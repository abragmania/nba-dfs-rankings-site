// 11-13 audit, state 3, the lead's order of 11-21 (never a refusal box): a picks, NO or working-lineup save is his one change, laid at send time on the lists the server last gave, so a
// save another page made first is never written over; when the server says another page saved since (a stale base), the page reads the saved lists, lays the same change on them and
// sends again, silently, up to SAVE_ROUNDS rounds. Only a true conflict (the same man or slot changed both ways) is said, at the page's foot. Pure; tests/merge_saves.test.mjs.

/** How many read-and-send-again rounds a save makes before it says it could not be saved. */
export const SAVE_ROUNDS = 3;

const stateIn = (lists, id) => (lists?.locked?.includes(id) ? "locked" : lists?.excluded?.includes(id) ? "excluded" : null);

/** His one picks change: { id: { from, to } } for each man whose state (locked, excluded or null) differs between `prev` and `next`. Pure. */
export function pickDiff(prev, next) {
  const out = {};
  for (const id of new Set([...(prev?.locked ?? []), ...(prev?.excluded ?? []), ...(next?.locked ?? []), ...(next?.excluded ?? [])])) {
    const from = stateIn(prev, id), to = stateIn(next, id);
    if (from !== to) out[id] = { from, to };
  }
  return out;
}

/** `lists` with the change laid on: each changed man taken off both lists and put on his new one. A new object. Pure. */
export function applyPickDiff(lists, diff) {
  const ids = new Set(Object.keys(diff)), locked = (lists?.locked ?? []).filter((id) => !ids.has(id)), excluded = (lists?.excluded ?? []).filter((id) => !ids.has(id));
  for (const [id, { to }] of Object.entries(diff)) if (to === "locked") locked.push(id); else if (to === "excluded") excluded.push(id);
  return { locked, excluded };
}

/** The most men a mode may lock: DraftKings classic has eight roster slots (the server's check, store.js checkPicks, reads this one). */
export const MAX_LOCKED = 8;

/** Merged lists over MAX_LOCKED: his new locks (the last of them first) come off until it fits, back to unlocked; the saved locks stay. { lists, dropped: [ids] }. Pure. */
export function capLocks(lists, diff, saved) {
  const locked = [...lists.locked], dropped = [], kept = new Set(saved?.locked ?? []);
  const his = Object.entries(diff).filter(([id, d]) => d.to === "locked" && !kept.has(id)).map(([id]) => id).reverse();
  while (locked.length > MAX_LOCKED && his.length) { const id = his.shift(); locked.splice(locked.indexOf(id), 1); dropped.push(id); }
  return { lists: { ...lists, locked }, dropped };
}
/** The foot words for locks capLocks left out: him, and the saved locks that fill the eight. Pure. */
export const capLine = (mode, dropped, saved, nameOf) => `Picks (${mode}): your lock on ${dropped.map(nameOf).join(", ")} was not saved: another page's save already locks ${saved.length} (${saved.map(nameOf).join(", ")}), and ${MAX_LOCKED} is the most.`;

/** The men the other page changed too, to something else: [{ id, theirs, to }] (his stands). Pure. */
export const pickClashes = (lists, diff) => Object.entries(diff).map(([id, d]) => ({ id, theirs: stateIn(lists, id), ...d })).filter((x) => x.theirs !== x.from && x.theirs !== x.to).map(({ id, theirs, to }) => ({ id, theirs, to }));

const WAS = { locked: "locked", excluded: "excluded", null: "cleared" }, CLICK = { locked: "lock", excluded: "exclude", null: "clear" };
/** The foot words for picks clashes (his change stands). Pure. */
export const pickClashLine = (mode, clashes, nameOf) => (clashes.length ? `Picks (${mode}): ${clashes.map((c) => `${nameOf(c.id)} was ${WAS[c.theirs]} on another page just before your ${CLICK[c.to]}`).join("; ")}; yours stands.` : "");

/** His one NO change: { add, remove } between two lists. Pure. */
export const listDiff = (prev, next) => ({ add: (next ?? []).filter((id) => !(prev ?? []).includes(id)), remove: (prev ?? []).filter((id) => !(next ?? []).includes(id)) });
/** `list` with the change laid on (its order kept, additions last). Pure. */
export const applyListDiff = (list, d) => [...(list ?? []).filter((id) => !d.remove.includes(id) && !d.add.includes(id)), ...d.add];

/** His one working-lineup change: [{ i, from, to }] per slot that differs. Pure. */
export const slotDiff = (prev, next) => (next ?? []).map((to, i) => ({ i, from: prev?.[i] ?? null, to: to ?? null })).filter((x) => x.from !== x.to);

/**
 * `slots` with his slot changes laid on: { slots, clashes: [{ i, theirs, to, moved }] }. A slot the other page also changed, to someone else, takes his (a clash); a man he put in a slot who
 * sits in another slot of theirs leaves that one (moved: its index), so no man is in two slots. Pure.
 */
export function applySlotDiff(slots, diff) {
  const out = [...(slots ?? [])], clashes = [];
  for (const { i, from, to } of diff) {
    const theirs = out[i] ?? null;
    if (theirs !== from && theirs !== to) clashes.push({ i, theirs, to, moved: null });
    out[i] = to;
  }
  for (const { i, to } of diff) {
    if (!to) continue;
    const j = out.findIndex((id, k) => k !== i && id === to);
    if (j >= 0 && !diff.some((d) => d.i === j)) { out[j] = null; clashes.push({ i: j, theirs: to, to: null, moved: i }); }
  }
  return { slots: out, clashes };
}

/** The foot words for working-lineup clashes (his change stands). slotName(i): the slot's name (PG, UTIL...). Pure. */
export function slotClashLine(mode, clashes, nameOf, slotName) {
  if (!clashes.length) return "";
  const said = clashes.map((c) => (c.moved !== null ? `${nameOf(c.theirs)} left ${slotName(c.i)}, where the other page had him, for your ${slotName(c.moved)}` : `${slotName(c.i)} held ${c.theirs ? nameOf(c.theirs) : "nobody"} from another page; your ${c.to ? nameOf(c.to) : "clear"} stands`));
  return `Working lineup (${mode}): ${said.join("; ")}.`;
}
