// The bench floor of a man moved into the five (Adam 4:02 PM 11-18: "never less than he would get off the bench"; path sweep 11-20), split out of tiers.js: each man moved into tonight's five is floored at
// his figure, team fill included, in this same team view with him on the bench and the man who would start in his place starting (standIn). Pure; runs in the browser too (the console page), so nothing is
// imported here: tiers.js passes its plan pass and its promoted-man test in. Tests: tests/slide_bench.test.mjs.

/** A man in tonight's five who would be on the bench without the move: promoted into an Out starter's place (isPromoted), or not his column's top on tonight's chart (a confirmed five's or a Starter mark's man), or with no position chart, not in the standing top five. */
const movedIn = (m, flagged, isPromoted) => m.in_five === true && (isPromoted(m, flagged) || m.chart_top === false || (m.chart_top === undefined && m.top5 === false));
/** The same man off the bench, at his place on the healthy chart (as the shadow placement reads it). */
const benchAs = (m) => ({ ...m, in_five: false, replaces: [], ...(m.depth !== undefined ? { depth: { pos: m.healthy?.pos ?? m.depth.pos ?? null, rank: m.healthy?.rank ?? null, idx: m.healthy?.idx ?? null } } : {}) });
/** The stand-in in the five in m's place (his depth as a man of the five; m's Out starters his to replace). */
const startAs = (s, m) => ({ ...s, in_five: true, replaces: m.replaces ?? [], ...(s.depth !== undefined ? { depth: { pos: s.depth.pos ?? null, rank: null, idx: s.depth.idx ?? null } } : {}) });

/** The man who would start in m's place were m on the bench: a healthy starter left out of the five, else the first man off the bench at m's position, else the first man off the bench; none marked; null with none. */
export function standIn(men, m, spotOf) {
  const free = men.filter((y) => !y.in_five && y.tier_force == null && Number.isFinite(spotOf(y.id))).sort((a, b) => spotOf(a.id) - spotOf(b.id)), posOf = (y) => y.healthy?.pos ?? y.depth?.pos ?? (y.positions ?? [])[0] ?? null;
  return free.find((y) => y.healthy?.starter === true) ?? free.find((y) => posOf(y) !== null && posOf(y) === posOf(m)) ?? free[0] ?? null;
}

/**
 * The plan with each moved man's bench floor (tiers.js tierPlan). args: tierPlan's; flagged: tiers.js's; planOnce(args) -> plan (tiers.js's one pass; reads args.benchFloors: Map id -> floor); isPromoted(m, flagged).
 * A moved man with no man to start in his place (standIn null) gets no floor, said in the team's notes (G62). Returns the plan.
 */
export function withBenchFloors(args, flagged, planOnce, isPromoted) {
  const moved = args.men.filter((m) => movedIn(m, flagged, isPromoted));
  if (!moved.length) return planOnce({ ...args, flagged });
  const first = planOnce({ ...args, flagged }), spotOf = (id) => first.byId.get(id)?.spot ?? Infinity, benchFloors = new Map(), noStandIn = [];
  for (const m of moved) {
    const s = standIn(args.men, m, spotOf);
    if (!s) { noStandIn.push(m.name); continue; }
    const off = planOnce({ ...args, flagged, men: args.men.map((y) => (y === m ? benchAs(m) : y === s ? startAs(s, m) : y)) }).byId.get(m.id);
    if (Number.isFinite(off?.auto)) benchFloors.set(m.id, off.auto);
  }
  const plan = benchFloors.size ? planOnce({ ...args, flagged, benchFloors }) : first;
  if (noStandIn.length) plan.notes.push(`No man off the bench could start in the place of ${noStandIn.join(", ")}, so ${noStandIn.length === 1 ? "his" : "their"} figure off the bench is not known and no bench floor is set (Adam 4:02 PM 11-18)`);
  return plan;
}
