// The console's minutes (Adam 11-12: one minutes model): the tier engine (tiers.js, the same pure code server/minutes runs for the board) on a scenario's Outs, marks and typed minutes. Pure ES module shared by the page
// and the server. The inputs carry, per team, `tier` (server/minutes/tier-inputs.js): each man's role games, TwoGun's figure and flags, his standing overrides, tonight's order and the lineup pages' five, so any
// scenario is worked here with no call to the server (tests/minutes_parity.test.mjs holds this equal to the board's engine). Roles are the engine's: Starter (the five), Bench+, Bench; Out of rotation is his mark.
// A man he marked S joins the five (six or more marked all start, said); Bench+ or Bench forces that tier.
import { chooseFive, tierPlan, ROLE_OF_TIER } from "./tiers.js";
import { isNum } from "./figures.js";

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
 * One scenario worked by the engine: { minutes: { id: { min, basis (the engine's why), median: false, tier, flag } }, roles: { id: "starter" | "bench_plus" | "bench" | "oor" }, five: [ids], notes: [text], total_note }.
 * outSet: the scenario's Outs; flips: { id: role } (his marks: starter, bench_plus, bench, oor); typed: { id: minutes } (taken off the 240, the rest shared around them). A man the engine has no inputs for has no entry
 * (the caller leaves his minutes missing) and is counted in the notes. With `edits` false the marks and typed minutes are ignored (the plain Ours column). His standing minutes override replaces a Starter's or Bench+ man's figure, as figures.js does.
 */
export function tierScenario(team, outSet, flips = {}, typed = {}, edits = false) {
  const T = team.tier, mark = edits ? flips : {}, typedNow = edits ? typed : {};
  const known = (id) => Object.hasOwn(T.men, id), onTeam = new Set(team.men.map((p) => p.id));
  const fixed = (T.base_outs ?? []).filter((o) => !onTeam.has(o.id)); // Out men the console has no row for: Out in every scenario, named
  const gone = new Set([...outSet, ...Object.entries(mark).filter(([, r]) => r === "oor").map(([id]) => id)]);
  const order = T.order.filter((id) => known(id) && onTeam.has(id) && !gone.has(id));
  // the five: the pages' five without the men gone, else TwoGun's flags; a man he marked off the five leaves it, a man marked S joins it
  const off = new Set(Object.entries(mark).filter(([, r]) => r === "bench" || r === "bench_plus").map(([id]) => id));
  const pool = order.filter((id) => !off.has(id)), want = Object.entries(mark).filter(([id, r]) => r === "starter" && pool.includes(id)).map(([id]) => id);
  const conf = T.confirmed ? { ids: T.confirmed.ids.filter((id) => pool.includes(id)), kind: T.confirmed.kind } : null;
  const base = chooseFive(pool.map((id) => ({ id, starter_flag: T.men[id].starter_flag === true })), conf);
  const five = new Set([...base.ids, ...want]), notes = [];
  if (five.size > 5) notes.push(`${five.size} starters marked: unmark one.`);
  const outs = [...gone].filter(known).map((id) => ({ name: T.men[id].name, lid: id, positions: T.men[id].positions ?? [], starter: T.men[id].top5 === true, avg: mean(T.men[id].rows) }))
    .concat(fixed.map((o) => ({ ...o, lid: null })));
  const outStarters = outs.filter((o) => o.starter).map((o) => o.name);
  const playing = team.men.filter((p) => !gone.has(p.id)).map((p) => p.id);
  const noInputs = playing.filter((id) => !known(id));
  if (noInputs.length) notes.push(`${noInputs.length} ${noInputs.length === 1 ? "man has" : "men have"} no minutes engine inputs, so no figure of ours: ${noInputs.map((id) => team.men.find((p) => p.id === id).name).join(", ")}`);
  const typedIn = Object.entries(typedNow).filter(([id, v]) => playing.includes(id) && isNum(v));
  const men = order.filter((id) => !typedIn.some(([t]) => t === id)).map((id) => {
    const m = T.men[id];
    return { id, key: id, name: m.name, lid: m.matched ? id : null, tg: m.tg, chart_usual: m.chart_usual ?? null, chart_games: m.chart_games ?? null, seen_played: m.seen_played === true, positions: m.positions ?? [], in_five: five.has(id), replaces: five.has(id) && !m.top5 ? outStarters : [], last_mpg: m.last_mpg, last_games: m.last_games,
      last_unknown: m.last_unknown === true, last_missing: m.last_missing === true, out_season: m.out_season, out_recent: m.out_recent, ov: { usual: m.ov?.usual ?? undefined, cap: m.ov?.cap ?? undefined, minutes: m.ov?.minutes ?? undefined, meta: m.ov?.meta ?? {} }, tier_force: FORCE[mark[id]] };
  });
  const typedSum = typedIn.reduce((s, [, v]) => s + v, 0);
  const why = T.confirmed ? (conf.ids.length ? null : "the lineup pages' five are all Out in this scenario") : T.five_why;
  const plan = tierPlan({ men, rowsOf: (id) => T.men[id].rows.map(([min, s, date]) => ({ min, started: s === 1, date })), games: null, since: T.since, teamGames: T.team_games, outs, boxNote: T.box_note,
    five: { ...base, ids: five, why }, teamMinutes: Math.max(0, 240 - typedSum) });
  const minutes = {}, roles = {};
  for (const id of order) {
    const typedMin = typedIn.find(([t]) => t === id);
    if (typedMin) { minutes[id] = { min: typedMin[1], basis: "typed", median: false, tier: five.has(id) ? "starter" : null, flag: null }; roles[id] = five.has(id) ? "starter" : mark[id] ?? "bench"; continue; }
    const e = plan.byId.get(id), ov = T.men[id].ov?.minutes;
    roles[id] = ROLE_OF[e.tier];
    if (isNum(ov) && e.tier !== "bench" && e.minutes_gate?.ok === false) { minutes[id] = { min: e.auto, basis: `${e.why}; your standing minutes override (${ov}) is not used: ${e.minutes_gate.text}`, median: false, tier: e.tier, flag: e.flag }; continue; }
    if (isNum(ov) && e.tier !== "bench") { minutes[id] = { min: ov, basis: `${e.why}; your standing minutes override: ${ov} minutes (computed ${isNum(e.auto) ? Math.round(e.auto * 10) / 10 : "missing"})`, median: false, tier: e.tier, flag: e.flag }; continue; }
    minutes[id] = { min: e.auto, basis: e.why, median: false, tier: e.tier, flag: e.flag };
  }
  for (const id of typedIn.map(([t]) => t).filter((t) => !minutes[t])) { minutes[id] = { min: typed[id], basis: "typed", median: false, tier: null, flag: null }; roles[id] = mark[id] ?? "bench"; }
  for (const id of gone) if (!known(id) || !order.includes(id)) roles[id] = outSet.has(id) ? "out" : "oor";
  const named = fixed.length ? [`${fixed.length} Out ${fixed.length === 1 ? "man has" : "men have"} no row in the console and stay${fixed.length === 1 ? "s" : ""} Out: ${fixed.map((o) => o.name).join(", ")}`] : [];
  return { minutes, roles, five: [...five], notes: [...plan.notes, ...T.notes, ...notes, ...named], total_note: plan.notes.find((n) => /minutes are not given|short of|over 240/.test(n)) ?? null, tier_of: ROLE_OF_TIER };
}
