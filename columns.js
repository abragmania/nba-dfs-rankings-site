// The player table's columns (optimizer standard A1, A17): the standard's order, and Adam's own ticks and order, remembered
// per optimizer mode (Cash, GPP) in browser storage, a per-viewer convenience. The state helpers are pure and tested in node;
// columnsControl wires the Columns button and its list, whose listeners sit on the list's own element so they survive a redraw.
import { esc, keepFocus } from "./board-util.js";

// The player column is always on: a row with no name cannot be read.
export const COLUMNS = [
  { key: "star", label: "Star" },
  { key: "name", label: "Player", required: true },
  { key: "salary", label: "Sal" },
  { key: "projection", label: "Proj" },
  { key: "proj_own", label: "Own" },
  { key: "value", label: "Val" },
  { key: "minutes", label: "Min" },
  { key: "dk_tonight", label: "DK/m TON" },
  { key: "thumbs", label: "Thumbs" },
  { key: "lock", label: "Lock" },
  { key: "exclude", label: "Exclude" },
  { key: "min_pct", label: "Min %" },
  { key: "max_pct", label: "Max %" },
  { key: "min_usual", label: "Usual" },
  { key: "min_chg", label: "Chg" },
  { key: "dk_per_min", label: "DK/m SZN" },
  { key: "usage", label: "Usg" },
];
const BY_KEY = new Map(COLUMNS.map((c) => [c.key, c]));
const STANDARD = COLUMNS.map((c) => c.key);

/** The remembered state's version. 2 (Adam, 11-07): Min and DK/m TON sit right after Val, the two halves of the projection beside it. */
export const COLUMNS_VERSION = 2;
const BESIDE_VAL = ["minutes", "dk_tonight"];

/** The standard's order with every column ticked. */
export const defaultColumns = () => ({ v: COLUMNS_VERSION, order: [...STANDARD], hidden: [] });

/** A remembered state made safe: unknown and repeated keys dropped, a column it does not know put back after its standard
 *  neighbour, a required column never hidden. A state from before version 2 has Min and DK/m TON moved right after Val and ticked,
 *  once, so the new order shows without a reset. Anything that is not a state gives the standard's. */
export function cleanColumns(saved) {
  if (!saved || typeof saved !== "object" || !Array.isArray(saved.order)) return defaultColumns();
  let order = [...new Set(saved.order)].filter((k) => BY_KEY.has(k));
  STANDARD.forEach((k, i) => {
    if (order.includes(k)) return;
    const prev = i === 0 ? -1 : order.indexOf(STANDARD[i - 1]);
    order.splice(prev + 1, 0, k);
  });
  const old = !(saved.v >= COLUMNS_VERSION);
  if (old) {
    order = order.filter((k) => !BESIDE_VAL.includes(k));
    order.splice(order.indexOf("value") + 1, 0, ...BESIDE_VAL);
  }
  const hidden = Array.isArray(saved.hidden) ? [...new Set(saved.hidden)].filter((k) => BY_KEY.has(k) && !BY_KEY.get(k).required && !(old && BESIDE_VAL.includes(k))) : [];
  return { v: COLUMNS_VERSION, order, hidden };
}

/** The stored text to a state; missing or unreadable text gives the standard's. */
export function parseColumns(text) {
  if (typeof text !== "string") return defaultColumns();
  try {
    return cleanColumns(JSON.parse(text));
  } catch {
    return defaultColumns(); // a damaged remembered choice is only a lost convenience: the standard's order stands
  }
}

/** The keys the table draws, in order. `force` lists columns drawn even when unticked. */
export const shownKeys = (st, { force = [] } = {}) => st.order.filter((k) => !st.hidden.includes(k) || force.includes(k));

/** The keys the table draws for the page's state: in late swap mode the lock column always draws, as it holds the row's slot picker. */
export const tableKeys = (st, { lateSwap = false } = {}) => shownKeys(st, { force: lateSwap ? ["lock"] : [] });

/** Beside the player count when the sort's own column is hidden, so the row order still has a reason on screen; "" otherwise. */
export const sortNote = (keys, sort) => (keys.includes(sort.key) || !BY_KEY.has(sort.key) ? "" : ` · sorted by ${BY_KEY.get(sort.key).label}`);

/** True when a click fell outside `wrap`. The path is the one the click took, so a control the click's own handler has just
 *  redrawn away still counts as inside. */
export const clickedOutside = (e, wrap) => !e.composedPath().includes(wrap);

/** Which edge of the row under a drag the dropped column lands on (moveColumn's rule): "bottom" dragging down, "top" dragging
 *  up, null over itself. */
export function dropEdge(st, key, over) {
  const from = st.order.indexOf(key), to = st.order.indexOf(over);
  return from < 0 || to < 0 || from === to ? null : from < to ? "bottom" : "top";
}

/** The Columns list's entries, in order. */
export const listedColumns = (st) => st.order.map((k) => ({ ...BY_KEY.get(k), on: !st.hidden.includes(k) }));

/** Ticks or unticks a column; a required one stays on. */
export function toggleColumn(st, key) {
  if (!BY_KEY.has(key) || BY_KEY.get(key).required) return st;
  return { ...st, hidden: st.hidden.includes(key) ? st.hidden.filter((k) => k !== key) : [...st.hidden, key] };
}

/** Moves `key` to the place of `over`: below it when dragged down, above it when dragged up. */
export function moveColumn(st, key, over) {
  const from = st.order.indexOf(key), to = st.order.indexOf(over);
  if (from < 0 || to < 0 || from === to) return st;
  const order = [...st.order];
  order.splice(from, 1);
  order.splice(to, 0, key);
  return { ...st, order };
}

/** The Columns list's markup. */
export function columnsListHtml(st) {
  const rows = listedColumns(st).map((c) => `<li class="colrow" data-col="${esc(c.key)}"><span class="hnd" draggable="true" tabindex="0" role="button" data-col-handle="${esc(c.key)}" title="Drag to move ${esc(c.label)}; the up and down arrow keys move it too" aria-label="Move ${esc(c.label)}">⠿</span>`
    + `<label><input type="checkbox" data-col-tick="${esc(c.key)}"${c.on ? " checked" : ""}${c.required ? ` disabled title="The player column stays on"` : ""}> ${esc(c.label)}</label></li>`).join("");
  return `<ul class="collist">${rows}</ul><button class="colreset" data-col-reset>Reset columns</button>`;
}

const storeKey = (mode) => `nbaboard.columns.${mode}`;

/** Wires the Columns button and its list. mode() is the optimizer's mode now; onChange() redraws the table. */
export function columnsControl({ btn, pop, mode, tryStore, onChange }) {
  const load = (m) => parseColumns(tryStore(() => localStorage.getItem(storeKey(m))));
  let forMode = mode(), st = load(forMode), dragging = null;
  const draw = () => keepFocus(pop, () => { pop.innerHTML = columnsListHtml(st); });
  const set = (next) => {
    if (next === st) return;
    st = next;
    tryStore(() => localStorage.setItem(storeKey(forMode), JSON.stringify(st)));
    draw(); onChange();
  };
  const wrap = btn.closest(".colsw");
  const close = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", () => {
    if (!pop.hidden) return close();
    draw(); pop.hidden = false; btn.setAttribute("aria-expanded", "true");
    pop.querySelector(".hnd")?.focus({ preventScroll: true }); // Esc and the arrows work however the list was opened
  });
  document.addEventListener("click", (e) => { if (!pop.hidden && clickedOutside(e, wrap)) close(); });
  pop.addEventListener("change", (e) => { const k = e.target.dataset?.colTick; if (k) set(toggleColumn(st, k)); });
  pop.addEventListener("click", (e) => {
    if (!e.target.closest?.("[data-col-reset]")) return;
    st = defaultColumns();
    tryStore(() => localStorage.removeItem(storeKey(forMode)));
    draw();
    pop.querySelector("[data-col-reset]").focus({ preventScroll: true });
    onChange();
  });
  // Dragging moves a column on the drop only, as a redraw during a drag would end it. No pointer position is read, so the
  // wide-screen body zoom cannot put a column in the wrong place.
  const clearOver = () => pop.querySelectorAll(".colrow.over").forEach((r) => r.classList.remove("over", "down"));
  pop.addEventListener("dragstart", (e) => {
    const k = e.target.dataset?.colHandle;
    if (!k) { e.preventDefault(); return; }
    dragging = k;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", k);
    e.dataTransfer.setDragImage(e.target.closest(".colrow"), 8, 8);
  });
  pop.addEventListener("dragover", (e) => {
    const row = e.target.closest?.(".colrow");
    if (!dragging || !row) return;
    e.preventDefault();
    clearOver();
    const edge = dropEdge(st, dragging, row.dataset.col);
    if (edge) row.classList.add("over", ...(edge === "bottom" ? ["down"] : []));
  });
  pop.addEventListener("drop", (e) => {
    const row = e.target.closest?.(".colrow");
    if (!dragging || !row) return;
    e.preventDefault();
    const k = dragging;
    dragging = null;
    clearOver();
    set(moveColumn(st, k, row.dataset.col));
  });
  pop.addEventListener("dragend", () => { dragging = null; clearOver(); });
  wrap.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !pop.hidden) { e.stopPropagation(); close(); btn.focus(); }
  });
  pop.addEventListener("keydown", (e) => {
    const k = e.target.dataset?.colHandle;
    if (!k || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const list = listedColumns(st).map((c) => c.key);
    const next = list[list.indexOf(k) + (e.key === "ArrowUp" ? -1 : 1)];
    if (next) set(moveColumn(st, k, next));
  });
  return {
    keys: (opts) => tableKeys(st, opts),
    /** The optimizer's mode changed: its own remembered columns take over. */
    setMode(next) {
      if (next === forMode) return;
      forMode = next; st = load(next);
      if (!pop.hidden) draw();
      onChange();
    },
  };
}
