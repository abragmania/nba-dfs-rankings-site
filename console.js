// The console: one team's depth chart on a plain light page (console-depth.js draws it). Every number comes from console-engine.js over the
// inputs route; his work saves to the slate's scenarios.json as he goes, and each change goes to the board and the optimizer by itself
// (console-auto.js), so there is no Apply step. This file holds the shared state, drawing, loading and the screen's clicks and keys;
// console-moves.js acts on the state.
import { esc, tipWhen } from "./board-util.js";
import { buildModel, buildTeam, canonRecord, recordOf, refreshTeams, savedBehind, typedText } from "./console-model.js";
import { depthHtml } from "./console-depth.js";
import { dropMark, firstPlaying, jumpTeam, pushHist, redo, setPin, setSource, toggleOut, toggleStarter, undo } from "./console-moves.js";
import { cardApi, lineupViewOf } from "./console-card.js";
import { createAutoApply, createPullReads, mayAutoSend, requeueApplied, requeueNews, resendChanged, resultSigs } from "./console-auto.js";
import { PIN_MAX } from "./override-limits.js";
import { keyOf } from "./console-engine.js";
import { teamNews } from "./console-news.js";

const USAGE_RETRY_MS = 20_000;
const USAGE_RETRIES = 6;

/** A team's colour for its switcher button and header rule. On the light console a pale colour would vanish, so it is darkened to read. */
function teamColour(c, team) {
  const colour = c.colourOf(team);
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
  if (!m) return colour;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? `color-mix(in srgb, ${colour} 45%, #000)` : colour;
}

/** The input with the keyboard, found again after a redraw by its team, man and kind. */
function keepInput(c, draw) {
  const a = document.activeElement, at = a && c.el.contains(a) && a.matches("input.fin") ? { ...a.dataset, s: a.selectionStart, e: a.selectionEnd, typed: typedText(a) } : null;
  draw();
  if (!at) return;
  const el = c.el.querySelector(`input.fin[data-team="${CSS.escape(at.team)}"][data-id="${CSS.escape(at.id)}"][data-k="${at.k}"]`);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (at.typed === null) { el.select(); return; }
  el.value = at.typed; // a redraw (a pull, a send's state) never changes what he is in the middle of typing; the box keeps its new default, so a commit still sees a change
  el.setSelectionRange(at.s ?? at.typed.length, at.e ?? at.typed.length);
}

/** The lineup read behind the news strip (the News tab's own route, so the site serves it too): kept with the server's clock then, so its age moves on. Trouble is kept as words, never thrown into a redraw. */
async function readNews(c) {
  if (!c.news) return;
  const name = c.slate;
  try {
    const out = await c.api(`/api/slate/${encodeURIComponent(name)}/news-lineups`);
    if (name !== c.slate) return;
    c.newsRead = { state: "ok", latest: out.state === "ok" ? out.latest : null, nowMs: Number.isFinite(out.now_ms) ? out.now_ms : Date.now(), localAt: Date.now() };
  } catch (e) {
    if (name === c.slate) c.newsRead = { state: "fail", why: e.message };
  }
}

/** What the news strip and the Status column draw from now: { state, why, N } (console-news.js), or undefined when the page wired no news. */
function newsOpt(c) {
  if (!c.news) return undefined;
  const n = c.newsRead;
  if (!n) return { state: "loading" };
  if (n.state !== "ok") return n;
  try {
    const slate = c.news.slateData();
    if (!slate) return { state: "fail", why: "no slate on show" };
    return { state: "ok", N: teamNews({ slate, latest: n.latest, nowMs: n.nowMs + (Date.now() - n.localAt), tips: c.news.tips(), view: c.model ? lineupViewOf(c) : null }, c.G.cur) };
  } catch (e) {
    return { state: "fail", why: e.message };
  }
}

function render(c) {
  const G = c.G;
  if (c.loadError || !c.model || !G.cur) return;
  const typing = document.activeElement;
  if (typing && c.el.contains(typing) && typing.matches?.("input.fin") && typedText(typing) !== null) { c.redrawLater = true; return; } // he is part-way through a number: a redraw would end the box (and commit half of it), so it waits until he leaves it
  c.redrawLater = false;
  const saveErr = Object.values(c.saveErrs).join(" ") || null;
  keepInput(c, () => {
    c.E("app").innerHTML = depthHtml(c.model, G.cur, { games: c.inputs.games, colourOf: (t) => teamColour(c, t), when: tipWhen(c.slate), slate: c.slate, sync: c.sync, canUndo: G.hi > 0, canRedo: G.hi < G.hist.length - 1, saveErr, news: newsOpt(c), help: G.help });
  });
  c.onWork?.();
}

/** Console trouble stays in the console: the board underneath is never written over. */
function showError(c, message) {
  c.loadError = message;
  c.model = null;
  c.E("app").innerHTML = `<div class="fatalc">The console could not load, so nothing here can be trusted or saved: ${esc(message)}</div>`;
}

function takeInputs(c, out) {
  c.inputs = out.inputs;
  c.applied = out.scenarios.applied;
}

/** The slate's work loaded, shown or not (the player card and the board ask for it): one load at a time per slate, a second ask waiting on the first. */
function ensure(c, name) {
  if (c.model && c.slate === name) return Promise.resolve();
  if (c.loading?.name === name) return c.loading.p;
  const p = load(c, name).finally(() => { if (c.loading?.p === p) c.loading = null; });
  c.loading = { name, p };
  return p;
}

async function load(c, name) {
  clearTimeout(c.usageTimer);
  clearTimeout(c.retryTimer);
  Object.assign(c, { slate: name, loadError: null, model: null, newsRead: null, usageTries: 0, saveErrs: {}, sync: { state: "ok", at: null }, touched: new Set(), pending: new Set() }); // another slate: nothing changed on it yet
  c.E("app").innerHTML = `<div class="fatalc dimc">Loading ${esc(name)}...</div>`;
  try {
    const out = await c.api(`/api/slate/${encodeURIComponent(name)}/console`);
    if (name !== c.slate) return;
    takeInputs(c, out);
    c.model = buildModel(c.inputs, out.scenarios.teams, out.scenarios.applied?.keys);
    c.lastSaved = {};
    c.serverSeen = Object.fromEntries(Object.keys(c.model.ST).map((code) => [code, canonRecord(out.scenarios.teams[code])])); // what the server held for each team when this page last looked or wrote
    for (const code of Object.keys(c.model.ST)) c.lastSaved[code] = savedBehind(out.scenarios.teams[code], c.model.ST[code]) ? "unsaved" : JSON.stringify(recordOf(c.model.ST[code])); // work rebased on a newer pull, or cleaned of old copies, is written on the next save
    const G = c.G, first = Object.keys(c.model.TEAMS)[0] ?? null;
    Object.assign(G, { cur: first, view: "team", editing: false, modal: null, pick: null, roleMoves: null, hist: [], hi: -1, focus: first ? { team: first, id: firstPlaying(c, first), k: "m" } : null });
    if (!first) return showError(c, "This slate has no games.");
    pushHist(c, "Start");
    render(c);
    readNews(c).then(() => { if (c.on && name === c.slate) render(c); }); // the strip says "reading..." until the read lands; readNews never rejects
    const news = requeueNews(c), applied = requeueApplied(c);
    if (news || applied) c.auto.kick(); // a news change whose send never landed, or a pull since the last send, reaches the board now
    else c.auto.settleNow(); // old work this page does not send (a locked or older slate, a mark nothing moved) is said in the header, not "up to date"
    watchUsage(c);
  } catch (e) {
    if (name === c.slate) showError(c, e.message);
  }
}

/** New inputs on the work on show: his marks stay and the numbers move. Comes on every show, while the usage table is loading, and when a send finds a newer pull. */
async function refresh(c) {
  const name = c.slate;
  try {
    await c.saveQueue; // his own saves have landed, so what the server holds is comparable
    const gen = c.saveGen;
    const out = await c.api(`/api/slate/${encodeURIComponent(name)}/console`);
    if (name !== c.slate || !c.model) return;
    await readNews(c);
    if (name !== c.slate || !c.model) return;
    const was = resultSigs(c);
    takeInputs(c, out);
    refreshTeams(c.model, c.inputs);
    const others = c.saveGen === gen ? takeOthersWork(c, out) : []; // a save of his own during the read makes the comparison unsafe, so it waits for the next one
    resendChanged(c, was); // a pull that moved a team the board holds is sent without a click
    render(c);
    if (others.length) c.toast(`${others.join(", ")} changed outside this page (the lineup news or another page): it took those marks and sent nothing over them.`, "notice");
  } catch (e) {
    c.toast(`Could not refresh the console's inputs: ${e.message}`, "err");
    c.auto?.fail(`The console could not read the new inputs, so the board may be behind: ${e.message}`); // the header is not green
  }
}

/** A team whose saved record on the server is not the one this page last saved was written by another page: this page takes the server's record for it (marks, scenario, source) and does not send its own copy. The teams taken. */
export function takeOthersWork(c, out) {
  const taken = [];
  for (const [code, input] of Object.entries(c.inputs.teams)) {
    const seen = c.serverSeen?.[code], now = canonRecord(out.scenarios.teams[code]);
    (c.serverSeen ??= {})[code] = now;
    if (seen === undefined || seen === now || c.lastSaved[code] === "unsaved") continue; // nobody else wrote, or his own write is still to come
    const { T, S } = buildTeam(input, out.scenarios.teams[code], out.scenarios.applied?.keys?.[code]);
    c.model.TEAMS[code] = T; c.model.ST[code] = S;
    c.lastSaved[code] = savedBehind(out.scenarios.teams[code], S) ? "unsaved" : JSON.stringify(recordOf(S));
    c.touched?.delete(code); c.pending?.delete(code);
    taken.push(code);
  }
  return taken;
}

function watchUsage(c) {
  clearTimeout(c.usageTimer);
  if (c.inputs?.usage.state !== "loading" || c.usageTries >= USAGE_RETRIES) return;
  c.usageTries++;
  c.usageTimer = setTimeout(async () => { await refresh(c); watchUsage(c); }, USAGE_RETRY_MS);
}

/** A typed minutes or DK/min box closed with a new number: it becomes his mark; an empty box drops the mark. A bad number is refused, said, and put back. */
function commitBox(c, inp) {
  if (inp.dataset.done) return; // Enter has sent it; the change event that follows is the same commit
  inp.dataset.done = "1";
  const shown = inp.defaultValue;
  inp.defaultValue = inp.value; // what he typed is now committed text, so the redraw this commit causes is not held back as half-typed (render)
  const { team, id, k } = inp.dataset, text = inp.value.trim();
  const T = c.model.TEAMS[team];
  if (!T) return;
  const S = c.model.ST[team], had = S.pins[keyOf(S.outs)]?.[k]?.[id];
  if (text === "") { if (had !== undefined) dropMark(c, team, id, k); else render(c); return; }
  const v = /^(\d+\.?\d*|\.\d+)$/.test(text) ? Number(text) : NaN;
  if (!(v >= 0 && v <= PIN_MAX[k])) { c.toast(`${k === "m" ? "Minutes" : "DK/min"} must be a number from 0 to ${PIN_MAX[k]}.`, "err"); render(c); return; }
  if (shown !== "" && Number(shown) === v) { delete inp.dataset.done; return; } // unchanged as shown
  setPin(c, team, id, k, v);
}

function onClick(c, e) {
  const t = e.target.closest?.("button");
  if (!t || !c.model || t.disabled) return;
  const d = t.dataset;
  if (d.teamGo) jumpTeam(c, d.teamGo);
  else if (d.help) { c.G.help = !c.G.help; render(c); }
  else if (d.goNews) c.onNews?.(c.G.cur);
  else if (d.undo) dropMark(c, d.team, d.id, d.undo);
  else if (d.s) toggleStarter(c, d.team, d.s);
  else if (d.out) toggleOut(c, d.team, d.out);
  else if (d.source) setSource(c, d.team, d.source);
  else if (d.sourceAll) setSource(c, d.team, d.sourceAll, true);
  else if (d.hist) (d.hist === "-1" ? undo : redo)(c);
}

function onKey(c, e) {
  if (!c.on || !c.model) return;
  const inBox = e.target.matches?.("input.fin");
  if (inBox && e.key === "Escape") { e.preventDefault(); e.target.value = e.target.defaultValue; e.target.blur(); return; }
  if (inBox && e.key === "Enter") { e.preventDefault(); commitBox(c, e.target); return; }
  if (inBox || !(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(c); } else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(c); }
}

const SHELL = `<div id="app"></div>`;

/** deps: { el, api, toast, colourOf(team) -> css colour, onPlayers(players), onWork() (his work moved: the board reads his marks again), news: { slateData() -> the slate with the board's rows, tips() -> { tip, tipAt } }
 *  (the lineup news strip and the Status column; without it neither reads the news), onNews() (the strip's link: opens the News tab) }. show() never rejects: its trouble goes to showError. */
export function createConsole({ el, api, toast, colourOf, onPlayers, onWork, news, onNews }) {
  el.innerHTML = SHELL;
  const c = {
    el, api, toast, colourOf, onPlayers, onWork, news, onNews, newsRead: null, on: false, slate: null, inputs: null, model: null, applied: null, loadError: null, lastSaved: {}, saveErrs: {}, saveQueue: Promise.resolve(), usageTimer: null, usageTries: 0, sync: { state: "ok", at: null },
    E: (id) => el.querySelector(`#${id}`),
    G: { cur: null, view: "team", pick: null, roleMoves: null, focus: null, hist: [], hi: -1, editing: false, rows: [], modal: null },
    render: () => render(c), drawBar: () => render(c), focusCell: () => {},
  };
  c.auto = createAutoApply(c, { refreshInputs: () => refresh(c), onState: () => { if (c.on) render(c); else c.onWork?.(); } }); // the board shows the send's state too
  el.addEventListener("click", (e) => onClick(c, e));
  el.addEventListener("change", (e) => { if (e.target.matches?.("input.fin")) commitBox(c, e.target); });
  el.addEventListener("focusout", () => setTimeout(() => { if (c.redrawLater && c.on) render(c); }, 0)); // the redraw that waited for him to finish typing
  document.addEventListener("keydown", (e) => onKey(c, e));
  return {
    /** The slate on show changed. Nothing loads until the console is opened or the board asks. */
    setSlate(name) {
      if (name === c.slate) return;
      Object.assign(c, { slate: name, model: null, inputs: null, loadError: null, newsRead: null });
      clearTimeout(c.usageTimer);
      clearTimeout(c.retryTimer);
      if (c.on) load(c, name);
    },
    show(name) {
      c.on = true;
      el.hidden = false;
      if (name !== c.slate || !c.model) return ensure(c, name);
      try {
        render(c);
      } catch (e) {
        showError(c, e.message);
        return Promise.resolve();
      }
      return refresh(c);
    },
    hide() { c.on = false; el.hidden = true; },
    isOn: () => c.on,
    /** An in-place pull refresh landed on the open page (board.js applyFresh), console open or not: the work loads if it has not (a load re-checks every team the board holds), else its inputs are
     *  read again and each team whose result moved is sent by the console's own send line, one at a time after any send in flight. One read at a time; teams with nothing held send nothing. */
    async onPull(name) {
      c.pullName = name;
      await (c.pullReads ??= createPullReads({
        read: () => (c.pullName !== c.slate || !c.model ? ensure(c, c.pullName) : refresh(c)),
        kick: () => { if (mayAutoSend(c.inputs)) c.auto.kick(); },
        pending: () => c.pending ?? new Set(),
      }))();
      return !c.loadError && Boolean(c.model);
    },
    /** The player card's and the board's reads and writes on the same work (console-card.js). */
    ...cardApi(c, (name) => ensure(c, name)),
  };
}
