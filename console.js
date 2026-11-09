// The console: one team's depth chart on a plain light page (console-depth.js draws it). Every number comes from console-engine.js over the
// inputs route; his work saves to the slate's scenarios.json as he goes, and each change goes to the board and the optimizer by itself
// (console-auto.js), so there is no Apply step. This file holds the shared state, drawing, loading and the screen's clicks and keys;
// console-moves.js acts on the state.
import { esc, tipWhen } from "./board-util.js";
import { buildModel, recordOf, refreshTeams } from "./console-model.js";
import { depthHtml } from "./console-depth.js";
import { dropMark, firstPlaying, jumpTeam, pushHist, redo, setPin, setSource, toggleOut, toggleStarter, undo } from "./console-moves.js";
import { cardApi } from "./console-card.js";
import { createAutoApply, requeueNews } from "./console-auto.js";
import { PIN_MAX } from "./override-limits.js";
import { keyOf } from "./console-engine.js";

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
  const a = document.activeElement, at = a && c.el.contains(a) && a.matches("input.fin") ? { ...a.dataset, s: a.selectionStart, e: a.selectionEnd } : null;
  draw();
  if (!at) return;
  const el = c.el.querySelector(`input.fin[data-team="${CSS.escape(at.team)}"][data-id="${CSS.escape(at.id)}"][data-k="${at.k}"]`);
  if (!el) return;
  el.focus({ preventScroll: true });
  el.select();
}

function render(c) {
  const G = c.G;
  if (c.loadError || !c.model || !G.cur) return;
  const saveErr = Object.values(c.saveErrs).join(" ") || null;
  keepInput(c, () => {
    c.E("app").innerHTML = depthHtml(c.model, G.cur, { games: c.inputs.games, colourOf: (t) => teamColour(c, t), when: tipWhen(c.slate), slate: c.slate, sync: c.sync, canUndo: G.hi > 0, canRedo: G.hi < G.hist.length - 1, saveErr });
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
  Object.assign(c, { slate: name, loadError: null, model: null, usageTries: 0, saveErrs: {}, sync: { state: "ok", at: null }, touched: new Set(), pending: new Set() }); // another slate: nothing changed on it yet
  c.E("app").innerHTML = `<div class="fatalc dimc">Loading ${esc(name)}...</div>`;
  try {
    const out = await c.api(`/api/slate/${encodeURIComponent(name)}/console`);
    if (name !== c.slate) return;
    takeInputs(c, out);
    c.model = buildModel(c.inputs, out.scenarios.teams, out.scenarios.applied?.keys);
    c.lastSaved = {};
    for (const code of Object.keys(c.model.ST)) c.lastSaved[code] = JSON.stringify(recordOf(c.model.ST[code]));
    const G = c.G, first = Object.keys(c.model.TEAMS)[0] ?? null;
    Object.assign(G, { cur: first, view: "team", editing: false, modal: null, pick: null, roleMoves: null, hist: [], hi: -1, focus: first ? { team: first, id: firstPlaying(c, first), k: "m" } : null });
    if (!first) return showError(c, "This slate has no games.");
    pushHist(c, "Start");
    render(c);
    if (requeueNews(c)) c.auto.kick(); // a news change whose send never landed reaches the board now
    watchUsage(c);
  } catch (e) {
    if (name === c.slate) showError(c, e.message);
  }
}

/** New inputs on the work on show: his marks stay and the numbers move. Comes on every show, while the usage table is loading, and when a send finds a newer pull. */
async function refresh(c) {
  const name = c.slate;
  try {
    const out = await c.api(`/api/slate/${encodeURIComponent(name)}/console`);
    if (name !== c.slate || !c.model) return;
    takeInputs(c, out);
    refreshTeams(c.model, c.inputs);
    render(c);
  } catch (e) {
    c.toast(`Could not refresh the console's inputs: ${e.message}`, "err");
  }
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
  const { team, id, k } = inp.dataset, text = inp.value.trim();
  const T = c.model.TEAMS[team];
  if (!T) return;
  const S = c.model.ST[team], had = S.pins[keyOf(S.outs)]?.[k]?.[id];
  if (text === "") { if (had !== undefined) dropMark(c, team, id, k); else render(c); return; }
  const v = /^(\d+\.?\d*|\.\d+)$/.test(text) ? Number(text) : NaN;
  if (!(v >= 0 && v <= PIN_MAX[k])) { c.toast(`${k === "m" ? "Minutes" : "DK/min"} must be a number from 0 to ${PIN_MAX[k]}.`, "err"); render(c); return; }
  if (inp.defaultValue !== "" && Number(inp.defaultValue) === v) { delete inp.dataset.done; return; } // unchanged as shown
  setPin(c, team, id, k, v);
}

function onClick(c, e) {
  const t = e.target.closest?.("button");
  if (!t || !c.model || t.disabled) return;
  const d = t.dataset;
  if (d.teamGo) jumpTeam(c, d.teamGo);
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

/** deps: { el, api, toast, colourOf(team) -> css colour, onPlayers(players), onWork() (his work moved: the board reads his marks again) }. show() never rejects: its trouble goes to showError. */
export function createConsole({ el, api, toast, colourOf, onPlayers, onWork }) {
  el.innerHTML = SHELL;
  const c = {
    el, api, toast, colourOf, onPlayers, onWork, on: false, slate: null, inputs: null, model: null, applied: null, loadError: null, lastSaved: {}, saveErrs: {}, saveQueue: Promise.resolve(), usageTimer: null, usageTries: 0, sync: { state: "ok", at: null },
    E: (id) => el.querySelector(`#${id}`),
    G: { cur: null, view: "team", pick: null, roleMoves: null, focus: null, hist: [], hi: -1, editing: false, rows: [], modal: null },
    render: () => render(c), drawBar: () => render(c), focusCell: () => {},
  };
  c.auto = createAutoApply(c, { refreshInputs: () => refresh(c), onState: () => { if (c.on) render(c); else c.onWork?.(); } }); // the board shows the send's state too
  el.addEventListener("click", (e) => onClick(c, e));
  el.addEventListener("change", (e) => { if (e.target.matches?.("input.fin")) commitBox(c, e.target); });
  document.addEventListener("keydown", (e) => onKey(c, e));
  return {
    /** The slate on show changed. Nothing loads until the console is opened or the board asks. */
    setSlate(name) {
      if (name === c.slate) return;
      Object.assign(c, { slate: name, model: null, inputs: null, loadError: null });
      clearTimeout(c.usageTimer);
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
    /** The player card's and the board's reads and writes on the same work (console-card.js). */
    ...cardApi(c, (name) => ensure(c, name)),
  };
}
