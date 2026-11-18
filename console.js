// The console: one team's depth chart on a plain light page (console-depth.js draws it). Every number comes from console-engine.js over the
// inputs route; his work saves to the slate's scenarios.json as he goes, and each change goes to the board and the optimizer by itself
// (console-auto.js), so there is no Apply step. This file holds the shared state, drawing, loading and the screen's clicks and keys;
// console-moves.js acts on the state.
import { esc, isoToEastern, tipWhen } from "./board-util.js";
import { buildModel, buildTeam, canonRecord, recordOf, refreshTeams, rolesText, savedBehind, typedText } from "./console-model.js";
import { depthHtml } from "./console-depth.js";
import { clearStanding, dropMark, firstPlaying, jumpTeam, pushHist, redo, saveDirty, setPin, setSource, toggleOut, toggleStarter, undo } from "./console-moves.js";
import { roleMarksFootHtml } from "./console-role-foot.js";
import { cardApi, lineupViewOf } from "./console-card.js";
import { createAutoApply, createPullReads, mayAutoSend, requeueApplied, requeueNews, resendChanged, resultSigs } from "./console-auto.js";
import { PIN_MAX } from "./override-limits.js";
import { keyOf } from "./console-engine.js";
import { defaultSourceOf } from "./depth-chart.js";
import { teamNews, newsView } from "./console-news.js";
import { landingHtml, teamBarOf, withAllChip } from "./console-all.js";
import { statusLine } from "./lineup-bar.js";
import { chartClick, chartChange, wireChartDrag, showInjured } from "./console-chart-ui.js";

/** His depth-chart moves as the server holds them, per team (console-moves.js saveDepth compares against it). */
const depthTexts = (model) => Object.fromEntries(Object.entries(model.TEAMS).map(([code, T]) => [code, JSON.stringify(T.tier?.depth?.moves ?? null)]));
const roleStamps = (model) => Object.fromEntries(Object.entries(model.TEAMS).filter(([, T]) => T.tier?.role_marks_stamp).map(([code, T]) => [code, T.tier.role_marks_stamp]));
const roleTexts = (model) => Object.fromEntries(Object.entries(model.TEAMS).filter(([, T]) => T.tier?.role_marks).map(([code, T]) => [code, rolesText(T.tier.role_marks)])); // his standing role marks as the chart holds them (Adam 10:25 AM 11-18)

const USAGE_RETRY_MS = 20_000;
const USAGE_RETRIES = 6;
/** After a failed read of the inputs, the next try: the board's own check runs once a minute (slate-refresh.js CHECK_MS), and a failed read has already taken its stamp. */
export const READ_RETRY_MS = 60_000;

const etAt = (ms) => (Number.isFinite(ms) ? isoToEastern(new Date(ms).toISOString()) : null) ?? "an unknown time";
/** The muted line at the page's foot after a failed read of the inputs (G64: never the main view): the chart on show is the last good one, and from when. "" when the last read worked. Pure. */
export function readFootHtml(fail, goodMs) {
  if (!fail) return "";
  return `<p class="cfoot">The depth chart and minutes could not be refreshed at ${esc(etAt(fail.ms))} (${esc(fail.why)}), so they are as read at ${esc(etAt(goodMs))}. The console tries again by itself.</p>`;
}

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
    const line = out.state === "missing" ? "" : statusLine(out); // the read's own trouble (a page not read, men not matched): said at the foot of the All teams page (G62, G64)
    c.newsRead = { state: "ok", latest: out.state === "ok" ? out.latest : null, nowMs: Number.isFinite(out.now_ms) ? out.now_ms : Date.now(), localAt: Date.now(), notes: line ? [line] : [] };
  } catch (e) {
    if (name === c.slate) c.newsRead = { state: "fail", why: e.message };
  }
}

const FILTER_KEY = "nbaboard.console.newsfilter"; // the All teams page's team filter, kept in this browser (Adam 3:25 PM 11-17)
const dismissKey = (slate) => `nbaboard.lineupdismiss.${slate}`; // the lineup news's own record of conflicts he hid (id -> signature)
function readStore(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { console.warn(`Console: ${key} could not be read (${e.message})`); return fallback; }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { console.warn(`Console: ${key} could not be saved (${e.message})`); }
}
function readDismissed(slate) {
  try { return JSON.parse(readStore(dismissKey(slate), "{}")) ?? {}; } catch (e) { console.warn(`Console: the hidden conflicts are unreadable (${e.message})`); return {}; }
}

/** What the news strip, the Status column and the All teams page draw from now: { state, why, N (the team's), V (the slate's, console-news.js newsView) }, or undefined when the page wired no news. */
function newsOpt(c) {
  if (!c.news) return undefined;
  const n = c.newsRead;
  if (!n) return { state: "loading" };
  if (n.state !== "ok") return n;
  try {
    const slate = c.news.slateData();
    if (!slate) return { state: "fail", why: "no slate on show" };
    const read = { slate, latest: n.latest, nowMs: n.nowMs + (Date.now() - n.localAt), tips: c.news.tips(), view: c.model ? lineupViewOf(c) : null, dismissed: readDismissed(c.slate), notes: n.notes };
    const V = newsView(read);
    return { state: "ok", V, N: teamNews(read, c.G.cur, V) };
  } catch (e) {
    return { state: "fail", why: e.message };
  }
}

/** The page on show: one team's, or the All teams news list (the team bar is the console's own, with "All teams" first). */
function pageHtml(c, news) {
  const G = c.G;
  const team = depthHtml(c.model, G.cur, { games: c.inputs.games, colourOf: (t) => teamColour(c, t), when: tipWhen(c.slate), slate: c.slate, sync: c.sync, canUndo: G.hi > 0, canRedo: G.hi < G.hist.length - 1, saveErr: Object.values(c.saveErrs).join(" ") || null, news, help: G.help, chartSel: G.chartSel ?? null, showInj: showInjured(c), readOnly: c.readOnly });
  const foot = readFootHtml(c.readFail, c.inputsAt); // a failed refresh: at the page's foot, under either view
  if (G.view !== "all") return `${withAllChip(team, false)}${roleMarksFootHtml(c.model.TEAMS[G.cur], c.model.ST[G.cur], G.cur, c.readOnly === true)}${foot}`; // his standing role marks, at the foot (G64)
  const words = !news ? "No lineup news is wired on this page." : news.state === "loading" ? "Reading the lineup news..." : news.state !== "ok" ? `Lineup news not read: ${news.why}` : null;
  const body = words ? `<section class="ca"><header class="ca-h"><h1>Tonight's lineup news</h1></header><div class="ca-empty">${esc(words)}</div></section>` : landingHtml(news.V, G.newsTeam ?? "", c.inputs.games.flatMap((g) => [g.away, g.home]));
  return `${withAllChip(teamBarOf(team), true)}${body}${foot}`;
}

function render(c) {
  const G = c.G;
  if (c.loadError || !c.model || !G.cur) return;
  const typing = document.activeElement;
  if (typing && c.el.contains(typing) && typing.matches?.("input.fin") && typedText(typing) !== null) { c.redrawLater = true; return; } // he is part-way through a number: a redraw would end the box (and commit half of it), so it waits until he leaves it
  c.redrawLater = false;
  keepInput(c, () => { c.E("app").innerHTML = pageHtml(c, newsOpt(c)); });
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
  clearTimeout(c.readTimer);
  Object.assign(c, { slate: name, loadError: null, model: null, newsRead: null, usageTries: 0, saveErrs: {}, sync: { state: "ok", at: null }, touched: new Set(), pending: new Set(), readFail: null, inputsAt: null }); // another slate: nothing changed on it yet
  c.E("app").innerHTML = `<div class="fatalc dimc">Loading ${esc(name)}...</div>`;
  try {
    const out = await c.api(`/api/slate/${encodeURIComponent(name)}/console`);
    if (name !== c.slate) return;
    takeInputs(c, out);
    c.inputsAt = Date.now();
    c.model = buildModel(c.inputs, out.scenarios.teams, out.scenarios.applied?.keys);
    c.depthSaved = depthTexts(c.model); // his depth-chart moves as the standing chart holds them
    c.rolesSaved = roleTexts(c.model); // and his role marks
    c.rolesBase = roleStamps(c.model); // the marks as read, sent back as base with each save (the route refuses a save over marks that moved since)
    c.lastSaved = {};
    c.serverSeen = Object.fromEntries(Object.keys(c.model.ST).map((code) => [code, canonRecord(out.scenarios.teams[code])])); // what the server held for each team when this page last looked or wrote
    c.serverHisAt = Object.fromEntries(Object.keys(c.model.ST).map((code) => [code, out.scenarios.teams[code]?.his_at ?? null])); // each team's his_at as read: sent as `base` with every save, so a stale page cannot write over a brought-down record
    c.serverFileHisAt = out.scenarios.his_at ?? null; c.conflicted = new Set(); c.saveWaiting = false;
    for (const code of Object.keys(c.model.ST)) c.lastSaved[code] = savedBehind(out.scenarios.teams[code], c.model.ST[code]) ? "unsaved" : JSON.stringify(recordOf(c.model.ST[code])); // work rebased on a newer pull, or cleaned of old copies, is written on the next save
    const G = c.G, first = Object.keys(c.model.TEAMS)[0] ?? null;
    Object.assign(G, { cur: first, view: "all", editing: false, modal: null, pick: null, roleMoves: null, hist: [], hi: -1, focus: first ? { team: first, id: firstPlaying(c, first), k: "m" } : null });
    if (!first) return showError(c, "This slate has no games.");
    pushHist(c, "Start");
    render(c);
    readNews(c).then(() => { if (c.on && name === c.slate) render(c); }); // the strip says "reading..." until the read lands; readNews never rejects
    const news = requeueNews(c), applied = requeueApplied(c);
    if (news || applied) c.auto.kick(true); // (no click of his started it: his_at is carried) // a news change whose send never landed, or a pull since the last send, reaches the board now
    else c.auto.settleNow(); // old work this page does not send (a locked or older slate, a mark nothing moved) is said in the header, not "up to date"
    watchUsage(c);
  } catch (e) {
    if (name === c.slate) showError(c, e.message);
  }
}

const readFailMsg = (why) => `The console could not read the new inputs, so the board may be behind: ${why}`;

/**
 * New inputs on the work on show: his marks stay and the numbers move (R12: redrawn in place; his typed minutes are read, never written). Comes on every show, while the usage table is loading, when a
 * send finds a newer pull, and when the board's check sees a new pull, position read or Ours minutes record (pull-moves.js pullStamp, console onPull). A failed read keeps the last good chart, says so
 * at the page's foot (readFootHtml) and tries again after READ_RETRY_MS, one timer at a time.
 */
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
    clearTimeout(c.readTimer);
    if (c.readFail) { c.readFail = null; c.auto?.readOk(readFailMsg(c.readFailWhy)); }
    c.inputsAt = Date.now();
    refreshTeams(c.model, c.inputs);
    for (const [code, text] of Object.entries(depthTexts(c.model))) { // another page or the other computer saved a team's chart since this page last did: this page takes it
      const S = c.model.ST[code], mine = c.depthSaved?.[code];
      if (S && text !== "null" && mine !== undefined && mine !== "unsaved" && text !== mine) { S.depth_moves = JSON.parse(text); c.depthSaved[code] = text; }
      else if (c.depthSaved && mine === undefined) c.depthSaved[code] = text;
    }
    for (const [code, text] of Object.entries(roleTexts(c.model))) { // his role marks, the same way: another page's or the other computer's saved list is taken
      const S = c.model.ST[code], mine = c.rolesSaved?.[code];
      if (S && mine !== undefined && mine !== "unsaved" && text !== mine) { S.role_marks = structuredClone(c.model.TEAMS[code].tier.role_marks); c.rolesSaved[code] = text; }
      else if (c.rolesSaved && mine === undefined) c.rolesSaved[code] = text;
      if (c.rolesSaved?.[code] !== "unsaved") (c.rolesBase ??= {})[code] = c.model.TEAMS[code].tier.role_marks_stamp ?? "[]"; // his own saves have landed (saveQueue above): what the server holds is the base
    }
    c.serverFileHisAt = out.scenarios.his_at ?? null; // his saves have landed (saveQueue above), so the file's stamp is the base for the next send
    const others = c.saveGen === gen ? takeOthersWork(c, out) : []; // a save of his own during the read makes the comparison unsafe, so it waits for the next one
    resendChanged(c, was); // a pull that moved a team the board holds is sent without a click
    render(c);
    if (others.length) c.toast(`${others.join(", ")} changed outside this page (the lineup news or another page): it took those marks and sent nothing over them.`, "notice");
  } catch (e) {
    if (name !== c.slate || !c.model) return;
    c.readFail = { ms: Date.now(), why: e.message }; c.readFailWhy = e.message; // the chart on show stays; the foot says from when (G64: no toast in the main view)
    clearTimeout(c.readTimer);
    c.readTimer = setTimeout(() => { if (name === c.slate) pullRead(c, name); }, c.retryMs ?? READ_RETRY_MS);
    c.auto?.fail(readFailMsg(e.message)); // the header is not green (it draws the page, foot included, when the console is open)
    render(c);
  }
}

/** A pull, position read or Ours record landed (the board's check), or a failed read is tried again: the work loads if it has not, else its inputs are read again, one read at a time
 *  (console-auto.js createPullReads); each team whose result moved, and any still not on the board, is sent by the console's own line. */
function pullRead(c, name) {
  c.pullName = name;
  return (c.pullReads ??= createPullReads({
    read: () => (c.pullName !== c.slate || !c.model ? ensure(c, c.pullName) : refresh(c)),
    kick: () => { if (mayAutoSend(c.inputs)) c.auto.kick(true); }, // a pull's kick: no click of his
    pending: () => c.pending ?? new Set(),
  }))();
}

/** A team whose saved record on the server is not the one this page last saved was written by another page: this page takes the server's record for it (marks, scenario, source) and does not send its own copy. The teams taken. */
export function takeOthersWork(c, out) {
  const taken = [];
  for (const [code, input] of Object.entries(c.inputs.teams)) {
    const seen = c.serverSeen?.[code], now = canonRecord(out.scenarios.teams[code]), conflicted = c.conflicted?.has(code) === true; // conflicted: the server refused this page's save of the team (CHANGED_ELSEWHERE)
    (c.serverSeen ??= {})[code] = now;
    if (seen === undefined || seen === now || (c.lastSaved[code] === "unsaved" && !conflicted)) { // nobody else wrote, or his own write is still to come
      if (seen !== undefined && seen === now) { (c.serverHisAt ??= {})[code] = out.scenarios.teams[code]?.his_at ?? null; if (c.conflicted?.delete(code)) c.lastSaved[code] = "unsaved"; } // only the stamp moved: his work is saved again on the new base
      continue;
    }
    const { T, S } = buildTeam(input, out.scenarios.teams[code], out.scenarios.applied?.keys?.[code], defaultSourceOf(c.inputs));
    c.model.TEAMS[code] = T; c.model.ST[code] = S;
    c.lastSaved[code] = savedBehind(out.scenarios.teams[code], S) ? "unsaved" : JSON.stringify(recordOf(S));
    (c.serverHisAt ??= {})[code] = out.scenarios.teams[code]?.his_at ?? null; c.conflicted?.delete(code);
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
  if (c.model && chartClick(c, e)) return; // the depth chart's chips and bar (console-chart-ui.js)
  const t = e.target.closest?.("button");
  if (!t || !c.model || t.disabled) return;
  const d = t.dataset;
  if (d.teamGo) jumpTeam(c, d.teamGo);
  else if (d.goAll) { c.G.view = "all"; render(c); }
  else if ("caFilter" in d) { c.G.newsTeam = d.caFilter; writeStore(FILTER_KEY, d.caFilter); render(c); } // "" is All
  else if (d.caDismiss) { writeStore(dismissKey(c.slate), JSON.stringify({ ...readDismissed(c.slate), [d.caDismiss]: d.caSig ?? "" })); render(c); }
  else if (d.help) { c.G.help = !c.G.help; render(c); }
  else if (d.undo) dropMark(c, d.team, d.id, d.undo);
  else if (d.clearMark) clearStanding(c, d.team, d.clearMark); // a standing role mark off, back to the rule (Undo brings it back)
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
 *  (the lineup news strip, the Status column and the All teams page; without it none reads the news), retryMs (after a failed read of the inputs, the wait before the next; tests shorten it) }.
 *  show() never rejects: its trouble goes to showError. */
export function createConsole({ el, api, toast, colourOf, onPlayers, onWork, news, retryMs = READ_RETRY_MS }) {
  el.innerHTML = SHELL;
  const c = {
    el, api, toast, colourOf, onPlayers, onWork, news, retryMs, readFail: null, inputsAt: null, newsRead: null, on: false, slate: null, inputs: null, model: null, applied: null, loadError: null, lastSaved: {}, saveErrs: {}, saveQueue: Promise.resolve(), usageTimer: null, usageTries: 0, sync: { state: "ok", at: null },
    E: (id) => el.querySelector(`#${id}`),
    G: { cur: null, view: "all", newsTeam: readStore(FILTER_KEY, ""), pick: null, roleMoves: null, focus: null, hist: [], hi: -1, editing: false, rows: [], modal: null },
    render: () => render(c), drawBar: () => render(c), focusCell: () => {},
    readOnly: typeof document !== "undefined" && document.documentElement?.classList?.contains("is-site") === true, // the public site: the depth chart is read-only (its routes are the app's only)
  };
  c.auto = createAutoApply(c, { refreshInputs: () => refresh(c), onState: () => { if (c.on) render(c); else c.onWork?.(); } }); // the board shows the send's state too
  // A save the server refused as CHANGED_ELSEWHERE (console-moves.js saveDirty): read the disk's work now, which this page takes for that team, and save what is still its own.
  c.onConflict = () => { clearTimeout(c.conflictTimer); c.conflictTimer = setTimeout(async () => { await refresh(c); saveDirty(c); }, 0); };
  el.addEventListener("click", (e) => onClick(c, e));
  el.addEventListener("change", (e) => { if (e.target.matches?.("input.fin")) commitBox(c, e.target); else if (c.model) chartChange(c, e); });
  wireChartDrag(c, el);
  el.addEventListener("focusout", () => setTimeout(() => { if (c.redrawLater && c.on) render(c); }, 0)); // the redraw that waited for him to finish typing
  document.addEventListener("keydown", (e) => onKey(c, e));
  return {
    /** The slate on show changed. Nothing loads until the console is opened or the board asks. */
    setSlate(name) {
      if (name === c.slate) return;
      Object.assign(c, { slate: name, model: null, inputs: null, loadError: null, newsRead: null, readFail: null, inputsAt: null });
      clearTimeout(c.usageTimer);
      clearTimeout(c.retryTimer);
      clearTimeout(c.readTimer);
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
    /** An in-place pull refresh landed on the open page (board.js applyFresh: a new pull, position read or Ours minutes record moves the board's stamp), console open or not: the work loads if it has not
     *  (a load re-checks every team the board holds), else its inputs are read again and each team whose result moved is sent by the console's own send line, one at a time after any send in flight.
     *  One read at a time; teams with nothing held send nothing. */
    async onPull(name) {
      await pullRead(c, name);
      return !c.loadError && Boolean(c.model);
    },
    /** The player card's and the board's reads and writes on the same work (console-card.js). */
    ...cardApi(c, (name) => ensure(c, name)),
  };
}
