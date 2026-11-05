// DraftKings NBA classic roster slots and the one lineup validator (pure ES module: the browser loads it too, so no node imports).
// The optimizer, the page and the upload-file writer all place and check lineups through this file.
import { tipMs } from "./board-util.js";

export const SLOTS = ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"];
/** DraftKings NBA classic salary cap: a contest rule, not slate data. */
export const SALARY_CAP = 50000;
/** Lineups a build makes when nobody says (standard D9): the page's box and a request with no count. */
export const DEFAULT_COUNT = 5;

/** Bit i set when the man may fill SLOTS[i]; 0 when he has no roster_positions. */
export function slotMask(player) {
  let m = 0;
  for (const rp of player?.roster_positions ?? []) {
    const i = SLOTS.indexOf(rp);
    if (i >= 0) m |= 1 << i;
  }
  return m;
}

/**
 * Tries to give entry k of `masks` a slot by an augmenting path; `owner[slot]` holds the entry index or -1.
 * Slots are tried in SLOTS order, so the result depends only on the input order.
 */
export function augment(masks, owner, k) {
  const seen = new Array(SLOTS.length).fill(false);
  const visit = (e) => {
    for (let i = 0; i < SLOTS.length; i++) {
      if (!(masks[e] & (1 << i)) || seen[i]) continue;
      seen[i] = true;
      if (owner[i] === -1 || visit(owner[i])) { owner[i] = e; return true; }
    }
    return false;
  };
  return visit(k);
}

/** Places entries in input order (Kuhn's matching, which reaches the maximum in one pass); returns owner per slot and the unplaced entry indexes. */
export function placeMasks(masks) {
  const owner = new Array(SLOTS.length).fill(-1);
  const unplaced = [];
  for (let k = 0; k < masks.length; k++) if (!augment(masks, owner, k)) unplaced.push(k);
  return { owner, unplaced };
}

/**
 * A man's slot mask with his late-swap pin applied: `pinned` maps dk_id -> slot name (late swap, Adam 2026-10-29: a pinned
 * man fills exactly that slot). A pin to a slot his positions do not allow (or not a slot at all) leaves him no slot (0).
 */
export function pinnedMask(player, pinned) {
  const m = slotMask(player);
  const slot = pinned?.[player?.dk_id];
  if (slot == null) return m;
  const i = SLOTS.indexOf(slot);
  return i < 0 ? 0 : m & (1 << i);
}

/**
 * Places up to 8 men in the roster slots. { ok: true, slots } when every man is placed; otherwise { ok: false, unplaced, slots }
 * with the most men placed. A man with no roster_positions is unplaced. With more than 8 men the extras are unplaced.
 * `pinned` (dk_id -> slot) holds a pinned man to his one slot.
 */
export function assign(players, { pinned = null } = {}) {
  const { owner, unplaced } = placeMasks(players.map((p) => pinnedMask(p, pinned)));
  const slots = owner.map((k) => (k === -1 ? null : players[k]));
  if (!unplaced.length) return { ok: true, slots };
  return { ok: false, unplaced: unplaced.map((k) => players[k]), slots };
}

// Late-swap order (Adam's rule, 2026-10-29): later-tipping men sit in the more flexible slots, so a late swap has the
// most room. Flexibility per slot in SLOTS order: UTIL 3, G and F 2, PG SG SF PF C 1. It changes only where each man sits.
const FLEX = [1, 1, 1, 1, 1, 2, 2, 3];

/** True when slot array a beats b by the late-swap rule; tipOf maps a slotted man to his tip index (0 = latest tip). */
function lateSwapBetter(a, b, tipOf, nTips) {
  const score = (slots) => {
    const s = new Array(nTips).fill(0);
    slots.forEach((p, i) => { if (p) s[tipOf.get(p)] += FLEX[i]; });
    return s;
  };
  const sa = score(a), sb = score(b);
  for (let t = 0; t < nTips; t++) if (sa[t] !== sb[t]) return sa[t] > sb[t];
  // Same flexibility at every tip: the lower DraftKings id in the earlier slot, so the result never depends on input order.
  // Ids compare as text, which matches number order because DraftKings ids are fixed-width digit strings.
  for (let i = 0; i < a.length; i++) {
    const x = a[i]?.dk_id ?? "", y = b[i]?.dk_id ?? "";
    if (x !== y) return x !== "" && (y === "" || x < y);
  }
  return false;
}

/**
 * Places up to 8 men for late swap: among every legal placement, the one that, from the latest tip time down to the
 * earliest, gives the men tipping then the most slot flexibility (first difference wins); men tipping at the same
 * instant are interchangeable, and remaining ties go to the lower dk_id in the earlier slot. Returns assign()'s shape
 * plus `arranged` and `untimed`: arranged is true when the slots are in late-swap order. When any man's tip is missing or
 * unreadable (untimed lists those men) or the men cannot all be placed, it returns assign()'s plain order with
 * arranged: false, never a guessed time. Tips are compared as instants (tipMs); refMs picks the year of a year-less stamp.
 * `pinned` (dk_id -> slot) keeps each pinned man in his slot in both the arranged and the plain placement; only the
 * others are re-seated around him.
 */
export function arrangeForLateSwap(players, { refMs = Date.now(), pinned = null } = {}) {
  const plain = assign(players, { pinned });
  const untimed = players.filter((p) => tipMs(p?.tip, refMs) == null);
  if (!plain.ok || untimed.length) return { ...plain, arranged: false, untimed };
  const ms = players.map((p) => tipMs(p.tip, refMs));
  const order = [...new Set(ms)].sort((a, b) => b - a);
  const tipOf = new Map(players.map((p, k) => [p, order.indexOf(ms[k])]));
  const masks = players.map((p) => pinnedMask(p, pinned));
  const cur = new Array(SLOTS.length).fill(null);
  let best = null;
  const place = (k) => {
    if (k === players.length) {
      if (!best || lateSwapBetter(cur, best, tipOf, order.length)) best = [...cur];
      return;
    }
    for (let i = 0; i < SLOTS.length; i++) {
      if (cur[i] || !(masks[k] & (1 << i))) continue;
      cur[i] = players[k];
      place(k + 1);
      cur[i] = null;
    }
  };
  place(0);
  return { ok: true, slots: best, arranged: true, untimed: [] };
}

/** A usable DraftKings salary: a positive whole number of dollars. */
export const isSalary = (v) => Number.isInteger(v) && v > 0;

const money = (n) => "$" + n.toLocaleString("en-US");

/**
 * The one lineup validator. `slots` is an 8-entry array in SLOTS order; a null entry is an empty slot (reported, and left
 * out of the other checks). Each man must be legal in his own slot, appear once, have a usable salary; the salary total
 * must be within the cap and the men must come from at least minGames games.
 */
export function checkLineup(slots, { cap = SALARY_CAP, minGames = 2 } = {}) {
  const reasons = [];
  if (!Array.isArray(slots) || slots.length !== SLOTS.length) {
    return { ok: false, reasons: [`A lineup has ${SLOTS.length} slots; this one has ${Array.isArray(slots) ? slots.length : "none"}.`] };
  }
  const empty = slots.filter((p) => p == null).length;
  if (empty) reasons.push(`${empty} empty slot${empty === 1 ? "" : "s"}.`);
  const men = [];
  slots.forEach((p, i) => {
    if (p == null) return;
    men.push(p);
    if (!(p.roster_positions ?? []).includes(SLOTS[i])) reasons.push(`${p.name} cannot play ${SLOTS[i]}.`);
  });
  const seen = new Set();
  for (const p of men) {
    if (seen.has(p.dk_id)) reasons.push(`${p.name} is in the lineup twice.`);
    seen.add(p.dk_id);
  }
  const badSalary = men.filter((p) => !isSalary(p.salary));
  if (badSalary.length) reasons.push(`No usable salary in this slate file for: ${badSalary.map((p) => p.name).join(", ")}.`);
  else {
    const total = men.reduce((t, p) => t + p.salary, 0);
    if (total > cap) reasons.push(`Salary used ${money(total)} is over the ${money(cap)} cap.`);
  }
  const noGame = men.filter((p) => p.game == null);
  if (noGame.length) reasons.push(`No game in this slate file for: ${noGame.map((p) => p.name).join(", ")}.`);
  const games = new Set(men.map((p) => p.game).filter((g) => g != null));
  if (games.size < minGames) reasons.push(`The players come from ${games.size} game${games.size === 1 ? "" : "s"}; DraftKings needs at least ${minGames}.`);
  return { ok: reasons.length === 0, reasons };
}

