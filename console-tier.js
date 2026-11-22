// The console's minutes (Adam 11-12: one minutes model): the tier engine (tiers.js, the same pure code server/minutes runs for the board) on a scenario's Outs, marks and typed minutes. Pure ES module shared by the page
// and the server. The inputs carry, per team, `tier` (server/minutes/tier-inputs.js): each man's role games, TwoGun's figure and flags, his standing overrides, tonight's order and the lineup pages' five, so any
// scenario is worked here with no call to the server (tests/minutes_parity.test.mjs holds this equal to the board's engine). Roles are the engine's: Starter (the five), Bench+, Bench; Out of rotation is his mark.
// A man he marked S joins the five (six or more marked all start, said); Bench+ or Bench forces that tier.
// Typed minutes (Adam 1:33 PM 11-17, as on the board): the plan is worked as if nothing were typed, then a typed man's figure, or a standing minutes override in force, is simply replaced by his number;
// nobody else moves for it, so the team may come to more or less than 240, said plainly (tiers.js typedTotalNote). Outs and his marks still redistribute.
import { roleFigure, tierPlan, ovMinutesIn, typedTotalNote, ROLE_OF_TIER } from "./tiers.js";
import { fiveWithMarks, realFive, starterFig, marksNote, markOut, newsFlips, newsFlipTimes } from "./role-marks.js";
import { typedVerdicts, unstampedNote, heldNote } from "./typed-aside.js";
import { isNum } from "./figures.js";
import { chartCols, tonightCols, columnTops, depthPlaces, healthyPlaces, fillEmpty, balanceFive, shortFiveFill } from "./depth-cols.js";

/** The team's depth chart on the page (Adam 11-17): the payload's seed with his moves (the page's own live list, team.depth_moves, else the saved one), as the engine builds it (depth-cols.js); null without one. five (ids): balanced for display (balanceFive). */
export function pageChart(team, ids = null, five = null) {
  const D = team.tier?.depth;
  if (!D) return null;
  const ch = chartCols(D.seed, Array.isArray(team.depth_moves) ? team.depth_moves : D.moves);
  if (!ids) return ch;
  // no empty column tonight (the lead, 11-17), as the engine fills it (depth-view.js): over tonight's playing men, guided by the pages' five the engine read
  const present = new Set(ids.map((id) => keyOfId(team.tier, id)).filter(Boolean)), alts = Object.fromEntries(Object.entries(D.votes ?? {}).map(([k, v]) => [k, v.alts])), nameOf = (k) => D.names?.[k] ?? k;
  const f = fillEmpty(ch, present, alts, new Set(D.likely ?? []), nameOf);
  if (!five) return Object.assign(f.chart, { fills: f.fills });
  // one starter at every position (Adam 6:26 PM 11-18), for the chart's display only (review of 11-18, finding 1): the five, every role and every minute come from the chart above, never from this
  const b = balanceFive(f.chart, present, new Set([...five].map((id) => keyOfId(team.tier, id)).filter(Boolean)), alts, nameOf);
  return Object.assign(b.chart, { fills: f.fills, shifts: b.shifts, blocked: b.blocked });
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
 * Tonight's five on a scenario, with no plan run: { gone, order, five: Set of ids, base (chooseFive's), conf, notes, fixed, claims (role-marks.js trimToFive's: whom each Starter call on a full five benched) }. The pages' five without the men gone, else TwoGun's flags; a man he marked off the five leaves it,
 * a man marked S joins it and takes a fill place first (so a swap or bench-then-S never gives six: six comes only from S marks on top of a real five).
 */
export function tierFive(team, outSet, markIn = {}) {
  const T = team.tier, known = (id) => Object.hasOwn(T.men, id), onTeam = new Set(team.men.map((p) => p.id)), mark = withStanding(team, markIn);
  const fixed = (T.base_outs ?? []).filter((o) => !onTeam.has(o.id)); // Out men the console has no row for: Out in every scenario, named
  const gone = new Set([...outSet, ...Object.entries(mark).filter(([, r]) => r === "oor").map(([id]) => id)]);
  const order = T.order.filter((id) => known(id) && onTeam.has(id) && !gone.has(id));
  const off = new Set(Object.entries(mark).filter(([, r]) => r === "bench" || r === "bench_plus").map(([id]) => id));
  const pool = order.filter((id) => !off.has(id)), want = Object.entries(mark).filter(([id, r]) => r === "starter" && pool.includes(id)).map(([id]) => id);
  const conf = T.confirmed ? { ids: T.confirmed.ids.filter((id) => pool.includes(id)), kind: T.confirmed.kind } : null;
  const ch = pageChart(team, order), cv = ch ? chartView(team, ch, pool) : null, tops = cv ? columnTops(cv.view).map((k) => cv.idOf.get(k)) : null; // Adam 11-17: with no pages' five, the chart's top man at each position starts
  const fill = cv && conf ? shortFiveFill(cv.view, new Set(conf.ids.map((id) => keyOfId(T, id)).filter(Boolean))).map((k) => cv.idOf.get(k)) : []; // a short pages' five filled position for position, as the engine does
  // a mark that moved the five is said in the plan's notes, as the board says it: against the five he would have had (the pages', else the chart's tops over tonight's men, else TwoGun's flags)
  const cvAll = ch ? chartView(team, ch, order) : null, allTops = cvAll ? columnTops(cvAll.view).map((k) => cvAll.idOf.get(k)).filter(Boolean) : null;
  const standing = team.role_marks ?? T.role_marks ?? {}, news = newsFlips(team.news, mark), his = Object.fromEntries(Object.entries(mark).filter(([id, r]) => !(news[id] === r && standing[id] !== r))); // the note names his own marks only, never the news's calls
  const flag = (id) => T.men[id].starter_flag === true, fv = fiveWithMarks({ pool, conf, tops, fill, flag, want, realIds: realFive({ order, conf: T.confirmed, tops: allTops, flag }),
    posOf: (id) => (ch ? ch.posOf.get(keyOfId(T, id)) ?? null : null), figOf: (id) => starterFig(T.men[id].rows.map(([min, s]) => ({ min, started: s === 1 ? true : s === 0 ? false : null }))), nameOf: (id) => T.men[id]?.name ?? id,
    whoseOf: (id) => (his[id] === "starter" ? "Your Starter mark" : "The lineup news's Starter call"), ...pickLook(team, mark, standing, his) }); // role-marks.js: the one rule the board's engine runs too (personal-view.js markedFive); the five before any mark
  const real = T.confirmed?.ids?.length ? T.confirmed.ids : allTops ?? order.filter(flag), mnote = marksNote(his, real, fv.five, (id) => T.men[id]?.name ?? id);
  const base = mnote ? { ...fv.base, note: [fv.base.note, mnote].filter(Boolean).join("; ") } : fv.base;
  return { gone, order, five: fv.five, base, conf, notes: fv.notes, fixed, claims: fv.claims };
}
/** His picks of whom a Starter mark replaces (the page's live list team.role_picks beside the page's marks, else the inputs'; role-marks.js picksById) for fiveWithMarks: pickOf on his own standing Starter marks only,
 *  pickAtOf (ms: when his pick was made, its own time, never the mark's (the review of 11-21, money): a pick that differs from the inputs' was made on this page, its page stamp (team.pick_at, console-moves.js
 *  stampFlips), else Infinity; else the inputs' role_picks_at), callAtOf (ms: when the Starter call in force on a man was made, his standing mark's where it stands, else the flip's; callTimes), nameOf for a
 *  picked man with no engine inputs (the chart's names). mark: the calls in force. */
function pickLook(team, mark, standing, his) {
  const T = team.tier, picks = (team.role_marks ? team.role_picks : T.role_picks) ?? {}, saved = T.role_picks ?? {}, t = callTimes(team, mark), ms = (iso) => Date.parse(iso ?? "");
  const pickAtOf = (id) => ((picks[id] ?? null) !== (saved[id] ?? null) ? (Number.isFinite(ms(team.pick_at?.[id])) ? ms(team.pick_at[id]) : Infinity) : later(ms(team.pick_at?.[id]), ms(T.role_picks_at?.[id]))); // equal to the inputs': the later of the page's stamp and the saved time (changed away and back before a read, the server stamped it again)
  return { pickOf: (id) => (standing[id] === "starter" && his[id] === "starter" ? picks[id] ?? null : null), pickAtOf, callAtOf: (id) => (Object.hasOwn(standing, id) && standing[id] === mark[id] ? t.markAt(id) : t.flipAt(id)), nameOf: (id) => T.men[id]?.name ?? T.depth?.names?.[id] ?? id };
}
/**
 * His Minutes-page typed numbers (T.minutes_page, stamped by their log) judged against the plan's roles (typed-aside.js), the men with a Console number (kept or set aside, consoleIds) left out, so setting a
 * Console number aside never revives an older Minutes-page one (the money review of 11-20, finding 7): { kept, aside, unstamped, held }.
 */
function pageVerdicts(team, plan, consoleIds, flips, order) {
  const T = team.tier, mp = T.minutes_page ?? {}, block = new Set(consoleIds);
  const typed = Object.fromEntries(Object.entries(mp.typed ?? {}).filter(([id, v]) => isNum(v) && order.includes(id) && !block.has(id)));
  return typedVerdicts(typed, { stampOf: (id) => mp.stamps?.[id], roleOf: (id) => plan.byId.get(id)?.tier ?? null, nameOf: (id) => T.men[id]?.name ?? id, changeOf: (id) => changeOn(team, flips, id),
    planHas: (id) => isNum(plan.byId.get(id)?.auto) });
}

/**
 * When the calls on a man were made (the money review of 11-20, findings 4 and 5): flipAt(id) (ms: the news entry's time for a news flip, else the flip's stamp in this scenario, team.scenario_key; NaN unknown),
 * markAt(id) (ms: his standing mark's time; for a mark made on this page since its inputs were read, the page's own stamp of it (team.mark_at, console-moves.js stampFlips), else Infinity; NaN unknown), byNews(id).
 * flips: { id: role }.
 */
/** The later of two times in ms, either NaN (unknown): the known one; NaN when neither is. */
const later = (a, b) => (Number.isFinite(a) ? (Number.isFinite(b) ? Math.max(a, b) : a) : b);
export function callTimes(team, flips = {}) {
  const T = team.tier ?? {}, newsAt = newsFlipTimes(team.news, flips), page = team.role_marks, saved = T.role_marks ?? {};
  return {
    flipAt: (id) => Date.parse(newsAt[id] ?? team.stamps?.r?.[team.scenario_key ?? ""]?.[id] ?? ""),
    markAt: (id) => (page && Object.hasOwn(page, id) && page[id] !== saved[id] ? (Number.isFinite(Date.parse(team.mark_at?.[id] ?? "")) ? Date.parse(team.mark_at[id]) : Infinity) : later(Date.parse(team.mark_at?.[id] ?? ""), Date.parse(T.role_marks_at?.[id] ?? ""))), // equal to the inputs': the later of the page's stamp and the saved time (the review of 11-21)
    byNews: (id) => Object.hasOwn(newsAt, id),
  };
}
/** Whether a flip reads over his standing mark: the strictly newer call wins (Adam 7:28 PM 11-19), read from the stamps, never from the order the files were written; at the same time the mark does, as on the
 *  board (role-marks.js withNewsRoles); the page's own steps never share a time (console-moves.js stepStamp). A page mark with no stamp wins; with either time unknown the flip does, as before the stamps.
 *  Out of rotation is not a tier and always stands (console-moves.js dropFlipsOf keeps it). */
export const flipWins = (t, id, role) => role === "oor" || (t.markAt(id) !== Infinity && (!Number.isFinite(t.markAt(id)) || !Number.isFinite(t.flipAt(id)) || t.flipAt(id) > t.markAt(id)));
/** The newest call in force on a man, for typed-aside.js typedDecision: { at, by } or null (a mark made on this page since its inputs: no time, so the side change decides, finding 5). */
export function changeOn(team, flips, id) {
  const t = callTimes(team, flips), standing = team.role_marks ?? team.tier?.role_marks ?? {};
  if (Object.hasOwn(flips, id) && (!Object.hasOwn(standing, id) || flipWins(t, id, flips[id]))) { const f = t.flipAt(id); return Number.isFinite(f) ? { at: new Date(f).toISOString(), by: t.byNews(id) ? "news" : "you" } : null; }
  const m = t.markAt(id);
  return Object.hasOwn(standing, id) && Number.isFinite(m) ? { at: new Date(m).toISOString(), by: "you" } : null;
}
/** His standing role marks (the payload's, else the page's live list on the team) under the per-night flips `mark`: a flip reads over a standing mark only when it is the newer call (flipWins). */
export function withStanding(team, mark = {}) {
  const standing = team.role_marks ?? team.tier?.role_marks ?? {};
  if (!Object.keys(standing).length) return mark;
  const t = callTimes(team, mark), out = { ...standing };
  for (const [id, role] of Object.entries(mark)) if (!Object.hasOwn(standing, id) || standing[id] === role || flipWins(t, id, role)) out[id] = role;
  return out;
}
/**
 * One scenario worked by the engine: { minutes: { id: { min, basis (the engine's why), median: false, tier, flag, label (tiers.js's short basis; kind "typed" or "ov_minutes" for his own number) } }, roles: { id: "starter" | "bench_plus" | "bench" | "oor" }, five: [ids], notes: [text], total_note }.
 * outSet: the scenario's Outs; flips: { id: role } (his marks: starter, bench_plus, bench, oor); typed: { id: minutes } (each replaces that man's figure; nobody else moves, the total is said). A man the engine has no inputs for has no entry
 * (the caller leaves his minutes missing) and is counted in the notes. With `edits` false his flips and typed minutes are ignored (the plain Ours column), but the lineup news's own flips (role-marks.js newsFlips over team.news) still count. His standing minutes override replaces any man's figure, Bench included, as figures.js does; his standing role marks (role-marks.js) always count.
 */
export function tierScenario(team, outSet, flips = {}, typed = {}, edits = false, consoleIds = null) { // consoleIds: every man with a Console number on this scenario, kept or set aside (pageVerdicts)
  // his Minutes-page typed minutes count on every source, as the board's engine reads them (figures.js); a number he typed in the Console wins over them (the lead, 11-17)
  // his standing marks always count, as on the board (Adam 10:25 AM 11-18); without his edits the lineup news's own flips still count, as the board's engine reads them, so the whole team is built on the five they make (Adam 9:30 AM 11-20)
  const block = new Set(consoleIds ?? Object.keys(edits ? typed : {})); // a man with a Console number, kept or set aside, never takes his Minutes-page number (the money review of 11-20, finding 7)
  const T = team.tier, byNews = newsFlips(team.news, flips), mark = withStanding(team, edits ? flips : byNews), page = Object.fromEntries(Object.entries(T.minutes_page?.typed ?? {}).filter(([id]) => !block.has(id))), typedNow = { ...page, ...(edits ? typed : {}) };
  const known = (id) => Object.hasOwn(T.men, id);
  const { gone, order, five, base, conf, notes, fixed } = tierFive(team, outSet, mark);
  const ch = pageChart(team, order), cv = ch ? chartView(team, ch, order) : null, places = cv ? depthPlaces(cv.view, new Set([...five].map((id) => keyOfId(T, id)).filter(Boolean))) : null, topKeys = cv ? new Set(columnTops(cv.view)) : null;
  const chartPos = (id) => { const p = ch.posOf.get(keyOfId(T, id)); return p ? [p] : []; }; // Adam 11-17: our chart's position, never DraftKings'
  const outs = [...gone].filter(known).map((id) => ({ name: T.men[id].name, lid: id, positions: ch ? chartPos(id) : T.men[id].positions ?? [], starter: T.men[id].top5 === true, avg: mean(T.men[id].rows), starter_fig: roleFigure(T.men[id].rows.map(([min, s]) => ({ min, started: s === 1 })), "starter", null).value }))
    .concat(fixed.map((o) => ({ ...o, lid: null })));
  // the lead's fix of 11-17, as the board's planInputs: the healthy chart (tonight's men and the Out men in their places) gives each man his role's bench spot and each Out man the position his minutes go to
  const outKey = (o) => (o.lid ? keyOfId(T, o.lid) : String(o.id ?? "").startsWith("out:") ? String(o.id).slice(4) : null);
  // review round 1, finding 1: the healthy places come from the unfilled chart (the sources and his moves), which tonight's Outs and the pages' five never change; tonight's fill is the view's only
  const healthy = ch ? healthyPlaces(pageChart(team), new Set([...order.map((id) => keyOfId(T, id)), ...outs.map(outKey)].filter(Boolean))) : null, hOf = (k) => healthy.get(k) ?? { pos: null, rank: null, starter: false };
  if (ch) for (const o of outs) { o.healthy = hOf(outKey(o)); o.starter = o.healthy.starter; }
  const standing = team.role_marks ?? T.role_marks ?? {};
  for (const o of outs) markOut(o, o.lid ? standing[o.lid] : o.mark); // his standing mark sets the Out man's role, as on the board (a base Out carries it from the payload)
  const outStarters = outs.filter((o) => o.starter).map((o) => o.name); // after his marks, as the board's planInputs
  const playing = team.men.filter((p) => !gone.has(p.id)).map((p) => p.id);
  const noInputs = playing.filter((id) => !known(id));
  if (noInputs.length) notes.push(`${noInputs.length} ${noInputs.length === 1 ? "man has" : "men have"} no minutes engine inputs, so no figure of ours: ${noInputs.map((id) => team.men.find((p) => p.id === id).name).join(", ")}`);
  const typedIn = Object.entries(typedNow).filter(([id, v]) => playing.includes(id) && isNum(v));
  const mkMen = (ids) => ids.map((id) => {
    const m = T.men[id];
    return { id, key: id, chart_rank: Number.isFinite(m.chart_rank) ? m.chart_rank : undefined, replaced: m.replaced ?? null, name: m.name, lid: m.matched ? id : null, off_chart: m.off_chart === true, tg: m.tg, chart_usual: m.chart_usual ?? null, chart_games: m.chart_games ?? null, seen_played: m.seen_played === true, positions: ch ? chartPos(id) : m.positions ?? [], ...(ch ? { depth: { pos: ch.posOf.get(m.key) ?? null, rank: places.get(m.key)?.rank ?? null, idx: places.get(m.key)?.idx ?? null }, chart_top: topKeys.has(m.key), healthy: hOf(m.key) } : {}), starter_flag: m.starter_flag === true, in_five: five.has(id), top5: m.top5 === true, put_in: m.put_in === true || (m.feed_out === true && !gone.has(id)) /* a man our feeds have Out playing in this scenario is put back In, as on the board */, replaces: five.has(id) && !m.top5 ? outStarters : [], last_mpg: m.last_mpg, last_games: m.last_games, last_gs: m.last_gs ?? null,
      last_unknown: m.last_unknown === true, last_missing: m.last_missing === true, out_season: m.out_season, out_recent: m.out_recent, ov: { usual: m.ov?.usual ?? undefined, cap: m.ov?.cap ?? undefined, minutes: m.ov?.minutes ?? undefined, meta: m.ov?.meta ?? {} }, mr: m.mr ?? null, tier_force: FORCE[mark[id]], tier_force_by: FORCE[mark[id]] && Object.hasOwn(byNews, id) && mark[id] === byNews[id] && (team.role_marks ?? T.role_marks ?? {})[id] !== byNews[id] ? "news" : undefined }; // the news's call only where it won over his mark
  });
  const why = T.confirmed ? (conf.ids.length ? null : "the lineup pages' five are all Out in this scenario") : T.five_why;
  // Adam 1:33 PM 11-17: typed minutes and standing minutes overrides never enter the plan; the plan is worked as if nothing were typed and his figure is replaced by his number (the board does the same).
  const typedOf = new Map(typedIn), noRow = typedIn.filter(([t]) => !order.includes(t)).map(([t]) => t), listed = (ids, f) => ids.map((id) => f(id)).join(", ");
  if (noRow.length) notes.push(`${listed(noRow, (id) => team.men.find((p) => p.id === id).name)} typed, but has no minutes engine inputs: ${noRow.length === 1 ? "his" : "their"} typed minutes stand and nobody else's minutes move for them`);
  const plan = tierPlan({ men: mkMen(order), rowsOf: (id) => T.men[id].rows.map(([min, s, date]) => ({ min, started: s === 1 ? true : s === 0 ? false : null, date })), games: null, since: T.since, teamGames: T.team_games, benchSpots: T.bench_spots ?? null, benchPlusStd: T.bench_plus_std ?? null, outs, boxNote: T.box_note,
    five: { ...base, ids: five, why }, typed: typedOf });
  const pv = pageVerdicts(team, plan, [...block], flips, order), unst = unstampedNote(pv.unstamped), held = heldNote(pv.held); // Adam 9:46 AM 11-20: his Minutes-page numbers a later role change set aside, as the board's engine judges them
  for (const id of Object.keys(pv.aside)) typedOf.delete(id);
  if (unst) notes.push(unst);
  if (held) notes.push(held);
  const minutes = {}, roles = {}, swaps = [];
  for (const id of order) {
    const e = plan.byId.get(id), ov = T.men[id].ov?.minutes, ovm = ovMinutesIn(ov, e), t = typedOf.get(id);
    swaps.push({ name: T.men[id].name, auto: e.auto, typed: t ?? null, ov: ovm });
    roles[id] = ROLE_OF[e.tier];
    if (isNum(t)) { minutes[id] = { min: t, basis: "typed", median: false, tier: e.tier, flag: e.flag, label: { kind: "typed", value: t, spot: e.label?.spot ?? null } }; continue; } // review round 2, finding 7: only his minutes are replaced, as on the board; review round 1 (depth chart), finding 10: the engine's bench spot rides along, so a typed man keeps his bench place
    if (isNum(ov) && e.minutes_gate?.ok === false) { minutes[id] = { min: e.auto, basis: `${e.why}; your standing minutes override (${ov}) is not used: ${e.minutes_gate.text}`, median: false, tier: e.tier, flag: e.flag, label: e.label }; continue; }
    if (ovm !== null) { minutes[id] = { min: ovm, basis: `${e.why}; your standing minutes override: ${ovm} minutes (computed ${isNum(e.auto) ? Math.round(e.auto * 10) / 10 : "missing"})`, median: false, tier: e.tier, flag: e.flag, label: { kind: "ov_minutes", value: ovm, limit: e.label?.limit ?? null, spot: e.label?.spot ?? null } }; continue; }
    minutes[id] = { min: e.auto, basis: e.why, median: false, tier: e.tier, flag: e.flag, label: e.label };
  }
  for (const id of typedIn.map(([t]) => t).filter((t) => !minutes[t])) { minutes[id] = { min: typedNow[id], basis: "typed", median: false, tier: null, flag: null, label: { kind: "typed", value: typedNow[id] } }; roles[id] = mark[id] ?? "bench"; swaps.push({ name: team.men.find((p) => p.id === id)?.name ?? id, auto: null, typed: typedNow[id], ov: null }); }
  for (const [id, a] of Object.entries(pv.aside)) if (minutes[id]) minutes[id] = { ...minutes[id], aside: { ...a, src: "page" }, basis: `${minutes[id].basis}; your Minutes-page ${a.words.slice(5)}` }; // src: restored on the Minutes route (console.js restoreRow)
  const totalNote = typedTotalNote(swaps);
  if (totalNote) notes.push(totalNote);
  for (const id of gone) if (!known(id) || !order.includes(id)) roles[id] = outSet.has(id) ? "out" : "oor";
  const named = fixed.length ? [`${fixed.length} Out ${fixed.length === 1 ? "man has" : "men have"} no row in the console and stay${fixed.length === 1 ? "s" : ""} Out: ${fixed.map((o) => o.name).join(", ")}`] : [];
  return { minutes, roles, five: [...five], notes: [...plan.notes, ...T.notes, ...notes, ...named], total_note: totalNote ?? plan.notes.find((n) => /minutes are not given|short of|over 240/.test(n)) ?? null, tier_of: ROLE_OF_TIER };
}
