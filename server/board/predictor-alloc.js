// The minutes predictor's top-down allocation of 240 (Adam 12:14 PM 11-27: "there are minutes to allocate, how are we going to allocate those minutes? In allocating them, you can use their past
// minutes played compared to the other guys at similar positions and in whatever context is appropriate, but you shouldn't assign deep bench guys minutes based SOLELY on their previous minutes,
// that's forgetting the team context"; Adam 3:00 PM 11-25: learn the coach's pecking order by position, "obvious by previous game logs").
// Before it, every healthy man got his own mean over the games he PLAYED here and the team was scaled to 240: teams came to about 284 before the fit, so the top six lost about 4.8 minutes to the
// deep bench. The allocation, as projectTeam runs it (predictor-core.js) when the setting is on:
//  1. A bench man's own figure counts the games the coach sat him (listed did-not-play) as 0 (benchBase): his minutes when available, never only when he played. The five keep their starter base
//     (the confirmed five is the five, Adam 4:50 PM 11-25). Every man's figure then moves toward his minutes with tonight's team playing (contextShift, the teammates whose absences his mean holds).
//     This supersedes the availability prior (predictor-core.js AVAIL_PRIOR): with the allocation on it is not applied.
//  2. An Out man's minutes go to his teammates as before (splitOut: learned absorption blended with the position prior), with a lean to the man next up at his position by the pecking order learned
//     from the boxes (nextUp: who played ahead of whom in games both were available), unless the depth chart names his backup.
//  3. The rotation is the five and the bench men with the highest figures, as many as the team's usual rotation (profile.depth, men with 10+ minutes a game, plus cfg.rot). The deep bench (the rest)
//     shares what such men play here (profile.curve's slots past the rotation, times cfg.pot: garbage time and foul trouble), never more than their own figures; the rotation is fitted to what is
//     left of 240, each man held to his cap (his ceiling, then 36, then 48 as before). A deep man rises into the rotation only when his figure does: when men ahead of him are Out and their minutes
//     reach him.
// Each man's why line says which part set his minutes (G62). Pure, no file or environment reads (the page loads this file); tests/minutes_alloc.test.mjs.

const TEAM = 240;

// Set on the first 12 of the 24 scored nights 10-29 to 11-12 (tools/minutes_backtest.mjs with the off-board rule on, 11-27; average miss / 10+ misses, predictor and three-way blend): the first try
// (rot 0, pot 1) 4.592 / 241 and 4.509 / 215; pot 1.6 to 3 brought the 10+ misses to 203-214, rot 1 the average to 4.47-4.51; picked rot 1, pot 2.5, ctx 0.5, ck 6: 4.507 / 203 and 4.490 / 204
// (4.510 / 203 and 4.491 / 203 once nextUp kept to the Out man's own position first).
// k 2 or 8, lean 0 or 2 and ctx 0.3 moved neither by more than 0.01 or two misses; ctx 1 was worse (4.616 / 223); rise 0 (no position rule for a deep man) 4.508 / 204 and 4.491 / 203, kept on as
// Adam asked. See ALLOC_DEFAULT_ON in predictor-core.js for the grade on all 24 nights.
// k: games' weight pulling a bench man's availability mean to his all-games mean times his share of games played; rot: men added to the usual rotation size; pot: the deep bench's pot scale;
// lean: how much more of an Out man's position-prior share the man next up at his position gets; rise: 1 for the position rule (rotationOf), 0 for the bench by figure; ctx, ck: contextShift;
// zr: 1 weighs a bench man's bench games and the games he sat by recency in benchBase (minutes-predictor.js recencySetting), 0 counts them.
// Refit on all 24 nights with recency on (Adam 2:09 PM 11-27, "let it learn from all the nights"; tools/minutes_backtest.mjs, 11-27; predictor, three-way blend, board): lean 1 to 0.5 took
// 4.588 / 380, 4.503 / 373, 4.539 / 385 to 4.584 / 377, 4.502 / 372, 4.538 / 385 (later 12 nights predictor 4.671 / 181 to 4.665 / 177, blend 4.526 / 167 to 4.524 / 166). Tried and left: lean 0
// (4.580 / 376, 4.500 / 373: it drops the pecking order's lean Adam asked for, 3:00 PM 11-25; the lead's call), lean 2 (4.594 / 384), pot 2 (4.561 / 378 but the blend 374) and pot 2.25 with lean
// 0.5 (4.573 / 376 but the blend 373), zr 1 (4.584 / 382), ctx 0.7 (4.589 / 380); before recency, k 2 or 8, rot 0 or 2, ctx 0.3 or 0.7 and pot 3: none lowered the predictor's and the blend's
// average and 10+ misses together.
export const ALLOC_PRIOR = Object.freeze({ k: 4, rot: 1, pot: 2.5, lean: 0.5, rise: 1, ctx: 0.5, ck: 6, zr: 0 });

/**
 * A bench man's own figure, the games the coach sat him counted as 0 (step 1): his bench mean over his bench games plus the games he was listed did-not-play after his first game here, shrunk by
 * cfg.k games toward (target, else his all-games mean) times his share of games played. 0 with no games here. Pure.
 */
export function benchBase(profile, id, target, cfg) {
  const m = profile.byId.get(id);
  if (!m) return 0;
  const n = m.roleN.b, z = m.benched ?? 0, share = m.games / (m.games + z), prior = (target ?? m.pref) * share;
  // cfg.zr 1: his bench games and the games he sat weigh by recency (minutes-predictor.js recencySetting), so a man the coach has sat lately counts nearer 0 (Adam 2:08 PM 11-27, refine)
  const rz = cfg.zr && Number.isFinite(m.benchR) && Number.isFinite(m.benchedR) && m.benchR + m.benchedR > 0, nr = rz ? m.benchR : n, zr = rz ? m.benchedR : z;
  const own = n + z > 0 ? (nr * m.roleMean.b) / (nr + zr) : prior, w = n + z + cfg.k;
  return w > 0 ? ((n + z) * own + cfg.k * prior) / w : prior; // w is 0 only with no games and k 0, which allocSetting refuses (code review 11-27, item 5): never 0 / 0
}

/**
 * His minutes in context (Adam 12:14 PM 11-27): his own figure is a mean over games some teammates missed, so it moves toward his minutes WITH each man on tonight's team (healthy or Out: an Out man's
 * minutes reach him through splitOut, from his level with that man playing). Per teammate u (profile.with, learnWith): (his mean without u - his mean with u) x u's missed share of his games, shrunk by
 * cfg.ck games of u's absence, times the position overlap and cfg.ctx; the sum taken off. 0 with no table or cfg.ctx 0. overlap: predictor-core.js posOverlap. Pure.
 */
export function contextShift(profile, id, team, { pos, overlap }, cfg) {
  const row = profile.with?.get(id);
  if (!row || !(cfg.ctx > 0)) return 0;
  let shift = 0;
  for (const u of team) {
    const c = u === id ? null : row.get(u);
    if (!c) continue;
    const [nW, mW, nA, mA] = c;
    shift -= cfg.ctx * overlap(pos.get(id), pos.get(u)) * (nA / (nW + nA)) * (mA - mW) * (nA / (nA + cfg.ck));
  }
  return shift;
}

/** How often a played more than b in games both were available here (learnPecking), shrunk to even: (ahead + 0.5) / (games + 1). Pure. */
export function aheadShare(profile, a, b) {
  const c = profile.peck?.get(a)?.get(b) ?? [0, 0];
  return (c[0] + 0.5) / (c[1] + 1);
}

/**
 * The man next up for an Out man u's minutes (step 2): among tonight's healthy men nearest his position (his own position when any is there, else an adjacent one: overlap 0.5) who are on the bench
 * or took a start tonight (not usual starters in the five), the one who played ahead of the others most often here. null with none, or with no pecking table. overlap: predictor-core.js posOverlap. Pure.
 */
export function nextUp(profile, u, healthy, { pos, five, overlap }) {
  if (!profile.peck) return null;
  const near = healthy.filter((j) => j !== u && profile.byId.has(j) && overlap(pos.get(u), pos.get(j)) >= 0.5 && !(five.has(j) && profile.usual.has(j)));
  const best = Math.max(0, ...near.map((j) => overlap(pos.get(u), pos.get(j)))), cands = near.filter((j) => overlap(pos.get(u), pos.get(j)) === best);
  if (!cands.length) return null;
  const score = (j) => cands.reduce((s, k) => s + (k === j ? 0 : aheadShare(profile, j, k)), 0);
  return cands.map((j) => ({ j, s: score(j) })).sort((a, b) => b.s - a.s || (a.j < b.j ? -1 : 1))[0].j;
}

/** Fits the free men to `total`: scale in proportion; a man who would pass his cap stays at it and the rest take the remainder. Map id -> minutes. Pure. */
export function fitTo(items, capOf, total = TEAM) {
  const fixed = new Map();
  let free = items.filter((x) => x.min > 0);
  for (let guard = 0; guard < 20 && free.length; guard++) {
    const left = total - [...fixed.values()].reduce((s, x) => s + x, 0);
    const tot = free.reduce((s, x) => s + x.min, 0);
    const over = free.filter((x) => (x.min / tot) * left > capOf(x));
    if (!over.length) { for (const x of free) fixed.set(x.id, (x.min / tot) * left); break; }
    for (const x of over) fixed.set(x.id, capOf(x));
    free = free.filter((x) => !over.includes(x));
  }
  return fixed;
}

/**
 * Step 3: { fit: Map id -> minutes, deep: Set of deep-bench ids, size (the rotation tonight), pot (the deep bench's minutes) }. items: [{ id, min (his figure with his share of the Out men), cap }];
 * five: tonight's five (always in the rotation). A profile without the team curve (an old saved one) gets the plain fit to 240 and no deep bench. Pure.
 */
export function allocate(items, profile, cfg, five, capOf, ctx = null) {
  if (!Array.isArray(profile.curve)) return { fit: fitTo(items, capOf), deep: new Set(), size: items.length, pot: 0, rose: new Map() };
  const size = Math.max(items.filter((x) => five.has(x.id)).length, Math.min(items.length, Math.round(profile.depth + cfg.rot)));
  const { rot, rose } = rotationOf(items, five, size, ctx), inRot = new Set(rot.map((x) => x.id));
  // the pot holds the deep men's whole figures (tried 11-27: keeping what reaches a deep man from tonight's Out men whole, outside the pot, was 4.507 / 203 to 4.511 / 204 on the first 12 nights)
  // the pot is the curve's slots past tonight's rotation as built (rot.length: the five and the usual men can pass `size` when a deep man starts), never past `size` (code review 11-27, item 2)
  const deep = items.filter((x) => !inRot.has(x.id)), want = deep.reduce((s, x) => s + x.min, 0);
  const pot = cfg.pot * profile.curve.slice(rot.length, rot.length + deep.length).reduce((s, x) => s + (x || 0), 0);
  const scale = want > pot && want > 0 ? pot / want : 1;
  const fit = new Map(deep.map((x) => [x.id, Math.min(capOf(x), x.min * scale)]));
  const left = TEAM - [...fit.values()].reduce((s, x) => s + x, 0);
  for (const [id, v] of fitTo(rot, capOf, left)) fit.set(id, v);
  return { fit, deep: new Set(deep.map((x) => x.id)), size: rot.length, pot: Math.min(pot, want), rose };
}

const byMin = (xs) => [...xs].sort((a, b) => b.min - a.min || (a.id < b.id ? -1 : 1));

/**
 * Tonight's rotation (step 3): { rot: items, rose: Map riser id -> the Out man whose place he took }. With no ctx: the five, then the bench by figure, `size` men. With ctx ({ outs: [{ id, own }], pos,
 * overlap }): the team's usual rotation is the `size` men with the highest own figures (items' `own`, the Out men's included); tonight's is the five and the healthy usual men, and each Out usual man's
 * place goes to the healthy deep man at his position (overlap 0.5 or more) with the highest figure, at most `size` men (a deep man rises only when a man ahead of him at his position is Out). Pure.
 */
function rotationOf(items, five, size, ctx) {
  const rose = new Map();
  if (!ctx) return { rot: [...byMin(items.filter((x) => five.has(x.id))), ...byMin(items.filter((x) => !five.has(x.id)))].slice(0, size), rose };
  const all = [...items.map((x) => ({ id: x.id, min: x.own ?? x.min })), ...ctx.outs.map((o) => ({ id: o.id, min: o.own, out: true }))];
  const usual = byMin(all).slice(0, size), usualIds = new Set(usual.map((x) => x.id));
  const rot = byMin(items.filter((x) => five.has(x.id) || usualIds.has(x.id))), inRot = new Set(rot.map((x) => x.id));
  for (const u of usual.filter((x) => x.out)) {
    if (rot.length >= size) break;
    const pick = byMin(items.filter((x) => !inRot.has(x.id) && ctx.overlap(ctx.pos.get(u.id), ctx.pos.get(x.id)) >= 0.5))[0];
    if (pick) { rot.push(pick); inRot.add(pick.id); rose.set(pick.id, u.id); }
  }
  return { rot, rose };
}

/** A deep man's why-line words (G62), or a deep man risen into the rotation for an Out man at his position; "" for a usual rotation man. */
export function allocWords(id, a) {
  if (a.rose?.has(id)) return `in tonight's ${a.size}-man rotation in place of a man out at his position`;
  if (!a.deep.has(id)) return "";
  return `deep bench (outside tonight's ${a.size}-man rotation): shares the ${a.pot.toFixed(1)} minutes this team's deep bench plays`;
}
