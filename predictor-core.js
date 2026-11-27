// The minutes predictor's pure projection (Adam 3:17-3:21 PM 11-18; moved here 11-25 so the Console can run it in the browser for the minutes blend, Adam 9:49 AM 11-25 "let's do it"):
// projectTeam is always GIVEN the five; predictFive is only the fallback when the five is not posted. Minutes are predicted per PLAYER, never by slot: own role base, an Out man's minutes split by
// learned absorption blended with a position prior, a per-man ceiling, then the team fitted to 240. A man new to tonight's role leans to that role's level (roleTargets; Adam 9:33 AM 11-20).
// With the allocation on (predictor-alloc.js, Adam 12:14 PM 11-27), 240 is allocated top down instead: the rotation in context, the deep bench what such men play here.
// No file or environment reads here (the page loads this file): the learner and the box reads stay in server/minutes/minutes-predictor.js, which re-exports these and fills the role-prior
// setting from the environment. profileToJson / profileFromJson carry a learned team profile to the page (server/minutes/predictor-inputs.js). Pure.

import { ALLOC_PRIOR, benchBase, nextUp, allocate, allocWords, fitTo, contextShift } from "./predictor-alloc.js";

export { ALLOC_PRIOR, benchBase, nextUp, allocate, aheadShare, contextShift, fitTo } from "./predictor-alloc.js";
export const TEAM_MIN = 240;
export const MAX_MIN = 48;
const FALLBACK_MIN = 36; // the first cap tried when the men's ceilings cannot hold 240
export const BENCH_SLOTS = 8;

// Role-change prior (Adam 9:33 AM 11-20; roleTargets): set on the replay of 10-29 through 11-18 with learning on (tools/minutes_predictor_replay.mjs
// --role-grid, 11-20, with roleCeiling: average miss 4.436 to 4.353, 10+ misses 269 to 250 on 3,311 men; men starting with under 3 prior starts
// 5.390 to 4.584 (the replay's group counts under 3 while the starter side's trust is 2), usual starters benched 4.865 to 4.597). 11-19 out of
// sample: 4.179 to 3.924 average, 9 to 10 misses of 10+ on 89 men. Pick: within 0.005 of the lowest average and one 10+ miss of the fewest, the
// lowest average on that side's role-change men. Shrink weight SHRINK_K on both sides (the bench side's 2 was one 10+ miss better).
export const ROLE_PRIOR = Object.freeze({ s: Object.freeze({ trust: 2, by: "pair", w: 0.5 }), b: Object.freeze({ trust: 3, by: "gap", w: 0.5 }) });
export const ROLE_PRIOR_DEFAULT_ON = true; // the average miss, the 10+ misses and both role-change subsets went down (replay, 11-20)

// Spot-start prior, the role prior's `spot` part (Adam 4:50 PM 11-25, "the confirmed five is the five": a man who rarely starts, put in the five, plays what such men play; and "fully inform the thing").
// share: a man in the five with fewer than this share of his games here started is a spot starter. His target is his all-games mean moved weight w up to the league's spot-start line (profile.spot.s,
// learned over every team's boxes before the night by minutes-predictor.js spotPattern: a + b x his all-games mean + c x the usual starters not in tonight's five) plus his team's own misses off that
// line over (its spot starts + teamK); his own starts pull his starter base toward it as before (baseMinutes). The raise comes out of the Out starter whose start he took (that man's minutes to split
// are that much less, none of them to him). bench: the weight for a usual starter on the bench, down to the league's benched line the same way. No line learned yet (under SPOT_MIN_GAMES such games
// league-wide): the rules above, said in his why line. Replay of the 23 scored nights 10-29 to 11-24 with the lock five on (tools/minutes_backtest.mjs, 11-25; average miss / 10+ misses): the
// predictor 5.224 / 496 to 5.214 / 489 (first 12 nights 5.197 / 276 to 5.194 / 273, later 11 5.258 / 220 to 5.239 / 216; spot starters 6.79 / 33 to 6.54 / 31), but the three-way blend
// 4.690 / 369 to 4.688 / 371 and its first half 4.649 / 213 to 4.651 / 215, so off by default (NBADFS_MINUTES_ROLE=spot=on, or its values, turns it on). Tried: no share of any Out man's minutes
// (5.211 / 488, three-way 4.693 / 373, spot starters left further under), the share cut to 1/3 (5.213 / 490), the bench side alone (5.212 / 494, three-way 4.686 / 370), w 0.5 to 0.75: none lowered all four.
export const SPOT_PRIOR = Object.freeze({ share: 0.15, w: 1, bench: 1, teamK: 3 });
export const SPOT_PRIOR_DEFAULT_ON = false; // the predictor went down on both halves, the three-way blend's and the board's 10+ misses went up (replay, 11-25)
export const SPOT_SHARE_WORDS = 1 / 3; // a man in the five who started under this share of his games here is named a spot starter in his why line, with the prior on or off (G62)
const DEFAULT_ROLE_PRIOR = ROLE_PRIOR_DEFAULT_ON ? (SPOT_PRIOR_DEFAULT_ON ? Object.freeze({ ...ROLE_PRIOR, spot: SPOT_PRIOR }) : ROLE_PRIOR) : null; // the setting with no environment to read (minutes-predictor.js roleSetting reads NBADFS_MINUTES_ROLE)

// Depth-chart prior (Adam 10:06 AM 11-25, "fully inform the thing"): the team's saved depth chart as of lock (server/minutes/predictor-chart.js) gives the usual healthy order. chart:
// { oor: Set of box-score ids the chart has out of the rotation, backup: Map starter id -> his chart backup id }. k: games' weight of the chart's out-of-rotation call, pulling the man's
// all-games mean (taken over games he played only) toward 0; backup: how much more of an Out starter's position-prior share his chart backup gets (splitOut).
// Set on the replay of the 22 scored nights (tools/minutes_backtest.mjs, 11-25; 14 nights have a chart saved before lock): k 3 with backup 1 lowered the predictor 5.338 to 5.246 (10+ misses 493 to 488)
// and the three-way average 4.728 to 4.711 (367 to 366). Tried and dropped: pulling rotation men toward the chart's usual minutes (k 1 to 10: worse on both, e.g. k 3 5.57 / 541) and an
// entry at his chart minutes for a chart man with no games here (5.38 / 513: it takes minutes from the starters, and some such men never play).
export const CHART_PRIOR = Object.freeze({ k: 3, backup: 1 });
export const CHART_PRIOR_DEFAULT_ON = true; // the predictor's and the three-way blend's average miss and 10+ misses all went down (replay, 11-25)
const DEFAULT_CHART_PRIOR = CHART_PRIOR_DEFAULT_ON ? CHART_PRIOR : null; // minutes-predictor.js chartSetting reads NBADFS_PREDICTOR_CHART

// Availability prior (the lead's brief 11-25 for Adam's "as good as possible as quickly as possible"): a man's base is his mean over the games he PLAYED here, but a bench man often sits (did not play
// or inactive), so every healthy man counted at his full base put each team about 284 minutes before the fit to 240 (replay of the 23 scored nights, 11-25), and the fit took the excess from everyone in
// proportion: the top six by projection came out 1.7 to 2.9 minutes low each while their own bases were within 0.6 of what they played. A bench man (not in tonight's five) with games here now counts
// at base x (games + k) / (games + missed + k), times run when he missed the team's last game (missed: games he was listed did-not-play or inactive after his first game played; minutes-predictor.js
// profileFromGames). A man in the five plays, so his base stands. The learner's own replay of past games (learnTeam) knows who played, so it runs without it.
// Set on the first 12 of the 23 scored nights 10-29 to 11-24 (tools/minutes_backtest.mjs, chart on, lock five on, spot off; 11-25): k 0, 2, 5 and run 0.3 to 1 tried, k 0 run 0.4 picked (predictor
// 5.197 / 276 to 4.645 / 232 there, three-way 4.649 / 213 to 4.508 / 203). All 23 nights (average miss / 10+ misses): predictor 5.224 / 496 to 4.718 / 424, three-way 4.690 / 369 to 4.551 / 367,
// board 4.651 / 379 to 4.578 / 377; actual top six predictor 5.99 (bias -4.83) to 4.99 (-2.59). Later 11 nights: predictor 5.258 / 220 to 4.810 / 192, three-way 4.743 / 156 to 4.606 but 10+ misses
// 156 to 164, so it fails the keep rule's later half and is off by default (NBADFS_PREDICTOR_AVAIL=on, or its values, turns it on). No k or run tried kept the later three-way 10+ misses at 156.
export const AVAIL_PRIOR = Object.freeze({ k: 0, run: 0.4 });
export const AVAIL_PRIOR_DEFAULT_ON = false; // the three-way blend's 10+ misses went up in the later half (replay, 11-25)
const DEFAULT_AVAIL_PRIOR = AVAIL_PRIOR_DEFAULT_ON ? AVAIL_PRIOR : null; // minutes-predictor.js availSetting reads NBADFS_PREDICTOR_AVAIL; the profile carries it (teamProfile) as it does the role prior

// Top-down allocation of 240 (predictor-alloc.js; Adam 12:14 PM 11-27); minutes-predictor.js allocSetting reads NBADFS_PREDICTOR_ALLOC. Graded with the off-board rule on (off-board.js) over the 24
// nights with boxes 10-29 to 11-25 (tools/minutes_backtest.mjs, 11-27, chart on, lock five on, spot off; average miss / 10+ misses), values set on the first 12: predictor 5.207 / 511 to 4.577 / 383,
// three-way blend 4.667 / 380 to 4.515 / 374, board 4.628 / 390 to 4.560 / 389; actual top six predictor 5.95 (bias -4.82) to 4.72 (-2.74), deep bench (actual rank 9 on) 4.75 (+3.00) to 4.40 (+2.10).
// Later 12 nights: predictor 5.218 / 235 to 4.654 / 180, three-way 4.689 / 167 to 4.543 but 10+ misses 167 to 171, so it fails the keep rule's later half; it is on by default by Adam's ruling
// of 12:14 PM 11-27 (NBADFS_PREDICTOR_ALLOC=off turns it off; its values set it). The allocation alone, the off-board rule off: predictor 4.794 / 442, three-way 4.561 / 386 (worse on its 10+ misses).
export const ALLOC_DEFAULT_ON = true; // Adam 12:14 PM 11-27: minutes are allocated top-down, never from a man's own past alone; on by his ruling though the later-half three-way 10+ misses went 167 to 171 (replay, 11-27)
const DEFAULT_ALLOC_PRIOR = ALLOC_DEFAULT_ON ? ALLOC_PRIOR : null;

/** A man's share for the availability prior: 1 for a man in tonight's five, with no games here, or the prior off (cfg null); else (games + k) / (games + missed + k), times cfg.run after a missed last game. Pure. */
export function availShare(profile, id, inFive, cfg) {
  const m = profile.byId.get(id);
  if (!cfg || inFive || !m) return 1;
  const p = (m.games + cfg.k) / (m.games + (m.missed ?? 0) + cfg.k);
  return (m.missRun ?? 0) >= 1 ? p * cfg.run : p;
}

// His why-line words for the availability prior (G62), "" when it moved nothing.
function availWords(profile, id, share) {
  if (!(share < 0.995)) return "";
  const m = profile.byId.get(id);
  return `played ${m.games} of the ${m.games + (m.missed ?? 0)} games he was on the roster for ${where(m)}${(m.missRun ?? 0) >= 1 ? ` and missed the last ${m.missRun}` : ""}, so his base counts x${share.toFixed(2)}`;
}

/** The profile with the chart prior folded in (pure; the profile given is not changed): each man the chart has out of the rotation, with games here, has his all-games mean times games / (games + k). */
export function withChart(profile, chart, cfg) {
  if (!chart || !cfg || !(cfg.k > 0)) return profile;
  const byId = new Map(profile.byId);
  for (const id of chart.oor) {
    const m = byId.get(id);
    if (m) byId.set(id, { ...m, pref: (m.games * m.pref) / (m.games + cfg.k) });
  }
  return { ...profile, byId, order: [...byId.values()].sort((a, b) => b.pref - a.pref || (a.id < b.id ? -1 : 1)) };
}

const prefOf = (profile, id) => (profile.byId.has(id) ? profile.byId.get(id).pref : -1);
const rankByPref = (profile, ids) => [...ids].sort((a, b) => prefOf(profile, b) - prefOf(profile, a) || (a < b ? -1 : 1));

// Fallback only: the usual five among the men on the roster, a learned or best-bench stand-in for each one who is Out.
export function predictFive(profile, { out = new Set(), roster = [] } = {}) {
  const seen = roster.filter((id) => profile.byId.has(id));
  const usual = [...seen].sort((a, b) => {
    const x = profile.byId.get(a), y = profile.byId.get(b);
    return y.starts - x.starts || y.pref - x.pref || (a < b ? -1 : 1);
  }).slice(0, 5);
  const five = usual.filter((id) => !out.has(id));
  const taken = new Set(usual);
  for (const id of usual.filter((u) => out.has(u))) {
    const learned = (profile.replacements.get(id) || []).find((r) => roster.includes(r.id) && !out.has(r.id) && !taken.has(r.id));
    let pick = learned && learned.id;
    if (!pick) pick = rankByPref(profile, roster.filter((r) => !out.has(r) && !taken.has(r)))[0];
    if (pick) { five.push(pick); taken.add(pick); }
  }
  return five;
}

const SHRINK_K = 4; // role mean shrunk toward the all-games mean (Adam 3:21 PM 11-18)
const ABSORB_K = 3; // learned absorption blended with the position prior
const ADJACENT = new Set(["PG-SG", "SG-SF", "SF-PF", "PF-C"]);

export function posOverlap(a, b) {
  if (!a || !b) return 0.5;
  if (a === b) return 1;
  return ADJACENT.has(`${a}-${b}`) || ADJACENT.has(`${b}-${a}`) ? 0.5 : 0.15;
}

// A man's own expected minutes in a role (s = starter, b = bench); 0 with no games for the team. His role mean is shrunk toward his
// all-games mean, or toward target when given (roleTargets: a man new to tonight's role; Adam 9:33 AM 11-20).
export function baseMinutes(profile, id, role, target = null) {
  const m = profile.byId.get(id);
  if (!m) return 0;
  const n = m.roleN[role];
  return (n * m.roleMean[role] + SHRINK_K * (target === null ? m.pref : target)) / (n + SHRINK_K);
}

// A man's cap in the fit to 240: his ceiling, moved by as much as a role-change target moves him off his all-games mean (Adam 9:33 AM 11-20:
// a bench man's top-quarter games no longer hold a new starter at bench level; replay 11-20, 4.394 to 4.353 average miss); 0 with no games here.
export function roleCeiling(profile, id, target = null) {
  const m = profile.byId.get(id);
  if (!m) return 0;
  return target === null ? m.ceiling : Math.max(0, Math.min(MAX_MIN, m.ceiling + target - m.pref));
}

// The team's starter-minus-bench gap: men with games in both roles, each weighted by his fewer role games; 0 with none.
export function roleGap(profile) {
  let s = 0, w = 0;
  for (const m of profile.order) {
    const n = Math.min(m.roleN.s, m.roleN.b);
    if (n > 0) { s += n * (m.roleMean.s - m.roleMean.b); w += n; }
  }
  return w ? s / w : 0;
}

// Each man moving up is paired with a usual starter not in tonight's five (Out, benched or gone): the best position overlap, then the
// higher starter base; up men in order of their all-games mean. Returns Map up id -> usual starter id.
function pairVacated(profile, up, vacated, pos) {
  const left = [...vacated], pairs = new Map();
  for (const id of rankByPref(profile, up)) {
    if (!left.length) break;
    const pick = [...left].sort((a, b) => posOverlap(pos.get(id), pos.get(b)) - posOverlap(pos.get(id), pos.get(a))
      || baseMinutes(profile, b, "s") - baseMinutes(profile, a, "s") || (a < b ? -1 : 1))[0];
    pairs.set(id, pick);
    left.splice(left.indexOf(pick), 1);
  }
  return pairs;
}

/**
 * Role-change targets (Adam 9:33 AM 11-20: a man moved into the five gets starter-level minutes; a usual starter benched, the mirror). A man in
 * tonight's five with fewer than cfg.s.trust starts here, and a usual starter on the bench with fewer than cfg.b.trust bench games, get a target:
 * his all-games mean moved weight w toward a role prior, only in the role's direction (never down for a man moved up, never up for one benched).
 * Priors (by): "curve", the team's starter or bench curve at his rank tonight; "pair", the base of the usual starter he replaces, or for a
 * benched man the bench base of the man who took his start, the curve when unpaired; "gap", his mean plus or minus the team's starter-minus-bench
 * gap for the share of his games in the other role. team: tonight's roster and Out list (only its usual starters are vacated starts).
 * With cfg.spot (the spot-start prior, SPOT_PRIOR) and the profile's league lines learned (profile.spot): a spot starter in the five, whatever his starts, and every usual starter on the bench lean to
 * the league's line instead (spotLines). Map id -> target, with .words (id -> why line words), .spot (the spot starters the line set) and .pairOf (up id -> the usual starter whose start he took). Pure.
 */
export function roleTargets(profile, { five, healthy, team = null, pos = new Map() }, cfg) {
  const targets = new Map();
  targets.words = new Map(); // id -> why his figure leans, for his why line (G62)
  targets.spot = new Set(); // the spot starters set by the league's line (projectTeam: their raise comes out of the Out man whose start they took, spotTook)
  targets.pairOf = new Map(); // up id -> the usual starter whose start he took
  if (!cfg) return targets;
  const known = healthy.filter((id) => profile.byId.has(id));
  const line = spotLines(profile, cfg), isSpot = (id) => Boolean(cfg.spot) && five.has(id) && profile.byId.get(id).startShare < cfg.spot.share;
  const up = known.filter((id) => five.has(id) && (profile.byId.get(id).roleN.s < cfg.s.trust || (isSpot(id) && Boolean(line.s))));
  const down = known.filter((id) => !five.has(id) && profile.usual.has(id) && (profile.byId.get(id).roleN.b < cfg.b.trust || Boolean(line.b)));
  if (!up.length && !down.length) return targets;
  // a vacated start is a usual starter on tonight's team (roster or Out list; healthy when no team is given) outside the five, never a man gone
  const onTeam = team ?? new Set(healthy), vacated = [...profile.usual].filter((u) => !five.has(u) && onTeam.has(u));
  const pairs = pairVacated(profile, up, vacated, pos);
  targets.pairOf = pairs;
  const tookStart = new Map([...pairs].map(([id, u]) => [u, id]));
  const fiveRank = rankByPref(profile, known.filter((id) => five.has(id))), benchRank = rankByPref(profile, known.filter((id) => !five.has(id)));
  const gap = roleGap(profile);
  const prior = (id, role) => {
    const m = profile.byId.get(id), c = role === "s" ? cfg.s : cfg.b;
    const slot = role === "s" ? profile.starterCurve[fiveRank.indexOf(id)] : profile.benchCurve[Math.min(benchRank.indexOf(id), BENCH_SLOTS - 1)];
    const curve = Number.isFinite(slot) ? slot : m.pref; // past the curve's slots (more than five starters given): his own mean
    if (c.by === "gap") return m.pref + (role === "s" ? gap * (1 - m.startShare) : -gap * m.startShare);
    if (c.by === "pair" && role === "s" && pairs.has(id)) return baseMinutes(profile, pairs.get(id), "s");
    if (c.by === "pair" && role === "b" && tookStart.has(id)) return baseMinutes(profile, tookStart.get(id), "b");
    return curve;
  };
  for (const [ids, role] of [[up, "s"], [down, "b"]]) {
    const c = role === "s" ? cfg.s : cfg.b;
    for (const id of ids) {
      const m = profile.byId.get(id), pref = m.pref;
      // a spot starter, or a usual starter benched, leans to the league's line for such men when one is learned (the spot-start prior, Adam 4:50 PM 11-25); else the role prior above
      const spot = role === "s" ? (isSpot(id) && line.s ? line.s(pref, vacated.length) : null) : line.b ? line.b(pref) : null;
      const move = (spot ?? prior(id, role)) - pref, w = spot === null ? c.w : role === "s" ? cfg.spot.w : cfg.spot.bench;
      targets.set(id, pref + w * (role === "s" ? Math.max(0, move) : Math.min(0, move)));
      targets.words.set(id, roleWords(m, role, spot, isSpot(id) && !line.s));
      if (role === "s" && spot !== null) targets.spot.add(id);
    }
  }
  return targets;
}

// The league's spot-start and benched lines from profile.spot (minutes-predictor.js spotPattern) as functions of his all-games mean (and, for a spot start, the usual starters not in the five),
// each plus the team's own misses off it over (its such games + teamK); null when not learned or the prior is off.
function spotLines(profile, cfg) {
  const fit = cfg.spot ? profile.spot : null, k = cfg.spot?.teamK ?? 0;
  const own = (side) => (fit?.here?.[side] ? fit.here[side][1] / (fit.here[side][0] + k) : 0);
  return { s: fit?.s ? (pref, vac) => fit.s.a + fit.s.b * pref + (fit.s.c ?? 0) * vac + own("s") : null, b: fit?.b && cfg.spot.bench > 0 ? (pref) => fit.b.a + fit.b.b * pref + own("b") : null };
}

// Why a role-change man's figure leans (his why line, G62; the spot-start prior, Adam 4:50 PM 11-25). noLine: a spot starter while no league line is learned yet. Keeps "leans to starter / bench level" (the scoreboard counts it).
function roleWords(m, role, line, noLine) {
  const at = line === null ? "" : ` (the league's ${role === "s" ? "spot-start" : "benched"} line, ${line.toFixed(1)})`;
  if (role === "b") return `usual starter on the bench, leans to bench level${at}`;
  if (line !== null) return `${spotStarterWords(m)}, leans to starter level${at}`;
  return `new in the five, leans to starter level${noLine ? " (no league spot-start line learned yet)" : ""}`;
}
const where = (m) => (m.carried ? `for ${m.carried}` : "here"); // a carried man's counts are his other team's (minutes-predictor.js carryTraded; code review 11-27, item 5)
const spotStarterWords = (m) => `spot starter (${m.starts} of ${m.games} games started ${where(m)})`;
/** A man in the five who started under SPOT_SHARE_WORDS of his games here and has no role target, named in his why line (G62; Adam 4:50 PM 11-25): his starter base is his own starts' mean shrunk to his all-games mean. */
function spotNamed(profile, id, five) {
  const m = profile.byId.get(id);
  if (!m || !five.has(id) || !(m.startShare < SPOT_SHARE_WORDS)) return "";
  return `${spotStarterWords(m)}, starter base ${m.roleN.s ? "from his own starts, pulled to his all-games mean" : "his all-games mean"}`;
}

// The minutes each Out man gives up to the spot starters set by the league's line who took his start (the spot-start prior): their raise over their own starter base. Map Out id -> minutes.
function spotTook(profile, targets, out) {
  const took = new Map();
  for (const id of targets.spot) {
    const u = targets.pairOf.get(id);
    if (u && out.has(u)) took.set(u, (took.get(u) ?? 0) + Math.max(0, baseMinutes(profile, id, "s", targets.get(id)) - baseMinutes(profile, id, "s")));
  }
  return took;
}

// One Out man's base minutes split across the healthy men by weight (never to one man). lean: his chart backup's position-prior weight times (1 + lean), 0 for none (the depth-chart prior).
// skip: men who take no share (the spot-start prior's line-set spot starters who took his start); less: minutes taken off his base first (spotTook).
// full: his base before `less` (the allocation's bench base for a man not a usual starter, predictor-alloc.js benchBase); his own role base when not given.
function splitOut(profile, u, healthy, base, pos, backup = null, lean = 0, skip = new Set(), less = 0, full = null) {
  const uBase = Math.max(0, (full ?? baseMinutes(profile, u, profile.usual.has(u) ? "s" : "b")) - less), keep = (j) => (skip.has(j) ? 0 : 1);
  const ov = healthy.map((j) => base.get(j) * posOverlap(pos.get(u), pos.get(j)) * (backup !== null && j === backup ? 1 + lean : 1) * keep(j));
  const ovSum = ov.reduce((s, x) => s + x, 0);
  const ab = profile.absorb.get(u) || { m: 0, gains: new Map() };
  const w = healthy.map((j, i) => {
    const prior = ovSum ? uBase * (ov[i] / ovSum) : 0;
    return (ab.m * (ab.gains.get(j) || 0) * keep(j) + ABSORB_K * prior) / (ab.m + ABSORB_K);
  });
  const wSum = w.reduce((s, x) => s + x, 0);
  return healthy.map((j, i) => (wSum ? uBase * (w[i] / wSum) : 0));
}

// Fit to 240 (the allocation off): scale the free men proportionally; a man who would pass his cap stays at it and the rest take the remainder (predictor-alloc.js fitTo, one copy).
const fitTeam = (items, capOf) => fitTo(items, capOf, TEAM_MIN);

// The fit: the top-down allocation when its setting is on (predictor-alloc.js allocate, Adam 12:14 PM 11-27), else the plain fit to 240 with no deep bench.
const fitWith = (items, profile, cfg, five, capOf, ctx) => (cfg ? allocate(items, profile, cfg, five, capOf, cfg.rise ? ctx : null) : { fit: fitTeam(items, capOf), deep: new Set(), size: items.length, pot: 0, rose: new Map() });

// Per-player minutes for tonight: the given five are starters, everyone else healthy is bench; Out men's minutes are split.
// adjust: Map id -> minutes the learner adds to a man's base (minutes-misses.js); the profile's own when not given.
// rolePrior: the role-change setting (roleTargets, roleCeiling), or null for none; the profile's own, else the default setting, when not given.
// chart: the depth-chart prior's chart (withChart), or null; chartPrior: its setting, or null for off (DEFAULT_CHART_PRIOR when not given).
// availPrior: the availability prior's setting (availShare), or null for off; the profile's own, else the default setting, when not given.
// allocPrior: the top-down allocation's setting (predictor-alloc.js, Adam 12:14 PM 11-27), or null for the plain fit; the profile's own, else the default setting, when not given. On, it supersedes
// the availability prior (a bench man's figure already counts the games the coach sat him).
export function projectTeam(profile0, { starters = [], out = new Set(), roster = [], pos = new Map(), adjust = profile0.adjust ?? null, rolePrior = profile0.rolePrior === undefined ? DEFAULT_ROLE_PRIOR : profile0.rolePrior, chart = null, chartPrior = DEFAULT_CHART_PRIOR,
  availPrior = profile0.availPrior === undefined ? DEFAULT_AVAIL_PRIOR : profile0.availPrior, allocPrior = profile0.allocPrior === undefined ? DEFAULT_ALLOC_PRIOR : profile0.allocPrior } = {}) {
  const useChart = Boolean(chart && chartPrior), profile = useChart ? withChart(profile0, chart, chartPrior) : profile0, alloc = allocPrior ?? null;
  const five = new Set(starters);
  const healthy = roster.filter((id) => !out.has(id));
  const oorIds = new Set(useChart && chartPrior.k > 0 ? healthy.filter((id) => chart.oor.has(id) && profile.byId.has(id)) : []); // the men the chart prior moved: in their why lines and the notes (ids); the blend names them in the team's notes (minutes-blend-words.js)
  const adj = (id) => (adjust && profile.byId.has(id) ? adjust.get(id) ?? 0 : 0);
  const targets = roleTargets(profile, { five, healthy, team: new Set([...roster, ...out]), pos }, rolePrior);
  const share = new Map(healthy.map((id) => [id, alloc ? 1 : availShare(profile, id, five.has(id), availPrior)])); // the availability prior: a bench man's chance to play tonight
  // a bench man's own figure: his bench base, or with the allocation on his minutes when available here (the games the coach sat him count 0; benchBase)
  const own = (id, inFive, t = null) => (alloc && !inFive ? benchBase(profile, id, t, alloc) : baseMinutes(profile, id, inFive ? "s" : "b", t));
  // with the allocation on, his figure moves to his minutes with tonight's team playing (contextShift: the men on the team tonight, Out men included, whose absences his mean holds)
  const teamTonight = roster, ctxOf = (id) => (alloc ? contextShift(profile, id, teamTonight, { pos, overlap: posOverlap }, alloc) : 0);
  const base = new Map(healthy.map((id) => [id, Math.max(0, own(id, five.has(id), targets.get(id) ?? null) + adj(id) + ctxOf(id)) * share.get(id)]));
  const { extra, nextOf } = outShares(profile, { healthy, out, roster, base, pos, targets, five, useChart, chart, chartPrior, alloc, own });
  const posMissing = pos.size ? [...healthy, ...roster.filter((id) => out.has(id) && profile.byId.has(id))].filter((id) => !pos.has(id)) : [];
  const items = healthy.map((id) => ({ id, min: base.get(id) + extra.get(id), own: base.get(id), cap: roleCeiling(profile, id, targets.get(id) ?? null) }));
  // the allocation's usual rotation counts the Out men at their own figures (a usual starter's starter base, anyone else's bench base), so a deep man rises only into an Out man's place at his position
  // a carried man (traded or signed, minutes-predictor.js carryTraded) Out is no absence his new teammates' games hold: never in the usual rotation here (code review 11-27, item 1)
  const ctx = { outs: roster.filter((id) => out.has(id) && profile.byId.has(id) && !profile.byId.get(id).carried).map((id) => ({ id, own: own(id, profile.usual.has(id)) })), pos, overlap: posOverlap };
  const holds = (f) => [...f.values()].reduce((s, x) => s + x, 0) >= TEAM_MIN - 1e-6;
  let a = fitWith(items, profile, alloc, five, (x) => x.cap, ctx), short = null;
  // ceilings cannot hold 240: each man's cap rises to 36 (his own ceiling when higher) first, and only if that cannot hold 240 either to 48 (review 11-18: IND's 11-02 man projected 48)
  if (!holds(a.fit)) { short = FALLBACK_MIN; a = fitWith(items, profile, alloc, five, (x) => Math.max(x.cap, FALLBACK_MIN), ctx); }
  if (!holds(a.fit)) { short = MAX_MIN; a = fitWith(items, profile, alloc, five, () => MAX_MIN, ctx); }
  const fit = a.fit;
  const rows = roster.map((id) => ({
    bbr_id: id,
    min: out.has(id) ? 0 : Math.round((fit.get(id) || 0) * 1000) / 1000,
    slot: out.has(id) ? "out" : five.has(id) ? "starter" : "bench",
    why: whyOf(profile, id, out, base, extra, short, adj(id), [targets.words.get(id) ?? spotNamed(profile, id, five),
      oorIds.has(id) ? "out of the rotation on the depth chart, leans lower" : "", share.has(id) ? availWords(profile, id, share.get(id)) : "", allocManWords(profile, id, a, nextOf, alloc, five)].filter(Boolean).join(", ")),
  }));
  const diff = Math.round((TEAM_MIN - rows.reduce((s, r) => s + r.min, 0)) * 1000) / 1000;
  const top = rows.filter((r) => r.min > 0).sort((a, b) => b.min - a.min).find((r) => r.min + diff <= MAX_MIN);
  if (top && diff) top.min = Math.round((top.min + diff) * 1000) / 1000;
  rows.notes = { posMissing, ceilingsShort: short !== null, capUsed: short, roleTargeted: targets.size, chartOor: oorIds.size, chartOorIds: [...oorIds], availLowered: [...share.values()].filter((s) => s < 0.995).length,
    ...(alloc ? { rotation: a.size, deepBench: a.deep.size, deepPot: Math.round(a.pot * 10) / 10 } : {}) };
  return rows;
}

// The Out men's minutes split across the healthy men (splitOut): { extra: Map id -> minutes, nextOf: Map id -> [Out ids he is next up for] }. The lean goes to the depth chart's backup when the chart
// prior names one, else with the allocation on to the man next up at the Out man's position by the learned pecking order (predictor-alloc.js nextUp).
function outShares(profile, { healthy, out, roster, base, pos, targets, five, useChart, chart, chartPrior, alloc, own }) {
  const extra = new Map(healthy.map((id) => [id, 0])), nextOf = new Map();
  const outKnown = roster.filter((id) => out.has(id) && profile.byId.has(id) && !profile.byId.get(id).carried); // a carried man's old-team minutes are none of this team's to split (code review 11-27, item 1)
  const took = spotTook(profile, targets, out); // the spot-start prior: a line-set spot starter's raise comes out of the Out starter whose start he took, and he takes no share of that man's minutes
  for (const u of outKnown) {
    const skip = new Set([...targets.spot].filter((j) => targets.pairOf.get(j) === u));
    const chartUp = useChart ? chart.backup?.get(u) ?? null : null, peckUp = alloc && chartUp === null ? nextUp(profile, u, healthy, { pos, five, overlap: posOverlap }) : null;
    if (peckUp !== null) nextOf.set(peckUp, [...(nextOf.get(peckUp) ?? []), u]);
    const lean = chartUp !== null ? chartPrior.backup ?? 0 : peckUp !== null ? alloc.lean : 0;
    const full = alloc && !profile.usual.has(u) ? own(u, false) : null;
    const share = splitOut(profile, u, healthy, base, pos, chartUp ?? peckUp, lean, skip, took.get(u) ?? 0, full);
    healthy.forEach((j, i) => extra.set(j, extra.get(j) + share[i]));
  }
  return { extra, nextOf };
}

// The allocation's words for his why line (G62): deep bench and its pot, next up at an Out man's position, a bench man's games sat counted; "" with the allocation off.
function allocManWords(profile, id, a, nextOf, alloc, five) {
  if (!alloc || !profile.byId.has(id)) return "";
  const m = profile.byId.get(id), n = nextOf.get(id)?.length ?? 0;
  return [!five.has(id) && (m.benched ?? 0) > 0 ? `sat ${m.benched} of ${m.games + m.benched} games he was available for ${m.carried ? `with ${m.carried}${m.satHere ? ` and here (${m.satHere} here)` : ""}` : "here"}, counted as 0` : "",
    n ? `next up at his position for ${n} man${n === 1 ? "" : "s"} out, by who played ahead of whom here` : "", allocWords(id, a)].filter(Boolean).join(", ");
}

function whyOf(profile, id, out, base, extra, short, adj = 0, role = "") {
  if (out.has(id)) return "out tonight";
  const m = profile.byId.get(id);
  if (!m) return "no games for this team: base 0";
  const gain = extra.get(id);
  const learned = Math.abs(adj) >= 0.05 ? `, ${adj > 0 ? "+" : ""}${adj.toFixed(1)} learned from misses` : "";
  const games = m.carried ? `${m.games} games for ${m.carried}, none here yet` : `${m.games} games here`; // carried: a man traded or signed, his games for his other team (minutes-predictor.js carryTraded)
  return `base ${base.get(id).toFixed(1)} min (${games}${role ? `, ${role}` : ""}${learned})${gain > 0.05 ? `, +${gain.toFixed(1)} from teammates out` : ""}${short ? `, ${short} cap used` : ""}`;
}

/**
 * One team's predictor minutes: projectTeam (the five given, Adam 3:20 PM 11-18) with the men's ids from predictorIds (tools/minutes_backtest_core.mjs). profile: the team's profile of its games before the night;
 * men: [{ key, id }]; five: keys of the five; out: Set of keys not playing (board men Out and the Out list's men off the board); pos: Map id -> position. project: projectTeam (minutes-predictor.js passes its
 * environment-aware one). Returns { byKey: Map key -> { minutes, why }, notes: { posMissing, ceilingsShort, capUsed, chartOor (how many men the depth-chart prior moved), chartMoved (their keys) } }. Pure.
 */
export function predictTeamMinutes(profile, { men, five, out, pos = new Map(), project = projectTeam, chart = null, chartPrior }) {
  const idOf = new Map(men.map((m) => [m.key, m.id])), outIds = new Set([...out].map((k) => idOf.get(k)).filter(Boolean));
  const starters = [...five].filter((k) => !out.has(k)).map((k) => idOf.get(k)).filter(Boolean);
  // chart, chartPrior: the depth-chart prior (projectTeam); chartPrior left out takes the project's own default
  const rows = project(profile, { starters, out: outIds, roster: men.map((m) => m.id), pos, chart, ...(chartPrior !== undefined ? { chartPrior } : {}) });
  const byId = new Map(rows.map((r) => [r.bbr_id, r]));
  return { byKey: new Map(men.map((m) => [m.key, { minutes: byId.get(m.id).min, why: byId.get(m.id).why }])),
    notes: { posMissing: rows.notes.posMissing.length, ceilingsShort: rows.notes.ceilingsShort, capUsed: rows.notes.capUsed ?? null, chartOor: rows.notes.chartOor ?? 0,
      chartMoved: men.filter((m) => (rows.notes.chartOorIds ?? []).includes(m.id)).map((m) => m.key) } };
}

/** A depth-chart prior's chart (withChart) as plain JSON for the page, and back. Pure. */
export const chartToJson = (c) => (c ? { oor: [...c.oor], backup: [...c.backup] } : null);
export const chartFromJson = (j) => (j ? { oor: new Set(j.oor), backup: new Map(j.backup) } : null);

/** A team profile (minutes-predictor.js teamProfile) as plain JSON for the page: its Maps and Set as lists; the learner's summary is left out (the server keeps it). Pure. */
export function profileToJson(p) {
  return { games: p.games, starterCurve: p.starterCurve, benchCurve: p.benchCurve, depth: p.depth, order: p.order, usual: [...p.usual],
    replacements: [...p.replacements], absorb: [...p.absorb].map(([u, a]) => [u, a.m, [...a.gains]]), adjust: p.adjust ? [...p.adjust] : null, ...(p.rolePrior !== undefined ? { rolePrior: p.rolePrior } : {}),
    ...(p.availPrior !== undefined ? { availPrior: p.availPrior } : {}), ...(p.spot ? { spot: p.spot } : {}), // the league's spot-start lines (roleTargets), plain numbers
    // the allocation's inputs (predictor-alloc.js): its setting, the team curve and the pecking table
    ...(p.allocPrior !== undefined ? { allocPrior: p.allocPrior } : {}), ...(p.curve ? { curve: p.curve } : {}), ...(p.peck ? { peck: [...p.peck].map(([a, row]) => [a, [...row]]) } : {}),
    ...(p.with ? { with: [...p.with].map(([a, row]) => [a, [...row]]) } : {}) };
}

/** The profile back from profileToJson's form, as projectTeam reads it. Pure. */
export function profileFromJson(j) {
  return { games: j.games, starterCurve: j.starterCurve, benchCurve: j.benchCurve, depth: j.depth, order: j.order, byId: new Map(j.order.map((m) => [m.id, m])), usual: new Set(j.usual),
    replacements: new Map(j.replacements), absorb: new Map(j.absorb.map(([u, m, g]) => [u, { m, gains: new Map(g) }])), adjust: j.adjust ? new Map(j.adjust) : null, ...(j.rolePrior !== undefined ? { rolePrior: j.rolePrior } : {}),
    ...(j.availPrior !== undefined ? { availPrior: j.availPrior } : {}), ...(j.spot ? { spot: j.spot } : {}),
    ...(j.allocPrior !== undefined ? { allocPrior: j.allocPrior } : {}), ...(j.curve ? { curve: j.curve } : {}), ...(j.peck ? { peck: new Map(j.peck.map(([a, row]) => [a, new Map(row)])) } : {}),
    ...(j.with ? { with: new Map(j.with.map(([a, row]) => [a, new Map(row)])) } : {}) };
}
