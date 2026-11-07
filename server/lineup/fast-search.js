// The GPP build's fast search (Adam, 11-04: "for GPP specifically emphasize speed over perfection"): a seeded local search over the
// men worth considering, starting from a legal lineup and swapping men, with a fixed amount of work per lineup. Pure: no clock and
// no file; the same seed gives the same lineups. optimize.js hands its answer to the exact search as a starting best for a short
// run, so an easy build still comes back proven best. Every lineup answers to every hard rule; checkFastLineup recounts it from
// scratch before it leaves here. Cash never comes here.
import { SLOTS } from "../board/slots.js";
import { EPS } from "./bound.js";

const N = SLOTS.length;
const FULL = (1 << N) - 1;
const WORK_PER_LINEUP = 400_000; // candidate pairs looked at per lineup: the budget that keeps a build to milliseconds a lineup
const MAX_STARTS = 12;
const KICKS_PER_START = 12;
const CORE_BETTER = 10; // a man with this many men at least as good on every count is left out of the local search
const SAME = 1e-9;

/** A small seeded random source, so a build is repeatable. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Each man's projection varied by a uniform plus or minus pct percent; a new list, the men themselves are never touched. */
export function jitter(vals, pct, random) {
  return vals.map((v) => v * (1 + (pct / 100) * (2 * random() - 1)));
}

/** The men the search looks at, best first: those with fewer than `keep` men at least as good, as cheap, at least as flexible and as useful to every rule. */
function coreOf(ctx, s, vals, keep) {
  const { n, sal, own, mask, team, game, low } = ctx;
  const out = [];
  for (let i = 0; i < n; i++) {
    const sameTeam = ctx.hardMin[team[i]] > 0 || ctx.softMin[team[i]] > 1;
    const sameGame = ctx.gameMin[game[i]] > 0;
    let better = 0;
    for (let j = 0; j < n && better < keep; j++) {
      if (j === i || vals[j] < vals[i] || sal[j] > sal[i] || (mask[i] & mask[j]) !== mask[i]) continue;
      if (sameTeam && team[j] !== team[i]) continue;
      if (sameGame && game[j] !== game[i]) continue;
      if (s.maxTotalOwn != null && own[j] > own[i]) continue;
      if (low.some((l) => l[i] && !l[j])) continue;
      better++;
    }
    if (better < keep) out.push(i);
  }
  return out.sort((a, b) => vals[b] - vals[a] || a - b);
}

/**
 * The best lineup this search finds: pool indexes, or null when it finds none legal. start: optimize.js's state with only the held men
 * placed. cuts and maxShared are the min-unique limits, as for the exact search. vals: what each man scores in this search. firstFit
 * returns the first legal lineup found.
 */
export function fastLineup({ ctx, s, start, cuts, maxShared, vals, rng, firstFit = false, budget = WORK_PER_LINEUP }) {
  const { n, sal, own, mask, team, game, low } = ctx;
  const k = N - ctx.lockedMen.length, R = ctx.rules.length;
  if (k <= 0) return null;
  const C = coreOf(ctx, s, vals, CORE_BETTER + Math.floor(cuts.length / 4));
  const m = C.length;
  const cutOf = Array.from({ length: n }, () => []);
  cuts.forEach((c, ci) => c.forEach((i) => cutOf[i].push(ci)));
  const T = Int32Array.from(start.teamCount), G = Int32Array.from(start.gameCount), L = Int32Array.from(start.lowCount), shared = new Int32Array(cuts.length);
  const inCur = new Uint8Array(n), cur = [], seen = new Uint8Array(FULL + 1);
  let S = start.baseSal, O = start.baseOwn, V = 0, D = start.distinctGames, excess = 0, work = 0;
  const teamLimits = ctx.teams.map((_, t) => t).filter((t) => ctx.teamMax[t] < N || ctx.hardMin[t] > 0 || ctx.softMin[t] > 1);
  const teamNeeds = teamLimits.filter((t) => ctx.hardMin[t] > 0 || ctx.softMin[t] > 1);
  const gameLimits = ctx.gameMax.map((_, g) => g).filter((g) => ctx.gameMax[g] < N || ctx.gameMin[g] > 0);

  const add = (i) => {
    cur.push(i); inCur[i] = 1; T[team[i]]++;
    if (G[game[i]]++ === 0) D++;
    for (let r = 0; r < R; r++) if (low[r][i]) L[r]++;
    S += sal[i]; O += own[i]; V += vals[i];
    const list = cutOf[i];
    for (let x = 0; x < list.length; x++) if (++shared[list[x]] > maxShared[list[x]]) excess++;
  };
  const del = (i) => {
    cur.splice(cur.indexOf(i), 1); inCur[i] = 0; T[team[i]]--;
    if (--G[game[i]] === 0) D--;
    for (let r = 0; r < R; r++) if (low[r][i]) L[r]--;
    S -= sal[i]; O -= own[i]; V -= vals[i];
    const list = cutOf[i];
    for (let x = 0; x < list.length; x++) if (shared[list[x]]-- > maxShared[list[x]]) excess--;
  };
  /** How far the lineup on hand is from legal; 0 when it breaks no rule. Seating is kept legal by every move, so it is not counted. */
  const broken = () => {
    let v = excess;
    if (S > s.cap) v += 1 + (S - s.cap) / 1000;
    if (s.minSalary != null && S < s.minSalary) v += 1 + (s.minSalary - S) / 1000;
    if (s.maxTotalOwn != null && O > s.maxTotalOwn + EPS) v += 1 + (O - s.maxTotalOwn) / 10;
    for (let x = 0; x < teamLimits.length; x++) {
      const t = teamLimits[x], c = T[t], need = Math.max(ctx.hardMin[t], c > 0 ? ctx.softMin[t] : 0);
      if (c > ctx.teamMax[t]) v += c - ctx.teamMax[t];
      if (c < need) v += need - c;
    }
    for (let x = 0; x < gameLimits.length; x++) {
      const g = gameLimits[x], c = G[g];
      if (c > ctx.gameMax[g]) v += c - ctx.gameMax[g];
      if (c < ctx.gameMin[g]) v += ctx.gameMin[g] - c;
    }
    if (D < s.minGames) v += s.minGames - D;
    for (let r = 0; r < R; r++) if (L[r] < ctx.rules[r].count) v += ctx.rules[r].count - L[r];
    return v;
  };
  /** The filled-slot sets the men on hand can take. */
  const reachNow = () => {
    let from = start.reach;
    for (let x = 0; x < cur.length; x++) {
      const bits = mask[cur[x]], next = [];
      for (let y = 0; y < from.length; y++) {
        let open = bits & ~from[y];
        while (open) {
          const bit = open & -open;
          open ^= bit;
          const to = from[y] | bit;
          if (!seen[to]) { seen[to] = 1; next.push(to); }
        }
      }
      for (let y = 0; y < next.length; y++) seen[next[y]] = 0;
      from = next;
    }
    return from;
  };
  const openSlots = (reach) => {
    let f = 0;
    for (let x = 0; x < reach.length; x++) f |= FULL & ~reach[x];
    return f;
  };
  /** True when men a (and b, unless -1) can join the lineup on hand, which breaks no rule of its own, and leave it legal and full. */
  const fits = (a, b) => {
    const two = b >= 0;
    const money = S + sal[a] + (two ? sal[b] : 0);
    if (money > s.cap || (s.minSalary != null && money < s.minSalary)) return false;
    if (s.maxTotalOwn != null && O + own[a] + (two ? own[b] : 0) > s.maxTotalOwn + EPS) return false;
    const ta = team[a], ga = game[a], tb = two ? team[b] : -1, gb = two ? game[b] : -1;
    if (T[ta] + 1 + (tb === ta ? 1 : 0) > ctx.teamMax[ta] || (two && T[tb] + 1 + (tb === ta ? 1 : 0) > ctx.teamMax[tb])) return false;
    if (G[ga] + 1 + (gb === ga ? 1 : 0) > ctx.gameMax[ga] || (two && G[gb] + 1 + (gb === ga ? 1 : 0) > ctx.gameMax[gb])) return false;
    if (D + (G[ga] === 0 ? 1 : 0) + (two && gb !== ga && G[gb] === 0 ? 1 : 0) < s.minGames) return false;
    for (let r = 0; r < R; r++) if (L[r] + (low[r][a] ? 1 : 0) + (two && low[r][b] ? 1 : 0) < ctx.rules[r].count) return false;
    for (let x = 0; x < teamNeeds.length; x++) {
      const t = teamNeeds[x], c = T[t] + (ta === t ? 1 : 0) + (tb === t ? 1 : 0);
      if (c < ctx.hardMin[t] || (c > 0 && c < ctx.softMin[t])) return false;
    }
    for (let x = 0; x < gameLimits.length; x++) {
      const g = gameLimits[x];
      if (G[g] + (ga === g ? 1 : 0) + (gb === g ? 1 : 0) < ctx.gameMin[g]) return false;
    }
    const la = cutOf[a];
    for (let x = 0; x < la.length; x++) if (shared[la[x]] + 1 + (two && cuts[la[x]].has(b) ? 1 : 0) > maxShared[la[x]]) return false;
    if (two) {
      const lb = cutOf[b];
      for (let x = 0; x < lb.length; x++) if (shared[lb[x]] + 1 + (cuts[lb[x]].has(a) ? 1 : 0) > maxShared[lb[x]]) return false;
    }
    return true;
  };
  /** Fills the open places with men taken at random, the better men more often; false at a dead end. */
  const fill = () => {
    while (cur.length < k) {
      const open = openSlots(reachNow());
      let placed = false;
      for (let tries = 0; tries < 40 && !placed; tries++) {
        const r = rng();
        const a = C[Math.floor(r * r * m)];
        if (!inCur[a] && mask[a] & open) { add(a); placed = true; }
      }
      if (!placed) {
        const a = C.find((i) => !inCur[i] && mask[i] & open);
        if (a == null) return false;
        add(a);
      }
    }
    return true;
  };
  /** One man at a time, the swap that leaves the fewest rules broken, then the best score; true once none is. */
  const repair = () => {
    let v = broken();
    for (let round = 0; v > 0 && round < k * 4; round++) {
      let bestV = v, bestScore = -Infinity, outMan = -1, inMan = -1;
      for (const x of [...cur]) {
        del(x);
        const open = openSlots(reachNow());
        for (let y = 0; y < m; y++) {
          const a = C[y];
          if (inCur[a] || a === x || !(mask[a] & open)) continue;
          work++;
          add(a);
          const b = broken();
          if (b < bestV - SAME || (b <= bestV + SAME && b < v && V > bestScore)) { bestV = b; bestScore = V; outMan = x; inMan = a; }
          del(a);
        }
        add(x);
      }
      if (inMan < 0) return false;
      del(outMan); add(inMan);
      v = broken();
    }
    return v === 0;
  };
  /** Swaps one man, then two, for whatever scores more, until nothing does. The lineup on hand is legal and stays so. */
  const descend = () => {
    for (let moved = true; moved && work < budget;) {
      moved = false;
      for (const x of [...cur]) {
        del(x);
        const open = openSlots(reachNow());
        let got = -1;
        for (let y = 0; y < m && vals[C[y]] > vals[x] + SAME; y++) {
          const a = C[y];
          work++;
          if (!inCur[a] && mask[a] & open && fits(a, -1)) { got = a; break; }
        }
        add(got >= 0 ? got : x);
        if (got >= 0) moved = true;
      }
      if (moved || k < 2) continue;
      const men = [...cur]; // taking a pair out and back moves them in cur, so the pass walks this list
      for (let p = 0; p < k && !moved && work < budget; p++) {
        for (let q = p + 1; q < k && !moved; q++) {
          const x = men[p], y = men[q], target = vals[x] + vals[y];
          del(y); del(x);
          const free = reachNow().map((r) => FULL & ~r);
          let best = target + SAME, pa = -1, pb = -1;
          for (let i = 0; i + 1 < m; i++) {
            const a = C[i];
            if (vals[a] + vals[C[i + 1]] <= best) break;
            if (inCur[a]) continue;
            for (let j = i + 1; j < m; j++) {
              const b = C[j];
              if (vals[a] + vals[b] <= best) break;
              work++;
              if (S + sal[a] + sal[b] > s.cap || inCur[b]) continue;
              const both = mask[a] | mask[b];
              let seats = false;
              for (let f = 0; f < free.length && !seats; f++) seats = (both & free[f]) === free[f] && (mask[a] & free[f]) !== 0 && (mask[b] & free[f]) !== 0;
              if (seats && fits(a, b)) { best = vals[a] + vals[b]; pa = a; pb = b; break; }
            }
          }
          if (pa >= 0) { add(pa); add(pb); moved = true; } else { add(x); add(y); }
        }
      }
    }
  };
  const load = (men) => {
    for (const i of [...cur]) del(i);
    for (const i of men) add(i);
  };
  /** Takes `count` men out at random and fills the places again. */
  const kick = (count) => {
    for (let x = 0; x < count && cur.length; x++) del(cur[Math.floor(rng() * cur.length)]);
    return fill();
  };

  let best = null, bestV = -Infinity;
  const keep = () => { if (V > bestV + SAME) { bestV = V; best = [...cur]; } };
  // Later lineups start from the latest and the first lineups, which sit near the best left; then from random lineups.
  const hints = [cuts.at(-1), cuts[0]].filter(Boolean).map((c) => [...c]);
  for (let st = 0; st < MAX_STARTS && work < budget; st++) {
    load([]);
    const hint = hints[st];
    if (hint) {
      for (const i of hint) {
        if (cur.length < k && mask[i] & openSlots(reachNow())) add(i);
      }
      const drop = Math.min(cur.length, N - Math.min(...maxShared, N - 1));
      if (!kick(Math.min(drop, 3))) continue;
    } else if (!fill()) continue;
    if (!repair()) continue;
    keep();
    if (firstFit) return [...cur].sort((a, b) => a - b);
    descend();
    keep();
    for (let kicks = 0; kicks < KICKS_PER_START && work < budget; kicks++) {
      const was = [...cur], before = V;
      if (kick(2 + Math.floor(rng() * 3)) && repair()) {
        descend();
        keep();
        if (V > before + SAME) continue;
      }
      load(was);
    }
  }
  return best && best.sort((a, b) => a - b);
}

/** Recounts a lineup from scratch against every hard rule; the reason it breaks one, or null. set: pool indexes. */
export function checkFastLineup(ctx, s, start, set, cuts, maxShared) {
  const men = [...set];
  if (new Set(men).size !== men.length || men.length + ctx.lockedMen.length !== N) return "the wrong number of men";
  let reach = start.reach;
  for (const i of men) {
    const next = new Set();
    for (const r of reach) for (let b = 1; b <= FULL; b <<= 1) if (ctx.mask[i] & b && !(r & b)) next.add(r | b);
    reach = [...next];
  }
  if (!reach.length) return "no seating";
  const salary = men.reduce((t, i) => t + ctx.sal[i], start.baseSal);
  if (salary > s.cap) return "over the cap";
  if (s.minSalary != null && salary < s.minSalary) return "under the min salary";
  if (s.maxTotalOwn != null && men.reduce((t, i) => t + ctx.own[i], start.baseOwn) > s.maxTotalOwn + EPS) return "over the ownership limit";
  const teams = Int32Array.from(start.teamCount), games = Int32Array.from(start.gameCount);
  for (const i of men) { teams[ctx.team[i]]++; games[ctx.game[i]]++; }
  for (let t = 0; t < teams.length; t++) {
    if (teams[t] > ctx.teamMax[t] || teams[t] < ctx.hardMin[t] || (teams[t] > 0 && teams[t] < ctx.softMin[t])) return `team ${ctx.teams[t]}`;
  }
  for (let g = 0; g < games.length; g++) if (games[g] > ctx.gameMax[g] || games[g] < ctx.gameMin[g]) return "a game limit";
  if (games.filter((c) => c > 0).length < s.minGames) return "too few games";
  for (let r = 0; r < ctx.rules.length; r++) {
    if (men.filter((i) => ctx.low[r][i]).length + start.lowCount[r] < ctx.rules[r].count) return `low-owned rule ${r + 1}`;
  }
  for (let c = 0; c < cuts.length; c++) if (men.filter((i) => cuts[c].has(i)).length > maxShared[c]) return "min unique";
  return null;
}
