// The minutes blend's words (server/board/minutes-blend.js; Adam 9:49 AM 11-25): each man's blend line, the team's notes (G62: who lacks a model, what the predictor ran short of, every man a
// rule moved, a team not at 240 and why) and the slate's summary for the board's foot (G64: notes at the foot, never the main view). Pure strings; the page loads this file too.
import { isNum } from "./figures.js";
import { MINUTES_CAP } from "./team-fill.js";

const TEAM = 240;
export const LABEL = { engine: "our engine", twogun: "TwoGun", predictor: "the predictor" };
const LACK = { engine: "no figure from our engine", twogun: "no TwoGun minutes (0 or blank there, or you put him back In)", predictor: "no box-score games for the predictor" };
const r1 = (v) => Math.round(v * 10) / 10;
const listWords = (a) => (a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a.at(-1)}`);
const menWord = (n) => `${n} m${n === 1 ? "an" : "en"}`;
const has = (n) => (n === 1 ? "has" : "have");
const MOVE_WORDS = {
  lift: "the starter line lifted him: a starter is not left below a plain bench man (up to his own highest model figure)",
  hold: "the starter line held him: a plain bench man is not above the lowest starter, unless our engine's own figure for him is",
  "starter floor": "kept at his starter floor (Adam 11-17: a starter never below his starter figure)",
  "Bench+ average": "kept at his Bench+ average (Adam 11-18: a Bench+ man never below it)",
};

/** One man's why line with the blend: the engine's words, then the members used with their figures, the average, his figure after the fit, and any rule that moved him (review item 2). Pure. */
export function manWords(r, v, move) {
  if (r.kept) return `${r.e.why}; ${r.kept}`;
  if (!isNum(r.b.value)) return `${r.e.why}; no model of the minutes blend has a figure for him, so his minutes are missing`;
  const lack = r.b.lacking.length ? ` (${r.b.lacking.length === 1 ? "one model has" : `${r.b.lacking.length} models have`} none for him)` : "";
  const fitted = isNum(v) && Math.abs(v - r.b.value) >= 0.05 ? `, fitted to ${TEAM} = ${r1(v)}` : "";
  const moved = move ? `; ${r1(move.from)} to ${r1(move.to)}: ${MOVE_WORDS[move.kind]}` : "";
  return `${r.e.why}; Blend: ${r.b.used.map((m) => `${LABEL[m]} ${r1(r.figs[m])}`).join(", ")}${lack}; average ${r1(r.b.value)}${fitted}${moved}`;
}

/** Why the team does not add to 240 after the fit (review item 5), from what the fit had to work with. Pure. */
function shortWhy(total, rows, fit, clamped) {
  const free = rows.filter((r) => !isNum(r.fixed) && fit.has(r.id));
  if (total > TEAM) return clamped > 0.05 ? `the figures kept as set (standing overrides, cap limits, minutes restrictions) and the men the starter line held add to ${r1(TEAM + clamped)} by themselves, so the others take only their floors`
    : "the starter floors and Bench+ averages of the men left to fit add to more than what the kept figures leave";
  if (!free.length) return "every man's figure is kept as set (standing overrides, cap limits, minutes restrictions)";
  return free.every((r) => fit.get(r.id) >= r.cap - 0.05) ? "every man left to fit is at his cap" : "the men left to fit have no more to take (at their caps or held by the starter line)";
}

/** What the predictor ran short of, as notes (review item 3; G62). gaps: blendInput's predictor gaps with the run's pos_missing and cap_raised. Pure. */
function gapNotes(gaps) {
  const g = gaps ?? {}, out = [];
  if (g.set_aside?.count) out.push(`${g.set_aside.count} box score${g.set_aside.count === 1 ? " was" : "s were"} set aside for the predictor (first: ${g.set_aside.first})`);
  if (g.pos_problem) out.push(`for the predictor, ${g.pos_problem}`);
  if (g.pos_missing > 0) out.push(`the predictor has no listed position for ${menWord(g.pos_missing)}, so an Out man's minutes reach them by role only`);
  if (isNum(g.cap_raised)) out.push(`the predictor's own ceilings could not hold ${TEAM} for this team, so its caps were raised to ${g.cap_raised}`);
  if (g.off_healthy?.length) out.push(`${menWord(g.off_healthy.length)} off TwoGun's board whom no feed of ours has Out ${g.off_healthy.length === 1 ? "is" : "are"} counted as playing by the predictor: ${g.off_healthy.join(", ")}`);
  if (g.off_list_problem) out.push(`the men off TwoGun's board could not be read (${g.off_list_problem}), so the predictor counts none of them`);
  // the depth-chart prior and the lock five (Adam 10:06 AM 11-25)
  if (g.chart_problem) out.push(`the predictor has no depth chart for this team (${g.chart_problem}), so its lean from the chart is off`);
  if (g.chart_no_id?.length) out.push(`${menWord(g.chart_no_id.length)} on the depth chart ${has(g.chart_no_id.length)} no box-score id, so the predictor's lean from the chart cannot reach ${g.chart_no_id.length === 1 ? "him" : "them"}: ${g.chart_no_id.join(", ")}`);
  if (g.chart_moved?.length) out.push(`the predictor's figure for ${listWords(g.chart_moved)} lean${g.chart_moved.length === 1 ? "s" : ""} lower: the depth chart has ${g.chart_moved.length === 1 ? "him" : "them"} out of the rotation`);
  if (g.five === "not the confirmed five") out.push("the predictor ran on tonight's starters, which are not the lineup pages' confirmed five (a Starter mark or our engine's call)");
  return out.map((n) => `Minutes blend: ${n}`);
}

/** The team's notes on the blend (G62: the foot). ctx: blendPlan's members, lacking, missing, gaps, rows, fit, res, floors, none, engineHad, total. Pure. */
export function blendNotes({ members, lacking, missing, gaps, rows, fit, res, floors, none, engineHad, total }) {
  const notes = [], nameOf = (id) => rows.find((r) => r.id === id).m.name, said = (xs) => listWords(xs.map((x) => `${nameOf(x.id)} ${r1(x.from)} to ${r1(x.to)}`));
  if (missing && members.includes("predictor")) notes.push(`Minutes blend: the minutes predictor could not run for this team (${missing}), so its men's minutes average ${listWords(members.filter((m) => m !== "predictor").map((m) => LABEL[m]))}`);
  for (const m of members) if (lacking[m]?.length && !(m === "predictor" && missing)) notes.push(`Minutes blend: ${menWord(lacking[m].length)} ${has(lacking[m].length)} ${LACK[m]} and take${lacking[m].length === 1 ? "s" : ""} the average of the other models: ${lacking[m].join(", ")}`);
  if (members.includes("predictor") && !missing) notes.push(...gapNotes(gaps));
  if (none.length) notes.push(`Minutes blend: ${listWords(none.map((r) => r.m.name))} ${has(none.length)} no figure from any model, so ${none.length === 1 ? "his minutes are" : "their minutes are"} missing; the others are fitted to ${TEAM} without ${none.length === 1 ? "him" : "them"}`);
  const filled = engineHad.filter((n) => !none.some((r) => r.m.name === n));
  if (filled.length) notes.push(`Minutes blend: our engine had no figure for ${listWords(filled)}; ${filled.length === 1 ? "his figure is" : "theirs are"} the average of the other models, and the team is fitted to ${TEAM} with ${filled.length === 1 ? "him" : "them"}`);
  if (fit.size && Math.abs(total - TEAM) > 0.05) notes.push(`Minutes blend: this team adds to ${r1(total)}, not ${TEAM}: ${shortWhy(total, rows, fit, res.clamped ?? 0)}`);
  const low = rows.filter((r) => r.tier === "starter" && fit.has(r.id)).sort((a, b) => fit.get(a.id) - fit.get(b.id))[0];
  if (res.above.length && low) notes.push(`Minutes blend: ${listWords(res.above.map((id) => `${nameOf(id)} ${r1(fit.get(id))}`))} stay${res.above.length === 1 ? "s" : ""} above the lowest starter (${low.m.name} ${r1(fit.get(low.id))}): a bench man is held at the lowest starter, never below our engine's own figure for him`);
  if (res.past.length) notes.push(`Minutes blend: ${TEAM} cannot be reached with every man at ${MINUTES_CAP} or under: ${listWords(res.past.map((id) => `${nameOf(id)} ${r1(fit.get(id))}`))} go${res.past.length === 1 ? "es" : ""} past it, up to our engine's ceiling for him`);
  const lifts = res.moved.filter((x) => x.kind === "lift"), holds = res.moved.filter((x) => x.kind === "hold");
  if (lifts.length) notes.push(`Minutes blend: the starter line lifted ${said(lifts)}: a starter is not left below a plain bench man`);
  if (holds.length) notes.push(`Minutes blend: the starter line held ${said(holds)}: a plain bench man is not above the lowest starter`);
  if (floors.length) notes.push(`Minutes blend: Adam's floors kept ${listWords(floors.map((x) => `${nameOf(x.id)} at his ${x.kind} ${r1(x.to)} (the fit had ${r1(x.from)})`))}; the others' minutes are fitted around them`);
  return notes;
}

/**
 * The slate's blend in one object for the board's foot (G62, G64): { members, teams, predictor_missing: [{ team, why }], lacking: { member: count }, none, moved, predictor_gaps } from each team's view.blend
 * ([[team, blend or null]]); null when no team ran the blend (it is off). Pure.
 */
export function blendSummary(teamBlends) {
  const on = teamBlends.filter(([, b]) => b && Array.isArray(b.members));
  if (!on.length) return null;
  const members = on[0][1].members, lacking = Object.fromEntries(members.map((m) => [m, 0]));
  for (const [, b] of on) for (const m of members) if (!(m === "predictor" && b.predictor_missing)) lacking[m] += b.lacking?.[m]?.length ?? 0;
  const ran = on.filter(([, b]) => !b.predictor_missing && b.predictor_gaps), g = (f) => ran.map(([t, b]) => [t, b.predictor_gaps[f]]);
  const predictor_gaps = { set_aside: Math.max(0, ...g("set_aside").map(([, v]) => v?.count ?? 0)), pos_problem: g("pos_problem").find(([, v]) => v)?.[1] ?? null,
    pos_missing: g("pos_missing").reduce((s, [, v]) => s + (v ?? 0), 0), cap_raised: g("cap_raised").filter(([, v]) => isNum(v)).map(([t]) => t),
    off_healthy: g("off_healthy").reduce((s, [, v]) => s + (v?.length ?? 0), 0), off_list_problem: g("off_list_problem").find(([, v]) => v)?.[1] ?? null,
    // the lock five and the depth-chart prior (11-25): how many teams ran on a confirmed five (of those whose input says), and the teams with no chart
    five_said: g("five").filter(([, v]) => v).length, five_confirmed: g("five").filter(([, v]) => v === "confirmed").length, chart_missing: g("chart_problem").filter(([, v]) => v).map(([t]) => t),
    chart_moved: g("chart_moved").reduce((s, [, v]) => s + (v?.length ?? 0), 0), chart_no_id: g("chart_no_id").reduce((s, [, v]) => s + (v?.length ?? 0), 0) }; // code review 11-25, item 3
  return { members, teams: on.length, predictor_missing: on.filter(([, b]) => b.predictor_missing).map(([team, b]) => ({ team, why: b.predictor_missing })), lacking,
    none: on.reduce((s, [, b]) => s + (b.none?.length ?? 0), 0), moved: on.reduce((s, [, b]) => s + (b.moved?.length ?? 0), 0), predictor_gaps };
}

/** The foot's words for the summary: what the minutes are, then who lacks a model, what the predictor ran short of and how many men a rule moved (the teams' notes name the men); "" with none. Pure. */
export function blendFootText(s) {
  if (!s) return "";
  const pg = s.predictor_gaps ?? {};
  const gaps = [...(s.predictor_missing.length ? [`the predictor could not run for ${s.predictor_missing.map((p) => p.team).join(", ")}, so those teams average the other models`] : []),
    ...s.members.filter((m) => s.lacking[m] > 0).map((m) => `${menWord(s.lacking[m])} ${has(s.lacking[m])} ${LACK[m]}, so ${s.lacking[m] === 1 ? "his figure averages" : "theirs average"} the other models`),
    ...(s.none > 0 ? [`${menWord(s.none)} ${has(s.none)} no figure from any model`] : []),
    ...(pg.set_aside > 0 ? [`${pg.set_aside} box score${pg.set_aside === 1 ? " was" : "s were"} set aside for the predictor`] : []),
    ...(pg.pos_problem ? [`for the predictor, ${pg.pos_problem}`] : []),
    ...(pg.pos_missing > 0 ? [`the predictor has no listed position for ${menWord(pg.pos_missing)}`] : []),
    ...(pg.cap_raised?.length ? [`the predictor raised its caps for ${pg.cap_raised.join(", ")}`] : []),
    ...(pg.off_healthy > 0 ? [`${menWord(pg.off_healthy)} off TwoGun's board ${pg.off_healthy === 1 ? "is" : "are"} counted as playing by the predictor`] : []),
    ...(pg.off_list_problem ? [`the men off TwoGun's board could not be read for the predictor`] : []),
    ...(pg.five_said > 0 ? [`the predictor ran on the lineup pages' confirmed five for ${pg.five_confirmed} of ${pg.five_said} teams, the rest on our engine's five`] : []),
    ...(pg.chart_missing?.length ? [`the predictor has no depth chart for ${pg.chart_missing.join(", ")}`] : []),
    ...(pg.chart_moved > 0 ? [`the depth chart lowered the predictor's figure for ${menWord(pg.chart_moved)} out of the rotation (each team's notes name them)`] : []),
    ...(pg.chart_no_id > 0 ? [`${menWord(pg.chart_no_id)} on the depth charts ${has(pg.chart_no_id)} no box-score id, so the predictor's lean from the chart cannot reach ${pg.chart_no_id === 1 ? "him" : "them"}`] : []),
    ...(s.moved > 0 ? [`the starter line or Adam's floors moved ${menWord(s.moved)} half a minute or more (each team's notes name them)`] : [])];
  return `Our minutes: ${listWords(s.members.map((m) => LABEL[m]))} averaged, fitted to ${TEAM}${gaps.length ? `; ${gaps.join("; ")}` : ""}`;
}
