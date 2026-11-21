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

// Kept per mode (Adam 1:22 PM ET 11-20: "exposure limits should be separate per mode also"): nbaboard.opt.limits.<mode>.<slate>. GPP with
// none of its own reads the one set older versions saved (nbaboard.opt.limits.<slate>), which only GPP builds ever used, until its own first
// save; Cash starts with none (no foot line: nothing of Cash's is carried or lost).
const storeKey = (slate, mode = null) => (mode ? `nbaboard.opt.limits.${mode}.${slate}` : `nbaboard.opt.limits.${slate}`);
export const LIMIT_MODES = Object.freeze(["Cash", "GPP"]);
/** A stored JSON entry told three ways: ABSENT (getItem null), null (unreadable: storage threw or the text is not JSON; tryStore gives null for a throw), or { value }. */
export const ABSENT = Object.freeze({ absent: true });
export function probeJson(tryStore, key) {
  return tryStore(() => { const t = localStorage.getItem(key); return t == null ? ABSENT : { value: JSON.parse(t) }; });
}

/** A stored entry's text told three ways: ABSENT, null (storage itself threw: blocked in this browser), or { text }. */
const probeText = (tryStore, key) => tryStore(() => { const t = localStorage.getItem(key); return t == null ? ABSENT : { text: t }; });

/**
 * { limits, unreadable } (and carried and damaged, with a mode): absent is no limits; unreadable is none applied, said so, never a stand-in.
 * With a mode, `damaged` tells a stored set that is there but cannot be read (not JSON, not a map) from storage that is blocked: the optimizer
 * panel builds nothing in a mode whose set is damaged until a box saves a new one (panel.js build, fails closed); blocked storage can hold no set
 * of this browser's to miss and can save none, so it builds with none, said in the settings block. No mode: the old shared key alone, as before.
 */
export function readLimits(tryStore, slate, mode = null) {
  let key = storeKey(slate, mode), got = probeText(tryStore, key);
  if (got === ABSENT && mode === "GPP") { key = storeKey(slate); got = probeText(tryStore, key); } // the set from before the split was GPP's (Cash ignored it until 11-20): carried to GPP only; Cash starts with none (lead's ruling on "Cash obeys its own Min/Max")
  let value = null, damaged = false;
  if (got && got !== ABSENT) { try { value = JSON.parse(got.text); damaged = !value || typeof value !== "object" || Array.isArray(value); } catch { damaged = true; } }
  if (got === null || damaged) {
    console.warn(`${key} ${got === null ? "cannot be read (storage blocked)" : "is not a Min % and Max % map"}; no Min % or Max % is applied`);
    return { limits: {}, unreadable: true, ...(mode ? { carried: false, damaged } : {}) };
  }
  const limits = got === ABSENT ? {} : cleanLimits(value);
  return { limits, unreadable: false, ...(mode ? { carried: key !== storeKey(slate, mode) && Object.keys(limits).length > 0, damaged: false } : {}) };
}
export const loadLimits = (tryStore, slate, mode = null) => readLimits(tryStore, slate, mode).limits;
/** Saves one mode's set (no mode: the old shared key). tryStore's answer: null when storage refused it. */
export const saveLimits = (tryStore, slate, limits, mode = null) => tryStore(() => { localStorage.setItem(storeKey(slate, mode), JSON.stringify(limits)); return true; });

/** Both modes' sets for a slate: { byMode: { Cash, GPP }, bad: [modes whose set could not be read], damaged: [those whose stored set is there but broken], carried: [modes reading the set from before the split] }. */
export function readLimitsByMode(tryStore, slate) {
  const byMode = {}, bad = [], damaged = [], carried = [];
  for (const m of LIMIT_MODES) { const r = readLimits(tryStore, slate, m); byMode[m] = r.limits; if (r.unreadable) bad.push(m); if (r.damaged) damaged.push(m); if (r.carried) carried.push(m); }
  return { byMode, bad, damaged, carried };
}

/** Gives the panel state P its Min % and Max % per mode: P.limByMode holds both sets, and P.limits reads and writes the set of the mode in force (P.mode). */
export function perModeLimits(P, byMode = { Cash: {}, GPP: {} }, bad = [], damaged = []) {
  P.limBad = [...bad]; // the modes whose stored set could not be read: the settings block says so
  P.limDamaged = [...damaged]; // of those, the ones whose stored set is there but broken: their builds refuse (panel.js) until a box saves a new set
  Object.defineProperty(P, "limByMode", { value: { ...byMode }, writable: true, enumerable: false, configurable: true });
  Object.defineProperty(P, "limits", { get() { return this.limByMode[this.mode] ?? {}; }, set(v) { this.limByMode[this.mode] = v; }, enumerable: true, configurable: true });
  return P;
}

/** Why a build in `mode` must not start for its Min % and Max %, or null: its stored set is there but broken, so who is held to what is unknown (fail closed, never "none"). */
export const limitsRefusal = (P, mode) => ((P.limDamaged ?? []).includes(mode) ? `Your saved ${mode} Min % and Max % could not be read from this browser, so nothing was built. Set or clear any man's Min % or Max % in ${mode} to save a new set, then build.` : null);
/** The panel state after a mode's set was saved whole: it is readable again. */
export const limitsSaved = (P, mode) => { P.limBad = (P.limBad ?? []).filter((m) => m !== mode); P.limDamaged = (P.limDamaged ?? []).filter((m) => m !== mode); };

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
