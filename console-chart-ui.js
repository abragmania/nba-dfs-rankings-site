// The depth chart's clicks and drags on the console page (console-chart.js draws it; Adam 11-17, "i can move guys to any position I want"): click a man to select him; the bar's arrows move him one place
// in his column, its picker gives him another position at the same depth, its B+ makes him Bench+ tonight (an engine role mark, console-moves.js setRole); drag a man by his handle within a column or into
// another one. Every move is one history step (Undo and Redo), runs the minutes again at once and is saved to the standing chart (console-moves.js depthMove). The public site's chart is read-only.
import { calc } from "./console-model.js";
import { chartModel } from "./console-chart.js";
import { depthMove, setRole } from "./console-moves.js";
import { moveAt, stepMove, posMove, POSITIONS } from "./depth-cols.js";

/** The team's chart now, and a man's key and name in it: { cm, keyOf(id), nameOf(id) } or null. */
function chartNow(c, team) {
  const T = c.model?.TEAMS[team], S = c.model?.ST[team];
  if (!T || !S) return null;
  const cm = chartModel(T, S, calc(T, S, S.outs).rows);
  return cm ? { cm, keyOf: (id) => T.tier.men[id]?.key ?? null, nameOf: (id) => T.byId[id]?.name ?? T.tier.men[id]?.name ?? id } : null;
}
const SHOW_INJ_KEY = "nbaboard.console.showinjured"; // the chart's "Show injured" switch, kept in this browser (Adam 3:35 PM 11-18); off by default; display only
/** Whether the switch is on: the page's live state, read once from this browser. */
export function showInjured(c) {
  if (c.G.showInj === undefined) {
    try { c.G.showInj = localStorage.getItem(SHOW_INJ_KEY) === "1"; } catch (e) { console.warn(`Console: the Show injured switch could not be read (${e.message})`); c.G.showInj = false; }
  }
  return c.G.showInj === true;
}
const at = () => new Date().toISOString();

/** A click inside the chart: true when it was the chart's. */
export function chartClick(c, e) {
  const chip = e.target.closest?.("[data-dchip]"), btn = e.target.closest?.("button");
  if (btn?.dataset.dshowinj) {
    c.G.showInj = !showInjured(c);
    try { localStorage.setItem(SHOW_INJ_KEY, c.G.showInj ? "1" : "0"); } catch (err) { console.warn(`Console: the Show injured switch could not be saved (${err.message})`); }
    c.render();
    return true;
  }
  if (btn?.dataset.dbp) { // the chart's B+ and the team table's B+ (console-depth.js manRow): one move, the card's role button's (console-moves.js setRole); no chart needed
    const { team, id } = btn.dataset, row = c.model?.TEAMS[team] ? calc(c.model.TEAMS[team], c.model.ST[team], c.model.ST[team].outs).rows.find((r) => r.id === id) : null;
    if (row && !c.readOnly && row.role !== "starter") setRole(c, team, id, row.role === "bench_plus" ? "bench" : "bench_plus");
    return true;
  }
  if (btn?.dataset.dstep) {
    const { team, id } = btn.dataset, ch = chartNow(c, team);
    if (!ch || c.readOnly) return true;
    const key = ch.keyOf(id), mv = stepMove(ch.cm.view, key, Number(btn.dataset.dstep), at());
    if (mv) depthMove(c, team, mv, `${ch.nameOf(id)} ${btn.dataset.dstep === "-1" ? "up" : "down"} at ${mv.pos}`);
    return true;
  }
  if (chip && !btn) {
    c.G.chartSel = c.G.chartSel === chip.dataset.dchip ? null : chip.dataset.dchip;
    c.render();
    return true;
  }
  return false;
}

/** The position picker changed: true when it was the chart's. */
export function chartChange(c, e) {
  const sel = e.target;
  if (!sel?.matches?.("select[data-dpos]")) return false;
  const { team, id } = sel.dataset, ch = chartNow(c, team);
  if (!ch || c.readOnly || !POSITIONS.includes(sel.value)) return true;
  const key = ch.keyOf(id), mv = posMove(ch.cm.view, key, sel.value, at()) ?? (ch.cm.posOf(id) ? null : moveAt(ch.cm.view, key, sel.value, ch.cm.view[sel.value].length, at()));
  if (mv) depthMove(c, team, mv, `${ch.nameOf(id)} to ${sel.value}`);
  return true;
}

/** Where a drop over `col` lands: the place before the first chip (not the dragged man) whose middle is below the pointer. */
function dropIndex(col, y, id) {
  const chips = [...col.querySelectorAll("[data-dchip]")].filter((x) => x.dataset.dchip !== id);
  const i = chips.findIndex((x) => { const r = x.getBoundingClientRect(); return y < r.top + r.height / 2; });
  return { index: i < 0 ? chips.length : i, before: i < 0 ? null : chips[i] };
}
const clearMarks = (el) => { for (const x of el.querySelectorAll(".dropb, .drope, .dragging")) x.classList.remove("dropb", "drope", "dragging"); };

/** Drag and drop on the chart: wired once on the console's element. */
export function wireChartDrag(c, el) {
  el.addEventListener("dragstart", (e) => {
    const chip = e.target.closest?.("[data-dchip]");
    if (!chip || c.readOnly) return;
    c.drag = { team: chip.dataset.team, id: chip.dataset.dchip };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", chip.dataset.dchip);
    chip.classList.add("dragging");
  });
  el.addEventListener("dragover", (e) => {
    const col = e.target.closest?.("[data-dcol]");
    if (!c.drag || !col || !POSITIONS.includes(col.dataset.dcol)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    for (const x of el.querySelectorAll(".dropb, .drope")) x.classList.remove("dropb", "drope");
    const d = dropIndex(col, e.clientY, c.drag.id);
    (d.before ?? col).classList.add(d.before ? "dropb" : "drope");
  });
  el.addEventListener("drop", (e) => {
    const col = e.target.closest?.("[data-dcol]"), drag = c.drag;
    c.drag = null;
    clearMarks(el);
    if (!drag || !col || !POSITIONS.includes(col.dataset.dcol)) return;
    e.preventDefault();
    const ch = chartNow(c, drag.team);
    if (!ch) return;
    const pos = col.dataset.dcol, key = ch.keyOf(drag.id), { index } = dropIndex(col, e.clientY, drag.id), mv = moveAt(ch.cm.view, key, pos, index, at());
    const from = ch.cm.posOf(drag.id);
    if (from === pos && ch.cm.view[pos].indexOf(key) === index) return; // dropped where he stood
    c.G.chartSel = drag.id;
    depthMove(c, drag.team, mv, `${ch.nameOf(drag.id)} to ${pos}${from === pos ? "" : ` (from ${from ?? "no position"})`}, ${index === 0 ? "the top" : `${index + 1} deep`}`);
  });
  el.addEventListener("dragend", () => { c.drag = null; clearMarks(el); });
}
