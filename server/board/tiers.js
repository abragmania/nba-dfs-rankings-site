// Our minutes engine's team plan (Adam 11-12 tiers; Adam 11-17 11:40-11:58 AM: role minutes, a 36-minute cap, every team to 240), pure; tests/minutes_tiers.test.mjs on frozen fixtures.
//  1. Five: tonight's five (the lineup pages' confirmed or agreed five, else TwoGun's starter flags on the board, said "expected"; a short five is filled from tonight's order).
//     Tiers stay as labels: Starter (the five); Bench+ (at least BENCH_PLUS_AVG minutes, overtime-scaled, in at least BENCH_PLUS_GAMES of the team's last RECENT_GAMES games, Adam 11-12); Bench (everyone else).
//  2. Starter: his own mean as a starter this season (overtime-scaled), any number of starts; no share of the Out men's minutes. A starter with NO starts (Adam 1:19 PM 11-17, option B): the starter figure, the
//     mean of all his starts, of the Out starter at his DraftKings position he replaced (pairReplaced; Adam 1:20 PM: the man whose slot he took, m.replaced, only when they share a position; each Out starter
//     taken once); no Out starter at his position, or that man with no starts either: the team's median starter figure;
//     his row carries the mark (flag "no_starts_starter"). Degraded, with neither: his own season mean (no game: the chart's usual), else TwoGun's number, flagged. That figure is his FLOOR: no later step takes
//     him below it, except a cap override at or below it. A typed figure or standing minutes override replaces his figure after the plan and moves nobody else (Adam 1:33 PM 11-17; typedTotalNote says the total).
//  2b. Kept from Adam 11-13: a man with NO played game this season, matched to the box scores and Out most of the team's games (CHART_NEEDS_OUT_MOST), whose depth chart carries a usual above 0 takes that usual
//     (source "chart", flag "no_games_chart"), only when last season's majority role (m.last_gs of m.last_games) is tonight's role, or last season's role is unknown (said). Otherwise said on his row.
//  3. Bench (tonight's playing men not in the five), Adam 12:45 PM 11-17: a man's ROLE is his place on tonight's depth chart (m.chart_rank: the standing chart with Adam's moves, Out men removed, everyone below moving up; never the rotation step's re-rank, review round 1, finding 7), a man with no game
//     this season and a returning man included. Only men the chart does not place (m.off_chart) go after the charted men, among themselves by minutes per game played in the team's last RECENT_GAMES games
//     (overtime-scaled); off the chart with no game this season: last, named in the team's notes to check. The Nth takes the
//     team's BENCH-SPOT figure N (team-fill.js benchSpots). Pure role: his own mean does not set it. Retired 11-17: a returning man's own bench figure and its cut of
//     his position's bench (coverReturns); his returning words stay on his row. With no team game on file the bench keeps each man's own bench mean (a man with no game: his chart's usual where 2b allows it), else
//     TwoGun's number (said).
//  4. Cap: nobody above MINUTES_CAP, except a starter whose own starter mean is above it (he keeps it). A standing usual override is his figure as set (his cap rises to it); a standing cap override is his cap and he
//     is "limited" (no fill). Overrides apply only in the role they were set for (ovGate).
//  5. Team total (team-fill.js fillTeam): under 240, spread in proportion over the men under the cap, then rounds of +1 to starters then bench (the last pro-rated); over 240, the bench trimmed in proportion,
//     then starters above their floors. Every step is said in the man's why and the team's notes; what nobody can take or give is named (G62).
//  TwoGun-far-lower flag (Adam 2:00 PM 11-17: never called a limit): TwoGun far below our figure (FAR_BELOW share and FAR_BELOW_MIN minutes) marks the row; both are shown, ours stands.
// RECENT_GAMES, BENCH_PLUS_*, FAR_BELOW* are working values Adam may tune. Typed minutes and standing minutes overrides are applied after this (figures.js), never rescaled.
import { isNum } from "./figures.js";
import { MINUTES_CAP, GAME_MAX, benchSpots as spotsOf, shareOut, fillTeam, ordinal } from "./team-fill.js";

export { shareOut, MINUTES_CAP };

const GAME_MINUTES = 240; // no import from tools/: the console page runs this file in the browser (server/board is what the page can load)
/** Whether the chart's usual stands in only for a man Out most of the team's games. true is the lead's pick, 11-13, because Adam deferred the scope; false: any matched man with no game this season. */
export const CHART_NEEDS_OUT_MOST = true;
export const RETURN_LAST_GAMES = 20; // a returning rotation man needs this many games last season (a working value)
export const RECENT_GAMES = 10;
export const BENCH_PLUS_GAMES = 6;
export const BENCH_PLUS_AVG = 15; // minutes in a game for it to count toward Bench+ (and the returning man's mean)
export const CEILING_QUANTILE = 0.75;
export const CEILING_MIN_GAMES = 4;
export const FAR_BELOW = 0.4;
export const FAR_BELOW_MIN = 8;
const EPS = 1e-9;
const r1 = (v) => Math.round(v * 10) / 10;
const ROLE_WORD = { starter: "as a starter", bench: "off the bench" };
export const ROLE_OF_TIER = { starter: "starter", bench_plus: "B+", bench: "bench" };

/** The q-quantile of a list (linear between the two nearest). null when empty. */
export function quantile(values, q) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y), p = (a.length - 1) * q, lo = Math.floor(p);
  return a[lo] + (a[Math.min(lo + 1, a.length - 1)] - a[lo]) * (p - lo);
}

/**
 * Tonight's five: { ids: Set of DraftKings ids (strings), kind: "confirmed" | "agreed" | "expected", note }. order: tonight's playing men, in order [{ id, starter_flag }]; confirmed: { ids, kind } or null
 * (the lineup pages' five). With no five from the pages, TwoGun's starter flags are the five, marked expected; a short five is filled from the top of tonight's order, a long one cut to the top of it. Pure.
 */
export function chooseFive(order, confirmed) {
  const here = new Set(order.map((o) => String(o.id)));
  let ids = [], kind = "expected", note = null;
  if (confirmed?.ids?.length) {
    ids = confirmed.ids.map(String).filter((id) => here.has(id)); kind = confirmed.kind;
    if (ids.length > 5) { // a pages' five longer than five is cut to the first five on tonight's order, said
      note = `the lineup pages' five names ${ids.length} men; the first 5 on tonight's order are used`;
      ids = order.map((o) => String(o.id)).filter((id) => ids.includes(id)).slice(0, 5);
    }
  } else {
    const flagged = order.filter((o) => o.starter_flag).map((o) => String(o.id));
    ids = flagged.slice(0, 5);
    if (flagged.length > 5) note = `TwoGun flags ${flagged.length} starters; the first 5 on tonight's order are used`;
  }
  if (ids.length < 5) {
    const add = order.map((o) => String(o.id)).filter((id) => !ids.includes(id)).slice(0, 5 - ids.length);
    if (add.length) note = `${note ? `${note}; ` : ""}${kind === "expected" ? "TwoGun flags" : `the lineup pages' five names`} ${ids.length} available starter${ids.length === 1 ? "" : "s"}: ${add.length} filled from the top of tonight's order`;
    ids = [...ids, ...add];
  }
  return { ids: new Set(ids), kind, note };
}

/** A man's recent games: his own games (any team) dated on or after `since`, the date of the team's RECENT_GAMES-th last game (null: none). { n (played), total, avg (when he played), big (games of BENCH_PLUS_AVG minutes or more) }. Rows' minutes are overtime-scaled already (roleRows). Pure. */
export function recentOf(rows, since) {
  const mine = since ? rows.filter((r) => r.date >= since) : [];
  const total = mine.reduce((s, r) => s + r.min, 0);
  return { n: mine.length, total, avg: mine.length ? total / mine.length : null, big: mine.filter((r) => r.min >= BENCH_PLUS_AVG).length };
}

/**
 * The role a standing override applies in (Adam 11-12): meta { role: "starter" | "bench" | null, set: "YYYY-MM-DD" }. Its stored role; with none, the role he held most often in his games before the set date
 * (started in more than half of them: starter, else bench); null (applies in any role) when there is no such game. rows: [{ started, date }]. Pure.
 */
export function overrideRole(meta, rows) {
  if (meta?.role === "starter" || meta?.role === "bench") return meta.role;
  const before = meta?.set ? rows.filter((r) => r.date < meta.set) : [];
  return before.length ? (before.filter((r) => r.started).length * 2 > before.length ? "starter" : "bench") : null;
}

/** Whether a standing override (value, meta) applies in tonight's role ("starter" | "bench"): { ok, for_role, text (when it does not) }. Pure. */
export function ovGate(value, meta, rows, role) {
  const forRole = overrideRole(meta, rows);
  if (!forRole || forRole === role) return { ok: true, for_role: forRole, text: null };
  return { ok: false, for_role: forRole, text: `your override of ${value} is for his ${forRole} role; tonight he ${role === "starter" ? "starts" : "is on the bench"}` };
}

/** One man's figure and ceiling for a role from his rows ({ min, started }): { value, ceiling, n, source: "role" | "twogun" | "none" }. Pure. (The chart exception for a man with no games is tierPlan's.) */
export function roleFigure(rows, role, tg) {
  const mine = rows.filter((r) => r.started === (role === "starter")).map((r) => r.min);
  if (mine.length) {
    const value = mine.reduce((s, v) => s + v, 0) / mine.length, best = Math.max(...mine);
    const ceiling = mine.length < CEILING_MIN_GAMES ? best : Math.max(quantile(mine, CEILING_QUANTILE), value);
    return { value, ceiling, n: mine.length, source: "role" };
  }
  return isNum(tg) ? { value: tg, ceiling: tg, n: 0, source: "twogun" } : { value: null, ceiling: null, n: 0, source: "none" };
}

const POS_EXPAND = { G: ["PG", "SG"], F: ["SF", "PF"] };
const posSet = (m) => new Set((m.positions ?? []).flatMap((p) => POS_EXPAND[p] ?? [p]).filter((p) => p !== "UTIL"));
const poss = (n) => (/s$/i.test(n) ? `${n}'` : `${n}'s`);

/** A man's standing minutes override in force for his plan entry `e`: its value when he is not Bench and its role gate passed (ovGate), else null. One copy for figures.js, console-tier.js and typedTotalNote. */
export const ovMinutesIn = (ov, e) => (isNum(ov) && e && e.tier !== "bench" && e.minutes_gate?.ok !== false ? ov : null);

/**
 * Adam 1:33 PM 11-17: minutes Adam types, and his standing minutes overrides, replace that man's figure and move nobody else (the plan is worked as if he typed nothing), so the team may come to more or less
 * than 240. men: [{ name, auto (the plan's figure or null), typed (or null), ov (the override in force, ovMinutesIn, or null) }]. Returns the team note saying the total plainly, or null (nothing typed or
 * overridden, the total 240 within a tenth, or a figure missing: the plan's own note says that). Pure.
 */
export function typedTotalNote(men, teamMinutes = GAME_MINUTES) {
  const typed = men.filter((m) => isNum(m.typed)), ov = men.filter((m) => !isNum(m.typed) && isNum(m.ov));
  if (!typed.length && !ov.length) return null;
  if (men.some((m) => !isNum(m.typed) && !isNum(m.ov) && !isNum(m.auto))) return null;
  const total = men.reduce((s, m) => s + (isNum(m.typed) ? m.typed : isNum(m.ov) ? m.ov : m.auto), 0), diff = total - teamMinutes;
  if (Math.abs(diff) < 0.05) return null;
  const whose = [typed.length ? "your typed minutes" : null, ov.length ? "your standing minutes overrides" : null].filter(Boolean).join(" and ");
  const held = typed.filter((m) => !isNum(m.auto)).map((m) => m.name); // review round 2, finding 6: the plan has no figure for him, so its fill is held (ruling 5), not because of the typing
  if (held.length) return `With ${whose} this team adds to ${r1(total)}: the fill to ${teamMinutes} is held because ${held.join(", ")} ha${held.length === 1 ? "s" : "ve"} no figure of ours, not because of your typing`;
  return `With ${whose} this team adds to ${r1(total)} (${r1(Math.abs(diff))} ${diff > 0 ? "over" : "under"} ${teamMinutes}): nobody else's minutes move for them`;
}

const tierWords = { starter: "Starter", bench_plus: "Bench+", bench: "Bench" };

/**
 * Tonight's minutes for one team. men: [{ id, key, name, lid (ledger id or null), tg (TwoGun's minutes or null), positions, in_five, replaces: [names of the Out starters he takes the place of], last_mpg (last
 * season's minutes a game, for a man with no games this season; last_missing: true when last season's minutes are not on file), ov: { usual, cap } (standing overrides' values, or {}) }]; rowsOf(lid) -> this season's played games [{ min, started }]; games: the team's ledger
 * games (null: none read); teamMinutes: what the team's men share (240; Adam's typed minutes never come off it, Adam 1:33 PM 11-17); outs: [{ name, lid, positions, starter }] (Out for a reason); five: { kind, note }; boxNote: why games are unusable, or null.
 * ov may carry `meta` ({ usual, cap, minutes: { role, set } }) and `minutes` (the standing minutes override's value): each override applies only in the role it was set for (ovGate); the entry's `skipped`
 * lists those it did not apply [{ field, text }] and `minutes_gate` is the minutes override's gate (null with none; its use stays with figures.js and console-tier.js).
 * benchSpots: the team's bench-spot figures (team-fill.js benchSpots; the console's payload carries them, its games being null); omitted, they are read from `games`; null: none on file.
 * typed: Map id -> Adam's typed minutes, read only for the notes' wording (a typed man the plan has no figure for); never a figure here (Adam 1:33 PM 11-17).
 * Returns { byId: Map id -> { auto (null when missing), figure, computed, ceiling (his cap tonight), computed_ceiling, floor (a starter's), spot (a bench man's spot or null), tier, basis, why, used, skipped, minutes_gate, flag, n,
 * label (the why in short, for the console's Basis column: { kind: starts | paired | median | spot | off_chart | own | chart | twogun | none | override, value, n, name, pos, spot, role, returning, fill, trim,
 * capped (minutes the 36 cap took), limit (his cap override when it limits him, else null) }) }, notes,
 * total (null when a figure is missing), pot }. Pure.
 */
export function tierPlan({ men, rowsOf, games, outs = [], five, boxNote = null, teamMinutes: TEAM_MINUTES = GAME_MINUTES, since: sinceIn, teamGames: teamGamesIn, chartNeedsOutMost = CHART_NEEDS_OUT_MOST, benchSpots: spotsIn, typed: typedIn = new Map() }) {
  // since / teamGames: given by the console's payload (no ledger games there); else read from `games`
  const notes = [], by = new Map(), since = sinceIn === undefined ? (games ?? []).slice(-RECENT_GAMES)[0]?.date ?? null : sinceIn, teamGames = teamGamesIn ?? (games ?? []).length;
  if (five?.note) notes.push(five.note);
  notes.push(`Starters: ${five.kind === "expected" ? `expected, TwoGun's starter flags (${five.why ? `the lineup pages' five was not used: ${five.why}` : "the lineup pages have not posted a five"})` : `the lineup pages' ${five.kind} five`}`);
  if (boxNote) notes.push(boxNote);
  // Adam 11-13: the team's median starter figure tonight (the five's own starter-role means), the stand-in when an Out starter's own figure is unknown
  const fiveFigs = boxNote ? [] : men.filter((m) => m.in_five && m.lid && !(m.replaces ?? []).length).map((m) => roleFigure(rowsOf(m.lid) ?? [], "starter", null)).filter((r) => r.source === "role").map((r) => r.value);
  const spots = boxNote ? null : spotsIn !== undefined ? spotsIn : spotsOf(games);
  const c = { rowsOf, boxNote, since, teamGames, chartNeedsOutMost, outs, spots, medianStarter: quantile(fiveFigs, 0.5), unmatched: [], chartMen: [], noLast: [] };
  const xs = men.map((m) => manBase(m, c));
  placeBench(xs, spots);
  pairReplaced(xs, outs);
  for (const x of xs) by.set(x.m.id, manFinish(x, c));
  // Adam 1:33 PM 11-17: typed minutes and standing minutes overrides never enter the plan (no pin, no shift to his position's bench men): his figure is replaced after it (figures.js, console-tier.js)
  const all = [...by.values()], known = all.filter((x) => isNum(x.figure)), missing = all.filter((x) => !isNum(x.figure));
  const fill = fillTeam(known.map((x) => ({ id: x.m.id, starter: x.tier === "starter", figure: x.figure, ceiling: x.ceiling, floor: x.floor, limited: x.limited, max: x.max })), TEAM_MINUTES, missing.length > 0);
  notes.push(...planNotes(c, xs, known), ...fillNotes(fill, missing, outs, TEAM_MINUTES, typedIn));
  const out = new Map(), sumOf = (mp) => [...mp.values()].reduce((s, v) => s + v, 0);
  for (const x of known) out.set(x.m.id, entryOf(x, fill, TEAM_MINUTES));
  for (const x of missing) out.set(x.m.id, { auto: null, figure: null, computed: null, ceiling: null, computed_ceiling: null, floor: null, spot: x.spot, tier: x.tier, basis: x.basis, used: x.used, skipped: x.skipped, minutes_gate: x.minutes_gate, flag: x.flag, n: 0, label: { ...x.label, fill: 0, trim: 0 }, why: x.words });
  const pot = { sum: r1(fill.sum), gap: r1(fill.gap), out: outs.map((o) => o.name),
    capped: known.filter((x) => x.capped > EPS).map((x) => ({ name: x.m.name, minutes: r1(x.capped) })), proportional: sumOf(fill.prop), rounds: fill.rounds, round_minutes: sumOf(fill.plus), trimmed: fill.trimmed, unassigned: fill.unassigned, untrimmed: fill.untrimmed };
  return { byId: out, notes, total: missing.length ? null : fill.sum + pot.proportional + pot.round_minutes - sumOf(fill.cut), pot };
}

/** One man's plan entry: his figure through the fill and trim, with a why naming each step (Adam 11-17). */
function entryOf(x, fill, T) {
  const id = x.m.id, e = fill.prop.get(id) ?? 0, p = fill.plus.get(id) ?? 0, cut = fill.cut.get(id) ?? 0, auto = x.figure + e + p - cut;
  const shown = (v) => v >= 0.05; // under a tenth's rounding: in the figure, not worded as "+0" or "-0"
  const fillWords = `${shown(e) ? `; +${r1(e)} to reach ${T} (in proportion to his figure, none above ${MINUTES_CAP})` : ""}${shown(p) ? `; +${r1(p)} in +1 rounds to reach ${T} (starters, then bench, the last round pro-rated)` : ""}`;
  const trimWords = shown(cut) ? `; -${r1(cut)}: the team's figures are over ${T} (${fill.how.get(id) === "starter" ? "the bench could not absorb it all, so starters were trimmed above their floors" : "the bench trimmed in proportion to their figures"})` : "";
  return { auto, figure: x.figure, computed: x.computed, ceiling: p > 1e-6 ? Math.max(x.ceiling, auto) : x.ceiling, computed_ceiling: x.computed_ceiling, floor: x.floor, spot: x.spot, tier: x.tier, basis: x.basis, used: x.used,
    skipped: x.skipped, minutes_gate: x.minutes_gate, flag: x.flag, n: x.n, label: { ...x.label, fill: shown(e + p) ? r1(e + p) : 0, trim: shown(cut) ? r1(cut) : 0 }, why: `${x.words}${fillWords}${trimWords} = ${r1(auto)}` };
}

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const meanOf = (rows) => (rows.length ? rows.reduce((s, r) => s + r.min, 0) / rows.length : null);

/** Pass 1 for one man: his rows, recent minutes, returning state, tier, role, own role figure and the chart's stand-in (step 2b). c: tierPlan's context (collects unmatched and noLast). */
function manBase(m, c) {
  const { boxNote, teamGames } = c, rows = boxNote || !m.lid ? [] : c.rowsOf(m.lid) ?? [], recent = recentOf(rows, c.since);
  if (!boxNote && !m.lid) c.unmatched.push(m.name);
  // a returning rotation man (Out for most of this season's games with a real last season, or back from an injury that kept him Out for most of the last 10) takes his tier from his own minutes then
  let returning = null, noFile = false;
  if (!m.in_five && recent.big < BENCH_PLUS_GAMES && !boxNote) {
    const allMean = meanOf(rows), window = Math.min(RECENT_GAMES, teamGames), outMost = !rows.length && teamGames > 0 && (m.out_season ?? 0) * 2 > teamGames;
    if (outMost && m.last_unknown) c.noLast.push(m.name);
    noFile = outMost && m.last_missing === true; // last season's minutes are not on file: said on his row, never read as Bench silently
    if (outMost && (m.last_games ?? 0) >= RETURN_LAST_GAMES && isNum(m.last_mpg) && m.last_mpg >= BENCH_PLUS_AVG)
      returning = `returning rotation man: ${r1(m.last_mpg)} a game over ${m.last_games} games last season, Out for ${m.out_season} of the team's ${teamGames} games this season`;
    else if (rows.length && window > 0 && (m.out_recent ?? 0) * 2 > window && allMean >= BENCH_PLUS_AVG)
      returning = `back from injury: ${r1(allMean)} a game over ${rows.length} earlier game${rows.length === 1 ? "" : "s"} this season, Out for ${m.out_recent} of the team's last ${window}`;
  }
  const tier = m.tier_force ?? (m.in_five ? "starter" : recent.big >= BENCH_PLUS_GAMES || returning ? "bench_plus" : "bench");
  const role = tier === "starter" ? "starter" : "bench";
  let f = roleFigure(rows, role, m.tg);
  // no game at all this season (a known man, boxes read): his depth chart's usual, unless the box scores (m.seen_played) or the chart's own basis (m.chart_games) show a game, or the scope switch excludes him
  const noGames = !rows.length && Boolean(m.lid) && !boxNote, usable = isNum(m.chart_usual) && m.chart_usual > 0;
  const mismatch = m.seen_played ? "the season's box scores show a game of his, so the depth chart's usual is not used" : (m.chart_games ?? 0) > 0 ? `his depth chart's own usual rests on ${m.chart_games} game${m.chart_games === 1 ? "" : "s"} this season, so "no games" is not trusted and the chart's usual is not used` : null;
  const inScope = !c.chartNeedsOutMost || (m.out_season ?? 0) * 2 > teamGames;
  // Adam 11-13: the chart's usual is last season's minutes whatever the role, so it stands in only when last season's majority role (games started over half) is tonight's role; last_gs unknown: it stands, said
  const lastRole = isNum(m.last_gs) && isNum(m.last_games) && m.last_games > 0 ? (m.last_gs * 2 > m.last_games ? "starter" : "bench") : null, chartBase = noGames && usable && !mismatch && inScope, roleMismatch = chartBase && lastRole !== null && lastRole !== role;
  const chartOk = chartBase && !roleMismatch;
  const roleOff = roleMismatch ? `his chart usual ${r1(m.chart_usual)} is last season's ${lastRole === "starter" ? "starter" : "bench"} minutes and ${role === "starter" ? "he starts" : "he is on the bench"} tonight, ${isNum(m.tg) ? `so TwoGun's ${m.tg} is used` : "and TwoGun has no number, so his minutes are missing (not guessed)"}` : null;
  const outText = isNum(m.out_season) ? `Out for only ${m.out_season} of the team's ${teamGames} games` : "his Out count is not on file";
  const tail = noGames && usable && mismatch ? mismatch : noGames && !usable ? NO_USUAL : noGames && usable && !inScope ? `no games this season but ${outText}, so his depth chart's usual (${r1(m.chart_usual)}) is not used: only an injured or inactive man takes it` : roleOff; // said on the TwoGun-number row
  if (chartOk) f = { value: m.chart_usual, ceiling: m.chart_usual, n: 0, source: "chart" };
  return { m, rows, recent, returning, noFile, tier, role, f, noGames, tail, lastRole, chartOk, boxNote, teamGames };
}
const NO_USUAL = "No games this season and his depth chart has no usual above 0: TwoGun's number is used";

/**
 * A bench man's place (step 3, Adam 12:45 PM 11-17: role is his place on tonight's depth chart): { group (0: on the chart, 1: off it with a game in the team's last RECENT_GAMES, 2: off it, games but none lately,
 * 3: off it, no game this season), key (minutes per game played in the last RECENT_GAMES, overtime-scaled; 0 otherwise) }. On the chart, tonight's order alone decides (key 0). Pure.
 */
export function benchOrderKey(offChart, rows, recent) {
  if (!offChart) return { group: 0, key: 0 };
  if (recent.n > 0) return { group: 1, key: recent.avg };
  return rows.length ? { group: 2, key: 0 } : { group: 3, key: 0 };
}

/**
 * Step 3: the bench men in tonight's depth-chart order: each charted man by his place on the standing chart (m.chart_rank: Adam's moves applied, Out men simply absent, so everyone below moves up; review round 1,
 * finding 7: never the rotation step's re-rank by own minutes), the men the chart does not place (m.off_chart) after them (benchOrderKey); the Nth takes spot N (0 past the team's deepest bench).
 */
function placeBench(xs, spots) {
  if (!spots) return;
  const rank = (x, i) => (Number.isFinite(x.m.chart_rank) ? x.m.chart_rank : 1e6 + i); // no rank given (direct callers): tonight's order
  const bench = xs.map((x, i) => ({ x, i, r: rank(x, i), o: benchOrderKey(x.m.off_chart === true, x.rows, x.recent) })).filter(({ x }) => x.tier !== "starter");
  bench.sort((a, b) => a.o.group - b.o.group || (a.o.group === 0 ? a.r - b.r : b.o.key - a.o.key) || a.i - b.i);
  bench.forEach(({ x, o }, k) => { x.spot = k + 1; x.spotFig = spots.figs[k] ?? 0; x.order = o; });
}

/**
 * Adam 1:19-1:20 PM 11-17 (option B, by position): the figure a starter with no starts takes: the starter figure (the mean of all his starts) of the Out starter at his DraftKings position he was paired with
 * (pairReplaced), else the team's median starter figure, the reason said (that man has no starts either, or why no Out starter was paired: x.noPair); null when neither is known. Never his own minutes.
 */
function viaOf(x, c) {
  const p = x.pair, nm = p?.out.name ?? null, fig = p?.out.starter_fig, median = isNum(c.medianStarter) ? c.medianStarter : null;
  if (isNum(fig)) return { v: fig, source: "replaces", mark: `took ${poss(nm)} starting minutes (${p.pos})`, words: `${poss(nm)} starter figure ${r1(fig)}, the mean of his starts (the Out starter at his position, ${p.pos}, he replaced)` };
  const why = nm ? `${nm}, the Out starter at his position, ${p.pos}, has no starts either` : x.noPair ?? "no Out starter tonight shares his position";
  if (median !== null) return { v: median, source: "median", mark: `team's typical starter minutes (${why})`, words: `the team's median starter figure ${r1(median)} (${why})` };
  x.noVia = why;
  return null;
}

/**
 * Adam 1:20 PM 11-17: each starter with no starts is paired with the Out starter who plays his DraftKings position (G covers PG and SG, F covers SF and PF): the man whose chart slot he took (m.replaced, the
 * rotation step's promoted_for) when they share a position, else an Out starter sharing one, the most positions in common first; each Out starter is taken once, men with a promoted_for match first, then
 * tonight's order. Sets x.pair = { out, pos (the shared positions) }, or x.noPair = why none was paired (review round 2, finding 5: his position not on file; the Out starter at his position taken by another man;
 * no Out starter sharing it). Pure on xs.
 */
function pairReplaced(xs, outs) {
  const all = outs.filter((o) => o.starter === true), free = [...all], takenBy = new Map(), common = (x, o) => [...posSet(x.m)].filter((p) => posSet(o).has(p));
  const need = xs.filter((x) => x.tier === "starter" && x.f.source !== "role"), first = need.filter((x) => free.some((o) => o.name === x.m.replaced?.name && common(x, o).length));
  for (const x of [...first, ...need.filter((y) => !first.includes(y))]) {
    if (!posSet(x.m).size) { x.noPair = `${poss(x.m.name)} position is not on file`; continue; }
    const own = free.find((o) => o.name === x.m.replaced?.name && common(x, o).length);
    const pick = own ?? free.filter((o) => common(x, o).length).sort((a, b) => common(x, b).length - common(x, a).length)[0];
    if (!pick) {
      const gone = all.find((o) => common(x, o).length && takenBy.has(o.name));
      x.noPair = gone ? `the Out starter at his position (${gone.name}) was taken by ${takenBy.get(gone.name)}; each Out starter is used once` : "no Out starter tonight shares his position";
      continue;
    }
    x.pair = { out: pick, pos: common(x, pick).join("/") };
    takenBy.set(pick.name, x.m.name);
    free.splice(free.indexOf(pick), 1);
  }
}

/** Step 2 (Adam 11-17): a starter's figure and cap: { value (null: missing), cap, source, basis, n, words, mark, markKind (the row flag's kind when not "no_starts_starter") }. */
function starterFigure(x, c) {
  const { m, rows, f } = x;
  if (f.source === "role") {
    const keep = f.value > MINUTES_CAP;
    return { value: f.value, cap: keep ? f.value : MINUTES_CAP, source: "role", basis: (m.replaces ?? []).length ? "replaces" : "starter", n: f.n, label: { kind: "starts", value: r1(f.value), n: f.n },
      words: `Starter: mean ${r1(f.value)} over ${plural(f.n, "start")} this season${keep ? `, above ${MINUTES_CAP}: his own starter mean, so he keeps it` : ""}` };
  }
  const via = viaOf(x, c), tg = `TwoGun has ${isNum(m.tg) ? m.tg : "none"} (not used)`;
  if (via) return { value: via.v, cap: MINUTES_CAP, source: via.source, basis: via.source, n: 0, mark: via.mark, label: via.source === "replaces" ? { kind: "paired", value: r1(via.v), name: x.pair.out.name, pos: x.pair.pos } : { kind: "median", value: r1(via.v) }, words: `Starter, no starts this season: ${via.words}: ${r1(via.v)}; ${tg}` };
  // review round 2, finding 4: no paired Out starter's figure and no team median: never his own minutes; TwoGun's number, flagged (RULES R1), else missing, said
  const why = `no starter figure of an Out starter at his position (${x.noVia}) and no team median on file`;
  if (isNum(m.tg)) return { value: m.tg, cap: MINUTES_CAP, source: "twogun", basis: "twogun", n: 0, label: { kind: "twogun", value: m.tg }, markKind: "no_role_games", mark: `${why}, so TwoGun's ${m.tg} is used`, words: `Starter, no starts this season: ${why}, so TwoGun's ${r1(m.tg)} minutes` };
  return { value: null, cap: null, source: "none", basis: "none", n: 0, label: { kind: "none" }, markKind: "no_figure", mark: `${why}, and TwoGun has no number: his minutes are missing`, words: `Starter, no starts this season: ${why}, and TwoGun has no minutes for him: minutes missing, not guessed (RULES R1)` };
}

/** Step 3: a bench man's role figure from his spot. */
function spotFigure(x, c) {
  const { m, spot: k, spotFig: v } = x, games = c.spots.games;
  const o = x.order, last = `last ${Math.min(RECENT_GAMES, x.teamGames)}`, unmatched = !m.lid && !c.boxNote ? "; not matched to the box scores, so no games of his were read" : "";
  const where = o.group === 0 ? "on tonight's depth chart" : o.group === 1 ? `(not placed on tonight's depth chart: after the charted men, by minutes per game played, ${last}: ${r1(o.key)} over ${x.recent.n})`
    : o.group === 2 ? `(not placed on tonight's depth chart: after the charted men; no game in the team's ${last})` : "(not placed on tonight's depth chart and no game this season: last)";
  return { value: v, cap: MINUTES_CAP, source: "spot", basis: "bench_spot", n: games, label: { kind: o.group === 0 ? "spot" : "off_chart", spot: k, value: r1(v), n: games }, words: `${prefixOf(x)}Bench spot ${k} ${where}: the team's ${ordinal(k)} man off the bench averages ${r1(v)} (${plural(games, "game")})${unmatched}` };
}

const prefixOf = (x) => (x.returning ? `${x.returning}; ` : x.noFile ? "last season's minutes are not on file, so he cannot be recognized as a returning rotation man; " : "");

/** A man's own figure in his role (a returning man; a bench with no spot figures; a starter with nothing of ours known): { value, cap, source, basis, n, words }. */
function ownFigure(x) {
  const { m, tier, role, f, tail } = x, pre = prefixOf(x), takes = (m.replaces ?? []).length && tier === "starter" ? ` (takes ${m.replaces.join(", ")}'s place in the five)` : "";
  let words;
  if (f.source === "role") words = `${pre}${tierWords[tier]}: mean ${r1(f.value)} over ${plural(f.n, "game")} he played ${ROLE_WORD[role]} this season`;
  else if (f.source === "chart") words = `${pre}${tierWords[tier]}${takes}: no games this season, so his depth chart's usual ${r1(f.value)} minutes; TwoGun has ${isNum(m.tg) ? m.tg : "none"}`;
  else if (f.source === "twogun") words = `${pre}${tierWords[tier]}${takes}: no games ${ROLE_WORD[role]} this season, so TwoGun's ${r1(f.value)} minutes (flag: no games in this role)${tail ? `; ${tail}` : ""}`;
  else words = `${pre}${tierWords[tier]}: no games ${ROLE_WORD[role]} this season and TwoGun has no minutes for him: minutes missing, not guessed (RULES R1)${tail ? `; ${tail}` : ""}`;
  return { value: f.value, cap: MINUTES_CAP, source: f.source, basis: f.source === "role" ? tier : f.source, n: f.n, words, label: ownLabel(x) };
}

/** The short basis of an own figure (ownFigure): his role mean, the chart's usual, TwoGun's number, or none. */
function ownLabel(x) {
  const { f, tier } = x;
  if (f.source === "role") return { kind: "own", role: tier, value: r1(f.value), n: f.n, returning: Boolean(x.returning) };
  return f.source === "chart" ? { kind: "chart", value: r1(f.value) } : f.source === "twogun" ? { kind: "twogun", value: f.value } : { kind: "none" };
}

/** Pass 2 for one man: his figure (steps 2-3), his standing overrides in tonight's role, the cap (step 4) and his flag. */
function manFinish(x, c) {
  const { m, tier, role, rows } = x, ov = m.ov ?? {};
  const fig = (tier === "starter" ? starterFigure(x, c) : x.spot ? spotFigure(x, c) : null) ?? ownFigure(x);
  let value = fig.value, cap = fig.cap, limited = false, words = fig.words, capped = 0;
  const used = [], meta = ov.meta ?? {}, skipped = [], ovNow = {};
  for (const k of ["usual", "cap"]) {
    if (!isNum(ov[k])) continue;
    const g = ovGate(ov[k], meta[k], rows, role);
    if (g.ok) ovNow[k] = ov[k]; else skipped.push({ field: k, text: g.text });
  }
  const minutesGate = isNum(ov.minutes) ? ovGate(ov.minutes, meta.minutes, rows, role) : null;
  if (isNum(ovNow.usual)) { value = ovNow.usual; used.push("usual"); }
  // review round 1, finding 6: a cap override at or below his figure is a limit (no fill); above it, it is his ceiling: proportional fill up to it, and the +1 rounds never pass it (max)
  if (isNum(ovNow.cap)) { cap = ovNow.cap; limited = !isNum(value) || ovNow.cap <= value + EPS; used.push("cap"); } else if (isNum(ovNow.usual) && ovNow.usual > cap) { cap = ovNow.usual; used.push("cap"); } // his usual as set is never capped
  if (used.length) words += `; your standing override sets his ${used.map((u) => (u === "usual" ? "figure" : "ceiling")).join(" and ")}`;
  if (skipped.length) words += `; ${skipped.map((s) => s.text).join("; ")}`;
  if (isNum(value) && value > cap + EPS) { capped = value - cap; value = cap; words += `; capped at ${r1(cap)} ${limited ? "by your cap override" : `(nobody above ${MINUTES_CAP} but a starter whose own starter mean is)`}: -${r1(capped)}`; }
  const overridden = used.includes("usual");
  const label = { ...(overridden ? { kind: "override", value: r1(ovNow.usual) } : fig.label), capped: capped > EPS && !limited ? r1(capped) : 0, limit: limited ? r1(cap) : null };
  if (!overridden && fig.source === "chart") c.chartMen.push(`${m.name} (chart ${r1(fig.value)}, TwoGun ${isNum(m.tg) ? m.tg : "none"})`);
  return { m, tier, recent: x.recent, skipped, minutes_gate: minutesGate, figure: value, computed: fig.value, ceiling: cap, computed_ceiling: fig.cap, floor: tier === "starter" && isNum(value) ? value : null, limited, max: isNum(ovNow.cap) ? ovNow.cap : GAME_MAX, capped: isNum(ovNow.cap) ? 0 : capped, spot: x.spot ?? null,
    basis: overridden ? "override" : fig.basis, label, words, used, flag: flagOf(x, fig, value, overridden, used.includes("cap") ? cap : null), n: fig.n, source: fig.source, returning: Boolean(x.returning) || fig.source === "chart" };
}

/** His row's flag: TwoGun far lower than our figure, the chart's stand-in, TwoGun's number, missing, or not matched. */
function flagOf(x, fig, value, overridden, ovCap) {
  const { m, tail, noGames, lastRole, boxNote } = x, src = fig.source;
  let flag = null;
  // review round 1, finding 4: a bench man's spot figure is flagged too; the flag is a warning only, it never holds a man out of the fill (only a cap override at or below his figure does)
  if (["role", "chart", "replaces", "median", "season", "spot"].includes(src) && isNum(m.tg) && isNum(value) && m.tg < value * (1 - FAR_BELOW) && value - m.tg >= FAR_BELOW_MIN)
    flag = { kind: "twogun_far_below", twogun: m.tg, own: r1(value), text: `TwoGun far lower: TwoGun has ${m.tg}, ours ${r1(value)}` }; // Adam 2:00 PM 11-17: not a limit (only a cap override or a news restriction is one); the rule (FAR_BELOW share and FAR_BELOW_MIN minutes) is unchanged
  if (overridden) return flag;
  if (fig.mark) return { kind: fig.markKind ?? "no_starts_starter", twogun: m.tg ?? null, own: isNum(value) ? r1(value) : null, text: `Starter with no starts this season: ${fig.mark}${flag ? `; ${flag.text}` : ""}` }; // Adam 1:19 PM 11-17: a visible mark on his row
  if (src === "chart") return { kind: "no_games_chart", twogun: m.tg ?? null, own: r1(value), text: `No games this season: his depth chart's usual ${r1(fig.value)}${ovCap !== null ? `, capped by your override at ${r1(ovCap)},` : ""} is used; TwoGun has ${isNum(m.tg) ? m.tg : "none"}${flag ? `; ${flag.text}` : ""}${lastRole === null ? "; last season's role is not on file, so the chart's usual is not checked against tonight's role" : ""}` };
  if (src === "twogun") return m.lid || boxNote ? { kind: "no_role_games", twogun: m.tg, own: null, text: tail === NO_USUAL ? NO_USUAL : `${noGames ? "No games this season" : "No games in this role"}: TwoGun's number is used${tail ? `; ${tail}` : ""}` } : { kind: "not_matched", twogun: m.tg, own: null, text: "Not matched to the box scores, so no games of his were read: TwoGun's number is used" };
  if (src === "none") return m.lid || boxNote ? { kind: "no_figure", twogun: null, own: null, text: `No games in this role and no TwoGun minutes: his minutes are missing${tail ? `; ${tail}` : ""}` } : { kind: "not_matched", twogun: null, own: null, text: "Not matched to the box scores and TwoGun has no minutes: his minutes are missing" };
  if (!m.lid && !boxNote && src === "spot") return { kind: "not_matched", twogun: m.tg ?? null, own: null, text: `Not matched to the box scores, so no games of his were read: his bench spot comes from his place, never his games${flag ? `; ${flag.text}` : ""}` }; // review round 2, finding 8
  return flag;
}

/** The team's notes on the men and the bench spots (G62: every man the plan could not read is named). */
function planNotes(c, xs, known) {
  const notes = [], { noLast, chartMen, unmatched, spots } = c, many = (n) => (n === 1 ? "man" : "men");
  if (noLast.length) notes.push(`${noLast.length} ${many(noLast.length)} Out for most of this season ha${noLast.length === 1 ? "s" : "ve"} no row in last season's totals, so cannot be recognized as returning: ${noLast.join(", ")}`);
  if (chartMen.length) notes.push(`${chartMen.length} ${many(chartMen.length)} with no game this season take${chartMen.length === 1 ? "s" : ""} their depth chart's usual instead of TwoGun's: ${chartMen.join(", ")}`);
  if (unmatched.length) notes.push(`${unmatched.length} ${many(unmatched.length)} not matched to the box scores, so no games were read (a bench man keeps his place on tonight's depth chart; a starter takes the Out starter's figure at his position, else the team's median): ${unmatched.join(", ")}`);
  const spotted = xs.filter((x) => x.spot).sort((a, b) => a.spot - b.spot), lost = spotted.filter((x) => x.order.group === 3);
  if (spotted.length) notes.push(`Bench by role (Adam 11-17): the Nth man off the bench on tonight's depth chart takes the team's average for its Nth man off the bench this season (${plural(spots.games, "game")} before tonight, each scaled to 240): ${spotted.map((x) => `${x.spot}. ${x.m.name} ${r1(x.spotFig)}`).join(", ")}`);
  else if (!c.boxNote && !spots && xs.some((x) => x.tier !== "starter")) notes.push("No game of the team's this season is on file, so the bench has no role figures: each bench man keeps his own bench mean, else TwoGun's number");
  if (lost.length) notes.push(`Not on tonight's depth chart and no game this season: placed last, check his role: ${lost.map((x) => x.m.name).join(", ")}`);
  const capped = known.filter((x) => x.capped > EPS);
  if (capped.length) notes.push(`Capped at ${MINUTES_CAP} (only a starter whose own starter mean is higher keeps it): ${capped.map((x) => `${x.m.name} -${r1(x.capped)}`).join(", ")}`);
  return notes;
}

/** The team's notes on step 5: the fill under 240 or the trim over it, and what nobody could take or give. */
function fillNotes(fill, missing, outs, T, typed = new Map()) {
  const notes = [], outWords = outs.length ? ` (Out: ${outs.map((o) => o.name).join(", ")})` : "", sumOf = (mp) => [...mp.values()].reduce((s, v) => s + v, 0), prop = sumOf(fill.prop), plus = sumOf(fill.plus);
  if (fill.gap > EPS && missing.length) {
    // review round 2, finding 6: a typed man the plan has no figure for holds the fill as any man does (ruling 5); said without blaming the typing
    const typedNone = missing.filter((x) => isNum(typed.get(x.m.id))), plain = missing.filter((x) => !isNum(typed.get(x.m.id)));
    for (const x of typedNone) notes.push(`${x.m.name} has no figure of ours (your typed ${typed.get(x.m.id)} stands on his row only), so the team is not filled to ${T}`);
    if (plain.length) notes.push(`The team's figures add to ${r1(fill.sum)}, ${r1(fill.gap)} short of ${T}${outWords}: nothing is handed out while ${plain.map((x) => x.m.name).join(", ")} ha${plain.length === 1 ? "s" : "ve"} no figure`);
  }
  else if (fill.gap > EPS) {
    notes.push(`The team's figures add to ${r1(fill.sum)}, ${r1(fill.gap)} short of ${T}${outWords}: ${r1(prop)} spread in proportion to the figures of the men under ${MINUTES_CAP} (limited men left out)${plus > EPS ? `; ${r1(plus)} more in ${plural(fill.rounds, "round")} of +1, starters then bench, the last pro-rated` : ""}`);
    if (fill.unassigned > 0.005) notes.push(`${r1(fill.unassigned)} minutes are not given to anyone: every man is limited, at his cap override or at ${GAME_MAX}, so the team adds to ${r1(T - fill.unassigned)}`);
  } else if (fill.gap < -EPS) {
    notes.push(`The team's figures add to ${r1(fill.sum)}, ${r1(-fill.gap)} over ${T}${outWords}: the bench trimmed by ${r1(fill.trimmed.bench)} in proportion to their figures${fill.trimmed.starter > EPS ? `; the bench could not absorb it all, so starters were trimmed by ${r1(fill.trimmed.starter)} above their floors` : ""}`);
    if (fill.untrimmed > 0.005) notes.push(`${r1(fill.untrimmed)} minutes over ${T} could not be trimmed: the starters at their floors and the men no trim may touch add to ${r1(T + fill.untrimmed)}`);
  }
  return notes;
}
