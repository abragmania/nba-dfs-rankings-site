// The console's keyboard and clicks. Each takes the console's shared state `c`; console.js attaches them.
import { parseCmd } from "./console-cmd.js";
import { COLS } from "./console-render.js";
import * as M from "./console-moves.js";
import { closeModal, confirmModal, openApply, openReverse } from "./console-applybox.js";

export const HINT = "try:  <name> 36   <name> out   <name> u 14   <name> p 40   <team>   slate   apply   undo";

export const cellOf = (c, f) => c.el.querySelector(`input.ed[data-team="${CSS.escape(f.team)}"][data-i="${CSS.escape(f.id)}"][data-k="${f.k}"]`);
export function focusCell(c) { if (c.G.focus) cellOf(c, c.G.focus)?.focus({ preventScroll: false }); }

const pos = (G) => G.rows.findIndex((x) => x.team === G.focus.team && x.id === G.focus.id);
/** The cells a row has: the lanes carry minutes and DK per minute only. */
const colsOf = (G) => (G.view === "team" && G.layout === "b" ? ["m", "d"] : COLS);
function nextFocus(G, dr, dc) {
  const cols = colsOf(G);
  let r = pos(G), col = Math.max(0, cols.indexOf(G.focus.k)) + dc;
  if (col >= cols.length) { col = 0; r++; }
  if (col < 0) { col = cols.length - 1; r--; }
  r = Math.max(0, Math.min(G.rows.length - 1, r + dr));
  col = Math.max(0, Math.min(cols.length - 1, col));
  return { team: G.rows[r].team, id: G.rows[r].id, k: cols[col] };
}
function go(c, dr, dc) {
  if (!c.G.rows.length) return;
  c.G.focus = nextFocus(c.G, dr, dc);
  c.G.editing = false;
  focusCell(c);
}
function commit(c, inp, dr, dc) {
  const v = parseFloat(inp.value), nf = nextFocus(c.G, dr, dc);
  c.G.editing = false;
  if (Number.isNaN(v) || v < 0 || inp.readOnly) { inp.value = inp.dataset.orig; inp.classList.remove("editing"); c.G.focus = nf; focusCell(c); return; }
  c.G.focus = nf;
  M.setPin(c, inp.dataset.team, inp.dataset.i, inp.dataset.k, v);
}
function startEdit(c, inp, typed) {
  c.G.editing = true;
  inp.dataset.orig = inp.value;
  inp.classList.add("editing");
  if (!typed) inp.setSelectionRange(inp.value.length, inp.value.length);
}
function openCmd(c) {
  const box = c.E("cmd");
  box.value = "";
  box.focus();
  cmdHint(c);
}

/** What the command box may do. */
const actions = (c) => ({
  G: c.G, model: c.model, render: c.render,
  undo: () => M.undo(c), redo: () => M.redo(c), jumpTeam: (t) => M.jumpTeam(c, t), setView: (v) => M.setView(c, v), resetScenario: () => M.resetScenario(c),
  setScenario: (t, k) => M.setScenario(c, t, k), toggleOut: (t, id) => M.toggleOut(c, t, id), clearPin: (t, id, k) => M.clearPin(c, t, id, k), setPin: (t, id, k, v) => M.setPin(c, t, id, k, v),
  setShare: (...a) => M.setShare(c, ...a), clearShare: (...a) => M.clearShare(c, ...a), saveCombo: (...a) => M.saveCombo(c, ...a), clearCombo: (...a) => M.clearCombo(c, ...a),
  openApply: () => openApply(c), reverse: () => openReverse(c),
});

export function cmdHint(c) {
  const r = parseCmd(actions(c), c.E("cmd").value);
  c.E("cmdhint").textContent = r ? (r.run ? "Enter: " : "") + r.msg : HINT;
}
function runCmd(c, s) {
  const r = parseCmd(actions(c), s);
  c.E("cmd").value = "";
  c.E("cmd").blur();
  if (r?.run) { r.run(); c.E("cmdhint").textContent = `done: ${r.msg}`; }
  else c.E("cmdhint").textContent = r ? r.msg : "";
  if (!c.G.modal) focusCell(c);
}

function keyInCommandBox(c, e, t) {
  if (e.key === "Enter") { e.preventDefault(); runCmd(c, t.value); }
  else if (e.key === "Escape") { t.value = ""; cmdHint(c); t.blur(); focusCell(c); }
}
function keyWhileEditing(c, e, inp) {
  const k = e.key;
  if (k === "Enter") { e.preventDefault(); commit(c, inp, e.shiftKey ? -1 : 1, 0); }
  else if (k === "Tab") { e.preventDefault(); commit(c, inp, 0, e.shiftKey ? -1 : 1); }
  else if (k === "ArrowDown" || k === "ArrowUp") { e.preventDefault(); commit(c, inp, k === "ArrowDown" ? 1 : -1, 0); }
  else if (k === "Escape") { e.preventDefault(); inp.value = inp.dataset.orig; c.G.editing = false; inp.classList.remove("editing"); inp.select(); }
}
/** Ctrl and Alt+digit moves; true when the key was theirs. */
function keyWithModifier(c, e) {
  const k = e.key;
  if (e.ctrlKey || e.metaKey) {
    const l = k.toLowerCase();
    if (l === "z") { e.preventDefault(); if (e.shiftKey) M.redo(c); else M.undo(c); }
    else if (l === "y") { e.preventDefault(); M.redo(c); }
    return true;
  }
  if (e.altKey && /^[1-9]$/.test(k)) {
    const code = Object.keys(c.model.TEAMS)[+k - 1];
    e.preventDefault();
    if (code) M.jumpTeam(c, code);
    return true;
  }
  return false;
}
function keyOnCell(c, e, inp) {
  const G = c.G, k = e.key, cell = inp ?? (G.focus ? cellOf(c, G.focus) : null);
  const adj = (d, big) => { e.preventDefault(); if (cell) M.adjust(c, cell, d, big); };
  const stop = (fn) => { e.preventDefault(); fn(); };
  const onTeam = (fn) => stop(() => { if (G.view === "team") fn(); });
  switch (k) {
    case "ArrowUp": case "ArrowDown": if (e.altKey) adj(k === "ArrowUp" ? 1 : -1, e.shiftKey); else stop(() => go(c, k === "ArrowUp" ? -1 : 1, 0)); break;
    case "ArrowLeft": stop(() => go(c, 0, -1)); break;
    case "ArrowRight": stop(() => go(c, 0, 1)); break;
    case "Tab": stop(() => go(c, 0, e.shiftKey ? -1 : 1)); break;
    case "Enter": stop(() => go(c, e.shiftKey ? -1 : 1, 0)); break;
    case "PageUp": adj(1, true); break;
    case "PageDown": adj(-1, true); break;
    case "=": adj(1, false); break;
    case "+": adj(1, true); break;
    case "-": adj(-1, false); break;
    case "_": adj(-1, true); break;
    case "Delete": case "Backspace": stop(() => M.clearPin(c, G.focus.team, G.focus.id, e.shiftKey ? null : G.focus.k)); break;
    case "F2": if (cell && !cell.readOnly) stop(() => startEdit(c, cell, false)); break;
    case "o": case "O": stop(() => M.toggleOut(c, G.focus.team, G.focus.id)); break;
    case "s": case "S": stop(() => M.setView(c, G.view === "slate" ? "team" : "slate")); break;
    case "g": case "G": case "/": case ":": stop(() => openCmd(c)); break;
    case "h": case "H": onTeam(() => M.setScenario(c, G.cur, "")); break;
    case "t": case "T": onTeam(() => M.setScenario(c, G.cur, c.model.TEAMS[G.cur].tonightKey)); break;
    case "[": onTeam(() => M.cycleScenario(c, -1)); break;
    case "]": onTeam(() => M.cycleScenario(c, 1)); break;
    case "<": case ">": stop(() => M.stepTeam(c, k === ">" ? 1 : -1)); break;
    case "a": case "A": stop(() => openApply(c)); break;
    case "r": case "R": stop(() => openReverse(c)); break;
    default:
      if (/^[0-9.]$/.test(k) && inp && !inp.readOnly && !e.altKey) startEdit(c, inp, true); // the default action then types over the selected text
      else if (k.length === 1) e.preventDefault();
  }
}

export function onKey(c, e) {
  if (!c.on || !c.model) return;
  const t = e.target, G = c.G;
  if (G.modal) {
    if (e.repeat) return; // a key still held from before the box opened is not an answer
    if (e.key === "Enter") { e.preventDefault(); confirmModal(c); }
    else if (e.key === "Escape") { e.preventDefault(); closeModal(c); }
    return;
  }
  if (t.id === "cmd") return keyInCommandBox(c, e, t);
  if (!c.el.contains(t) && t !== document.body) return; // the header's slate box and buttons keep their own keys
  if (keyWithModifier(c, e)) return;
  const inp = t.matches?.("input.ed") ? t : null;
  if (inp && G.editing) return keyWhileEditing(c, e, inp);
  if (!inp && t.tagName === "INPUT") return;
  keyOnCell(c, e, inp);
}

/** The compare block's row for the man in focus wears the same tint as his row in the main table. */
export function tintCompare(c) {
  for (const tr of c.el.querySelectorAll(".tc tr.rf")) tr.classList.remove("rf");
  if (c.G.focus) c.el.querySelector(`.tc tr[data-man="${CSS.escape(c.G.focus.id)}"]`)?.classList.add("rf");
}

export function onFocusIn(c, e) {
  const inp = e.target;
  if (!c.on || !c.model || !inp.matches?.("input.ed")) return;
  c.G.focus = { team: inp.dataset.team, id: inp.dataset.i, k: inp.dataset.k };
  if (!c.G.editing) inp.select();
  c.updateSide();
  tintCompare(c);
}
export function onFocusOut(c, e) {
  const inp = e.target;
  if (!c.on || !c.model || !inp.matches?.("input.ed") || !c.G.editing || inp.dataset.orig === undefined) return;
  const v = parseFloat(inp.value);
  c.G.editing = false;
  inp.classList.remove("editing");
  if (!Number.isNaN(v) && v >= 0 && !inp.readOnly && inp.isConnected && String(inp.value) !== inp.dataset.orig) M.setPin(c, inp.dataset.team, inp.dataset.i, inp.dataset.k, v);
}

function clickAction(c, b) {
  const d = b.dataset;
  if (d.role) { c.G.pick = null; M.setRole(c, d.team, d.ri, d.role); }
  else if (d.lay) c.setLayout(d.lay);
  else if (d.pick) { const same = c.G.pick?.team === d.team && c.G.pick.id === d.pick; c.G.pick = same ? null : { team: d.team, id: d.pick }; c.render(); }
  else if (d.t) M.jumpTeam(c, d.t);
  else if (b.id === "vslate") M.setView(c, c.G.view === "slate" ? "team" : "slate");
  else if (b.id === "vapply") openApply(c);
  else if (b.id === "vreverse") openReverse(c);
  else if (b.id === "applyGo") confirmModal(c);
  else if (b.id === "applyNo") closeModal(c);
  else if (d.key !== undefined && b.classList.contains("sv")) M.setScenario(c, c.G.cur, d.key);
  else if (d.o) M.toggleOut(c, d.team ?? c.G.cur, d.o);
  else if (d.del !== undefined) M.removeScenario(c, d.del);
  else if (b.id === "save") M.saveScenario(c);
  else if (b.id === "reset") M.resetScenario(c);
  else if (d.pinx) { const [tm, sk, k, id] = d.pinx.split("|"); M.clearPinAt(c, tm, sk, k, id); }
  else if (d.hist !== undefined) M.restore(c, +d.hist);
}
export function onClick(c, e) {
  const b = e.target.closest?.("button,[data-hist]");
  if (!c.model) return;
  // A man picked on the lanes goes to the lane tapped next (the phone's way to drag).
  const lane = !b && !e.target.closest?.("input") ? e.target.closest?.("[data-lane]") : null;
  if (lane && c.G.pick?.team === lane.dataset.team) {
    const { team, id } = c.G.pick;
    c.G.pick = null;
    if (!M.setRole(c, team, id, lane.dataset.lane)) c.render();
    return;
  }
  if (!b) return;
  clickAction(c, b);
  if (!c.G.modal) focusCell(c); // the keyboard goes back to the last cell after any toolbar click
}
