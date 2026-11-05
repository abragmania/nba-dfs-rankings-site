// Late swap mode (Adam, 2026-10-29): after lock, a man whose game has started is frozen in his lineup slot, and a started man
// who is not in the lineup can no longer be added. Pure ES module (the browser and the server both load it): the time
// "now" is always passed in, never read from the clock here, so the tests inject it.
import { tipMs } from "./board-util.js";
import { SLOTS } from "./slots.js";

/** Each slot man's last row and started state, so a man a new pull drops is still known by name. A man off the slate keeps what was remembered, else `rowOf(id)` (a built card's row, one this page held). Pure. */
export function rememberSlots(slots, byId, started, last = null, rowOf = null) {
  const out = {};
  for (const id of slots) {
    if (id == null) continue;
    const row = byId.get(id);
    if (row) { out[id] = { row, started: started.has(id) }; continue; }
    const known = last?.[id] ?? (rowOf?.(id) ? { row: rowOf(id), started: false } : null);
    if (known) out[id] = known;
  }
  return out;
}

/**
 * The slots whose man has left the slate: [{ i, id, name, started }]. Each slot stays his until Adam decides. Started is read from his last tip on every call, so a man gone before
 * his tip freezes when it comes; clock: { nowMs, refMs }. It fails closed: a tip missing or unreadable, or a man never seen, counts as started. Pure.
 */
export function goneSlots(slots, byId, last = null, clock = null) {
  const out = [];
  slots.forEach((id, i) => {
    if (id == null || byId.has(id)) return;
    const seen = last?.[id], tip = tipMs(seen?.row?.tip, clock?.refMs ?? undefined);
    out.push({ i, id, name: seen?.row?.name ?? `DraftKings id ${id}`, started: seen?.started === true || tip == null || (clock != null && tip <= clock.nowMs) });
  });
  return out;
}

/** The sentence a late swap Build refuses with while a slot's man has left the slate; null with none. It fails closed: the slot is never filled for him. Pure. */
export function goneRefusal(gone, slotNames) {
  if (!gone.length) return null;
  const said = gone.map((g) => `${g.name} (${slotNames[g.i]})`).join(", ");
  return gone.some((g) => g.started)
    ? `Build refused: ${said} left the slate and a game has started, so that slot cannot change here. Load another lineup or leave late swap.`
    : `Build refused: ${said} left the slate in the new pull. Take ${gone.length === 1 ? "him" : "them"} out of the slot to build.`;
}

/** The slate's own date at noon UTC, null when the name carries none: one copy, in board-util.js (re-exported for late swap's callers). */
export { slateRefMs } from "./board-util.js";

/**
 * Who has started at nowMs: a man whose tip (read with tipMs against refMs, the slate's date) is at or before nowMs.
 * Returns { started: Set of dk_id, untimed: [players with a missing or unreadable tip] }. An untimed man is treated as not
 * started, and the caller says so; his start is never guessed.
 */
export function startedSplit(players, { nowMs, refMs }) {
  const started = new Set(), untimed = [];
  for (const p of players ?? []) {
    const t = tipMs(p?.tip, refMs);
    if (t == null) untimed.push(p);
    else if (t <= nowMs) started.add(p.dk_id);
  }
  return { started, untimed };
}

/**
 * The pins for a late-swap build from the working lineup. slots: 8 dk_ids (or null for an open slot) in SLOTS order;
 * userPins: slot indexes Adam pinned; started: the Set from startedSplit. A started man in the lineup is frozen in his
 * slot whatever userPins says. Returns { pinned: { dk_id: slot name }, frozen: Set of slot indexes }.
 */
export function pinsOf({ slots, userPins = [], started }) {
  const pinned = {}, frozen = new Set();
  slots.forEach((id, i) => {
    if (id == null) return;
    if (started.has(id)) frozen.add(i);
    if (started.has(id) || userPins.includes(i)) pinned[id] = SLOTS[i];
  });
  return { pinned, frozen };
}

/**
 * Who a late-swap build leaves out: every started man not pinned (he is not in the working lineup, so he can no longer
 * be added). Returns { excluded: [dk_id], droppedLocks: [dk_id] }, droppedLocks being the saved locks among them.
 */
export function leftOut({ players, started, pinned, locked = [] }) {
  const excluded = (players ?? []).map((p) => p.dk_id).filter((id) => started.has(id) && !(id in pinned));
  const out = new Set(excluded);
  return { excluded, droppedLocks: locked.filter((id) => out.has(id)) };
}

/**
 * Pins `player` to slot index `idx` in the working lineup { slots, userPins }; byId maps dk_id -> player. Returns { ls }
 * (a new working lineup) or { msg } saying why not: a started man, a frozen slot, or a slot his positions do not allow.
 * A man already in the lineup moves; whoever sat in idx (never a frozen man) takes his old slot when he can play it,
 * else leaves the lineup, and either way loses any pin he had.
 */
export function pinTo(ls, player, idx, { started, byId }) {
  const slot = SLOTS[idx];
  if (!slot) return { msg: "That is not a roster slot." };
  if (started.has(player.dk_id)) return { msg: `${player.name}'s game has started; he stays where he is.` };
  const occupant = ls.slots[idx];
  if (occupant != null && started.has(occupant)) return { msg: `${slot} is frozen: that game has started.` };
  if (!(player.roster_positions ?? []).includes(slot)) return { msg: `${player.name} cannot play ${slot}.` };
  const slots = [...ls.slots];
  const from = slots.indexOf(player.dk_id);
  if (from >= 0) {
    const fits = occupant != null && (byId.get(occupant)?.roster_positions ?? []).includes(SLOTS[from]);
    slots[from] = fits ? occupant : null;
  }
  slots[idx] = player.dk_id;
  const userPins = [...ls.userPins.filter((i) => i !== idx && i !== from), idx].sort((a, b) => a - b);
  return { ls: { slots, userPins } };
}

// ---- the moving clock and the guards that keep a man from slipping in after his tip (review round 1) ----

/** The page's now: the server's now at the last read plus the time the page has counted since. clock = { serverMs, pageMs }
 *  (the server's reading and the page's own clock when it arrived); pageNowMs is the page's clock now. */
export function clockNow(clock, pageNowMs) {
  return clock.serverMs + Math.max(0, pageNowMs - clock.pageMs);
}

/** Milliseconds from nowMs to the next tip after it (so the page can redraw as that game starts); null when none is left. */
export function nextTipDelay(players, { nowMs, refMs }) {
  let next = null;
  for (const p of players ?? []) {
    const t = tipMs(p?.tip, refMs);
    if (t != null && t > nowMs && (next == null || t < next)) next = t;
  }
  return next == null ? null : next - nowMs;
}

/** What a refresh saw: the men in the slots and who had started. Later checks compare against it. */
export function snapshot(slots, started) {
  return { slots: slots.filter((id) => id != null), started: [...started] };
}

/** A refresh only carries forward: a man is admitted when the last snapshot already held him or his game has not started.
 *  A started man new to the slots is never admitted, so a tick, a pin or a build cannot launder him (review round 2).
 *  Only Adam declaring his entry (switching the mode on, or loading a saved lineup in it) takes the slots as they are. */
export function carryForward(slots, started, prevSnap) {
  const before = new Set(prevSnap?.slots ?? []);
  return { slots: slots.filter((id) => id != null && (before.has(id) || !started.has(id))), started: [...started] };
}

/** Men in the slots whose game has started but who were not in the slots at the last refresh: they came in after their
 *  tip, so DraftKings would refuse the entry. Returns their dk_ids in slot order. */
export function lateEntries({ slots, started, snap }) {
  const before = new Set(snap?.slots ?? []);
  return slots.filter((id) => id != null && started.has(id) && !before.has(id));
}

/** Men started now who had not started when the lineups were built (builtStarted, a list of dk_ids). */
export function startedSince(builtStarted, started) {
  const was = new Set(builtStarted);
  return [...started].filter((id) => !was.has(id));
}

/** Unpins slot index idx (a frozen slot cannot be unpinned); the man stays in the working lineup as an open choice. */
export function unpin(ls, idx, { started }) {
  if (ls.slots[idx] != null && started.has(ls.slots[idx])) return ls;
  return { slots: ls.slots, userPins: ls.userPins.filter((i) => i !== idx) };
}
