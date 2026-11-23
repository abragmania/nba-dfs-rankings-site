// The optimizer's exact search (server/lineup/optimize.js calls it): the run's search context, the start state, the rules a full lineup must meet and the
// branch and bound itself. Split from optimize.js (global rule: a file over 600 lines is split); the bodies are optimize.js's, unchanged.
// Pure (no file or network access) and browser-safe: the public site runs it (site-src/opt-worker.js). Cash and GPP both maximize total projection; the
// feed's ceiling is never read (optimizer standard A21); a man missing a figure never reaches the pool, so none is scored as zero (RULES R1).
import { SLOTS, slotMask, pinnedMask } from "../board/slots.js";
import { EPS, BOUND_SLACK, WIDTH, SLOT_BITS, REACH_MAX, extendReach } from "./bound.js";
import { ruleTables, ruleCounts, ruleMet, ruleReachable } from "../board/own-rules.js";

const N = SLOTS.length;
/** Shared with optimize.js, which imports them from here (one copy of each helper). */
export const isNum = (v) => typeof v === "number" && Number.isFinite(v);
export const byIdOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** For each suffix start i (0..n), the up-to-N best keys of men i..n-1 under `better`, as a flat array of n+1 rows of N (NaN pads). */
function suffixBest(keys, better) {
  const n = keys.length;
  const out = new Float64Array((n + 1) * N).fill(NaN);
  for (let i = n - 1; i >= 0; i--) {
    const prev = out.subarray((i + 1) * N, (i + 2) * N);
    const row = out.subarray(i * N, (i + 1) * N);
    const k = keys[i];
    let w = 0, placed = false;
    for (let r = 0; r < N && w < N; r++) {
      if (!placed && (Number.isNaN(prev[r]) || better(k, prev[r]))) { row[w++] = k; placed = true; r--; continue; }
      if (Number.isNaN(prev[r])) break;
      row[w++] = prev[r];
    }
    if (!placed && w < N) row[w++] = k;
  }
  return out;
}

function sumFirst(arr, i, k) {
  let t = 0;
  for (let r = 0; r < k; r++) t += arr[i * N + r];
  return t;
}

/**
 * Builds the run's search context: pool sorted by objective (ties by salary, then dk_id), locked base state,
 * and the suffix tables the bounds read.
 */
export function buildContext(pool, lockedMen, mode, s) {
  const obj = (p) => p.projection; // Cash and GPP alike
  const sorted = [...pool].sort((a, b) => obj(b) - obj(a) || a.salary - b.salary || byIdOrder(a.dk_id, b.dk_id));
  const n = sorted.length;
  const all = [...lockedMen, ...sorted];
  const teams = [...new Set(all.map((p) => p.team))].sort();
  const games = [...new Set(all.map((p) => p.game))].sort();
  const tIdx = new Map(teams.map((t, i) => [t, i]));
  const gIdx = new Map(games.map((g, i) => [g, i]));
  const rules = s.ownRules, { hit, suffix } = ruleTables(rules, sorted); // own-rules.js: the men each ownership rule counts
  const ctx = {
    n, sorted, lockedMen, obj, rules, hit, hitSuffix: suffix, lockMask: lockedMen.map((p) => pinnedMask(p, s.pinned)),
    val: sorted.map(obj), sal: sorted.map((p) => p.salary), own: sorted.map((p) => (isNum(p.proj_own) ? p.proj_own : 0)),
    mask: sorted.map(slotMask), team: sorted.map((p) => tIdx.get(p.team)), game: sorted.map((p) => gIdx.get(p.game)),
    teamMax: teams.map((t) => s.teamOverrides[t]?.max ?? s.teamMax),
    // A team override min is a hard requirement; the overall teamMin binds only teams the lineup uses (absent, or at least teamMin men).
    hardMin: teams.map((t) => s.teamOverrides[t]?.min ?? 0),
    softMin: teams.map((t) => (s.teamOverrides[t]?.min != null ? 0 : s.teamMin)),
    gameMax: games.map((g) => s.gameOverrides[g]?.max ?? N),
    gameMin: games.map((g) => s.gameOverrides[g]?.min ?? 0),
    nTeams: teams.length, nGames: games.length, teams, tIdx, gIdx,
  };
  ctx.minTeams = teams.map((_, t) => t).filter((t) => ctx.hardMin[t] > 0 || ctx.softMin[t] > 0);
  ctx.gamesWithMin = games.map((_, g) => g).filter((g) => ctx.gameMin[g] > 0);
  // Suffix tables: cheapest and dearest salaries, smallest ownerships, per-team counts.
  ctx.smallSal = suffixBest(ctx.sal, (a, b) => a < b);
  ctx.largeSal = suffixBest(ctx.sal, (a, b) => a > b);
  ctx.smallOwn = suffixBest(ctx.own, (a, b) => a < b);
  ctx.teamSuffix = ctx.minTeams.map((t) => {
    const c = new Int32Array(n + 1);
    for (let i = n - 1; i >= 0; i--) c[i] = c[i + 1] + (ctx.team[i] === t ? 1 : 0);
    return c;
  });
  ctx.gameSuffix = ctx.gamesWithMin.map((g) => {
    const c = new Int32Array(n + 1);
    for (let i = n - 1; i >= 0; i--) c[i] = c[i + 1] + (ctx.game[i] === g ? 1 : 0);
    return c;
  });
  return ctx;
}

/** The search's starting state with only the locked men placed: the slot sets they can fill, team and game counts, base totals. */
export function baseState(ctx) {
  const st = {
    reach: [0],
    teamCount: new Int32Array(ctx.nTeams), gameCount: new Int32Array(ctx.nGames),
    distinctGames: 0, base: 0, baseSal: 0, baseOwn: 0, hitCount: ruleCounts(ctx.rules, ctx.lockedMen),
  };
  ctx.lockedMen.forEach((p, k) => {
    const next = new Set();
    for (const m of st.reach) for (const bit of SLOT_BITS[ctx.lockMask[k]]) if (!(m & bit)) next.add(m | bit); // a pinned man's mask is his one slot
    st.reach = [...next];
    st.teamCount[ctx.tIdx.get(p.team)]++;
    if (st.gameCount[ctx.gIdx.get(p.game)]++ === 0) st.distinctGames++;
    st.base += ctx.obj(p);
    st.baseSal += p.salary;
    st.baseOwn += isNum(p.proj_own) ? p.proj_own : 0;
  });
  return st;
}

/** The last rules a full lineup must meet, on the search state st. */
function leafOk(ctx, s, st, salary) {
  if (st.distinctGames < s.minGames) return false;
  if (s.minSalary != null && salary < s.minSalary) return false;
  for (let r = 0; r < ctx.rules.length; r++) if (!ruleMet(ctx.rules[r], st.hitCount[r])) return false;
  for (const t of ctx.minTeams) if (st.teamCount[t] < ctx.hardMin[t] || (st.teamCount[t] > 0 && st.teamCount[t] < ctx.softMin[t])) return false;
  for (const g of ctx.gamesWithMin) if (st.gameCount[g] < ctx.gameMin[g]) return false;
  return true;
}

/** False when the k men still to pick from i on cannot meet some rule, whatever they score. */
export function canFinish(ctx, s, st, i, k, salary, ow) {
  if (ctx.n - i < k) return false;
  if (salary + sumFirst(ctx.smallSal, i, k) > s.cap) return false;
  if (s.minSalary != null && salary + sumFirst(ctx.largeSal, i, k) < s.minSalary) return false;
  if (s.maxTotalOwn != null && ow + sumFirst(ctx.smallOwn, i, k) > s.maxTotalOwn + EPS) return false;
  // Every ownership rule must still be reachable with the k men left, all from men i on (each rule on its own: a valid bound, so still exact).
  for (let r = 0; r < ctx.rules.length; r++) {
    const hit = ctx.hitSuffix[r][i];
    if (!ruleReachable(ctx.rules[r], st.hitCount[r], k, hit, ctx.n - i - hit)) return false;
  }
  if (st.distinctGames + k < s.minGames) return false;
  let deficit = 0;
  for (let m = 0; m < ctx.minTeams.length; m++) {
    const t = ctx.minTeams[m];
    const c = st.teamCount[t];
    const d = Math.max(ctx.hardMin[t] - c, c > 0 ? ctx.softMin[t] - c : 0);
    if (d > 0) {
      if (d > ctx.teamSuffix[m][i]) return false;
      deficit += d;
    }
  }
  if (deficit > k) return false;
  // Games are disjoint, so their deficits add; a man can serve a team and its game at once, so they are not added to the teams'.
  let gameDeficit = 0;
  for (let m = 0; m < ctx.gamesWithMin.length; m++) {
    const g = ctx.gamesWithMin[m];
    const d = ctx.gameMin[g] - st.gameCount[g];
    if (d > 0) {
      if (d > ctx.gameSuffix[m][i]) return false;
      gameDeficit += d;
    }
  }
  return gameDeficit <= k;
}

/**
 * Exact search for the best lineup under every constraint plus the min-unique cuts (each a Set of pool indexes,
 * shared with the new lineup by at most maxShared[its index] pool men). Returns { set, proven }: set is the chosen pool
 * indexes or null; proven is false when the step limit stopped the search (set is then the best found so far, not proven best).
 * The men are tried in pool order, and a lineup replaces the best only by beating it by more than EPS, so among equal
 * scores the first in that order wins. A bound only closes a node holding no such lineup, so it never changes the pick.
 * firstFit ends the search at the first legal lineup: only whether one exists is being asked.
 * seed (the fast GPP build) is a legal lineup, pool indexes, to start from as the best so far.
 */
export function solve(ctx, s, cuts, maxShared, firstFit = false, seed = null, maxSteps = s.maxSteps) {
  const { n, val, sal, own, mask, team, game, hit } = ctx;
  const L = ctx.lockedMen.length;
  const st = baseState(ctx);
  const { teamCount, gameCount, hitCount } = st;
  const R = ctx.rules.length;
  const cutOf = Array.from({ length: n }, () => []);
  cuts.forEach((c, ci) => c.forEach((i) => cutOf[i].push(ci)));
  const shared = new Int32Array(cuts.length);
  const chosen = [];
  let best = -Infinity, bestSet = null, steps = 0, stopped = false;
  if (seed) { best = seed.reduce((t, i) => t + val[i], st.base); bestSet = [...seed]; }
  // Per depth: the slot sets the men so far can fill (none left means they cannot all be seated), and each table's constant plus their weights.
  const { tables, weights, constants } = ctx.bound;
  const P = tables.length;
  const reach = new Uint8Array((N + 1) * REACH_MAX), reachN = new Int32Array(N + 1), seen = new Uint8Array(WIDTH);
  const acc = new Float64Array((N + 1) * P);
  st.reach.forEach((m, x) => { reach[L * REACH_MAX + x] = m; });
  reachN[L] = st.reach.length;
  acc.set(constants, L * P);
  let lastTable = 0;

  /** True when table p shows no completion of this node beats `limit`. Written so that a NaN never closes a node. */
  function closedBy(p, i, d, limit) {
    const T = tables[p], row = i * WIDTH, a = acc[d * P + p], off = d * REACH_MAX, count = reachN[d];
    for (let x = 0; x < count; x++) if (!(a + T[row + reach[off + x]] <= limit)) return false;
    return true;
  }

  function dfs(i, k, v, salary, ow) {
    if (stopped || (firstFit && bestSet)) return;
    if (++steps > maxSteps) { stopped = true; return; }
    if (k === 0) {
      if (v > best + EPS && leafOk(ctx, s, st, salary)) { best = v; bestSet = [...chosen]; }
      return;
    }
    if (!canFinish(ctx, s, st, i, k, salary, ow)) return;
    const d = N - k, limit = best + EPS - BOUND_SLACK;
    if (closedBy(lastTable, i, d, limit)) return;
    for (let p = 0; p < P; p++) if (p !== lastTable && closedBy(p, i, d, limit)) { lastTable = p; return; }

    // Include man i.
    const t = team[i];
    let fits = teamCount[t] < ctx.teamMax[t] && gameCount[game[i]] < ctx.gameMax[game[i]] && salary + sal[i] <= s.cap && (s.maxTotalOwn == null || ow + own[i] <= s.maxTotalOwn + EPS);
    if (fits) for (const ci of cutOf[i]) if (shared[ci] >= maxShared[ci]) { fits = false; break; }
    if (fits && (reachN[d + 1] = extendReach(reach, reachN[d], d, SLOT_BITS[mask[i]], seen)) > 0) {
      for (let p = 0; p < P; p++) acc[(d + 1) * P + p] = acc[d * P + p] + weights[p][i];
      teamCount[t]++;
      if (gameCount[game[i]]++ === 0) st.distinctGames++;
      for (const ci of cutOf[i]) shared[ci]++;
      for (let r = 0; r < R; r++) if (hit[r][i]) hitCount[r]++;
      chosen.push(i);
      dfs(i + 1, k - 1, v + val[i], salary + sal[i], ow + own[i]);
      chosen.pop();
      for (let r = 0; r < R; r++) if (hit[r][i]) hitCount[r]--;
      for (const ci of cutOf[i]) shared[ci]--;
      if (--gameCount[game[i]] === 0) st.distinctGames--;
      teamCount[t]--;
    }
    // Leave man i out.
    dfs(i + 1, k, v, salary, ow);
  }

  dfs(0, N - L, st.base, st.baseSal, st.baseOwn);
  return { set: bestSet, proven: !stopped, steps };
}
