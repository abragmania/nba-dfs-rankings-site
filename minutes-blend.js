// The minutes blend (Adam 9:49 AM 11-25, "let's do it"): the board's minutes are the plain average of our minutes engine, TwoGun's minutes and the minutes predictor, the three-way figure the
// nightly scoreboard graded best (data/cache/minutes-score/latest.json, 22 nights through 11-23: three-way 4.73 average miss against engine 4.91, TwoGun 5.21, predictor 5.34).
// One copy, run by the board's engine (server/minutes/personal-view.js teamPlan), the Console in the browser (console-tier.js tierScenario) and so the scoreboard's `board` column
// (tools/minutes_backtest.mjs, through the engine). The models are one list, BLEND_MEMBERS: dropping TwoGun later is one line (Adam wants to, 11-25).
// Rules (the lead's rulings of 11-25 and the code review of 11-25):
//  1. Per man playing: the average of the members that have him. Our engine has him when its plan gives a figure; TwoGun only when its minutes are above 0, and never for a man Adam put back In
//     (his rule: such a man plays on our figure, never TwoGun's); the predictor when his box-score id is in its team profile. Who lacks a model is counted in the team's notes (G62).
//     A man no model has keeps no figure, said; the others are fitted without him (review item 6).
//  2. The predictor runs on tonight's five (the plan's starters) and the men not playing, as the scoreboard ran it; a team it cannot run for averages the other members, said in the notes, and
//     what it ran short of (set-aside boxes, positions, raised caps, men off the board it counts as playing) is named (review item 3).
//  3. Then the team is fitted back to 240 in proportion, each man held to his cap (the engine's ceiling for him, at most 36 unless he is a starter whose own engine figure is above 36 or his cap
//     override sets it; past 36 only when 240 cannot be reached otherwise, named) and kept at or above Adam's standing floors: a starter never below his starter figure, a Bench+ man never below
//     his Bench+ average (tiers.js rules 2 and 3b, Adam 11-17 and 11-18). Kept as the engine has them, outside the blend: a standing usual override, a cap override at or below his figure and a
//     minutes restriction in the news (tiers.js rules 4 and 4b; review item 10). The starter line (fitTeamBlend) is off by default (STARTER_LINE: it scored worse); on, every man it or a floor
//     moves MOVE_SAID or more is named on his row and in the team's notes (review item 2). Typed minutes and standing minutes overrides replace a man's figure after this, as before (figures.js).
// The input (server/minutes/predictor-inputs.js blendInput) is plain JSON, so the server and the page read the same numbers. Pure; tests/minutes_blend.test.mjs. Words: minutes-blend-words.js.
import { isNum } from "./figures.js";
import { MINUTES_CAP } from "./team-fill.js";
import { predictTeamMinutes, profileFromJson } from "./predictor-core.js";
import { blendNotes, manWords } from "./minutes-blend-words.js";

export { blendSummary, blendFootText } from "./minutes-blend-words.js";
export const BLEND_MEMBERS = Object.freeze(["engine", "twogun", "predictor"]);
/**
 * The starter line, OFF (code review 11-25, item 2: kept only if it does not worsen the board's average miss). Scored 11-25 on the 22 nights with a box score (3,634 men, box-score actuals, the board
 * column as of lock): line on 4.685, bench hold only ("hold") 4.685, line off 4.679 (our engine alone 4.910, TwoGun 5.215, the predictor 5.337). The input's starter_line (true, false or "hold";
 * NBADFS_BLEND_STARTER_LINE=on|off|hold in predictor-inputs.js) sets it per run; the fit, the caps and Adam's floors stand either way.
 */
export const STARTER_LINE = false;
export const MOVE_SAID = 0.5; // minutes a rule must move a man before it is named on his row and in the notes (review item 2)
const TEAM = 240, EPS = 1e-9;

/** One man's average over the members that have a figure: { value (null when none has), used, lacking }. figs: { member: number or null }. Pure. */
export function blendMan(figs, members = BLEND_MEMBERS) {
  const used = members.filter((m) => isNum(figs[m])), lacking = members.filter((m) => !isNum(figs[m]));
  return { value: used.length ? used.reduce((s, m) => s + figs[m], 0) / used.length : null, used, lacking };
}

/**
 * Fits the free men's values in proportion to `target`, each between his floor (none: 0) and his cap: Map id -> minutes. items: [{ id, v, cap, floor }]. In rounds, the side further out of bounds
 * is held first (the men past their caps at them, or the men under their floors at them) and the rest refitted to what is left. What the caps cannot hold stays short; floors past it stay over. Pure.
 */
export function fitCapped(items, target) {
  const out = new Map(), floorOf = (x) => (isNum(x.floor) ? Math.min(Math.max(x.floor, 0), x.cap) : 0), mine = new Set();
  let free = items.filter((x) => x.v > 0 || floorOf(x) > 0);
  for (const x of items) if (!free.includes(x)) out.set(x.id, 0);
  for (let guard = 0; guard < 60 && free.length; guard++) {
    const left = Math.max(0, target - [...mine].reduce((s, id) => s + out.get(id), 0)), tot = free.reduce((s, x) => s + Math.max(x.v, 0), 0);
    const val = (x) => (tot > 0 ? (Math.max(x.v, 0) / tot) * left : 0);
    const over = free.filter((x) => val(x) > x.cap + EPS), under = free.filter((x) => val(x) < floorOf(x) - EPS);
    if (!over.length && !under.length) { for (const x of free) out.set(x.id, val(x)); return out; }
    const ov = over.reduce((s, x) => s + val(x) - x.cap, 0), un = under.reduce((s, x) => s + floorOf(x) - val(x), 0), capSide = ov >= un, fix = capSide ? over : under;
    for (const x of fix) { out.set(x.id, capSide ? x.cap : floorOf(x)); mine.add(x.id); }
    free = free.filter((x) => !fix.includes(x));
  }
  for (const x of free) out.set(x.id, floorOf(x)); // the guard ran out (never seen): each at his floor, so nothing is missing
  return out;
}

/** One round of the fit: the fixed and held men as they are, the free men fitted to what is left: { fit, clamped (what the kept men add past the target, 0 when none) }. Pure. */
function fitRound(men, fixed, held, target) {
  const left = target - [...fixed.values(), ...held.values()].reduce((s, v) => s + v, 0);
  const free = men.filter((m) => !fixed.has(m.id) && !held.has(m.id)).map((m) => ({ id: m.id, v: m.v, cap: m.cap, floor: m.floor }));
  return { fit: new Map([...fixed, ...held, ...fitCapped(free, Math.max(0, left))]), clamped: left < -EPS ? -left : 0 }; // review item 5: never a negative share; the excess is named
}

/**
 * The team fitted to 240 (rule 3): men [{ id, v, cap, floor, tier, fixed (a value kept as is, or null), eng (our engine's own figure), top (his highest model figure) }] ->
 * { fit: Map id -> minutes, above: [ids], moved: [{ id, kind ("lift" | "hold"), from, to }], clamped, first (the fit before the line) }.
 * The starter line (starterLine true), in rounds (at most eight): (a) a starter below a plain bench man is lifted toward that man's figure, up to his own highest model figure and his cap: a model
 * that does not know he starts tonight must not pull the bench down with him; (b) a plain bench man still above the lowest starter is held at that starter, but never below our engine's own figure
 * for him (the engine puts him past a starter only when it must); a man left above the lowest starter is in `above`, for the notes. Pure.
 */
export function fitTeamBlend(men, target = TEAM, { starterLine = STARTER_LINE } = {}) {
  const fixed = new Map(men.filter((m) => isNum(m.fixed)).map((m) => [m.id, m.fixed])), held = new Map(), above = new Set(), how = new Map();
  const free = (m) => !fixed.has(m.id) && !held.has(m.id), starters = men.filter((m) => m.tier === "starter");
  let r = fitRound(men, fixed, held, target);
  const first = r.fit;
  for (let round = 0; starterLine && round < 8 && starters.length; round++) {
    const fit = r.fit, bench = men.filter((m) => m.tier === "bench" && free(m)), topBench = Math.max(0, ...bench.map((m) => fit.get(m.id)));
    const lift = starterLine === "hold" ? [] : starters.filter((s) => free(s) && fit.get(s.id) < topBench - EPS && isNum(s.top) && s.top > fit.get(s.id) + EPS); // "hold": part (b) only
    if (lift.length) for (const s of lift) { held.set(s.id, Math.max(fit.get(s.id), Math.min(topBench, s.top, s.cap))); how.set(s.id, "lift"); }
    else {
      const low = Math.min(...starters.map((s) => fit.get(s.id))), over = bench.filter((m) => fit.get(m.id) > low + EPS);
      if (!over.length) break;
      for (const m of over) {
        const at = Math.max(low, Math.min(fit.get(m.id), isNum(m.eng) ? m.eng : 0));
        held.set(m.id, at); how.set(m.id, "hold");
        if (at > low + EPS) above.add(m.id);
      }
    }
    r = fitRound(men, fixed, held, target);
  }
  const fit = r.fit, low = starters.length ? Math.min(...starters.map((s) => fit.get(s.id))) : null;
  const moved = [...how].map(([id, kind]) => ({ id, kind, from: first.get(id), to: fit.get(id) })).filter((x) => Math.abs(x.to - x.from) >= MOVE_SAID);
  return { fit, above: [...above].filter((id) => low !== null && fit.get(id) > low + EPS), moved, clamped: r.clamped, first };
}

/**
 * The predictor's minutes for the playing men: { byId: Map dk id -> minutes, known: Set dk ids it has games for, notes: { posMissing, capUsed } } or { missing }. input: blendInput's predictor part. Pure.
 */
export function predictorFigures(pred, playing, starters) {
  if (!pred || pred.missing) return { missing: pred?.missing ?? "no predictor input was made" };
  const profile = profileFromJson(pred.profile), on = new Set(playing);
  const out = new Set([...pred.men.filter((m) => !String(m.key).startsWith("out:") && !on.has(m.key)).map((m) => m.key), ...(pred.off_out ?? [])]);
  const res = predictTeamMinutes(profile, { men: pred.men.map((m) => ({ key: m.key, id: m.id })), five: starters, out, pos: new Map(pred.pos ?? []) });
  const byId = new Map(), known = new Set();
  for (const m of pred.men) if (on.has(m.key)) { byId.set(m.key, res.byKey.get(m.key).minutes); if (profile.byId.has(m.id)) known.add(m.key); }
  return { byId, known, notes: { posMissing: res.notes.posMissing ?? 0, capUsed: res.notes.capUsed ?? null } };
}

/**
 * A man's caps in the fit (rule 3): cap, the engine's ceiling for him held at 36, unless he is a starter whose own engine figure is above 36 (then that figure) or his standing cap override sets the
 * ceiling (e.used has "cap"; then it is his cap as set); wide, the engine's ceiling and figure unheld, used only when 240 cannot be reached under the caps. e: the plan's entry. Pure.
 */
export function capsOf(e) {
  const ceil = isNum(e.ceiling) ? e.ceiling : MINUTES_CAP, auto = isNum(e.auto) ? e.auto : 0;
  if (Array.isArray(e.used) && e.used.includes("cap") && isNum(e.ceiling)) return { cap: e.ceiling, wide: e.ceiling };
  const cap = Math.min(ceil, MINUTES_CAP);
  return { cap: e.tier === "starter" && auto > MINUTES_CAP ? Math.max(cap, auto) : cap, wide: Math.max(ceil, auto, cap) };
}

/** The fit under the caps; when the team cannot reach 240 under them, again with the wide caps, the men then past 36 in `past` (named in the notes). rows: blendPlan's. Pure. */
export function fitWithCaps(rows, opts = {}) {
  const first = fitTeamBlend(rows, TEAM, opts), sum = (f) => [...f.values()].reduce((s, v) => s + v, 0);
  if (sum(first.fit) > TEAM - 0.05 || !rows.some((r) => r.wide > r.cap + EPS)) return { ...first, past: [] };
  const second = fitTeamBlend(rows.map((r) => ({ ...r, cap: r.wide })), TEAM, opts);
  return { ...second, past: rows.filter((r) => !isNum(r.fixed) && second.fit.get(r.id) > r.cap + EPS && second.fit.get(r.id) > MINUTES_CAP + EPS).map((r) => r.id) };
}

/** Why a man is kept as the engine has him, outside the blend (rule 3, review item 10), or null: his standing usual override, a minutes restriction, his cap override at or below his figure. */
function keptWhy(e) {
  if (!isNum(e.auto)) return null;
  if (e.label?.kind === "override") return "your standing usual override is kept as set, outside the blend";
  if (e.restriction) return "his minutes restriction holds him as our engine has him, outside the blend";
  if (e.limited || isNum(e.label?.limit)) return "your cap override at or below his figure is a fixed limit, outside the blend";
  return null;
}

/** The blend's rows for the fit: one per playing man of the plan, with his figures, caps, floor and what keeps him. */
function blendRows(plan, men, input, members, pred) {
  const lacking = Object.fromEntries(members.map((m) => [m, []])), rows = [];
  for (const m of men.filter((x) => plan.byId.has(x.id))) {
    const e = plan.byId.get(m.id), tg = input.tg?.[m.id];
    const figs = { engine: isNum(e.auto) ? e.auto : null, twogun: !m.put_in && isNum(tg) && tg > 0 ? tg : null, predictor: pred.known?.has(m.id) ? pred.byId.get(m.id) : null };
    const b = blendMan(figs, members), kept = keptWhy(e);
    for (const k of b.lacking) lacking[k].push(m.name);
    const floor = (e.tier === "starter" || e.tier === "bench_plus") && isNum(e.floor) ? e.floor : null; // Adam 11-17 and 11-18: the starter floor, the Bench+ average
    rows.push({ m, e, figs, b, kept, id: m.id, v: b.value, ...capsOf(e), floor, tier: e.tier, fixed: kept ? e.auto : null, eng: isNum(e.auto) ? e.auto : null, top: b.used.length ? Math.max(...b.used.map((k) => figs[k])) : null });
  }
  return { rows, lacking };
}

/** The men a floor moved: at their floor after the fit and MOVE_SAID or more above where the fit without floors had them. Pure. */
function floorMoves(rows, fit, opts) {
  const withFloor = rows.filter((r) => isNum(r.floor) && !isNum(r.fixed));
  if (!withFloor.length) return [];
  const loose = fitWithCaps(rows.map((r) => ({ ...r, floor: null })), opts).fit;
  return withFloor.filter((r) => Math.abs(fit.get(r.id) - r.floor) < 0.05 && fit.get(r.id) - loose.get(r.id) >= MOVE_SAID)
    .map((r) => ({ id: r.id, kind: r.tier === "starter" ? "starter floor" : "Bench+ average", from: loose.get(r.id), to: fit.get(r.id) }));
}

/**
 * The plan with the blend on (rules 1-3): each playing man's `auto` becomes his blended, fitted figure, with `engine_auto` (the engine's own), `models` ({ member: figure or null }), `blend_used` and a why
 * line added; the plan's notes gain the blend's notes and `blend` sums it up ({ members, lacking: { member: [names] }, predictor_missing, predictor_gaps, none, moved }). input: blendInput's answer
 * ({ off: true } or none leaves the plan as it is; starter_line false turns the starter line off). men: the plan's input men ({ id, name, put_in }). plan: tiers.js tierPlan's answer. Pure.
 */
export function blendPlan(plan, men, input) {
  if (!input || input.off) return plan;
  const members = input.members ?? BLEND_MEMBERS, playing = men.map((m) => m.id).filter((id) => plan.byId.has(id)), opts = { starterLine: [true, false, "hold"].includes(input.starter_line) ? input.starter_line : STARTER_LINE };
  const starters = playing.filter((id) => plan.byId.get(id).tier === "starter");
  const pred = members.includes("predictor") ? predictorFigures(input.predictor, playing, starters) : { byId: new Map(), known: new Set() };
  const { rows, lacking } = blendRows(plan, men, input, members, pred);
  const fitted = rows.filter((r) => isNum(r.v) || isNum(r.fixed)), none = rows.filter((r) => !isNum(r.v) && !isNum(r.fixed)); // review item 6: a man no model has is fitted around
  const res = fitted.length ? fitWithCaps(fitted, opts) : { fit: new Map(), above: [], past: [], moved: [], clamped: 0 }, fit = res.fit;
  const floors = floorMoves(fitted, fit, opts), total = [...fit.values()].reduce((s, v) => s + v, 0), byId = new Map(plan.byId);
  const movedOf = new Map([...res.moved, ...floors].map((x) => [x.id, x]));
  for (const r of rows) {
    const v = isNum(r.fixed) ? r.fixed : fit.has(r.id) ? fit.get(r.id) : null;
    byId.set(r.id, { ...r.e, auto: v, engine_auto: r.e.auto, models: r.figs, blend_used: r.kept ? ["engine"] : r.b.used, why: manWords(r, v, movedOf.get(r.id)) });
  }
  const engineHad = rows.filter((r) => !isNum(r.e.auto) && isNum(r.v)).map((r) => r.m.name); // our engine had no figure, another model has one (review item 6)
  const keptNotes = engineHad.length && !none.length ? plan.notes.filter((n) => !/nothing is handed out while .* no figure|has no figure of ours \(your typed/.test(n)) : plan.notes;
  const gaps = { ...(input.predictor?.gaps ?? {}), pos_missing: pred.notes?.posMissing ?? 0, cap_raised: pred.notes?.capUsed ?? null };
  const notes = blendNotes({ members, lacking, missing: pred.missing ?? null, gaps, rows, fit, res, floors, none, engineHad, total });
  const nameOf = (id) => rows.find((r) => r.id === id).m.name;
  return { ...plan, byId, total: none.length ? null : total, notes: [...keptNotes, ...notes],
    blend: { members: [...members], lacking, predictor_missing: pred.missing ?? null, predictor_gaps: gaps, none: none.map((r) => r.m.name), moved: [...movedOf.values()].map((x) => ({ name: nameOf(x.id), kind: x.kind, from: x.from, to: x.to })) } };
}
