// The minutes predictor's pure projection (Adam 3:17-3:21 PM 11-18; moved here 11-25 so the Console can run it in the browser for the minutes blend, Adam 9:49 AM 11-25 "let's do it"):
// projectTeam is always GIVEN the five; predictFive is only the fallback when the five is not posted. Minutes are predicted per PLAYER, never by slot: own role base, an Out man's minutes split by
// learned absorption blended with a position prior, a per-man ceiling, then the team fitted to 240. A man new to tonight's role leans to that role's level (roleTargets; Adam 9:33 AM 11-20).
// No file or environment reads here (the page loads this file): the learner and the box reads stay in server/minutes/minutes-predictor.js, which re-exports these and fills the role-prior
// setting from the environment. profileToJson / profileFromJson carry a learned team profile to the page (server/minutes/predictor-inputs.js). Pure.

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
const DEFAULT_ROLE_PRIOR = ROLE_PRIOR_DEFAULT_ON ? ROLE_PRIOR : null; // the setting with no environment to read (minutes-predictor.js roleSetting reads NBADFS_MINUTES_ROLE)

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
 * Map id -> target. Pure.
 */
export function roleTargets(profile, { five, healthy, team = null, pos = new Map() }, cfg) {
  const targets = new Map();
  if (!cfg) return targets;
  const known = healthy.filter((id) => profile.byId.has(id));
  const up = known.filter((id) => five.has(id) && profile.byId.get(id).roleN.s < cfg.s.trust);
  const down = known.filter((id) => !five.has(id) && profile.usual.has(id) && profile.byId.get(id).roleN.b < cfg.b.trust);
  if (!up.length && !down.length) return targets;
  // a vacated start is a usual starter on tonight's team (roster or Out list; healthy when no team is given) outside the five, never a man gone
  const onTeam = team ?? new Set(healthy);
  const pairs = pairVacated(profile, up, [...profile.usual].filter((u) => !five.has(u) && onTeam.has(u)), pos);
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
      const pref = profile.byId.get(id).pref, move = prior(id, role) - pref;
      targets.set(id, pref + c.w * (role === "s" ? Math.max(0, move) : Math.min(0, move)));
    }
  }
  return targets;
}

// One Out man's base minutes split across the healthy men by weight (never to one man).
function splitOut(profile, u, healthy, base, pos) {
  const uBase = baseMinutes(profile, u, profile.usual.has(u) ? "s" : "b");
  const ov = healthy.map((j) => base.get(j) * posOverlap(pos.get(u), pos.get(j)));
  const ovSum = ov.reduce((s, x) => s + x, 0);
  const ab = profile.absorb.get(u) || { m: 0, gains: new Map() };
  const w = healthy.map((j, i) => {
    const prior = ovSum ? uBase * (ov[i] / ovSum) : 0;
    return (ab.m * (ab.gains.get(j) || 0) + ABSORB_K * prior) / (ab.m + ABSORB_K);
  });
  const wSum = w.reduce((s, x) => s + x, 0);
  return healthy.map((j, i) => (wSum ? uBase * (w[i] / wSum) : 0));
}

// Fit to 240: scale the free men proportionally; a man who would pass his cap stays at it and the rest take the remainder.
function fitTeam(items, capOf) {
  const fixed = new Map();
  let free = items.filter((x) => x.min > 0);
  for (let guard = 0; guard < 20 && free.length; guard++) {
    const left = TEAM_MIN - [...fixed.values()].reduce((s, x) => s + x, 0);
    const tot = free.reduce((s, x) => s + x.min, 0);
    const over = free.filter((x) => (x.min / tot) * left > capOf(x));
    if (!over.length) { for (const x of free) fixed.set(x.id, (x.min / tot) * left); break; }
    for (const x of over) fixed.set(x.id, capOf(x));
    free = free.filter((x) => !over.includes(x));
  }
  return fixed;
}

// Per-player minutes for tonight: the given five are starters, everyone else healthy is bench; Out men's minutes are split.
// adjust: Map id -> minutes the learner adds to a man's base (minutes-misses.js); the profile's own when not given.
// rolePrior: the role-change setting (roleTargets, roleCeiling), or null for none; the profile's own, else the default setting, when not given.
export function projectTeam(profile, { starters = [], out = new Set(), roster = [], pos = new Map(), adjust = profile.adjust ?? null, rolePrior = profile.rolePrior === undefined ? DEFAULT_ROLE_PRIOR : profile.rolePrior } = {}) {
  const five = new Set(starters);
  const healthy = roster.filter((id) => !out.has(id));
  const adj = (id) => (adjust && profile.byId.has(id) ? adjust.get(id) ?? 0 : 0);
  const targets = roleTargets(profile, { five, healthy, team: new Set([...roster, ...out]), pos }, rolePrior);
  const base = new Map(healthy.map((id) => [id, Math.max(0, baseMinutes(profile, id, five.has(id) ? "s" : "b", targets.get(id) ?? null) + adj(id))]));
  const extra = new Map(healthy.map((id) => [id, 0]));
  const outKnown = roster.filter((id) => out.has(id) && profile.byId.has(id));
  for (const u of outKnown) {
    const share = splitOut(profile, u, healthy, base, pos);
    healthy.forEach((j, i) => extra.set(j, extra.get(j) + share[i]));
  }
  const posMissing = pos.size ? [...healthy, ...outKnown].filter((id) => !pos.has(id)) : [];
  const items = healthy.map((id) => ({ id, min: base.get(id) + extra.get(id), cap: roleCeiling(profile, id, targets.get(id) ?? null) }));
  const holds = (f) => [...f.values()].reduce((s, x) => s + x, 0) >= TEAM_MIN - 1e-6;
  let fit = fitTeam(items, (x) => x.cap), short = null;
  // ceilings cannot hold 240: each man's cap rises to 36 (his own ceiling when higher) first, and only if that cannot hold 240 either to 48 (review 11-18: IND's 11-02 man projected 48)
  if (!holds(fit)) { short = FALLBACK_MIN; fit = fitTeam(items, (x) => Math.max(x.cap, FALLBACK_MIN)); }
  if (!holds(fit)) { short = MAX_MIN; fit = fitTeam(items, () => MAX_MIN); }
  const rows = roster.map((id) => ({
    bbr_id: id,
    min: out.has(id) ? 0 : Math.round((fit.get(id) || 0) * 1000) / 1000,
    slot: out.has(id) ? "out" : five.has(id) ? "starter" : "bench",
    why: whyOf(profile, id, out, base, extra, short, adj(id), targets.has(id) ? (five.has(id) ? "new in the five, leans to starter level" : "usual starter on the bench, leans to bench level") : ""),
  }));
  const diff = Math.round((TEAM_MIN - rows.reduce((s, r) => s + r.min, 0)) * 1000) / 1000;
  const top = rows.filter((r) => r.min > 0).sort((a, b) => b.min - a.min).find((r) => r.min + diff <= MAX_MIN);
  if (top && diff) top.min = Math.round((top.min + diff) * 1000) / 1000;
  rows.notes = { posMissing, ceilingsShort: short !== null, capUsed: short, roleTargeted: targets.size };
  return rows;
}

function whyOf(profile, id, out, base, extra, short, adj = 0, role = "") {
  if (out.has(id)) return "out tonight";
  const m = profile.byId.get(id);
  if (!m) return "no games for this team: base 0";
  const gain = extra.get(id);
  const learned = Math.abs(adj) >= 0.05 ? `, ${adj > 0 ? "+" : ""}${adj.toFixed(1)} learned from misses` : "";
  return `base ${base.get(id).toFixed(1)} min (${m.games} games here${role ? `, ${role}` : ""}${learned})${gain > 0.05 ? `, +${gain.toFixed(1)} from teammates out` : ""}${short ? `, ${short} cap used` : ""}`;
}

/**
 * One team's predictor minutes: projectTeam (the five given, Adam 3:20 PM 11-18) with the men's ids from predictorIds (tools/minutes_backtest_core.mjs). profile: the team's profile of its games before the night;
 * men: [{ key, id }]; five: keys of the five; out: Set of keys not playing (board men Out and the Out list's men off the board); pos: Map id -> position. project: projectTeam (minutes-predictor.js passes its
 * environment-aware one). Returns { byKey: Map key -> { minutes, why }, notes: { posMissing, ceilingsShort, capUsed } }. Pure.
 */
export function predictTeamMinutes(profile, { men, five, out, pos = new Map(), project = projectTeam }) {
  const idOf = new Map(men.map((m) => [m.key, m.id])), outIds = new Set([...out].map((k) => idOf.get(k)).filter(Boolean));
  const starters = [...five].filter((k) => !out.has(k)).map((k) => idOf.get(k)).filter(Boolean);
  const rows = project(profile, { starters, out: outIds, roster: men.map((m) => m.id), pos });
  const byId = new Map(rows.map((r) => [r.bbr_id, r]));
  return { byKey: new Map(men.map((m) => [m.key, { minutes: byId.get(m.id).min, why: byId.get(m.id).why }])), notes: { posMissing: rows.notes.posMissing.length, ceilingsShort: rows.notes.ceilingsShort, capUsed: rows.notes.capUsed ?? null } };
}

/** A team profile (minutes-predictor.js teamProfile) as plain JSON for the page: its Maps and Set as lists; the learner's summary is left out (the server keeps it). Pure. */
export function profileToJson(p) {
  return { games: p.games, starterCurve: p.starterCurve, benchCurve: p.benchCurve, depth: p.depth, order: p.order, usual: [...p.usual],
    replacements: [...p.replacements], absorb: [...p.absorb].map(([u, a]) => [u, a.m, [...a.gains]]), adjust: p.adjust ? [...p.adjust] : null, ...(p.rolePrior !== undefined ? { rolePrior: p.rolePrior } : {}) };
}

/** The profile back from profileToJson's form, as projectTeam reads it. Pure. */
export function profileFromJson(j) {
  return { games: j.games, starterCurve: j.starterCurve, benchCurve: j.benchCurve, depth: j.depth, order: j.order, byId: new Map(j.order.map((m) => [m.id, m])), usual: new Set(j.usual),
    replacements: new Map(j.replacements), absorb: new Map(j.absorb.map(([u, m, g]) => [u, { m, gains: new Map(g) }])), adjust: j.adjust ? new Map(j.adjust) : null, ...(j.rolePrior !== undefined ? { rolePrior: j.rolePrior } : {}) };
}
