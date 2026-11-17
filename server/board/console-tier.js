// The console's minutes (Adam 11-12: one minutes model): the tier engine (tiers.js, the same pure code server/minutes runs for the board) on a scenario's Outs, marks and typed minutes. Pure ES module shared by the page
// and the server. The inputs carry, per team, `tier` (server/minutes/tier-inputs.js): each man's role games, TwoGun's figure and flags, his standing overrides, tonight's order and the lineup pages' five, so any
// scenario is worked here with no call to the server (tests/minutes_parity.test.mjs holds this equal to the board's engine). Roles are the engine's: Starter (the five), Bench+, Bench; Out of rotation is his mark.
// A man he marked S joins the five (six or more marked all start, said); Bench+ or Bench forces that tier.
// Typed minutes (Adam 1:33 PM 11-17, as on the board): the plan is worked as if nothing were typed, then a typed man's figure, or a standing minutes override in force, is simply replaced by his number;
// nobody else moves for it, so the team may come to more or less than 240, said plainly (tiers.js typedTotalNote). Outs and his marks still redistribute.
import { chooseFive, roleFigure, tierPlan, ovMinutesIn, typedTotalNote, ROLE_OF_TIER } from "./tiers.js";
import { isNum } from "./figures.js";
import { chartCols, tonightCols, columnTops, depthPlaces, healthyPlaces, fillEmpty, shortFiveFill } from "./depth-cols.js";

/** The team's depth chart on the page (Adam 11-17): the payload's seed with his moves (the page's own live list, team.depth_moves, else the saved one), as the engine builds it (depth-cols.js); null without one. */
export function pageChart(team, ids = null) {
  const D = team.tier?.depth;
  if (!D) return null;
  const ch = chartCols(D.seed, Array.isArray(team.depth_moves) ? team.depth_moves : D.moves);
  if (!ids) return ch;
  // no empty column tonight (the lead, 11-17), as the engine fills it (depth-view.js): over tonight's playing men, guided by the pages' five the engine read
  const present = new Set(ids.map((id) => keyOfId(team.tier, id)).filter(Boolean)), alts = Object.fromEntries(Object.entries(D.votes ?? {}).map(([k, v]) => [k, v.alts]));
  const f = fillEmpty(ch, present, alts, new Set(D.likely ?? []), (k) => D.names?.[k] ?? k);
  return Object.assign(f.chart, { fills: f.fills });
}
const keyOfId = (T, id) => T.men[id]?.key ?? null;
/** Tonight's view of the chart over the men `ids` (console ids): { view, idOf: key -> id }. */
export function chartView(team, ch, ids) {
  const idOf = new Map(ids.map((id) => [keyOfId(team.tier, id), id]).filter(([k]) => k));
  return { view: tonightCols(ch, new Set(idOf.keys())), idOf };
}

const ROLE_OF = { starter: "starter", bench_plus: "bench_plus", bench: "bench" };
const FORCE = { bench_plus: "bench_plus", bench: "bench" };

/** Whether the team carries the engine's inputs: { ok: true } or { ok: false, why } (why null for a fixture with no `tier` field at all). */
export function tierUse(team) {
  if (team.tier === undefined) return { ok: false, why: null };
  if (team.tier === null || team.tier.missing) return { ok: false, why: team.tier?.missing ?? `no minutes engine inputs for ${team.code ?? "this team"}` };
  return { ok: true };
}

const mean = (rows) => (rows.length ? rows.reduce((s, r) => s + r[0], 0) / rows.length : null);

/**
 * Tonight's five on a scenario, with no plan run: { gone, order, five: Set of ids, base (chooseFive's), conf, notes, fixed }. The pages' five without the men gone, else TwoGun's flags; a man he marked off the five leaves it,
 * a man marked S joins it and takes a fill place first (so a swap or bench-then-S never gives six: six comes only from S marks on top of a real five).
 */
export function tierFive(team, outSet, mark = {}) {
  const T = team.tier, known = (id) => Object.hasOwn(T.men, id), onTeam = new Set(team.men.map((p) => p.id));
  const fixed = (T.base_outs ?? []).filter((o) => !onTeam.has(o.id)); // Out men the console has no row for: Out in every scenario, named
  const gone = new Set([...outSet, ...Object.entries(mark).filter(([, r]) => r === "oor").map(([id]) => id)]);
  const order = T.order.filter((id) => known(id) && onTeam.has(id) && !gone.has(id));
  const off = new Set(Object.entries(mark).filter(([, r]) => r === "bench" || r === "bench_plus").map(([id]) => id));
  const pool = order.filter((id) => !off.has(id)), want = Object.entries(mark).filter(([id, r]) => r === "starter" && pool.includes(id)).map(([id]) => id);
  const conf = T.confirmed ? { ids: T.confirmed.ids.filter((id) => pool.includes(id)), kind: T.confirmed.kind } : null;
  const ch = pageChart(team, order), cv = ch ? chartView(team, ch, pool) : null, tops = cv ? columnTops(cv.view).map((k) => cv.idOf.get(k)) : null; // Adam 11-17: with no pages' five, the chart's top man at each position starts
  const fill = cv && conf ? shortFiveFill(cv.view, new Set(conf.ids.map((id) => keyOfId(T, id)).filter(Boolean))).map((k) => cv.idOf.get(k)) : []; // a short pages' five filled position for position, as the engine does
  const flag = (id) => T.men[id].starter_flag === true, base0 = chooseFive(pool.map((id) => ({ id, starter_flag: flag(id) })), conf, tops, fill), isReal = (id) => (conf?.ids?.length ? conf.ids.includes(id) : tops?.length ? tops.includes(id) : flag(id)); // chooseFive ignores an empty pages' five
  let base = base0;
  if (want.length) { // the real five (pages' or flagged, cut to five) stays and the S-marked men join it; only a short one is filled, S marks taking fill places before the order does
    const real = [...base0.ids].filter(isReal), five0 = new Set([...real, ...want]), fill = pool.filter((id) => !five0.has(id)).slice(0, Math.max(0, 5 - five0.size));
    const took = want.filter((id) => !real.includes(id)).length, cut = base0.note ? base0.note.split("; ").filter((n) => !/ available starters?: \d+ filled/.test(n)) : [];
    const fillNote = fill.length ? `${base0.kind === "expected" ? "TwoGun flags" : "the lineup pages' five names"} ${real.length} available starter${real.length === 1 ? "" : "s"}${took ? `; S marks took ${took} place${took === 1 ? "" : "s"}` : ""}: ${fill.length} filled from the top of tonight's order` : null;
    base = { ...base0, ids: new Set([...five0, ...fill]), note: [...cut, fillNote].filter(Boolean).join("; ") || null };
  }
  const five = new Set([...base.ids, ...want]), notes = [];
  if (five.size > 5) notes.push(`${five.size} starters marked: unmark one.`);
  return { gone, order, five, base, conf, notes, fixed };
}

/**
 * One scenario worked by the engine: { minutes: { id: { min, basis (the engine's why), median: false, tier, flag, label (tiers.js's short basis; kind "typed" or "ov_minutes" for his own number) } }, roles: { id: "starter" | "bench_plus" | "bench" | "oor" }, five: [ids], notes: [text], total_note }.
 * outSet: the scenario's Outs; flips: { id: role } (his marks: starter, bench_plus, bench, oor); typed: { id: minutes } (each replaces that man's figure; nobody else moves, the total is said). A man the engine has no inputs for has no entry
 * (the caller leaves his minutes missing) and is counted in the notes. With `edits` false the marks and typed minutes are ignored (the plain Ours column). His standing minutes override replaces a Starter's or Bench+ man's figure, as figures.js does.
 */
export function tierScenario(team, outSet, flips = {}, typed = {}, edits = false) {
  // his Minutes-page typed minutes count on every source, as the board's engine reads them (figures.js); a number he typed in the Console wins over them (the lead, 11-17)
  const T = team.tier, mark = edits ? flips : {}, page = T.minutes_page?.typed ?? {}, typedNow = { ...page, ...(edits ? typed : {}) };
  const known = (id) => Object.hasOwn(T.men, id);
  const { gone, order, five, base, conf, notes, fixed } = tierFive(team, outSet, mark);
  const ch = pageChart(team, order), cv = ch ? chartView(team, ch, order) : null, places = cv ? depthPlaces(cv.view, new Set([...five].map((id) => keyOfId(T, id)).filter(Boolean))) : null, topKeys = cv ? new Set(columnTops(cv.view)) : null;
  const chartPos = (id) => { const p = ch.posOf.get(keyOfId(T, id)); return p ? [p] : []; }; // Adam 11-17: our chart's position, never DraftKings'
  const outs = [...gone].filter(known).map((id) => ({ name: T.men[id].name, lid: id, positions: ch ? chartPos(id) : T.men[id].positions ?? [], starter: T.men[id].top5 === true, avg: mean(T.men[id].rows), starter_fig: roleFigure(T.men[id].rows.map(([min, s]) => ({ min, started: s === 1 })), "starter", null).value }))
    .concat(fixed.map((o) => ({ ...o, lid: null })));
  const outStarters = outs.filter((o) => o.starter).map((o) => o.name);
  // the lead's fix of 11-17, as the board's planInputs: the healthy chart (tonight's men and the Out men in their places) gives each man his role's bench spot and each Out man the position his minutes go to
  const outKey = (o) => (o.lid ? keyOfId(T, o.lid) : String(o.id ?? "").startsWith("out:") ? String(o.id).slice(4) : null);
  // review round 1, finding 1: the healthy places come from the unfilled chart (the sources and his moves), which tonight's Outs and the pages' five never change; tonight's fill is the view's only
  const healthy = ch ? healthyPlaces(pageChart(team), new Set([...order.map((id) => keyOfId(T, id)), ...outs.map(outKey)].filter(Boolean))) : null, hOf = (k) => healthy.get(k) ?? { pos: null, rank: null, starter: false };
  if (ch) for (const o of outs) { o.healthy = hOf(outKey(o)); o.starter = o.healthy.starter; }
  const playing = team.men.filter((p) => !gone.has(p.id)).map((p) => p.id);
  const noInputs = playing.filter((id) => !known(id));
  if (noInputs.length) notes.push(`${noInputs.length} ${noInputs.length === 1 ? "man has" : "men have"} no minutes engine inputs, so no figure of ours: ${noInputs.map((id) => team.men.find((p) => p.id === id).name).join(", ")}`);
  const typedIn = Object.entries(typedNow).filter(([id, v]) => playing.includes(id) && isNum(v));
  const mkMen = (ids) => ids.map((id) => {
    const m = T.men[id];
    return { id, key: id, chart_rank: Number.isFinite(m.chart_rank) ? m.chart_rank : undefined, replaced: m.replaced ?? null, name: m.name, lid: m.matched ? id : null, off_chart: m.off_chart === true, tg: m.tg, chart_usual: m.chart_usual ?? null, chart_games: m.chart_games ?? null, seen_played: m.seen_played === true, positions: ch ? chartPos(id) : m.positions ?? [], ...(ch ? { depth: { pos: ch.posOf.get(m.key) ?? null, rank: places.get(m.key)?.rank ?? null, idx: places.get(m.key)?.idx ?? null }, chart_top: topKeys.has(m.key), healthy: hOf(m.key) } : {}), in_five: five.has(id), replaces: five.has(id) && !m.top5 ? outStarters : [], last_mpg: m.last_mpg, last_games: m.last_games, last_gs: m.last_gs ?? null,
      last_unknown: m.last_unknown === true, last_missing: m.last_missing === true, out_season: m.out_season, out_recent: m.out_recent, ov: { usual: m.ov?.usual ?? undefined, cap: m.ov?.cap ?? undefined, minutes: m.ov?.minutes ?? undefined, meta: m.ov?.meta ?? {} }, tier_force: FORCE[mark[id]] };
  });
  const why = T.confirmed ? (conf.ids.length ? null : "the lineup pages' five are all Out in this scenario") : T.five_why;
  // Adam 1:33 PM 11-17: typed minutes and standing minutes overrides never enter the plan; the plan is worked as if nothing were typed and his figure is replaced by his number (the board does the same).
  const typedOf = new Map(typedIn), noRow = typedIn.filter(([t]) => !order.includes(t)).map(([t]) => t), listed = (ids, f) => ids.map((id) => f(id)).join(", ");
  if (noRow.length) notes.push(`${listed(noRow, (id) => team.men.find((p) => p.id === id).name)} typed, but has no minutes engine inputs: ${noRow.length === 1 ? "his" : "their"} typed minutes stand and nobody else's minutes move for them`);
  const plan = tierPlan({ men: mkMen(order), rowsOf: (id) => T.men[id].rows.map(([min, s, date]) => ({ min, started: s === 1, date })), games: null, since: T.since, teamGames: T.team_games, benchSpots: T.bench_spots ?? null, outs, boxNote: T.box_note,
    five: { ...base, ids: five, why }, typed: typedOf });
  const minutes = {}, roles = {}, swaps = [];
  for (const id of order) {
    const e = plan.byId.get(id), ov = T.men[id].ov?.minutes, ovm = ovMinutesIn(ov, e), t = typedOf.get(id);
    swaps.push({ name: T.men[id].name, auto: e.auto, typed: t ?? null, ov: ovm });
    roles[id] = ROLE_OF[e.tier];
    if (isNum(t)) { minutes[id] = { min: t, basis: "typed", median: false, tier: e.tier, flag: e.flag, label: { kind: "typed", value: t, spot: e.label?.spot ?? null } }; continue; } // review round 2, finding 7: only his minutes are replaced, as on the board; review round 1 (depth chart), finding 10: the engine's bench spot rides along, so a typed man keeps his bench place
    if (isNum(ov) && e.tier !== "bench" && e.minutes_gate?.ok === false) { minutes[id] = { min: e.auto, basis: `${e.why}; your standing minutes override (${ov}) is not used: ${e.minutes_gate.text}`, median: false, tier: e.tier, flag: e.flag, label: e.label }; continue; }
    if (ovm !== null) { minutes[id] = { min: ovm, basis: `${e.why}; your standing minutes override: ${ovm} minutes (computed ${isNum(e.auto) ? Math.round(e.auto * 10) / 10 : "missing"})`, median: false, tier: e.tier, flag: e.flag, label: { kind: "ov_minutes", value: ovm, limit: e.label?.limit ?? null, spot: e.label?.spot ?? null } }; continue; }
    minutes[id] = { min: e.auto, basis: e.why, median: false, tier: e.tier, flag: e.flag, label: e.label };
  }
  for (const id of typedIn.map(([t]) => t).filter((t) => !minutes[t])) { minutes[id] = { min: typedNow[id], basis: "typed", median: false, tier: null, flag: null, label: { kind: "typed", value: typedNow[id] } }; roles[id] = mark[id] ?? "bench"; swaps.push({ name: team.men.find((p) => p.id === id)?.name ?? id, auto: null, typed: typedNow[id], ov: null }); }
  const totalNote = typedTotalNote(swaps);
  if (totalNote) notes.push(totalNote);
  for (const id of gone) if (!known(id) || !order.includes(id)) roles[id] = outSet.has(id) ? "out" : "oor";
  const named = fixed.length ? [`${fixed.length} Out ${fixed.length === 1 ? "man has" : "men have"} no row in the console and stay${fixed.length === 1 ? "s" : ""} Out: ${fixed.map((o) => o.name).join(", ")}`] : [];
  return { minutes, roles, five: [...five], notes: [...plan.notes, ...T.notes, ...notes, ...named], total_note: totalNote ?? plan.notes.find((n) => /minutes are not given|short of|over 240/.test(n)) ?? null, tier_of: ROLE_OF_TIER };
}
