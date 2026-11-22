// Adam 11-17 (11:40-11:58 AM): the team's bench-spot figures and the step that brings a team to 240, pure; tests/minutes_tiers_*.test.mjs. Runs in the browser too (console page), so nothing is imported from tools/.
//  Bench spot N: the team's per-game minutes of its Nth man off the bench this season (games before the night, each scaled to 240 with overtime out; a game with fewer than N bench men counts 0 for spot N).
//  Fill (Adam 3:02 PM 11-18): under 240, the gap goes to the Bench+ men first (in proportion to their figures), then the plain bench (same, none above the team's lowest starter, R15), then the starters (same), each only up to his
//  own ceiling (ownCeiling, Adam 3:03 PM 11-18: the mean of his top quarter of games this season, at most 36; typed minutes never enter, Adam 1:33 PM 11-17); still short, rounds of +1 to each starter, then +1 to each bench man, first
//  to his ceiling, then to 36, then to GAME_MAX or his cap override (the last resort, the men named), the last round pro-rated so the team lands on 240. Over 240: the plain bench is trimmed in proportion to their figures, toward 0;
//  what it cannot absorb comes off the Bench+ men, then the starters, in proportion to what they hold above their floors (Adam 9:50 AM 11-18); still over: all of them in proportion to their figures, to the total exactly. What nobody can take or give is returned, never dropped (G62).
export const MINUTES_CAP = 36; // Adam 11-17: nobody above 36 projected minutes, except a starter whose own starter mean is above it
export const GAME_MAX = 48; // review round 1, finding 5: a regulation game; the +1 rounds never give a man more
const REGULATION = 48, OT_PERIOD = 5, EPS = 1e-9, MAX_ROUNDS = 1000, MIN_PLAYED = 4;

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

const playedDesc = (mins) => (mins ?? []).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => b - a), avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;

/** Adam 3:03 PM 11-18: a man's own ceiling for the fill: min(cap, mean of the top quarter (ceil(n/4)) of his minutes in the n games he played this season); fewer than 4 games: the cap (36). mins: his minutes, games played only.
 *  Returns { value, top, of } (top/of: the games it rests on; top 0 when it falls back to the cap). Pure. */
export function ownCeiling(mins, cap = MINUTES_CAP) {
  const p = playedDesc(mins);
  if (p.length < MIN_PLAYED) return { value: cap, top: 0, of: p.length };
  const top = Math.ceil(p.length / 4);
  return { value: Math.min(cap, avg(p.slice(0, top))), top, of: p.length };
}

/** Adam 3:11 PM 11-18: a starter's and a Bench+ man's figure: (mean of his top half (ceil(n/2)) of games + his season mean) / 2 over every game he played this season (starts and bench games together); fewer than 4 games: null
 *  (his usual figure stands). Returns { value, topHalf, season, n, top } or null. Pure. */
export function seasonBlend(mins) {
  const p = playedDesc(mins);
  if (p.length < MIN_PLAYED) return null;
  const top = Math.ceil(p.length / 2), topHalf = avg(p.slice(0, top)), season = avg(p);
  return { value: (topHalf + season) / 2, topHalf, season, n: p.length, top };
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

/**
 * A plain bench man's room under his team's lowest starter (R15; Adam 6:40-6:43 PM 11-17: no bench man ends above the lowest healthy starter on his team; Adam 9:50 AM 11-18: not a Bench+ man, whose cap is 36
 * like everyone's): men [{ id, starter, bplus }], total(id) his minutes now. Returns (man) -> the lowest starter's total less his own (Infinity: a starter, a Bench+ man, or no starter in men). Pure.
 */
export function starterCeiling(men, total) {
  const starters = men.filter((m) => m.starter).map((m) => m.id);
  return (m) => (m.starter || m.bplus === true || !starters.length ? Infinity : Math.min(...starters.map(total)) - total(m.id));
}

/**
 * Step 5 of the team plan (Adam 11-17; order of the gap Adam 3:02 PM 11-18). men: [{ id, starter (bool), bplus (a Bench+ man), figure, ceiling (his own ceiling for the fill, ownCeiling), hard (his cap tonight: 36, a starter's own
 * higher mean, or his cap override; default his ceiling), floor (a starter's or a Bench+ man's typical minutes; null otherwise), limited (a cap of his own at or below his figure: no fill), max (his cap override, else GAME_MAX: the +1
 * rounds never give more) }]; a plain bench man's total stays at or under the team's lowest starter's (R15, Adam 6:43 PM 11-17; not a Bench+ man's); teamMinutes; hold: true when a figure is missing (nothing is handed out then, RULES R1).
 * Returns { sum, gap, prop: Map, plus: Map, cut: Map, how: Map id -> "bench" | "bench_plus" | "starter", rounds, unassigned, untrimmed, trimmed: { bench, bench_plus, starter } | null, over: [{ id, total }] (men the fill took past
 * their cap, 36 as a rule, because 240 could not be reached under it), pastCeiling: [{ id, total }] (men past their own ceiling, not past the cap), passed: [{ id, total }] (plain bench men past the team's lowest starter) }. Pure.
 */
export function fillTeam(men, teamMinutes, hold = false) {
  const sum = men.reduce((s, x) => s + x.figure, 0), gap = teamMinutes - sum, free = men;
  const res = { sum, gap, prop: new Map(), plus: new Map(), cut: new Map(), how: new Map(), rounds: 0, unassigned: 0, untrimmed: 0, trimmed: null, over: [], pastCeiling: [], passed: [] };
  if (gap > EPS && !hold) {
    const open = free.filter((x) => !x.limited), byId = new Map(free.map((x) => [x.id, x]));
    // R15: a bench man ends no higher than the team's lowest starter (starterCeiling); maps: what each man has gained so far
    const ceilAt = (maps) => (id, a) => starterCeiling(free, (j) => byId.get(j).figure + [...maps, a ?? new Map()].reduce((s, mp) => s + (mp.get(j) ?? 0), 0))(byId.get(id));
    const prop = new Map(), cap = (x) => Math.min(x.ceiling, x.max ?? GAME_MAX);
    let pLeft = gap;
    // Adam 3:02 PM 11-18: Bench+ men, then the plain bench, then the starters, each group in proportion to its figures and only to each man's own ceiling
    for (const grp of [open.filter((x) => !x.starter && x.bplus === true), open.filter((x) => !x.starter && x.bplus !== true), open.filter((x) => x.starter)]) {
      for (let i = 0; i < 50 && pLeft > EPS && grp.length; i++) { // passes: the lowest starter's gain raises the bench's ceiling for the next pass
        const at = ceilAt([prop]), p = shareOut(grp.map((x) => ({ id: x.id, w: x.figure, room: Math.max(0, Math.min(cap(x) - x.figure - (prop.get(x.id) ?? 0), at(x.id))) })), pLeft);
        for (const [id, v] of p.added) prop.set(id, (prop.get(id) ?? 0) + v);
        const took = pLeft - p.left; pLeft = p.left;
        if (took <= EPS) break;
      }
    }
    res.prop = prop;
    // the lead's call under Adam's "fill each team to 240" and "no one over 36": the +1 rounds go to each man's ceiling, then to his cap (36), and only when 240 cannot be reached under those may they pass it, up to GAME_MAX or his
    // cap override; the men past their ceiling or cap are named (res.pastCeiling, res.over); a bench man passes his starter only last (res.passed)
    const held = (x, ...extra) => (prop.get(x.id) ?? 0) + extra.reduce((s, mp) => s + (mp.get(x.id) ?? 0), 0), S = open.filter((x) => x.starter), B = open.filter((x) => !x.starter);
    const levels = [[cap, true], [(x) => Math.min(Math.max(x.hard ?? x.ceiling, x.ceiling), x.max ?? GAME_MAX), true], [(x) => x.max ?? GAME_MAX, true], [(x) => x.max ?? GAME_MAX, false]];
    const adds = [];
    let left = pLeft;
    levels.forEach(([lim, r15]) => {
      if (left <= EPS) return;
      const room = (x) => ({ id: x.id, room: Math.max(0, lim(x) - x.figure - held(x, ...adds)) }), r = plusOneRounds(S.map(room), B.map(room), left, r15 ? ceilAt([prop, ...adds]) : null);
      adds.push(r.added); left = r.left; res.rounds += r.rounds;
    });
    res.unassigned = left;
    res.plus = new Map(open.map((x) => [x.id, adds.reduce((s, mp) => s + (mp.get(x.id) ?? 0), 0)]).filter(([, v]) => v > 0));
    const late = (x) => adds.slice(1).reduce((s, mp) => s + (mp.get(x.id) ?? 0), 0), total = (x) => x.figure + held(x, res.plus), hardOf = (x) => Math.max(x.hard ?? x.ceiling, x.ceiling);
    res.over = open.filter((x) => late(x) > EPS && total(x) > hardOf(x) + EPS).map((x) => ({ id: x.id, total: total(x) }));
    res.pastCeiling = open.filter((x) => late(x) > EPS && total(x) > x.ceiling + EPS && total(x) <= hardOf(x) + EPS).map((x) => ({ id: x.id, total: total(x) }));
    const finalCap = ceilAt([prop, res.plus]);
    res.passed = B.filter((x) => (adds[3]?.get(x.id) ?? 0) > EPS && finalCap(x.id) < -EPS).map((x) => ({ id: x.id, total: total(x) }));
  } else if (gap < -EPS) {
    // Adam 9:50 AM 11-18: the plain bench first (toward 0), then Bench+ men down toward their floors (their typical minutes), then starters above their floors
    const bench = free.filter((x) => !x.starter && x.bplus !== true), plus = free.filter((x) => !x.starter && x.bplus === true), starters = free.filter((x) => x.starter);
    const b = shareOut(bench.map((x) => ({ id: x.id, w: x.figure, room: Math.max(0, x.figure) })), -gap);
    const above = (x) => Math.max(0, x.figure - (x.floor ?? (x.bplus === true ? x.figure : 0))), none = (left) => ({ added: new Map(), left }); // a Bench+ man with no floor given keeps his figure
    const bp = b.left > EPS ? shareOut(plus.map((x) => ({ id: x.id, w: above(x), room: above(x) })), b.left) : none(b.left);
    const s = bp.left > EPS ? shareOut(starters.map((x) => ({ id: x.id, w: above(x), room: above(x) })), bp.left) : none(bp.left);
    // review of 11-18 (lead): still over with the plain bench at 0 and every starter and Bench+ man at his floor: all of them give in proportion to their figures down to the total exactly (named), the team never stays over
    const kept = (x) => Math.max(0, x.figure - (bp.added.get(x.id) ?? 0) - (s.added.get(x.id) ?? 0)), forced = s.left > EPS ? shareOut([...plus, ...starters].map((x) => ({ id: x.id, w: kept(x), room: kept(x) })), s.left) : none(s.left);
    for (const [kind, mp] of [["bench", b.added], ["bench_plus", bp.added], ["starter", s.added], ["forced", forced.added]]) for (const [id, v] of mp) if (v > EPS) { res.cut.set(id, (res.cut.get(id) ?? 0) + v); res.how.set(id, res.how.get(id) && kind === "forced" ? "forced" : kind); }
    res.trimmed = { bench: -gap - b.left, bench_plus: b.left - bp.left, starter: bp.left - s.left, forced: s.left - forced.left };
    res.untrimmed = forced.left;
  }
  return res;
}
