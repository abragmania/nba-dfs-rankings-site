// The optimizer's upper bound on what a search node can still score (pure ES module with relative imports only: the browser
// will run the engine too). server/lineup/optimize.js reads ctx (its search context) and closes a node on these tables.
import { SLOTS } from "../board/slots.js";

const N = SLOTS.length;
/** Totals within this count as equal: a lineup replaces the best only by beating it by more than EPS, and the ownership cap allows it too. */
export const EPS = 1e-7;
/** A tenth of EPS, more than the rounding in a bound's sums: a bound never closes a node on rounding alone. */
export const BOUND_SLACK = 1e-8;
/** One per set of filled slots. */
export const WIDTH = 1 << N;
const FULL = WIDTH - 1;
/** The single-slot bits of each slot set. */
export const SLOT_BITS = Array.from({ length: WIDTH }, (_, m) => Array.from({ length: N }, (_, i) => 1 << i).filter((bit) => m & bit));
/** C(8,4), the most slot sets the men at one depth can fill. */
export const REACH_MAX = 70;
const MULT_ROUNDS = 500; // the multiplier search normally ends on MULT_MIN_THETA first
const MULT_PATIENCE = 8; // rounds without MULT_MIN_GAIN points of bound before the step halves
const MULT_MIN_GAIN = 0.01;
const MULT_MIN_THETA = 0.1;
const MULT_ZERO_GAP = 2e-8; // a limit used to within this is met exactly: its rounding, and the ownership row's EPS/10 of room, are no reason to move its multiplier
const MULT_MAX_TERM = 1e4; // a multiplier found by the search keeps its terms to this, so 1.5e4 after OWN_SCALES: there a double's rounding stays far under BOUND_SLACK
const SAL_SCALES = [0, 0.7, 1, 1.3];
const OWN_SCALES = [0, 0.7, 1, 1.5];

/** Fills a slot-set table: F[i * WIDTH + M] is the most the men from i on can add, by `weight`, filling exactly the slots M leaves open (-Infinity if they cannot). */
function fillTable(F, n, mask, weight) {
  F.fill(-Infinity, n * WIDTH, (n + 1) * WIDTH);
  F[n * WIDTH + FULL] = 0;
  for (let i = n - 1; i >= 0; i--) {
    const row = i * WIDTH, next = row + WIDTH, bits = SLOT_BITS[mask[i]], w = weight[i];
    for (let M = 0; M < FULL; M++) {
      let top = F[next + M];
      for (let x = 0; x < bits.length; x++) {
        if (M & bits[x]) continue;
        const c = w + F[next + (M | bits[x])];
        if (c > top) top = c;
      }
      F[row + M] = top;
    }
    F[row + FULL] = 0;
  }
}

/** The run's limits on the pool men as rows a*x <= rhs, x being who is picked: salary first, ownership second when capped (scaled to like sizes). */
function limitRows(ctx, s, start) {
  const { n, sal, own, team, game, low } = ctx;
  const rows = [];
  const add = (coef, rhs, size = 0) => rows.push({ coef: Float64Array.from({ length: n }, (_, i) => coef(i)), rhs, size });
  add((i) => sal[i] / 1000, (s.cap - start.baseSal) / 1000);
  if (s.maxTotalOwn != null) add((i) => own[i] / 10, (s.maxTotalOwn + EPS - start.baseOwn) / 10, s.maxTotalOwn / 10);
  ctx.rules.forEach((rule, r) => add((i) => (low[r][i] ? -1 : 0), start.lowCount[r] - rule.count));
  for (let t = 0; t < ctx.nTeams; t++) {
    if (ctx.teamMax[t] < N) add((i) => (team[i] === t ? 1 : 0), ctx.teamMax[t] - start.teamCount[t]);
    if (ctx.hardMin[t] > 0) add((i) => (team[i] === t ? -1 : 0), start.teamCount[t] - ctx.hardMin[t]);
  }
  for (let g = 0; g < ctx.nGames; g++) {
    if (ctx.gameMax[g] < N) add((i) => (game[i] === g ? 1 : 0), ctx.gameMax[g] - start.gameCount[g]);
    if (ctx.gameMin[g] > 0) add((i) => (game[i] === g ? -1 : 0), start.gameCount[g] - ctx.gameMin[g]);
  }
  return rows;
}

/** Each man's value less y times his share of every limit. */
function weightsFor(ctx, rows, y) {
  const w = Float64Array.from(ctx.val);
  rows.forEach((row, r) => {
    if (y[r] !== 0) for (let i = 0; i < w.length; i++) w[i] -= y[r] * row.coef[i];
  });
  return w;
}

/** The pool men a filled table picks from the slot set M. */
function tracePicks(F, ctx, weight, M) {
  const picks = [];
  for (let i = 0; i < ctx.n && M !== FULL; i++) {
    const here = F[i * WIDTH + M];
    if (here === F[(i + 1) * WIDTH + M]) continue;
    const bit = SLOT_BITS[ctx.mask[i]].find((b) => !(M & b) && weight[i] + F[(i + 1) * WIDTH + (M | b)] === here);
    if (bit == null) break;
    picks.push(i);
    M |= bit;
  }
  return picks;
}

/** Subgradient search for the multipliers giving the lowest bound at the root. Only the bound's strength rests on it: any y >= 0 gives a valid bound. */
function bestMultipliers(ctx, rows, start, F) {
  const y = new Float64Array(rows.length), g = new Float64Array(rows.length);
  const largest = rows.map((row) => row.coef.reduce((top, c) => Math.max(top, Math.abs(c)), Math.max(Math.abs(row.rhs), row.size)));
  let bestY = Float64Array.from(y), bestUb = Infinity, theta = 1, stale = 0;
  for (let round = 0; round < MULT_ROUNDS && theta >= MULT_MIN_THETA; round++) {
    if (!largest.every((top, r) => y[r] * top <= MULT_MAX_TERM)) { // too large to use: back to the best, with a shorter step
      y.set(bestY);
      theta /= 2;
      continue;
    }
    const w = weightsFor(ctx, rows, y);
    fillTable(F, ctx.n, ctx.mask, w);
    let M = -1, top = -Infinity;
    for (const m of start.reach) if (F[m] > top) { top = F[m]; M = m; }
    if (M < 0) break; // no seating fills the lineup: every table will say so
    let ub = start.base + top;
    rows.forEach((row, r) => { ub += y[r] * row.rhs; });
    const gain = bestUb - ub;
    if (gain > 0) { bestUb = ub; bestY = Float64Array.from(y); }
    if (gain > MULT_MIN_GAIN) stale = 0;
    else if (++stale >= MULT_PATIENCE) { theta /= 2; stale = 0; }
    const picks = tracePicks(F, ctx, w, M);
    let norm = 0;
    rows.forEach((row, r) => {
      let used = 0;
      for (const i of picks) used += row.coef[i];
      const gap = used - row.rhs;
      g[r] = Math.abs(gap) < MULT_ZERO_GAP || (y[r] === 0 && gap < 0) ? 0 : gap;
      norm += g[r] * g[r];
    });
    if (norm === 0) break;
    const step = (theta * (ub - bestUb + 1)) / norm;
    for (let r = 0; r < y.length; r++) y[r] = Math.max(0, y[r] + step * g[r]);
  }
  return bestY;
}

/**
 * The run's bound, from `start`, the search state with only the locked men placed. For multipliers y >= 0 and a legal lineup,
 * each limit's a*x <= rhs gives
 *   value = sum(value - y*a) + sum(y*a) <= sum(value - y*a) + sum(y*rhs),
 * and the men must fill the open slots, so the table's best over the reachable slot sets caps what the men left can add.
 * One table per pair of scales on the best salary and ownership multipliers, since a node's best pair moves with what it has left.
 */
export function buildBound(ctx, s, start) {
  const rows = limitRows(ctx, s, start);
  const work = new Float64Array((ctx.n + 1) * WIDTH);
  const best = bestMultipliers(ctx, rows, start, work);
  const tables = [], weights = [], constants = [];
  for (const a of SAL_SCALES) {
    for (const b of s.maxTotalOwn != null ? OWN_SCALES : [1]) {
      const y = Float64Array.from(best);
      y[0] *= a;
      if (s.maxTotalOwn != null) y[1] *= b;
      const w = weightsFor(ctx, rows, y);
      const F = tables.length ? new Float64Array(work.length) : work;
      fillTable(F, ctx.n, ctx.mask, w);
      tables.push(F);
      weights.push(w);
      constants.push(rows.reduce((c, row, r) => c + y[r] * row.rhs, start.base));
    }
  }
  return { tables, weights, constants };
}

/** Writes to row d + 1 every slot set reachable from row d by seating a man with these slot bits; returns how many. */
export function extendReach(reach, count, d, bits, seen) {
  const from = d * REACH_MAX, to = from + REACH_MAX;
  let w = 0;
  for (let x = 0; x < count; x++) {
    const m = reach[from + x];
    for (let b = 0; b < bits.length; b++) {
      if (m & bits[b]) continue;
      const next = m | bits[b];
      if (!seen[next]) { seen[next] = 1; reach[to + w++] = next; }
    }
  }
  for (let x = 0; x < w; x++) seen[reach[to + x]] = 0;
  return w;
}
