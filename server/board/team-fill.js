// Adam 11-17 (11:40-11:58 AM): the team's bench-spot figures and the step that brings a team to 240, pure; tests/minutes_tiers.test.mjs. Runs in the browser too (console page), so nothing is imported from tools/.
//  Bench spot N: the team's per-game minutes of its Nth man off the bench this season (games before the night, each scaled to 240 with overtime out; a game with fewer than N bench men counts 0 for spot N).
//  Fill: under 240, the gap is spread over the men under MINUTES_CAP (limited men excluded; typed minutes never enter, Adam 1:33 PM 11-17) in proportion to their figures, none above his cap; still short, rounds of +1 to each starter, then +1 to
//  each bench man, the last round pro-rated so the team lands on 240 (this step may pass 36, never GAME_MAX or a man's cap override). Over 240: the plain bench is trimmed in proportion to their figures, toward 0;
//  what it cannot absorb comes off the Bench+ men, then the starters, in proportion to what they hold above their floors (Adam 9:50 AM 11-18). What nobody can take or give is returned, never dropped (G62).
export const MINUTES_CAP = 36; // Adam 11-17: nobody above 36 projected minutes, except a starter whose own starter mean is above it
export const GAME_MAX = 48; // review round 1, finding 5: a regulation game; the +1 rounds never give a man more
const REGULATION = 48, OT_PERIOD = 5, EPS = 1e-9, MAX_ROUNDS = 1000;

/** 1st, 2nd, 3rd, 4th ... */
export const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

/**
 * The team's bench-spot figures from its ledger games ({ overtime, men: [{ min, started }] }, oldest first, all before the night): { figs: [spot 1, spot 2, ...], games (those used), unflagged (games left out:
 * a man who played has no start flag) }, or null with no game.
 * A man off the bench is one who did not start and played (minutes over 0). A game with no whole-number overtime count is read as it is: the ledger already reads a missing count as 0, and
 * personal-view.js teamPlan counts those boxes in the team's notes (review round 1, finding 9: no second count here). Pure.
 */
export function benchSpots(games) {
  const all = (games ?? []).filter((g) => Array.isArray(g?.men));
  if (!all.length) return null;
  // the review of 11-18: a game where a man who played has no start flag cannot say who came off the bench: it is left out and counted (unflagged), never read as bench men
  const played = (m) => Number.isFinite(m.min) && m.min > 0, list = all.filter((g) => g.men.every((m) => !played(m) || typeof m.started === "boolean")), unflagged = all.length - list.length;
  if (!list.length) return { figs: [], games: 0, unflagged };
  const sums = [];
  for (const g of list) {
    const ot = Number.isInteger(g.overtime) && g.overtime >= 0 ? g.overtime : null;
    const f = ot === null ? 1 : REGULATION / (REGULATION + OT_PERIOD * ot);
    const bench = g.men.filter((m) => m.started === false && played(m)).map((m) => m.min * f).sort((a, b) => b - a);
    bench.forEach((v, i) => { sums[i] = (sums[i] ?? 0) + v; });
  }
  return { figs: sums.map((s) => s / list.length), games: list.length, unflagged };
}

/** Hands `amount` out over men [{ id, w, room }] in proportion to w, none past his room. Returns { added: Map id -> minutes, left }. Pure. */
export function shareOut(men, amount) {
  const added = new Map(men.map((m) => [m.id, 0]));
  let active = men.filter((m) => m.room > EPS && m.w > 0), left = amount;
  while (active.length && left > EPS) {
    const wsum = active.reduce((s, m) => s + m.w, 0), full = active.filter((m) => (left * m.w) / wsum >= m.room - added.get(m.id) - EPS);
    if (!full.length) { for (const m of active) added.set(m.id, added.get(m.id) + (left * m.w) / wsum); left = 0; break; }
    for (const m of full) { const take = m.room - added.get(m.id); added.set(m.id, m.room); left -= take; }
    active = active.filter((m) => !full.includes(m));
  }
  return { added, left: Math.max(0, left) };
}

/**
 * Rounds of +1 to each starter, then +1 to each bench man, until `amount` is gone; the last part pro-rated over its group. Each man [{ id, room }] takes no more than his room (GAME_MAX or his cap override less
 * what he holds; no room given: no limit). benchCap (optional): (id, added) -> a bench man's further room under the team's lowest starter (R15), read after each starters' round.
 * Returns { added: Map id -> minutes, rounds (whole or part rounds begun), left (what nobody had room for) }. Pure.
 */
export function plusOneRounds(starters, bench, amount, benchCap = null) {
  const added = new Map([...starters, ...bench].map((x) => [x.id, 0])), isBench = new Set(bench.map((x) => x.id));
  const room = (x) => Math.min((Number.isFinite(x.room) ? x.room : Infinity) - added.get(x.id), benchCap && isBench.has(x.id) ? benchCap(x.id, added) : Infinity);
  let left = amount, rounds = 0;
  while (left > EPS && rounds < MAX_ROUNDS) {
    if (![...starters, ...bench].some((x) => room(x) > EPS)) break;
    rounds++;
    for (const g of [starters, bench]) { // each group's open men read at its turn: the starters' +1 raises the bench's ceiling in the same round (R15)
      const grp = g.filter((x) => room(x) > EPS);
      if (!grp.length || left <= EPS) continue;
      const each = Math.min(1, left / grp.length);
      for (const x of grp) { const v = Math.min(each, room(x)); added.set(x.id, added.get(x.id) + v); left -= v; }
    }
  }
  return { added, rounds, left: Math.max(0, left) };
}

/** The positions next to each (the guard, forward and big families): an Out man's minutes his own position cannot take go to these. */
export const ADJACENT = { PG: ["SG"], SG: ["PG", "SF"], SF: ["SG", "PF"], PF: ["SF", "C"], C: ["PF"] };

/** One man at a time in role order (`men` [{ id, room }]: Bench+, then the 2nd, then the 3rd), each to his cap before the next takes any (PROJECT.md Part 3; the lead's call under Adam's bench minutes by role).
 *  roomOf(x): his room now. Adds into `added`; returns what nobody had room for. */
function inRoleOrder(men, amount, added, roomOf) {
  let left = amount;
  for (const x of men) {
    if (left <= EPS) break;
    const v = Math.min(left, roomOf(x));
    if (v > EPS) { added.set(x.id, (added.get(x.id) ?? 0) + v); left -= v; }
  }
  return Math.max(0, left);
}

/** Adam 10:10 AM 11-18 ("shared split"): all Bench+ men on the team share `amount` in proportion to their typical minutes (figure), each to his room, what a full man cannot take going to the others (shareOut).
 *  A man whose figure is 0 or missing shares with the lowest positive Bench+ figure as his weight (review); none positive: equal shares. roomOf(x): his room now. Adds into `added`; returns what nobody had room for. */
function inProportion(men, amount, added, roomOf) {
  const pos = men.map((m) => m.figure).filter((f) => Number.isFinite(f) && f > 0), low = pos.length ? Math.min(...pos) : 1;
  const s = shareOut(men.map((m) => ({ id: m.id, w: Number.isFinite(m.figure) && m.figure > 0 ? m.figure : low, room: roomOf(m) })), amount);
  for (const [id, v] of s.added) if (v > EPS) added.set(id, (added.get(id) ?? 0) + v);
  return s.left;
}

/**
 * A plain bench man's room under his team's lowest starter (R15; Adam 6:40-6:43 PM 11-17: no bench man ends above the lowest healthy starter on his team; Adam 9:50 AM 11-18: not a Bench+ man, whose cap is 36
 * like everyone's): men [{ id, starter, bplus }], total(id) his minutes now. Returns (man) -> the lowest starter's total less his own (Infinity: a starter, a Bench+ man, or no starter in men). Pure.
 */
export function starterCeiling(men, total) {
  const starters = men.filter((m) => m.starter).map((m) => m.id);
  return (m) => (m.starter || m.bplus === true || !starters.length ? Infinity : Math.min(...starters.map(total)) - total(m.id));
}

/**
 * An Out man's minutes go to his position first (Adam's rulings "PG replaces PG, SG replaces SG" and bench by role; Adam 6:40 PM 11-17: starters before the bench; Adam 9:46 AM 11-18: Bench+ before the plain bench
 * at any position): demand: [{ pos, amount }] (each position's lost minutes); men: [{ id, pos (null: none), starter, bplus (a Bench+ man), figure (before this step; 0 if omitted), room (to his cap: 36, or his cap
 * override, less his figure) }], the bench men tonight in role order (Bench+, the 2nds, the 3rds, ties by a blend of last 10 and season minutes a game) and every starter (a starter with no position takes nothing here but sets the ceiling).
 * Each position's amount goes to its own starters, each to his cap, then the starters of the positions next to it (ADJACENT), then all Bench+ men on the team, whatever their position, sharing in proportion to their
 * typical minutes, each to 36 (Adam 10:10 AM 11-18), then its own plain bench, then the plain bench next to it; starters and the plain bench one man at a time in role order;
 * no plain bench man above the team's lowest starter (starterCeiling, R15); what is left is returned for the team-wide fill.
 * Returns { added: Map id -> minutes, left, by: [{ pos, amount, own, spill, elsewhere (Bench+ men at no position next to it) }] }. Pure.
 */
export function positionFill(men, demand) {
  const added = new Map(), by = [], fig = new Map(men.map((m) => [m.id, m.figure ?? 0]));
  const under = starterCeiling(men, (id) => fig.get(id) + (added.get(id) ?? 0));
  const roomOf = (x) => Math.max(0, Math.min(x.room - (added.get(x.id) ?? 0), under(x)));
  let left = 0;
  for (const d of demand) {
    if (!(d.amount > EPS)) continue;
    // R15 (Adam 6:43 PM 11-17): his position's starters (to the cap), then the starters next to it; Adam 9:46 AM 11-18: then every Bench+ man, then his position's plain bench, then the plain bench next to it;
    // each stage takes only what the one before could not
    const at = (m) => !!m.pos && m.pos === d.pos, near = (m) => !!m.pos && (ADJACENT[d.pos] ?? []).includes(m.pos), plus = (m) => !m.starter && m.bplus === true, plain = (m) => !m.starter && m.bplus !== true;
    // Adam 10:10 AM 11-18: all Bench+ men on the team, whatever their position, share in proportion to their typical minutes (inProportion), one group; starters and the plain bench by position, one man at a time (inRoleOrder)
    const stages = [[(m) => at(m) && m.starter, inRoleOrder], [(m) => near(m) && m.starter, inRoleOrder], [plus, inProportion], [(m) => plain(m) && at(m), inRoleOrder], [(m) => plain(m) && near(m), inRoleOrder]];
    const before = new Map(added);
    let rest = d.amount;
    for (const [s, give] of stages) if (rest > EPS) rest = give(men.filter(s), rest, added, roomOf);
    const gained = (ids) => ids.reduce((s, id) => s + (added.get(id) ?? 0) - (before.get(id) ?? 0), 0);
    by.push({ pos: d.pos, amount: d.amount, own: gained(men.filter(at).map((m) => m.id)), spill: gained(men.filter(near).map((m) => m.id)), elsewhere: gained(men.filter((m) => !at(m) && !near(m)).map((m) => m.id)) });
    left += rest;
  }
  return { added, left, by };
}

/**
 * Step 5 of the team plan (Adam 11-17). men: [{ id, starter (bool), bplus (a Bench+ man), figure, ceiling (his cap tonight), floor (a starter's or a Bench+ man's typical minutes; null otherwise), limited (a cap
 * of his own at or below his figure: no fill), max (his cap override, else GAME_MAX: the +1 rounds never pass it), w (optional: his weight in the proportional share, else his figure; tiers.js passes his figure
 * before the position step, so a man at an unrelated position keeps his share when a teammate goes Out), pos (optional: his chart position) }]; a plain bench man's total stays at or under the team's lowest
 * starter's (R15, Adam 6:43 PM 11-17; not a Bench+ man's, Adam 9:50 AM 11-18); teamMinutes; hold: true when a figure is missing (nothing is handed out then, RULES R1).
 * Returns { sum, gap, prop: Map, plus: Map, cut: Map, how: Map id -> "bench" | "bench_plus" | "starter", rounds, unassigned, untrimmed, trimmed: { bench, bench_plus, starter } | null, over: [{ id, total }] (men the
 * fill took past 36 because 240 could not be reached under it), passed: [{ id, total }] (plain bench men the fill took past the team's lowest starter because 240 could not be reached otherwise) }. Pure.
 */
export function fillTeam(men, teamMinutes, hold = false) {
  const sum = men.reduce((s, x) => s + x.figure, 0), gap = teamMinutes - sum, free = men;
  const res = { sum, gap, prop: new Map(), plus: new Map(), cut: new Map(), how: new Map(), rounds: 0, unassigned: 0, untrimmed: 0, trimmed: null, over: [], passed: [] };
  if (gap > EPS && !hold) {
    const open = free.filter((x) => !x.limited), byId = new Map(free.map((x) => [x.id, x])), none = { added: new Map(), rounds: 0, left: 0 };
    // R15: a bench man ends no higher than the team's lowest starter (starterCeiling); maps: what each man has gained so far
    const ceilAt = (maps) => (id, a) => starterCeiling(free, (j) => byId.get(j).figure + [...maps, a ?? new Map()].reduce((s, mp) => s + (mp.get(j) ?? 0), 0))(byId.get(id));
    const prop = new Map();
    let pLeft = gap;
    for (let i = 0; i < 50 && pLeft > EPS; i++) { // the share in passes: the lowest starter's gain raises the bench's ceiling for the next pass
      const cap = ceilAt([prop]), p = shareOut(open.map((x) => ({ id: x.id, w: x.w ?? x.figure, room: Math.max(0, Math.min(Math.min(x.ceiling, x.max ?? GAME_MAX) - x.figure - (prop.get(x.id) ?? 0), cap(x.id))) })), pLeft);
      for (const [id, v] of p.added) prop.set(id, (prop.get(id) ?? 0) + v);
      const took = pLeft - p.left; pLeft = p.left;
      if (took <= EPS) break;
    }
    res.prop = prop;
    // the lead's call under Adam's "fill each team to 240" and "no one over 36": the +1 rounds stay under each man's cap first (a man of figure 0 has room the proportional share gave him none of);
    // only when 240 cannot be reached under 36 (a short roster) may they pass it, up to GAME_MAX or his cap override, and each man over 36 is named (res.over); a bench man passes his starter only last (res.passed)
    const held = (x, ...extra) => (prop.get(x.id) ?? 0) + extra.reduce((s, mp) => s + (mp.get(x.id) ?? 0), 0);
    const under = (x) => ({ id: x.id, room: Math.max(0, Math.min(x.ceiling, x.max ?? GAME_MAX) - x.figure - held(x)) }), S = open.filter((x) => x.starter), B = open.filter((x) => !x.starter);
    const r = plusOneRounds(S.map(under), B.map(under), pLeft, ceilAt([prop]));
    const past = (...ex) => (x) => ({ id: x.id, room: Math.max(0, (x.max ?? GAME_MAX) - x.figure - held(x, ...ex)) });
    const o = r.left > EPS ? plusOneRounds(S.map(past(r.added)), B.map(past(r.added)), r.left, ceilAt([prop, r.added])) : { ...none, left: r.left };
    const q = o.left > EPS ? plusOneRounds(S.map(past(r.added, o.added)), B.map(past(r.added, o.added)), o.left) : { ...none, left: o.left };
    res.plus = new Map([...r.added].map(([id, v]) => [id, v + (o.added.get(id) ?? 0) + (q.added.get(id) ?? 0)]));
    res.rounds = pLeft > EPS ? r.rounds + o.rounds + q.rounds : 0; res.unassigned = q.left;
    res.over = open.filter((x) => (o.added.get(x.id) ?? 0) + (q.added.get(x.id) ?? 0) > EPS).map((x) => ({ id: x.id, total: x.figure + held(x, res.plus) })).filter((m) => m.total > MINUTES_CAP + EPS);
    const finalCap = ceilAt([prop, res.plus]);
    res.passed = B.filter((x) => (q.added.get(x.id) ?? 0) > EPS && finalCap(x.id) < -EPS).map((x) => ({ id: x.id, total: x.figure + held(x, res.plus) }));
  } else if (gap < -EPS) {
    // Adam 9:50 AM 11-18: the plain bench first (toward 0), then Bench+ men down toward their floors (their typical minutes), then starters above their floors
    const bench = free.filter((x) => !x.starter && x.bplus !== true), plus = free.filter((x) => !x.starter && x.bplus === true), starters = free.filter((x) => x.starter);
    const b = shareOut(bench.map((x) => ({ id: x.id, w: x.figure, room: Math.max(0, x.figure) })), -gap);
    const above = (x) => Math.max(0, x.figure - (x.floor ?? (x.bplus === true ? x.figure : 0))), none = (left) => ({ added: new Map(), left }); // a Bench+ man with no floor given keeps his figure
    const bp = b.left > EPS ? shareOut(plus.map((x) => ({ id: x.id, w: above(x), room: above(x) })), b.left) : none(b.left);
    const s = bp.left > EPS ? shareOut(starters.map((x) => ({ id: x.id, w: above(x), room: above(x) })), bp.left) : none(bp.left);
    for (const [kind, mp] of [["bench", b.added], ["bench_plus", bp.added], ["starter", s.added]]) for (const [id, v] of mp) if (v > EPS) { res.cut.set(id, v); res.how.set(id, kind); }
    res.trimmed = { bench: -gap - b.left, bench_plus: b.left - bp.left, starter: bp.left - s.left };
    res.untrimmed = s.left;
  }
  return res;
}
