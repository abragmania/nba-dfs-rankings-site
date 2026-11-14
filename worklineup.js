// The working lineup (Adam, 5:34 PM ET 2026-10-29, from the NFL app's click-to-pick): the optimizer panel's 8 slots that
// Adam fills by hand. A click on a player row puts the man in (or takes him out), a click on a filled slot empties it, and
// Build keeps the hand-picked men and fills the rest; any man may move to another slot his positions allow. Pure ES module (the browser and the tests
// load it): no DOM, no network. Every placement and fit check goes through slots.js (`assign`), the one matcher.
//
// The working lineup is 8 entries in SLOTS order, each a dk_id or null. Saved locks are not stored in it: a locked man who
// is not hand-picked is seated in an open slot for the view and counts against the slots and the cap, because every build
// holds him too.
import { SLOTS, SALARY_CAP, slotMask, augment, assign } from "./slots.js";

const N = SLOTS.length;
const money = (n) => "$" + n.toLocaleString("en-US");
export const posText = (p) => (p.positions ?? p.roster_positions ?? []).join("/");
export const lockedMsg = (p) => `${p.name} is locked; unlock him to take him out.`;

/** 8 open slots. */
export const emptyWork = () => new Array(N).fill(null);

/** The hand-picked dk_ids, in slot order. */
export const handIds = (slots) => slots.filter((id) => id != null);

/** A key for "which men are hand-picked" (seat order ignored): a build compares it to say its result is out of date. */
export const workKey = (slots) => JSON.stringify([...handIds(slots)].sort());

/** The locked men who are not hand-picked and are on the slate: they fill open slots in the view and in every build. */
export function lockOthers(slots, byId, lockedIds) {
  const hand = new Set(handIds(slots));
  return (lockedIds ?? []).filter((id) => !hand.has(id)).map((id) => byId.get(id)).filter(Boolean);
}

/**
 * The view of the working lineup: `men` (8 entries, a slate player or undefined for an open slot) and `kind` (8 entries:
 * "hand", "lock" or null). Hand-picked men sit in their own slots; locked men fill open slots around them (slots.js
 * assign with the hand-picked men pinned). `unplaced` lists locked men who find no open slot. When that leaves a locked man
 * out, everyone is placed again with no slot held (a hand-picked man's slot is not binding); `heldOnly` skips that second try.
 */
export function seatWork(slots, byId, lockedIds, { heldOnly = false } = {}) {
  const hand = slots.map((id) => (id == null ? null : byId.get(id) ?? null));
  const others = lockOthers(slots, byId, lockedIds);
  const pinned = Object.fromEntries(hand.map((p, i) => (p ? [p.dk_id, SLOTS[i]] : null)).filter(Boolean));
  let placed = assign([...hand.filter(Boolean), ...others], { pinned });
  // The slots are not binding: when the held placement leaves a locked man out, everyone is placed again with none held.
  const free = placed.ok || heldOnly ? null : assign([...hand.filter(Boolean), ...others]);
  if (free?.ok) placed = free;
  const men = new Array(N).fill(undefined), kind = new Array(N).fill(null);
  placed.slots.forEach((p, i) => {
    if (!p) return;
    men[i] = p;
    kind[i] = p.dk_id in pinned ? "hand" : "lock";
  });
  return { men, kind, unplaced: placed.ok ? [] : placed.unplaced };
}

/** Why the man cannot be hand-picked whatever the seating (excluded, locked, a missing figure); null when he can. */
export function pickRefusal(p, { lockedIds, excludedIds }) {
  if ((excludedIds ?? []).includes(p.dk_id)) return `${p.name} is excluded; remove the exclude to add him.`;
  if ((lockedIds ?? []).includes(p.dk_id)) return `${p.name} is locked, so he is in every build already.`;
  if (!slotMask(p)) return `${p.name} has no roster positions in this slate file.`;
  if (!Number.isInteger(p.salary) || p.salary <= 0) return `${p.name} has no salary in this slate file.`;
  if (typeof p.projection !== "number") return `${p.name} has no projection in this pull, so a build cannot score him.`;
  return null;
}

/**
 * Puts man `p` in the working lineup. He goes into the first open slot his positions allow, in SLOTS order, that still
 * leaves room for the locked men; when none does but the men already in can be re-seated so that he fits, they are
 * re-seated (slots.js assign). Returns { ok: true, slots, reseated } or { ok: false, msg } with the short reason: no slot
 * for his position, or the $50,000 cap. `slots` is never changed in place.
 */
export function placeMan(slots, p, { byId, lockedIds = [], excludedIds = [] }) {
  if (slots.includes(p.dk_id)) return { ok: true, slots: [...slots], reseated: false };
  const refused = pickRefusal(p, { lockedIds, excludedIds });
  if (refused) return { ok: false, msg: refused };
  const hand = handIds(slots).map((id) => byId.get(id)).filter(Boolean);
  const others = lockOthers(slots, byId, lockedIds);
  const taken = hand.length + others.length;
  if (taken >= N) return { ok: false, msg: `The lineup is full; click a slot to empty it before adding ${p.name}.` };
  const all = assign([...hand, p, ...others]);
  if (!all.ok) return { ok: false, msg: `No slot for ${p.name} (${posText(p)}): the open slots do not take his position.` };
  const salary = [...hand, ...others].reduce((t, m) => t + (Number.isInteger(m.salary) ? m.salary : 0), 0) + p.salary;
  if (salary > SALARY_CAP) return { ok: false, msg: `${p.name} (${money(p.salary)}) would take the lineup to ${money(salary)}, over the ${money(SALARY_CAP)} cap.` };
  const mask = slotMask(p);
  for (let i = 0; i < N; i++) {
    if (slots[i] != null || !(mask & (1 << i))) continue;
    const next = [...slots];
    next[i] = p.dk_id;
    if (!seatWork(next, byId, lockedIds, { heldOnly: true }).unplaced.length) return { ok: true, slots: next, reseated: false };
  }
  return reseat(slots, p, others, byId);
}

/**
 * Re-seats the men already in so that `p` fits: starting from their seats as they are, `p` and then each locked man is
 * given a slot by one augmenting path (slots.js augment), so only the men along that path move. Kuhn's matching reaches
 * a full placement whenever one exists, which placeMan has checked with assign.
 */
function reseat(slots, p, others, byId) {
  const list = [], owner = new Array(N).fill(-1);
  slots.forEach((id, i) => { const m = id == null ? null : byId.get(id); if (m) { owner[i] = list.length; list.push(m); } });
  const nHand = list.length + 1;
  list.push(p, ...others);
  const masks = list.map(slotMask);
  for (let k = nHand - 1; k < list.length; k++) {
    if (!augment(masks, owner, k)) return { ok: false, msg: `No slot for ${p.name} (${posText(p)}): the open slots do not take his position.` };
  }
  return { ok: true, slots: owner.map((k) => (k >= 0 && k < nHand ? list[k].dk_id : null)), reseated: true };
}

/** Takes man `id` out of the working lineup (his slot opens). */
export const removeMan = (slots, id) => slots.map((x) => (x === id ? null : x));

/** Empties slot i. */
export const emptySlot = (slots, i) => slots.map((x, k) => (k === i ? null : x));

/** A row click: takes the man out when he is hand-picked, else puts him in (placeMan). */
export function toggleMan(slots, p, opts) {
  if (slots.includes(p.dk_id)) return { ok: true, slots: removeMan(slots, p.dk_id), reseated: false };
  return placeMan(slots, p, opts);
}

/**
 * A lineup on show (a built one: 8 dk_ids in SLOTS order) taken as the working lineup, each man hand-picked in the slot he
 * sits in, except the locked men (a lock stays a lock, so unlocking still takes him out). A man no longer on the slate
 * leaves his slot open.
 */
export function workFrom(ids, byId, lockedIds = []) {
  const lock = new Set(lockedIds);
  return Array.from({ length: N }, (_, i) => {
    const id = ids?.[i];
    return id != null && byId.has(id) && !lock.has(id) ? id : null;
  });
}

/** A working lineup as stored (from the server) checked against the slate now: an entry that is not an id on the slate, or a
 *  man no longer legal in his slot, opens that slot. Anything that is not 8 entries is 8 open slots. */
export function cleanWork(raw, byId) {
  if (!Array.isArray(raw) || raw.length !== N) return emptyWork();
  const seen = new Set();
  return raw.map((id, i) => {
    const p = typeof id === "string" ? byId.get(id) : null;
    if (!p || seen.has(id) || !(slotMask(p) & (1 << i))) return null;
    seen.add(id);
    return id;
  });
}
