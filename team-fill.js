// Adam 11-17 (11:40-11:58 AM): the team's bench-spot figures and the step that brings a team to 240, pure; tests/minutes_tiers.test.mjs. Runs in the browser too (console page), so nothing is imported from tools/.
//  Bench spot N: the team's per-game minutes of its Nth man off the bench this season (games before the night, each scaled to 240 with overtime out; a game with fewer than N bench men counts 0 for spot N).
//  Fill: under 240, the gap is spread over the men under MINUTES_CAP (limited men excluded; typed minutes never enter, Adam 1:33 PM 11-17) in proportion to their figures, none above his cap; still short, rounds of +1 to each starter, then +1 to
//  each bench man, the last round pro-rated so the team lands on 240 (this step may pass 36, never GAME_MAX or a man's cap override). Over 240: the bench is trimmed in proportion to their figures, toward 0;
//  what it cannot absorb comes off the starters in proportion to what they hold above their floors. What nobody can take or give is returned, never dropped (G62).
export const MINUTES_CAP = 36; // Adam 11-17: nobody above 36 projected minutes, except a starter whose own starter mean is above it
export const GAME_MAX = 48; // review round 1, finding 5: a regulation game; the +1 rounds never give a man more
const REGULATION = 48, OT_PERIOD = 5, EPS = 1e-9, MAX_ROUNDS = 1000;

/** 1st, 2nd, 3rd, 4th ... */
export const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

/**
 * The team's bench-spot figures from its ledger games ({ overtime, men: [{ min, started }] }, oldest first, all before the night): { figs: [spot 1, spot 2, ...], games }, or null with no game.
 * A man off the bench is one who did not start and played (minutes over 0). A game with no whole-number overtime count is read as it is: the ledger already reads a missing count as 0, and
 * personal-view.js teamPlan counts those boxes in the team's notes (review round 1, finding 9: no second count here). Pure.
 */
export function benchSpots(games) {
  const list = (games ?? []).filter((g) => Array.isArray(g?.men));
  if (!list.length) return null;
  const sums = [];
  for (const g of list) {
    const ot = Number.isInteger(g.overtime) && g.overtime >= 0 ? g.overtime : null;
    const f = ot === null ? 1 : REGULATION / (REGULATION + OT_PERIOD * ot);
    const bench = g.men.filter((m) => !m.started && Number.isFinite(m.min) && m.min > 0).map((m) => m.min * f).sort((a, b) => b - a);
    bench.forEach((v, i) => { sums[i] = (sums[i] ?? 0) + v; });
  }
  return { figs: sums.map((s) => s / list.length), games: list.length };
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
 * what he holds; no room given: no limit). Returns { added: Map id -> minutes, rounds (whole or part rounds begun), left (what nobody had room for) }. Pure.
 */
export function plusOneRounds(starters, bench, amount) {
  const added = new Map([...starters, ...bench].map((x) => [x.id, 0])), room = (x) => (Number.isFinite(x.room) ? x.room : Infinity) - added.get(x.id);
  let left = amount, rounds = 0;
  while (left > EPS && rounds < MAX_ROUNDS) {
    const open = [starters, bench].map((g) => g.filter((x) => room(x) > EPS));
    if (!open[0].length && !open[1].length) break;
    rounds++;
    for (const grp of open) {
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
 *  Adds into `added`; returns what nobody had room for. */
function inRoleOrder(men, amount, added) {
  let left = amount;
  for (const x of men) {
    if (left <= EPS) break;
    const v = Math.min(left, Math.max(0, x.room - (added.get(x.id) ?? 0)));
    if (v > EPS) { added.set(x.id, (added.get(x.id) ?? 0) + v); left -= v; }
  }
  return Math.max(0, left);
}

/**
 * An Out man's minutes go to his position first (Adam's rulings "PG replaces PG, SG replaces SG" and bench by role; the lead's fix of 11-17): demand: [{ pos, amount }] (each position's lost minutes);
 * men: [{ id, pos, starter, room (to his cap: 36, or his cap override, less his figure) }], the bench men tonight in role order (Bench+, the 2nds, the 3rds, ties by last-10 minutes) and the starters. Each position's
 * amount goes to its own bench men one at a time in that order, each to his cap, then its starters; what they cannot take goes the same way to the bench men, then the starters, of the positions next to it (ADJACENT); what
 * is left is returned for the team-wide fill.
 * Returns { added: Map id -> minutes, left, by: [{ pos, amount, own, spill }] }. Pure.
 */
export function positionFill(men, demand) {
  const added = new Map(), by = [];
  let left = 0;
  for (const d of demand) {
    if (!(d.amount > EPS)) continue;
    // his position's bench, then its starters (to the cap), then the bench and then the starters of the positions next to it; each stage takes only what the one before could not
    const at = (m) => m.pos === d.pos, near = (m) => (ADJACENT[d.pos] ?? []).includes(m.pos), stages = [(m) => at(m) && !m.starter, (m) => at(m) && m.starter, (m) => near(m) && !m.starter, (m) => near(m) && m.starter];
    const before = new Map(added);
    let rest = d.amount;
    for (const s of stages) if (rest > EPS) rest = inRoleOrder(men.filter(s), rest, added);
    const gained = (ids) => ids.reduce((s, id) => s + (added.get(id) ?? 0) - (before.get(id) ?? 0), 0);
    by.push({ pos: d.pos, amount: d.amount, own: gained(men.filter((m) => m.pos === d.pos).map((m) => m.id)), spill: gained(men.filter((m) => (ADJACENT[d.pos] ?? []).includes(m.pos)).map((m) => m.id)) });
    left += rest;
  }
  return { added, left, by };
}

/**
 * Step 5 of the team plan (Adam 11-17). men: [{ id, starter (bool), figure, ceiling (his cap tonight), floor (a starter's; null otherwise), limited (a cap of his own at or below his figure: no fill),
 * max (his cap override, else GAME_MAX: the +1 rounds never pass it), w (optional: his weight in the proportional share, else his figure; tiers.js passes his figure before the position step, so a man
 * at an unrelated position keeps his share when a teammate goes Out) }]; teamMinutes; hold: true when a figure is missing (nothing is handed out then, RULES R1).
 * Returns { sum, gap, prop: Map, plus: Map, cut: Map, how: Map id -> "bench" | "starter", rounds, unassigned, untrimmed, trimmed: { bench, starter } | null, over: [{ id, total }] (men the fill took past 36
 * because 240 could not be reached under it) }. Pure.
 */
export function fillTeam(men, teamMinutes, hold = false) {
  const sum = men.reduce((s, x) => s + x.figure, 0), gap = teamMinutes - sum, free = men;
  const res = { sum, gap, prop: new Map(), plus: new Map(), cut: new Map(), how: new Map(), rounds: 0, unassigned: 0, untrimmed: 0, trimmed: null, over: [] };
  if (gap > EPS && !hold) {
    const open = free.filter((x) => !x.limited);
    const p = shareOut(open.map((x) => ({ id: x.id, w: x.w ?? x.figure, room: Math.max(0, Math.min(x.ceiling, x.max ?? GAME_MAX) - x.figure) })), gap);
    res.prop = p.added;
    // the lead's call under Adam's "fill each team to 240" and "no one over 36": the +1 rounds stay under each man's cap first (a man of figure 0 has room the proportional share gave him none of);
    // only when 240 cannot be reached under 36 (a short roster) may they pass it, up to GAME_MAX or his cap override, and each man over 36 is named (res.over)
    const held = (x, extra) => (p.added.get(x.id) ?? 0) + (extra?.get(x.id) ?? 0);
    const under = (x) => ({ id: x.id, room: Math.max(0, Math.min(x.ceiling, x.max ?? GAME_MAX) - x.figure - held(x)) });
    const r = plusOneRounds(open.filter((x) => x.starter).map(under), open.filter((x) => !x.starter).map(under), p.left);
    const past = (x) => ({ id: x.id, room: Math.max(0, (x.max ?? GAME_MAX) - x.figure - held(x, r.added)) });
    const o = r.left > EPS ? plusOneRounds(open.filter((x) => x.starter).map(past), open.filter((x) => !x.starter).map(past), r.left) : { added: new Map(), rounds: 0, left: r.left };
    res.plus = new Map([...r.added].map(([id, v]) => [id, v + (o.added.get(id) ?? 0)]));
    res.rounds = p.left > EPS ? r.rounds + o.rounds : 0; res.unassigned = o.left;
    res.over = open.filter((x) => (o.added.get(x.id) ?? 0) > EPS).map((x) => ({ id: x.id, total: x.figure + held(x, res.plus) })).filter((m) => m.total > MINUTES_CAP + EPS);
  } else if (gap < -EPS) {
    const bench = free.filter((x) => !x.starter), starters = free.filter((x) => x.starter);
    const b = shareOut(bench.map((x) => ({ id: x.id, w: x.figure, room: Math.max(0, x.figure) })), -gap);
    const above = (x) => Math.max(0, x.figure - (x.floor ?? 0));
    const s = b.left > EPS ? shareOut(starters.map((x) => ({ id: x.id, w: above(x), room: above(x) })), b.left) : { added: new Map(), left: b.left };
    for (const [id, v] of b.added) if (v > EPS) { res.cut.set(id, v); res.how.set(id, "bench"); }
    for (const [id, v] of s.added) if (v > EPS) { res.cut.set(id, v); res.how.set(id, "starter"); }
    res.trimmed = { bench: -gap - b.left, starter: b.left - s.left };
    res.untrimmed = s.left;
  }
  return res;
}
