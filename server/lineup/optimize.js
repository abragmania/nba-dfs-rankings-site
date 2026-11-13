// DraftKings NBA classic lineup optimizer: exact branch and bound for Cash, a fast seeded search with a short exact run for GPP
// (fast-search.js); pure (no file or network access). Besides settings.variancePct's random source, the one outside input is the reference time used to read year-less tip stamps for late-swap seating: args.refMs, read from the clock
// (Date.now()) only at the entry point when the caller leaves it out; everything below takes it as an argument.
// Cash and GPP both maximize total projection. GPP adds its optional ownership limits (max total ownership, low-owned rules).
// The projection is the effective one the server passes in (Adam's typed number or bump, server/slate/overrides.js). The
// feed's ceiling is never read: a lineup carries no ceiling total and a man with none is never skipped for it (optimizer
// standard A21). A man missing a figure the run needs is skipped and never scored as zero (RULES R1).
import { SLOTS, SALARY_CAP, DEFAULT_COUNT, MAX_COUNT, slotMask, pinnedMask, assign, arrangeForLateSwap, checkLineup, isSalary } from "../board/slots.js";
import { EPS, BOUND_SLACK, WIDTH, SLOT_BITS, REACH_MAX, buildBound, extendReach } from "./bound.js";
import { readExposure, countLimits, limitStart, buildLimited } from "./exposure.js";
import { fastLineup, checkFastLineup, jitter, seededRandom } from "./fast-search.js";
import { isOut } from "../board/figures.js";

const N = SLOTS.length;
const MAX_LOW_RULES = 8;
/** The reason a man not playing is in the skipped list. */
export const OUT_WHY = "Out";
/** The note when every man this run may use (pool and locked or pinned men) is from one game. */
export const ONE_GAME_NOTE = "Every player this run can use is from one game; DraftKings needs players from at least two games.";
/** Search steps allowed per lineup before the run stops and says the lineup is not proven best; settings.maxSteps overrides. */
export const DEFAULT_MAX_STEPS = 10_000_000;
/** The step limit that means none: what the app's server names (build-run.js re-exports it as APP_MAX_STEPS). */
export const NO_STEP_LIMIT = Number.MAX_SAFE_INTEGER;
// The fast GPP build (fast-search.js). The exact search gets these steps per lineup from the local search's best, up to a total for the
// build, and these to look for a lineup the local search could not find, up to a total, so no setting can grind.
const FAST_EXACT_STEPS = 500_000;
const FAST_EXACT_TOTAL = 40_000_000;
const FAST_FIND_STEPS = 2_000_000;
const FAST_FIND_TOTAL = 10_000_000;
const FAST_FINDS = 32; // such looks per build: each can make a bound table
const FAST_BOUNDS = 6; // bound tables a build under Min % and Max % may make to polish its lineups; it can have many sets of held men
const FAST_SEED = 20261104;

const SETTING_KEYS = ["count", "minUnique", "minSalary", "teamMax", "teamMin", "teamOverrides", "gameOverrides", "maxTotalOwn", "lowOwned", "maxSteps", "pinned", "exposure", "variancePct"];
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const isPlain = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const byIdOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const round2 = (v) => Math.round(v * 100) / 100;
const money = (n) => "$" + n.toLocaleString("en-US");
const fail = (skipped, error) => ({ lineups: [], skipped, note: null, error });

/** Reads and checks the settings against the slate's teams and games; returns { s } or { error }. */
function readSettings(mode, settings, slateTeams, slateGames) {
  if (settings != null && !isPlain(settings)) return { error: "Settings must be an object." };
  const st = settings ?? {};
  const unknown = Object.keys(st).filter((k) => !SETTING_KEYS.includes(k));
  if (unknown.length) return { error: `Unknown setting: ${unknown.join(", ")}.` };
  const s = {
    cap: SALARY_CAP,
    minGames: 2,
    count: st.count ?? DEFAULT_COUNT,
    minUnique: st.minUnique ?? 1,
    minSalary: st.minSalary ?? null,
    teamMax: st.teamMax ?? N,
    teamMin: st.teamMin ?? 0,
    teamOverrides: st.teamOverrides ?? {},
    gameOverrides: st.gameOverrides ?? {},
    maxSteps: st.maxSteps ?? DEFAULT_MAX_STEPS,
    // maxTotalOwn and lowOwned are GPP limits: checked in either mode, ignored in Cash on purpose.
    maxTotalOwn: mode === "GPP" ? st.maxTotalOwn ?? null : null,
    lowOwned: [], // filled below from a checked list of rules, in GPP only
  };
  if (!isInt(s.count, 1, MAX_COUNT)) return { error: `Lineups must be a whole number from 1 to ${MAX_COUNT}.` };
  if (!isInt(s.minUnique, 1, N)) return { error: `Min unique must be a whole number from 1 to ${N}.` };
  if (s.minSalary != null && !isInt(s.minSalary, 0, SALARY_CAP)) return { error: `Min salary must be a whole number of dollars from 0 to ${SALARY_CAP}.` };
  if (!isInt(s.teamMax, 0, N) || !isInt(s.teamMin, 0, N)) return { error: `Min and max per team must be whole numbers from 0 to ${N}.` };
  if (s.teamMin > s.teamMax) return { error: `Min per team (${s.teamMin}) is more than max per team (${s.teamMax}).` };
  if (!isInt(s.maxSteps, 1, Number.MAX_SAFE_INTEGER)) return { error: "Max search steps must be a positive whole number." };
  // Variance is a GPP setting: checked in either mode, ignored in Cash on purpose, off at 0.
  const vary = st.variancePct;
  if (vary != null && !(isNum(vary) && vary >= 0 && vary <= 100)) return { error: "Variance must be a percentage from 0 to 100." };
  s.variancePct = mode === "GPP" && vary > 0 ? vary : null;
  // GPP puts speed first (Adam, 11-04). Cash, and a caller naming its own step limit, get the exact search.
  s.fast = s.variancePct != null || (mode === "GPP" && (st.maxSteps == null || st.maxSteps === NO_STEP_LIMIT));
  if (!isPlain(s.teamOverrides)) return { error: "Team overrides must map a team to {min, max}." };
  for (const [t, o] of Object.entries(s.teamOverrides)) {
    if (!slateTeams.has(t)) return { error: `Team override ${t} is not a team in this slate file (use its capital-letter code).` };
    if (!isPlain(o) || Object.keys(o).some((k) => k !== "min" && k !== "max")) return { error: `The ${t} override must be {min, max}.` };
    if ((o.min != null && !isInt(o.min, 0, N)) || (o.max != null && !isInt(o.max, 0, N))) return { error: `The ${t} min and max must be whole numbers from 0 to ${N}.` };
    if (o.min != null && o.min > (o.max ?? s.teamMax)) return { error: `The ${t} min (${o.min}) is more than its max (${o.max ?? s.teamMax}).` };
  }
  // A game override counts men from either team in that game; its min is a hard requirement, like a team override's.
  if (!isPlain(s.gameOverrides)) return { error: "Game overrides must map a game to {min, max}." };
  for (const [g, o] of Object.entries(s.gameOverrides)) {
    if (!slateGames.has(g)) return { error: `Game override ${g} is not a game on this slate.` };
    if (!isPlain(o) || Object.keys(o).some((k) => k !== "min" && k !== "max")) return { error: `The ${g} override must be {min, max}.` };
    if ((o.min != null && !isInt(o.min, 0, N)) || (o.max != null && !isInt(o.max, 0, N))) return { error: `The ${g} min and max must be whole numbers from 0 to ${N}.` };
    if (o.min != null && o.max != null && o.min > o.max) return { error: `The ${g} min (${o.min}) is more than its max (${o.max}).` };
  }
  const own = st.maxTotalOwn, lo = st.lowOwned;
  if (own != null && !(isNum(own) && own >= 0)) return { error: "Max total ownership must be a percentage." };
  // Low-owned rules: a list of {count, underPct}, every rule binding at once; the older single {count, underPct} is a list of one.
  if (lo != null) {
    const rules = Array.isArray(lo) ? lo : [lo];
    if (rules.length > MAX_LOW_RULES) return { error: `At most ${MAX_LOW_RULES} low-owned rules; this run has ${rules.length}.` };
    for (const [i, r] of rules.entries()) {
      const shape = isPlain(r) && Object.keys(r).every((k) => k === "count" || k === "underPct");
      const which = rules.length === 1 ? "Low-owned" : `Low-owned rule ${i + 1}`;
      if (!shape || !isInt(r.count, 0, N) || !(isNum(r.underPct) && r.underPct >= 0)) return { error: `${which} must be {count: 0 to ${N}, underPct: a percentage}.` };
    }
    if (mode === "GPP") s.lowOwned = rules.map((r) => ({ count: r.count, underPct: r.underPct }));
  }
  // Late-swap pins (Adam, 2026-10-29): dk_id -> the one slot that man must fill, in Cash and GPP alike. The men themselves
  // are checked against the slate in preparePool.
  const pins = st.pinned ?? {};
  if (!isPlain(pins)) return { error: "Pinned must map DraftKings ids to roster slots." };
  const pinIds = Object.keys(pins);
  if (pinIds.length > N) return { error: `At most ${N} players can be pinned; this run has ${pinIds.length}.` };
  for (const id of pinIds) {
    if (typeof pins[id] !== "string" || !SLOTS.includes(pins[id])) return { error: `Pinned player ${id} has slot ${JSON.stringify(pins[id])}; a slot is one of ${SLOTS.join(", ")}.` };
  }
  s.pinned = { ...pins };
  // A man's Min % and Max % (exposure.js). Late swap fills open slots around one entry, so they do not apply there.
  const limits = readExposure(st.exposure);
  if (limits.error) return { error: limits.error };
  s.exposureIgnored = mode !== "GPP" && Object.keys(limits.exposure).length > 0; // Min % and Max % are GPP settings (the server holds the rule too): a Cash run ignores them and says so
  s.exposure = s.exposureIgnored ? {} : limits.exposure;
  if (pinIds.length && Object.keys(s.exposure).length) return { error: "Min % and Max % do not apply in late swap." };
  return { s };
}

/** A man the board or our minutes say is not playing: Out by status (figures.js isOut), or our engine's playing === false. Whatever his projection, the
 *  pool never holds him (RULES R4); a man the caller locks, hand-picks or pins is its explicit choice and is named in the run's note instead. */
export const isNotPlaying = (p) => isOut(p?.injury_status) || p?.ours?.playing === false;

/** What a man lacks for this run, as phrases ("no salary"); empty when he is eligible. */
function gaps(p, mode, s) {
  const g = [];
  const figure = (v, label) => {
    if (v == null) g.push(`no ${label}`);
    else if (!isNum(v)) g.push(`a ${label} that is not a number`);
  };
  if (typeof p.dk_id !== "string" || !p.dk_id) g.push("no DraftKings id");
  if (p.salary == null) g.push("no salary");
  else if (!isSalary(p.salary)) g.push("a salary that is not a positive whole number");
  // Both modes score the projection; nothing else is needed to score a man.
  figure(p.projection, "projection");
  if (!Array.isArray(p.roster_positions) || !p.roster_positions.length) g.push("no roster positions");
  if (p.team == null) g.push("no team");
  if (p.game == null) g.push("no game");
  if (s.maxTotalOwn != null) figure(p.proj_own, "projected ownership (the total-ownership cap needs it)");
  // The search's cap check assumes none below zero, and a low-owned rule would count him as under any line. Low-owned rules alone do not need the figure: a man with none just never counts.
  if ((s.maxTotalOwn != null || s.lowOwned.length) && isNum(p.proj_own) && p.proj_own < 0) g.push("a projected ownership below zero");
  return g;
}

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
function buildContext(pool, lockedMen, mode, s) {
  const obj = (p) => p.projection; // Cash and GPP alike
  const sorted = [...pool].sort((a, b) => obj(b) - obj(a) || a.salary - b.salary || byIdOrder(a.dk_id, b.dk_id));
  const n = sorted.length;
  const all = [...lockedMen, ...sorted];
  const teams = [...new Set(all.map((p) => p.team))].sort();
  const games = [...new Set(all.map((p) => p.game))].sort();
  const tIdx = new Map(teams.map((t, i) => [t, i]));
  const gIdx = new Map(games.map((g, i) => [g, i]));
  const rules = s.lowOwned;
  // Low-owned means a published ownership strictly under the rule's underPct (<, so a man at exactly 5.0% is not under 5%); a man with
  // no ownership never counts. One man counts toward every rule he meets.
  const isLow = (p, r) => isNum(p.proj_own) && p.proj_own < rules[r].underPct;
  const ctx = {
    n, sorted, lockedMen, isLow, obj, rules, lockMask: lockedMen.map((p) => pinnedMask(p, s.pinned)),
    val: sorted.map(obj), sal: sorted.map((p) => p.salary), own: sorted.map((p) => (isNum(p.proj_own) ? p.proj_own : 0)),
    mask: sorted.map(slotMask), team: sorted.map((p) => tIdx.get(p.team)), game: sorted.map((p) => gIdx.get(p.game)),
    low: rules.map((_, r) => sorted.map((p) => isLow(p, r))),
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
  // Suffix tables: cheapest and dearest salaries, smallest ownerships, low-owned and per-team counts.
  ctx.smallSal = suffixBest(ctx.sal, (a, b) => a < b);
  ctx.largeSal = suffixBest(ctx.sal, (a, b) => a > b);
  ctx.smallOwn = suffixBest(ctx.own, (a, b) => a < b);
  ctx.lowSuffix = ctx.low.map((low) => {
    const c = new Int32Array(n + 1);
    for (let i = n - 1; i >= 0; i--) c[i] = c[i + 1] + (low[i] ? 1 : 0);
    return c;
  });
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
function baseState(ctx) {
  const st = {
    reach: [0],
    teamCount: new Int32Array(ctx.nTeams), gameCount: new Int32Array(ctx.nGames),
    distinctGames: 0, base: 0, baseSal: 0, baseOwn: 0, lowCount: new Int32Array(ctx.rules.length),
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
    for (let r = 0; r < ctx.rules.length; r++) if (ctx.isLow(p, r)) st.lowCount[r]++;
  });
  return st;
}

/** The last rules a full lineup must meet, on the search state st. */
function leafOk(ctx, s, st, salary) {
  if (st.distinctGames < s.minGames) return false;
  if (s.minSalary != null && salary < s.minSalary) return false;
  for (let r = 0; r < ctx.rules.length; r++) if (st.lowCount[r] < ctx.rules[r].count) return false;
  for (const t of ctx.minTeams) if (st.teamCount[t] < ctx.hardMin[t] || (st.teamCount[t] > 0 && st.teamCount[t] < ctx.softMin[t])) return false;
  for (const g of ctx.gamesWithMin) if (st.gameCount[g] < ctx.gameMin[g]) return false;
  return true;
}

/** False when the k men still to pick from i on cannot meet some rule, whatever they score. */
function canFinish(ctx, s, st, i, k, salary, ow) {
  if (ctx.n - i < k) return false;
  if (salary + sumFirst(ctx.smallSal, i, k) > s.cap) return false;
  if (s.minSalary != null && salary + sumFirst(ctx.largeSal, i, k) < s.minSalary) return false;
  if (s.maxTotalOwn != null && ow + sumFirst(ctx.smallOwn, i, k) > s.maxTotalOwn + EPS) return false;
  // Every low-owned rule must still be reachable with the k men left (each rule on its own: a valid bound, so still exact).
  for (let r = 0; r < ctx.rules.length; r++) if (st.lowCount[r] + Math.min(k, ctx.lowSuffix[r][i]) < ctx.rules[r].count) return false;
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
function solve(ctx, s, cuts, maxShared, firstFit = false, seed = null, maxSteps = s.maxSteps) {
  const { n, val, sal, own, mask, team, game, low } = ctx;
  const L = ctx.lockedMen.length;
  const st = baseState(ctx);
  const { teamCount, gameCount, lowCount } = st;
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
      for (let r = 0; r < R; r++) if (low[r][i]) lowCount[r]++;
      chosen.push(i);
      dfs(i + 1, k - 1, v + val[i], salary + sal[i], ow + own[i]);
      chosen.pop();
      for (let r = 0; r < R; r++) if (low[r][i]) lowCount[r]--;
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

/**
 * One lineup of the fast GPP build: the local search, then (variance off) a short exact run from its answer, which improves it or proves
 * it best. Returns { set, proven }; set null with proven false means no legal lineup was found in the budget. With variance each search
 * scores its own varied projections; the men's own figures are untouched.
 */
function fastSearch(ctx, s, cuts, maxShared, firstFit = false) {
  const run = s.fastRun, start = baseState(ctx), varied = s.variancePct != null;
  const vals = varied && !firstFit ? jitter(ctx.val, s.variancePct, run.random) : ctx.val;
  const seed = fastLineup({ ctx, s, start, cuts, maxShared, vals, rng: run.rng, firstFit });
  if (seed) {
    const broke = checkFastLineup(ctx, s, start, seed, cuts, maxShared);
    if (broke) throw new Error(`The fast search produced an illegal lineup: ${broke}.`);
    if (firstFit) return { set: seed, proven: true };
    if (varied) return { set: seed, proven: false };
    if (run.exactLeft <= 0 || (!ctx.bound && run.bounds >= FAST_BOUNDS)) return { set: seed, proven: false };
    if (!ctx.bound) { ctx.bound = buildBound(ctx, s, start); run.bounds++; }
    const r = solve(ctx, s, cuts, maxShared, false, seed, Math.min(FAST_EXACT_STEPS, run.exactLeft));
    run.exactLeft -= r.steps;
    return r;
  }
  // The test the exact search runs first: failing it at the root shows there is none, at no cost to the allowance.
  if (!canFinish(ctx, s, start, 0, N - ctx.lockedMen.length, start.baseSal, start.baseOwn)) return { set: null, proven: true };
  // The local search found none: the exact search looks, or shows there is none, within what is left of the build's allowance.
  if (run.finds >= FAST_FINDS || run.findLeft <= 0) return { set: null, proven: false };
  run.finds++;
  if (!ctx.bound) ctx.bound = buildBound(ctx, s, start);
  const r = solve(ctx, s, cuts, maxShared, firstFit || varied, null, Math.min(FAST_FIND_STEPS, run.findLeft));
  run.findLeft -= r.steps;
  // Under variance the first legal lineup is taken, so it is proven nothing; set null with proven true still means none exists.
  return varied && !firstFit ? { set: r.set, proven: r.set ? false : r.proven } : r;
}

const fastStopNote = (r) => `The fast GPP search found no legal lineup ${r + 1} within its budget under these settings; loosen a setting or build fewer.`;

/** A fast build's lineups, best real projection first, and its one line. */
function finishFast(lineups, s, note) {
  lineups.sort((a, b) => b.projection - a.projection);
  const open = lineups.filter((l) => !l.proven).length;
  const line = !lineups.length ? null
    : s.variancePct != null ? `Variance ±${s.variancePct}%: each lineup was searched on varied projections; the numbers shown are the real ones.`
    : open ? `Fast GPP build: ${open} of ${lineups.length} lineups are the best found, not proven best.` : null;
  return [note, line].filter(Boolean).join(" ") || null;
}

/** Throws when a pinned man is not in his pinned slot of `slots` (SLOTS order): the last guard before a lineup is returned. */
export function assertPinned(slots, pinned) {
  const off = Object.entries(pinned ?? {}).filter(([id, slot]) => slots[SLOTS.indexOf(slot)]?.dk_id !== id);
  if (off.length) throw new Error("Optimizer moved a pinned player: " + off.map(([id, slot]) => `${id} at ${slot}`).join(", "));
}

function lineupOf(men, proven, refMs, pinned) {
  // Who is in the lineup is settled; only the seating is chosen here, for late swap (plain order when a tip is unreadable).
  // A pinned man is never re-seated; a hand-picked man is just a man in the lineup and may take any slot his positions allow
  // (Adam, 2:58 PM ET 2026-10-29).
  const placed = arrangeForLateSwap(men, { refMs, pinned });
  const slots = placed.slots;
  const check = checkLineup(slots);
  if (!check.ok) throw new Error("Optimizer produced an illegal lineup: " + check.reasons.join(" "));
  assertPinned(slots, pinned);
  const sum = (f) => (men.some((p) => !isNum(p[f])) ? null : round2(men.reduce((t, p) => t + p[f], 0)));
  const teams = {};
  for (const p of [...men].sort((a, b) => byIdOrder(a.team, b.team))) teams[p.team] = (teams[p.team] ?? 0) + 1;
  return {
    slots,
    salary: men.reduce((t, p) => t + p.salary, 0),
    projection: sum("projection"),
    total_own: sum("proj_own"),
    games: new Set(men.map((p) => p.game)).size,
    teams,
    proven,
    late_swap: placed.arranged,
  };
}

/** True when late-swap pins are in the run. */
const latePinned = (s) => Object.keys(s.pinned).length > 0;
/** How the men held in every lineup are named: "locked", "locked or pinned" (late swap) or "locked or hand-picked". */
const heldWord = (s) => (latePinned(s) ? "locked or pinned" : s.hand ? "locked or hand-picked" : "locked");

/** Checks the locked men and the team minimums against what is available; returns a plain-English reason no lineup can exist, or null. */
function startProblem(lockedMen, pool, s) {
  const pinned = latePinned(s), held = heldWord(s);
  if (lockedMen.length > N) return `${lockedMen.length} players are ${held}; a lineup holds ${N}.`;
  const placed = assign(lockedMen, { pinned: s.pinned });
  if (!placed.ok) return `No legal roster slot for ${s.hand ? "locked or hand-picked" : "locked"}: ${placed.unplaced.map((p) => p.name).join(", ")}${pinned ? " (around the pinned players)" : ""}.`;
  const salary = lockedMen.reduce((t, p) => t + p.salary, 0);
  if (salary > s.cap) return `The ${s.hand ? "locked and hand-picked" : "locked"} players' salary ${money(salary)} is over the ${money(s.cap)} cap.`;
  // With 8 held men no search step runs, so this is the one check of their ownership against the cap.
  const heldOwn = lockedMen.reduce((t, p) => t + p.proj_own, 0);
  if (s.maxTotalOwn != null && heldOwn > s.maxTotalOwn + EPS) return `The ${held} players' total ownership ${round2(heldOwn)}% is over the ${s.maxTotalOwn}% limit.`;
  if (new Set([...lockedMen, ...pool].map((p) => p.game)).size < s.minGames) return ONE_GAME_NOTE;
  const byTeam = {};
  for (const p of lockedMen) byTeam[p.team] = (byTeam[p.team] ?? 0) + 1;
  for (const [t, c] of Object.entries(byTeam)) {
    const max = s.teamOverrides[t]?.max ?? s.teamMax;
    if (c > max) return `${c} ${s.hand ? "locked or hand-picked" : "locked"} players are from ${t}; the most allowed is ${max}.`;
  }
  for (const [t, o] of Object.entries(s.teamOverrides).sort(([a], [b]) => byIdOrder(a, b))) {
    if (o.min == null) continue;
    const have = [...lockedMen, ...pool].filter((p) => p.team === t).length;
    if (have < o.min) return `${t} has ${have} available player${have === 1 ? "" : "s"} in this run; the ${t} minimum is ${o.min}.`;
  }
  return gameProblem(lockedMen, pool, s);
}

/** Why the game limits cannot hold before any search runs, naming the game; null when no such reason shows. */
function gameProblem(lockedMen, pool, s) {
  const limits = Object.entries(s.gameOverrides).sort(([a], [b]) => byIdOrder(a, b));
  if (!limits.length) return null;
  const men = [...lockedMen, ...pool], held = heldWord(s);
  const count = (list, f) => list.filter(f).length;
  const players = (c) => `${c} player${c === 1 ? "" : "s"}`;
  const teamsIn = (g) => [...new Set(men.filter((p) => p.game === g).map((p) => p.team))];
  // A team min counts toward a game only when the team plays no other game: otherwise another game could meet it.
  const teamMinIn = (t, g) => (men.every((p) => p.team !== t || p.game === g) ? s.teamOverrides[t]?.min ?? 0 : 0);
  for (const [g, o] of limits) {
    const heldHere = count(lockedMen, (p) => p.game === g);
    if (o.max != null && heldHere > o.max) return `${players(heldHere)} ${heldHere === 1 ? "is" : "are"} ${held} from ${g}; the most allowed from that game is ${o.max}.`;
    const teamNeed = teamsIn(g).reduce((c, t) => c + teamMinIn(t, g), 0);
    if (o.max != null && teamNeed > o.max) return `The team minimums in ${g} need ${players(teamNeed)}; the most allowed from that game is ${o.max}.`;
    if (!o.min) continue;
    if (o.min >= N) return `The ${g} minimum is ${o.min}, but DraftKings needs players from at least two games, so one game can fill at most ${N - 1} slots.`;
    const have = count(men, (p) => p.game === g);
    if (have < o.min) return `${g} has ${players(have)} available in this run; the ${g} minimum is ${o.min}.`;
    const room = teamsIn(g).reduce((c, t) => c + Math.min(count(men, (p) => p.team === t && p.game === g), s.teamOverrides[t]?.max ?? s.teamMax), 0);
    if (room < o.min) return `The team limits allow ${players(room)} from ${g}; the ${g} minimum is ${o.min}.`;
  }
  // What each game can supply at most, under its max and its teams' limits: it must fill the lineup, from at least two games.
  const maxes = limits.filter(([, o]) => o.max != null).map(([g, o]) => `${g} at most ${o.max}`).join(", ");
  const capacity = (g) => Math.min(s.gameOverrides[g]?.max ?? N, teamsIn(g).reduce((c, t) => c + Math.min(count(men, (p) => p.team === t && p.game === g), s.teamOverrides[t]?.max ?? s.teamMax), 0));
  const roomy = [...new Set(men.map((p) => p.game))].map((g) => [g, capacity(g)]).filter(([, c]) => c > 0);
  const fillable = roomy.reduce((c, [, n]) => c + n, 0);
  if (roomy.length < s.minGames && maxes) return `The game limits (${maxes}) leave players from ${roomy.length === 1 ? `only ${roomy[0][0]}` : "no game"}; DraftKings needs players from at least two games.`;
  if (fillable < N && maxes) return `The game limits (${maxes}) with the team limits allow ${players(fillable)}; a lineup holds ${N}.`;
  // Games share no men, so what each must supply adds up. Each game supplies the most of its minimum and its teams' (their minimums, or their held men).
  const needOf = (g) => Math.max(s.gameOverrides[g]?.min ?? 0, teamsIn(g).reduce((c, t) => c + Math.max(teamMinIn(t, g), count(lockedMen, (p) => p.team === t && p.game === g)), 0));
  const total = [...new Set(men.map((p) => p.game))].reduce((c, g) => c + needOf(g), 0);
  const named = limits.filter(([, o]) => o.min > 0).map(([g, o]) => `${g} at least ${o.min}`);
  if (total > N && named.length) return `The game minimums (${named.join(", ")}) with the other minimums and ${held} players need ${total} players; a lineup holds ${N}.`;
  return null;
}

/** The game limits in words, for the note when the search finds no lineup under them; "" with none. */
function gameLimitWords(s) {
  const words = Object.entries(s.gameOverrides).sort(([a], [b]) => byIdOrder(a, b)).flatMap(([g, o]) => {
    if (o.min != null && o.max != null) return [`${g} ${o.min} to ${o.max}`];
    return o.min != null ? [`${g} at least ${o.min}`] : o.max != null ? [`${g} at most ${o.max}`] : [];
  });
  return words.join(", ");
}

/**
 * The hand-picked men come from the request, so their errors never end "in this slate file" (the server reads that ending
 * as its own data's fault): each must be on the slate, once, not excluded, and have every figure the run needs.
 * Returns the reason, or null.
 */
function checkHandPicked(players, handPicked, exSet, mode, s) {
  if (new Set(handPicked).size !== handPicked.length) return "A hand-picked man is listed twice.";
  if (handPicked.length > N) return `At most ${N} men can be hand-picked; this run has ${handPicked.length}.`;
  const byId = new Map(players.map((p) => [p.dk_id, p]));
  for (const id of handPicked) {
    const p = byId.get(id);
    if (!p) return `Hand-picked player ${id} is not on this slate.`;
    if (exSet.has(id)) return `${p.name} is hand-picked and excluded; remove the exclude or take him out of the lineup.`;
    const g = gaps(p, mode, s);
    if (g.length) return `Hand-picked ${p.name} has ${g.join(", ")} in this slate file, so no lineup with him can be scored.`;
  }
  return null;
}

/** Splits the players into locked men, the eligible pool and the skipped list; returns { lockedMen, pool, skipped } or { error }. */
function preparePool(players, mode, s, lockSet, exSet) {
  const skipped = [];
  const byId = new Map();
  for (const p of players) {
    const g = gaps(p, mode, s);
    if (g.includes("no DraftKings id")) {
      skipped.push({ dk_id: null, name: p.name ?? null, why: `${g.join(", ")} in this slate file` });
      continue;
    }
    if (byId.has(p.dk_id)) return { skipped, error: `DraftKings id ${p.dk_id} appears twice in this slate file.` };
    byId.set(p.dk_id, { p, g });
  }
  for (const id of Object.keys(s.exposure)) if (!byId.has(id)) return { skipped, error: `Player ${id} has a Min % or Max % and is not on this slate.` };
  for (const id of exSet) if (!byId.has(id)) return { skipped, error: `Excluded player ${id} is not in this slate file.` };
  for (const id of lockSet) {
    if (!byId.has(id)) return { skipped, error: `Locked player ${id} is not in this slate file.` };
    if (exSet.has(id)) return { skipped, error: `${byId.get(id).p.name} is both locked and excluded.` };
  }
  // Pins come from the request, so their errors never end "in this slate file" (the server reads that ending as its own data's fault).
  const slotTaken = new Map();
  for (const [id, slot] of Object.entries(s.pinned)) {
    if (!byId.has(id)) return { skipped, error: `Pinned player ${id} is not on this slate.` };
    const { p, g } = byId.get(id);
    if (exSet.has(id)) return { skipped, error: `${p.name} is both pinned and excluded.` };
    if (g.length) return { skipped, error: `Pinned ${p.name} has ${g.join(", ")} in this slate file, so no lineup with him can be scored.` };
    if (!p.roster_positions.includes(slot)) return { skipped, error: `${p.name} cannot be pinned at ${slot}; he can play ${p.roster_positions.join(", ")}.` };
    if (slotTaken.has(slot)) return { skipped, error: `${slotTaken.get(slot)} and ${p.name} are both pinned at ${slot}.` };
    slotTaken.set(slot, p.name);
  }
  // A pinned man is in the lineup, like a locked one. Pinned men go first, so a locked man with no slot left around the
  // pins is the one the start check names.
  lockSet = new Set([...Object.keys(s.pinned), ...lockSet]);
  const pool = [];
  for (const { p, g } of byId.values()) {
    if (exSet.has(p.dk_id) || lockSet.has(p.dk_id)) continue;
    if (isNotPlaying(p)) skipped.push({ dk_id: p.dk_id, name: p.name, why: OUT_WHY });
    else if (g.length) skipped.push({ dk_id: p.dk_id, name: p.name, why: `${g.join(", ")} in this slate file` });
    else pool.push(p);
  }
  skipped.sort((a, b) => (a.dk_id == null) - (b.dk_id == null) || byIdOrder(a.dk_id ?? "", b.dk_id ?? "") || byIdOrder(a.name ?? "", b.name ?? ""));
  const lockedMen = [...lockSet].map((id) => byId.get(id));
  const lockedGaps = lockedMen.filter(({ g }) => g.length);
  if (lockedGaps.length) return { skipped, error: lockedGaps.map(({ p, g }) => `${p.name} has ${g.join(", ")} in this slate file`).join("; ") + "." };
  return { lockedMen: lockedMen.map(({ p }) => p), pool, skipped, lockSet };
}

/**
 * optimize({ players, mode: "Cash" | "GPP", settings, locked: [dk_id], excluded: [dk_id], refMs }) → { lineups, skipped, note, error }.
 * refMs (milliseconds; default the clock now) picks the year of a year-less tip stamp; it changes only the seating.
 * settings.count defaults to DEFAULT_COUNT (standard D9), so a caller wanting one lineup must say so.
 * note (null or a sentence) says why fewer lineups than asked came back; error (null or a sentence) says why the run could not start.
 * Each lineup: { slots (SLOTS order), salary, projection, total_own (null if any man's is missing), games, teams,
 * proven (false when a step limit or the fast GPP budget stopped the search before proving that lineup best, and always under variance), late_swap (true when the
 * slots are in late-swap order, later tips in the more flexible slots; false when a man's tip is missing or unreadable
 * and the slots are the plain placement) }.
 * settings.exposure (B10): { dk_id: { min?, max? } }, percentages of the lineups asked (exposure.js); with none that binds the
 * search below runs exactly as it would without it. Refused with pins: they do not apply in late swap.
 * settings.pinned (late swap): { dk_id: slot }; each pinned man is in every lineup at exactly that slot, counts toward the
 * cap, team limits and ownership rules like a locked man, and is never re-seated. Pins work in Cash and GPP.
 * settings.gameOverrides: { game: { min?, max? } }, men from either team in that game; a min is a hard requirement.
 * GPP is the fast build (fast-search.js): every hard rule holds, a lineup may be not proven best, and the note says so in one line.
 * Naming settings.maxSteps below the app's no-limit value asks for the exact search; Cash always has it.
 * settings.variancePct (GPP only): each lineup is searched on every man's projection varied by a uniform plus or minus that percent,
 * drawn from `random`; the lineups keep the real figures and come back best real projection first.
 * handPicked (the working lineup, Adam 5:34 PM ET 2026-10-29): [dk_id]; each is in every lineup as if locked for this run
 * only, in Cash and GPP, under every other setting. He holds no slot: he may sit in any slot his positions allow (Adam,
 * 2:58 PM ET 2026-10-29: "that doesn't mean he HAS to be locked in at SG ... He can play either position").
 * onProgress (the server's worker, lineup/build-run.js): called with { done: 0, of, skipped } once the search starts, then with
 * { done, of, lineup } as each lineup finishes. It changes nothing about the search or its result.
 */
export function optimize({ players, mode, settings, locked = [], excluded = [], handPicked = [], refMs = Date.now(), onProgress = null, random = Math.random }) {
  if (mode !== "Cash" && mode !== "GPP") return fail([], 'Mode must be "Cash" or "GPP".');
  if (!isNum(refMs)) return fail([], "The reference time for reading tip times must be a number of milliseconds.");
  if (!Array.isArray(players)) return fail([], "Players must be a list.");
  if (!players.every(isPlain)) return fail([], "Each player must be an object.");
  const strings = (a) => Array.isArray(a) && a.every((id) => typeof id === "string");
  if (!strings(locked)) return fail([], "Locked must be a list of DraftKings ids.");
  if (!strings(excluded)) return fail([], "Excluded must be a list of DraftKings ids.");
  if (!strings(handPicked)) return fail([], "Hand-picked men must be a list of DraftKings ids.");
  const onSlate = (f) => new Set(players.map((p) => p[f]).filter((v) => v != null));
  const read = readSettings(mode, settings, onSlate("team"), onSlate("game"));
  if (read.error) return fail([], read.error);
  const s = read.s;
  s.fastRun = { rng: seededRandom(FAST_SEED), random, findLeft: FAST_FIND_TOTAL, finds: 0, exactLeft: FAST_EXACT_TOTAL, bounds: 0, lastProven: false };
  const exSet = new Set(excluded);
  const handProblem = checkHandPicked(players, handPicked, exSet, mode, s);
  if (handProblem) return fail([], handProblem);
  s.hand = handPicked.length > 0;
  const lockIds = new Set([...locked, ...handPicked]);
  const result = runSearch(players, mode, s, lockIds, exSet, refMs, onProgress);
  // A man Out who is held anyway (locked, hand-picked or pinned: the caller's own choice) is named, never rostered silently.
  const held = new Set([...lockIds, ...Object.keys(s.pinned)]);
  const heldOut = players.filter((p) => held.has(p.dk_id) && isNotPlaying(p)).map((p) => p.name ?? p.dk_id);
  if (heldOut.length && result.lineups.length) result.note = [result.note, `${heldOut.join(", ")} ${heldOut.length === 1 ? "is" : "are"} Out but held in every lineup because ${heldOut.length === 1 ? "he was" : "they were"} locked, hand-picked or already in the entry.`].filter(Boolean).join(" ");
  if (s.exposureIgnored && !result.error) result.note = [result.note, "Min % and Max % are GPP settings; this Cash run ignored them."].filter(Boolean).join(" ");
  return result;
}

/** The sentence when the step limit ended the search on lineup r + 1. */
const stepsNote = (s, r, found) => (found
  ? `Search stopped after ${s.maxSteps.toLocaleString("en-US")} steps; lineup ${r + 1} not proven best.`
  : `Search stopped after ${s.maxSteps.toLocaleString("en-US")} steps before finding lineup ${r + 1}.`);

/**
 * The search a build under Min % and Max % uses (exposure.js): the men `held` count as locked for this one lineup and the men
 * in `out` leave the pool. A cut counts every man the new lineup is sure to share with an earlier one, since who is held changes
 * from lineup to lineup. Dropping men keeps the pool's order, so ties break as they do without limits.
 */
function limitedSearch(lockedMen, pool, mode, s) {
  const byId = new Map(pool.map((p) => [p.dk_id, p]));
  const contexts = new Map();
  const noLineup = new Set(); // fast build: held and out sets shown to have no lineup; the lineups built only tighten, so none stays none
  const keyOf = (held, out) => JSON.stringify([[...held].sort(), [...out].sort()]);
  const contextFor = (held, out) => {
    const key = keyOf(held, out);
    if (contexts.has(key)) return contexts.get(key);
    const men = [...lockedMen, ...held.map((id) => byId.get(id))];
    const left = pool.filter((p) => !out.has(p.dk_id) && !held.includes(p.dk_id));
    let ctx = null;
    if (!startProblem(men, left, s)) {
      ctx = buildContext(left, men, mode, s);
      if (!s.fast) ctx.bound = buildBound(ctx, s, baseState(ctx));
      ctx.index = new Map(ctx.sorted.map((p, i) => [p.dk_id, i]));
    }
    if (contexts.size >= 16) contexts.clear(); // each holds its bound tables: only the latest few are ever asked again
    contexts.set(key, ctx);
    return ctx;
  };
  return (held, out, built, firstFit) => {
    if (noLineup.has(keyOf(held, out))) return { ids: null, proven: true };
    const ctx = contextFor(held, out);
    if (!ctx) return { ids: null, proven: true };
    const sure = ctx.lockedMen.map((p) => p.dk_id);
    const room = built.map((ids) => N - s.minUnique - sure.filter((id) => ids.includes(id)).length);
    if (room.some((x) => x < 0)) return { ids: null, proven: true }; // the men held already match that lineup too closely
    const cuts = built.map((ids) => new Set(ids.map((id) => ctx.index.get(id)).filter((i) => i != null)));
    const { set, proven } = s.fast ? fastSearch(ctx, s, cuts, room, firstFit) : solve(ctx, s, cuts, room, firstFit);
    const ids = set && [...sure, ...set.map((i) => ctx.sorted[i].dk_id)];
    if (!s.fast) return { ids, proven };
    if (!firstFit) s.fastRun.lastProven = proven;
    if (!ids && proven) noLineup.add(keyOf(held, out));
    return { ids, proven: Boolean(ids) || proven }; // a fast lineup not proven best is still a lineup: the batch goes on
  };
}

/** A build with a Min % or Max % that binds: the start checks, then the batch (exposure.js). */
function runLimited(limits, players, { lockedMen, pool, skipped }, mode, s, exSet, refMs, onProgress) {
  const byId = new Map(players.map((p) => [p.dk_id, p]));
  const usable = new Set(pool.map((p) => p.dk_id));
  const nameOf = (id) => byId.get(id)?.name ?? id;
  const skipWhy = (id) => skipped.find((x) => x.dk_id === id)?.why;
  const why = (id) => (usable.has(id) ? null : exSet.has(id) ? "is excluded" : skipWhy(id) === OUT_WHY ? "is Out" : `cannot be scored (${skipWhy(id) ?? "a figure is missing"})`);
  const held = new Set(lockedMen.map((p) => p.dk_id));
  const refused = limitStart(limits, s.count, { nameOf, held, why });
  if (refused) return { lineups: [], skipped, note: refused, error: null };
  for (const id of held) limits.delete(id); // he is in every lineup: his Min is met, and any Max left allows all of them
  const lineups = [];
  onProgress?.({ done: 0, of: s.count, skipped });
  const addLineup = (ids, proven) => {
    lineups.push(lineupOf(ids.map((id) => byId.get(id)), s.fast ? s.fastRun.lastProven : proven, refMs, s.pinned));
    onProgress?.({ done: lineups.length, of: s.count, lineup: lineups.at(-1) });
  };
  const note = buildLimited({ exposure: s.exposure, count: s.count, limits, search: limitedSearch(lockedMen, pool, mode, s), addLineup, nameOf, stepsNote: (r, found) => (s.fast ? fastStopNote(r) : stepsNote(s, r, found)), carryOn: s.fast });
  return { lineups, skipped, note: s.fast ? finishFast(lineups, s, note) : note, error: null };
}

/** The search from the pool on: locked (and hand-picked and pinned) men, the start checks, then each lineup in turn. */
function runSearch(players, mode, s, lockIds, exSet, refMs, onProgress) {
  const prep = preparePool(players, mode, s, lockIds, exSet);
  if (prep.error) return fail(prep.skipped, prep.error);
  const { lockedMen, pool, skipped, lockSet } = prep; // lockSet holds the locked and the pinned men
  const done = (lineups, note) => ({ lineups, skipped, note, error: null });
  const allPicked = players.length > 0 && players.every((p) => exSet.has(p.dk_id) || lockSet.has(p.dk_id));
  if (!pool.length && lockedMen.length < N && allPicked) return done([], "Every player is excluded.");
  if (!pool.length && !lockedMen.length) {
    const unusable = players.every((p) => typeof p.dk_id !== "string" || !p.dk_id || !Array.isArray(p.roster_positions) || !p.roster_positions.length);
    const allOut = skipped.length > 0 && skipped.every((x) => x.why === OUT_WHY);
    return done([], unusable ? "No player has roster positions or a DraftKings id in this slate file." : allOut ? "Every player left is Out." : "No player has every figure this run needs in this slate file.");
  }
  const problem = startProblem(lockedMen, pool, s);
  if (problem) return done([], problem);
  const limits = countLimits(s.exposure, s.count);
  if (limits.size) return runLimited(limits, players, prep, mode, s, exSet, refMs, onProgress);

  const ctx = buildContext(pool, lockedMen, mode, s);
  if (!s.fast) ctx.bound = buildBound(ctx, s, baseState(ctx));
  const maxShared = N - s.minUnique - lockedMen.length;
  const lineups = [], cuts = [];
  let note = null;
  onProgress?.({ done: 0, of: s.count, skipped });
  for (let r = 0; r < s.count; r++) {
    if (r > 0 && maxShared < 0) {
      note = `With ${lockedMen.length} players ${heldWord(s)}, no lineup can differ by ${s.minUnique} players from lineup 1.`;
      break;
    }
    const shares = cuts.map(() => maxShared);
    const { set, proven } = s.fast ? fastSearch(ctx, s, cuts, shares) : solve(ctx, s, cuts, shares);
    if (set) {
      cuts.push(new Set(set));
      lineups.push(lineupOf([...lockedMen, ...set.map((i) => ctx.sorted[i])], proven, refMs, s.pinned));
      onProgress?.({ done: lineups.length, of: s.count, lineup: lineups.at(-1) });
    }
    if (s.fast && !proven && !set) {
      note = fastStopNote(r);
      break;
    }
    if (!proven && !s.fast) {
      note = stepsNote(s, r, Boolean(set));
      break;
    }
    if (!set) {
      const words = gameLimitWords(s);
      note = r === 0
        ? (words ? `No lineup meets these settings with these game limits: ${words}.` : "No lineup meets these settings.")
        : `No other lineup differs by at least ${s.minUnique} player${s.minUnique === 1 ? "" : "s"} from ${r === 1 ? "lineup 1" : `each of lineups 1–${r}`} under these settings.`;
      break;
    }
  }
  return done(lineups, s.fast ? finishFast(lineups, s, note) : note);
}
