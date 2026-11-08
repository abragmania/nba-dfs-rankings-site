// A row's Min % and Max % boxes (optimizer standard B10): what a typed number does, the browser's copy per slate (the viewer's
// own inputs, as the team limits are) and what a build sends. The build counts them (server/lineup/exposure.js). Pure apart from
// the storage call handed in; tested in node.
import { esc } from "./board-util.js";

const WORD = { min: "Min %", max: "Max %" };
const isPct = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
export const LATE_SWAP_NOTE = "Min % and Max % do not apply in late swap";

/**
 * What closing a box does. kind: "min" or "max"; cur: this box's number or null; other: the other box's; held: he is in every
 * lineup (locked or hand-picked); excluded: he is in none. An emptied box takes the limit off (value null).
 */
export function limitOutcome(kind, text, { name, cur = null, other = null, held = false, excluded = false }) {
  const t = String(text).trim();
  if (t === "") return cur == null ? { act: "cancel" } : { act: "save", value: null };
  const v = /^(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN;
  if (!isPct(v)) return { act: "bad", msg: `${WORD[kind]} must be a number from 0 to 100.` };
  if (v === cur) return { act: "cancel" };
  if (kind === "max" && v < 100 && held) return { act: "bad", msg: `${name} is locked or in the working lineup, so he is in every lineup; he cannot take a Max %.` };
  if (kind === "min" && v > 0 && excluded) return { act: "bad", msg: `${name} is excluded, so he cannot take a Min %.` };
  if (other != null && (kind === "min" ? v > other : v < other)) return { act: "bad", msg: "Min % cannot be above Max %." };
  return { act: "save", value: v };
}

/** The limits with one box changed; a man with neither box leaves the map. Nothing is changed in place. */
export function withLimit(limits, id, kind, value) {
  const next = { ...limits }, row = { ...next[id] };
  if (value == null) delete row[kind]; else row[kind] = value;
  if (row.min == null && row.max == null) delete next[id]; else next[id] = row;
  return next;
}

/** A stored map made safe: anything that is not a limit is left out. */
export function cleanLimits(saved) {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
  const out = {};
  for (const [id, l] of Object.entries(saved)) {
    if (!l || typeof l !== "object") continue;
    const row = {};
    if (isPct(l.min)) row.min = l.min;
    if (isPct(l.max)) row.max = l.max;
    if (row.min != null && row.max != null && row.min > row.max) continue;
    if (row.min != null || row.max != null) out[id] = row;
  }
  return out;
}

const storeKey = (slate) => `nbaboard.opt.limits.${slate}`;
export const loadLimits = (tryStore, slate) => cleanLimits(tryStore(() => JSON.parse(localStorage.getItem(storeKey(slate)) ?? "null")));
export const saveLimits = (tryStore, slate, limits) => tryStore(() => localStorage.setItem(storeKey(slate), JSON.stringify(limits)));

/** What a build sends as settings.exposure: the limits of men on this slate, in one order so two builds compare; null when none. */
export function sentLimits(limits, byId) {
  const ids = Object.keys(limits).filter((id) => byId.has(id)).sort();
  return ids.length ? Object.fromEntries(ids.map((id) => [id, limits[id]])) : null;
}

/** The line by Build (limits bind with their columns unticked or the man filtered away, so the panel says they are on). sent: sentLimits' answer. */
export function limitCountHtml(sent) {
  const n = sent ? Object.keys(sent).length : 0;
  if (!n) return "";
  return `<div class="limcount">${n} ${n === 1 ? "man has" : "men have"} a Min % or Max %.</div>`;
}

/** Puts a saved number in its box at once, with no redraw of the rows (a press is still under way). */
export function limitPatch(root, kind, id, value) {
  const box = root.querySelector(`[data-edit="${kind}"][data-id="${CSS.escape(id)}"]`);
  if (!box) return;
  box.textContent = value == null ? "" : String(value);
  box.classList.toggle("on", value != null);
}

/** A row's box. A button holding the number, so it opens like the typed Proj and Own (cell-editor.js) and survives every redraw. */
export function limitCellHtml(kind, id, limits, lateSwap) {
  const v = limits?.[id]?.[kind];
  const shown = v == null ? "" : esc(String(v));
  if (lateSwap) return `<td class="lim"><button class="limb" disabled title="${LATE_SWAP_NOTE}">${shown}</button></td>`;
  return `<td class="lim"><button class="limb${v == null ? "" : " on"}" data-edit="${kind}" data-id="${esc(id)}" title="${WORD[kind]}">${shown}</button></td>`;
}
