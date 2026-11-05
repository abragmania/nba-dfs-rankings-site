// Which player rows cannot go into the working lineup right now, and why (optimizer standard A18): the row is greyed and a
// click does nothing, the reason on hover. A man cannot go in when a pick is refused whatever the seating (worklineup.js), no
// open slot takes his position, or his salary is more than the salary left less the cheapest legal fill of the other open
// slots. Men already in may be re-seated, as a click re-seats them. Pure ES module, tested in node.
import { SLOTS, SALARY_CAP, slotMask } from "./slots.js";
import { money } from "./board-util.js";
import { handIds, lockOthers, pickRefusal, lockedMsg, posText } from "./worklineup.js";

const N = SLOTS.length;
const FULL = (1 << N) - 1;
const bitsOf = (mask) => SLOTS.map((_, i) => 1 << i).filter((b) => mask & b);

/** Every set of slots these men can fill together; empty when they cannot all be seated. */
function seatSets(men) {
  let sets = new Set([0]);
  for (const p of men) {
    const next = new Set();
    for (const m of sets) for (const b of bitsOf(slotMask(p))) if (!(m & b)) next.add(m | b);
    sets = next;
  }
  return sets;
}

/** The cheapest salary that fills exactly each set of slots, one man to one slot; Infinity when these men cannot. */
function fillTable(men) {
  const cost = new Float64Array(FULL + 1).fill(Infinity);
  cost[0] = 0;
  for (const p of men) {
    const bits = bitsOf(slotMask(p));
    // Highest set first: a set this man adds to has been passed already, so no man is used twice.
    for (let m = FULL; m >= 0; m--) {
      if (cost[m] === Infinity) continue;
      for (const b of bits) if (!(m & b) && cost[m] + p.salary < cost[m | b]) cost[m | b] = cost[m] + p.salary;
    }
  }
  return cost;
}

/**
 * The cheapest fill of the other open slots for man `p`, from the men who may be picked and not him. Men with the same slots
 * differ only by salary, so `keep` of each kind are enough; keeping one more than the slots to fill leaves enough with him
 * taken out. The tables are shared between men they do not change.
 */
function fillFinder(pool, toFill) {
  const kinds = new Map();
  for (const p of pool) {
    const m = slotMask(p);
    if (!kinds.has(m)) kinds.set(m, []);
    kinds.get(m).push(p);
  }
  const kept = [...kinds.values()].flatMap((men) => men.sort((a, b) => a.salary - b.salary).slice(0, toFill + 1));
  const isKept = new Set(kept.map((p) => p.dk_id));
  const shared = fillTable(kept), without = new Map();
  return (p) => {
    if (!isKept.has(p.dk_id)) return shared;
    const key = `${slotMask(p)}:${p.salary}`; // two men alike leave the same table
    if (!without.has(key)) without.set(key, fillTable(kept.filter((x) => x.dk_id !== p.dk_id)));
    return without.get(key);
  };
}

/** Why `p` cannot sit with the men held, or null. seats: seatSets of the men held; left: salary left, null when unknown. */
function fitReason(p, { seats, left, toFill, tableFor, open }) {
  let cheapest = Infinity, fits = false;
  const table = tableFor(p), bits = bitsOf(slotMask(p));
  for (const m of seats) {
    for (const b of bits) {
      if (m & b) continue;
      fits = true;
      if (table[FULL ^ (m | b)] < cheapest) cheapest = table[FULL ^ (m | b)];
    }
  }
  if (!fits) return `No open slot takes his position (${posText(p)}).`;
  if (cheapest === Infinity) return `No legal men left to fill the other ${toFill} open slot${toFill === 1 ? "" : "s"} with him in.`;
  if (left == null || p.salary + cheapest <= left) return null;
  const has = `${money(Math.max(0, left))} left`;
  return `${money(p.salary)} does not fit: ${open === 1 ? `${has}.` : `${has}, and the cheapest fill of the other ${toFill} open slot${toFill === 1 ? "" : "s"} is ${money(cheapest)}.`}`;
}

/**
 * dk_id -> the reason for every man who cannot go in now. A hand-picked man is left out: a click takes him out (standard D3);
 * a locked one is in (his lock is his to undo). `slots` is the working lineup, `players` the slate's men.
 */
export function rowBlocks(slots, players, { byId, lockedIds = [], excludedIds = [] }) {
  const inHand = new Set(handIds(slots));
  const held = [...inHand].map((id) => byId.get(id)).filter(Boolean).concat(lockOthers(slots, byId, lockedIds));
  const heldIds = new Set(held.map((p) => p.dk_id));
  const opts = { lockedIds, excludedIds };
  const open = N - held.length, toFill = open - 1;
  const known = held.every((p) => Number.isInteger(p.salary));
  const left = known ? SALARY_CAP - held.reduce((t, p) => t + p.salary, 0) : null;
  const free = open > 0 ? players.filter((p) => !heldIds.has(p.dk_id) && !pickRefusal(p, opts)) : [];
  const seats = open > 0 ? seatSets(held) : null;
  const tableFor = open > 0 ? fillFinder(free, toFill) : null;
  const out = new Map();
  for (const p of players) {
    const locked = lockedIds.includes(p.dk_id);
    let why = null;
    if (inHand.has(p.dk_id)) why = locked ? lockedMsg(p) : null;
    else why = pickRefusal(p, opts);
    if (!why && !inHand.has(p.dk_id)) {
      why = open <= 0 ? `The lineup is full; click a slot to empty it before adding ${p.name}.` : fitReason(p, { seats, left, toFill, tableFor, open });
    }
    if (why) out.set(p.dk_id, why);
  }
  return out;
}
