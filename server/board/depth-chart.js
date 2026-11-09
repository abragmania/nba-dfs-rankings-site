// Saved depth charts (Adam, 11-06) and the minutes they give. Pure ES module shared by the page and the server: no disk, no clock.
//
// A chart is one team's explicit lists, written by Adam or an approved proposal, never inferred (Adam, 11-06): `starters` is exactly
// five named men, each with a named `backup` and that backup's `backup_source` ("seed proposal" or "Adam <date>"); `bench` is the ordered
// rotation (Bench+ and Bench); `oor` (out of rotation) and `injured` are lists of their own; `positions` is each position's ordered list
// (a man may sit on two, and counts once in `men`). Nothing here decides who starts from minutes, starts or medians. Positions are
// information only: they never decide who starts (Adam, 11-07).
//   chart = { schema, team, updated_at, sources, men: { key: { name, positions: [..], role, usual, usual_basis, history, role_unconfirmed,
//     note, last_season_team, bbr_id, fields: { role|usual|positions: { source, as_of } } } }, starters: [{ key, backup, backup_source }],
//     bench: [keys], oor: [keys], injured: [keys], positions: { PG: [keys], SG, SF, PF, C } }
// Starters (chartFive) are a set: the chart's five who are playing and not flipped away, plus every man marked S; marking never moves
// anyone else. An Out starter's named backup starts only while fewer than five are marked. Six or more marked all start, with a note.
// Minutes (chartMinutes, Adam 11-07): last season's figures only, never this season's or the chart's usual. Each starter gets his own
// last-season starter MPG, else his position group's starter average; the rest of the 240 trickles down the bench ladder in rotation
// order (a named starter he flipped to the bench first, then Bench+, then the chart's bench order). Usual stays on the chart as information and feeds no minutes figure.
import { isNum } from "./figures.js";

export const DEPTH_SCHEMA = 1;
export const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
export const DEPTH_ROLES = ["starter", "bench_plus", "bench", "oor", "injured"];
export const DEPTH_ROLE_LABEL = { starter: "Starter", bench_plus: "Bench+", bench: "Bench", oor: "Out of rotation", injured: "Injured" };
export const MINUTE_SOURCES = ["twogun", "ours", "ours_edits"];
export const SOURCE_LABEL = { twogun: "TwoGun", ours: "Ours", ours_edits: "Ours + my edits" };
export const MAX_MIN = 48;
export const SEED_SOURCE = "seed proposal";
/** WORKING VALUE, not ruled on by Adam: how many games of last season's minutes per game count against this season's games in a man's usual minutes. */
export const LAST_SEASON_WEIGHT_GAMES = 20;
const PLAYING = ["starter", "bench_plus", "bench"];
const r3 = (x) => Math.round(x * 1000) / 1000;
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const KEYS = {
  chart: ["schema", "team", "updated_at", "sources", "men", "starters", "bench", "oor", "injured", "positions"],
  man: ["name", "positions", "role", "usual", "usual_basis", "history", "role_unconfirmed", "note", "last_season_team", "bbr_id", "fields"],
  starter: ["key", "backup", "backup_source"],
  field: ["source", "as_of"],
};
const strange = (obj, allowed) => Object.keys(obj).find((k) => !allowed.includes(k));
export const validBackupSource = (s) => s === SEED_SOURCE || (typeof s === "string" && /^Adam \d{4}-\d{2}-\d{2}$/.test(s));

/** A man's usual minutes: this season's MPG over `g` games blended with last season's MPG at LAST_SEASON_WEIGHT_GAMES games. { min, basis }; min null with no history. */
export function blendUsual(thisMpg, g, lastMpg) {
  const hasThis = isNum(thisMpg) && isNum(g) && g > 0, hasLast = isNum(lastMpg) && lastMpg > 0;
  if (hasThis && hasLast) return { min: r3((g * thisMpg + LAST_SEASON_WEIGHT_GAMES * lastMpg) / (g + LAST_SEASON_WEIGHT_GAMES)), basis: `this season ${f1(thisMpg)} MPG over ${g} G blended with last season ${f1(lastMpg)} MPG (weight ${LAST_SEASON_WEIGHT_GAMES} G, working value)` };
  if (hasThis) return { min: r3(thisMpg), basis: `this season ${f1(thisMpg)} MPG over ${g} G (no last season)` };
  if (hasLast) return { min: r3(lastMpg), basis: `last season ${f1(lastMpg)} MPG (no games this season)` };
  return { min: null, basis: "no history" };
}

/** The reason one man is malformed, or null. */
function badMan(k, m) {
  if (!m || typeof m !== "object" || Array.isArray(m) || typeof m.name !== "string" || !m.name) return `${k}: a man needs a name.`;
  const extra = strange(m, KEYS.man);
  if (extra) return `${m.name}: unknown field ${extra.slice(0, 20)}.`;
  if (!DEPTH_ROLES.includes(m.role)) return `${m.name}: unknown role ${String(m.role).slice(0, 20)}.`;
  if (!(m.usual === null || (isNum(m.usual) && m.usual >= 0 && m.usual <= MAX_MIN))) return `${m.name}: usual minutes must be a number from 0 to ${MAX_MIN}, or null.`;
  if (!Array.isArray(m.positions) || !m.positions.every((p) => POSITIONS.includes(p))) return `${m.name}: positions must be among ${POSITIONS.join(", ")}.`;
  if (m.bbr_id !== undefined && m.bbr_id !== null && typeof m.bbr_id !== "string") return `${m.name}: bbr_id must be text or null.`;
  for (const f of ["role", "usual", "positions"]) {
    const fld = m.fields?.[f];
    if (typeof fld?.source !== "string" || typeof fld?.as_of !== "string") return `${m.name}: the ${f} field needs a source and an as-of date.`;
    if (strange(fld, KEYS.field)) return `${m.name}: the ${f} field has an unknown key.`;
  }
  return strange(m.fields, ["role", "usual", "positions"]) ? `${m.name}: unknown field entry.` : null;
}

/** Whether each list names men on the chart once, each with a fitting role: null or the reason. */
function badLists(chart) {
  const men = chart.men, seen = new Map();
  const claim = (keys, where, check) => {
    if (!Array.isArray(keys)) return `${where} must be a list.`;
    for (const k of keys) {
      if (!men[k]) return `${where} names ${String(k).slice(0, 30)}, who is not on the chart.`;
      if (seen.has(k)) return `${men[k].name} is on both ${seen.get(k)} and ${where}.`;
      seen.set(k, where);
      if (!check(men[k].role)) return `${men[k].name} is on ${where} but his role is ${men[k].role}.`;
    }
    return null;
  };
  const sk = chart.starters.map((s) => s?.key);
  const why = claim(sk, "the starters", (r) => r === "starter") ?? claim(chart.bench, "the bench", (r) => r === "bench" || r === "bench_plus")
    ?? claim(chart.oor, "out of rotation", (r) => r === "oor") ?? claim(chart.injured, "the injured list", (r) => r === "injured");
  if (why) return why;
  for (const k of Object.keys(men)) if (!seen.has(k)) return `${men[k].name} is on no list.`;
  for (const s of chart.starters) {
    if (!s || typeof s !== "object") return "A starter entry must be an object.";
    if (strange(s, KEYS.starter)) return `${men[s.key].name}'s starter entry has an unknown key.`;
    if (s.backup === null || s.backup === undefined) {
      if (s.backup_source !== undefined && s.backup_source !== null) return `${men[s.key].name} has a backup source but no backup.`;
      continue;
    }
    if (!men[s.backup] || !PLAYING.includes(men[s.backup].role) || sk.includes(s.backup)) return `${men[s.key].name}'s backup must be a bench man on the chart, or null.`;
    if (!validBackupSource(s.backup_source)) return `${men[s.key].name}'s backup needs a source: "${SEED_SOURCE}" or "Adam <date>".`;
  }
  if (new Set(chart.starters.map((s) => s.backup).filter(Boolean)).size !== chart.starters.filter((s) => s.backup).length) return "Two starters share a backup.";
  return null;
}

/** Null when the chart is well formed, else the first reason. Unknown keys are refused at every level. */
export function badChart(chart) {
  if (!chart || typeof chart !== "object" || Array.isArray(chart)) return "A chart must be an object.";
  const extra = strange(chart, KEYS.chart);
  if (extra) return `The chart has an unknown key: ${extra.slice(0, 20)}.`;
  if (chart.schema !== DEPTH_SCHEMA) return `The chart's schema must be ${DEPTH_SCHEMA}.`;
  if (typeof chart.team !== "string" || !/^[A-Z]{2,4}$/.test(chart.team)) return "The chart needs a team code.";
  const men = chart.men;
  if (!men || typeof men !== "object" || Array.isArray(men)) return "The chart needs a men object.";
  for (const [k, m] of Object.entries(men)) { const why = badMan(k, m); if (why) return why; }
  if (!Array.isArray(chart.starters) || chart.starters.length !== 5) return "The chart must name exactly 5 starters.";
  const why = badLists(chart);
  if (why) return why;
  if (!chart.positions || typeof chart.positions !== "object" || Array.isArray(chart.positions) || strange(chart.positions, POSITIONS)) return "The chart's positions must be exactly PG, SG, SF, PF and C lists.";
  for (const p of POSITIONS) {
    const list = chart.positions[p];
    if (!Array.isArray(list)) return `The chart needs a ${p} list.`;
    for (const k of list) if (!men[k] || !men[k].positions.includes(p)) return `The ${p} list names ${String(k).slice(0, 30)}, who does not list ${p}.`;
  }
  for (const [k, m] of Object.entries(men)) for (const p of m.positions) if (!chart.positions[p].includes(k)) return `${m.name} lists ${p} but is not on the ${p} list.`;
  return null;
}

// ---- chart minutes: the figures (Adam, 11-07) ----
// Every figure is worked by seasonMinuteFigures from last season's Basketball-Reference totals (data/seasons/bbr-<end year>-totals.json,
// tools/fetch_season_totals.mjs), the season before the slate's; nothing here is a hard-coded minutes figure.
export const TEAM_MINUTES = 240;        // a regulation game: five men on the floor for 48 minutes
export const STARTER_MIN_GAMES = 25;    // a starter figure (his own, or his group's average) needs 25+ games last season (Adam, 11-07)
export const STARTER_MIN_SHARE = 0.75;  // ... starting at least 75% of them (Adam, 11-07)
export const BENCH_FLOOR = 40;          // the bench keeps at least 40 of the 240: starters past 200 are scaled down (Adam, 11-07)
export const LADDER_RUNGS = 5;          // the bench ladder: 6th to 10th man (Adam, 11-07); men past the 10th get 0
/** A position's starter-average group (Adam, 11-07: guards play more than forwards, forwards more than bigs). */
export const POS_GROUP = { PG: "G", SG: "G", SF: "F", PF: "F", C: "C" };

/** A Basketball-Reference row's first position ("SG-PG" -> SG) as G, F or C; null when it has none. */
const bbrGroup = (pos) => POS_GROUP[String(pos ?? "").split("-")[0].trim()] ?? null;
/** Whether a season row is a starter's: STARTER_MIN_GAMES+ games, starting STARTER_MIN_SHARE+ of them. */
const startedSeason = (r) => r.g >= STARTER_MIN_GAMES && r.gs / r.g >= STARTER_MIN_SHARE;
const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

/** His own last-season starter MPG from his season row (a traded man's row is his combined one), or null when he was not a starter by the rule. */
export const ownStarterMpg = (row) => (row && row.g > 0 && startedSeason(row) ? r3(row.mp / row.g) : null);

/**
 * The league figures from last season's rows [{ team, pos, g, gs, mp }]: { group: { G, F, C }, ladder: [6th .. 10th] }.
 *   group: the average MPG of starters by the rule, by their first listed position.
 *   ladder: per team, among men with STARTER_MIN_GAMES+ games on that team (a traded man's combined "TOT" row belongs to no team; his per-team rows,
 *   `teamRows`, count on each team he played for, by his games, starts and minutes there), the five with
 *   the most starts are its starters and the rest are ranked by MPG, but a man past the five who is a starter by the rule (25+ games, 75%+ started) is a
 *   starter and not a bench man, so he takes no rung (Adam 11-09); each rung is the average over the teams that have a man on it.
 */
export function seasonMinuteFigures(players, teamRows = []) {
  const group = {};
  for (const g of ["G", "F", "C"]) { const m = mean(players.filter((r) => startedSeason(r) && bbrGroup(r.pos) === g).map((r) => r.mp / r.g)); group[g] = m === null ? null : r3(m); }
  const rungs = Array.from({ length: LADDER_RUNGS }, () => []);
  const onTeams = [...players.filter((r) => r.team !== "TOT"), ...teamRows];
  for (const team of new Set(onTeams.map((r) => r.team))) {
    const men = onTeams.filter((r) => r.team === team && r.g >= STARTER_MIN_GAMES).sort((a, b) => b.gs - a.gs || b.mp - a.mp || String(a.bbrId).localeCompare(String(b.bbrId)));
    men.slice(5).filter((r) => !startedSeason(r)).map((r) => r.mp / r.g).sort((a, b) => b - a).slice(0, LADDER_RUNGS).forEach((v, i) => rungs[i].push(v));
  }
  return { group, ladder: rungs.map((v) => { const m = mean(v); return m === null ? null : r3(m); }) };
}

const ORD = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

/** A starter's figure: { min, basis, median }. His own last-season starter MPG, else his first listed position's group average (median: a group figure, not his own). */
export function starterFigure(fig, key, pos0) {
  const own = fig.own?.[key];
  if (isNum(own)) return { min: own, basis: `starter, own ${fig.season} starter MPG ${f1(own)}`, median: false };
  const g = POS_GROUP[pos0], avg = g ? fig.group?.[g] : null, why = fig.why?.[key] ? ` (${fig.why[key]})` : "";
  if (isNum(avg)) return { min: avg, basis: `starter, ${g} average ${f1(avg)}${why}`, median: true };
  return { min: null, basis: `${g ? `starter, no ${g} average in the ${fig.season} table` : "starter, no position to take a group average from"}${why}`, median: false };
}

/**
 * The 240 shared out (Adam, 11-07): { key: { min, how } } for the untyped starters and bench men, one algorithm whether or not anyone is typed, on room = 240 minus
 * the typed sum. starters: [{ key, min }] (untyped, with a figure); bench: [keys], the whole ladder in order; typedOn: { key: minutes } for the ladder men who are typed. A typed
 * man keeps his place on the ladder and his minutes count toward the bench, so typing a man's current figure moves nobody. Pure.
 *   Starters past room: every untyped man is scaled by one factor. Otherwise, if the starters leave the bench under BENCH_FLOOR they are scaled down to leave it exactly that;
 *   each bench man then takes his rung until the rest runs out (the last takes what is left, the men after him 0); when the rest is more than the rungs hold, every rung is raised in proportion.
 *   This function alone is not a no-op for a typed man's own figure once scale-all is on (typing a scaled figure can drop the starters back under room and turn it off); chartMinutes
 *   therefore drops a typed figure equal to the man's own before calling it (settleTyped), which is what makes typing a current figure move nobody.
 */
export function shareMinutes(starters, bench, ladder, typed = 0, typedOn = {}) {
  const out = {}, room = Math.max(0, TEAM_MINUTES - typed);
  const S = starters.reduce((s, x) => s + x.min, 0);
  const rungAt = (i) => (i < ladder.length && isNum(ladder[i]) ? ladder[i] : 0);
  const open = bench.map((k, i) => ({ k, i })).filter((x) => !Object.hasOwn(typedOn, x.k)), R = open.reduce((a, x) => a + rungAt(x.i), 0);
  const need = Math.max(0, BENCH_FLOOR - Object.values(typedOn).reduce((a, b) => a + b, 0)); // what the untyped bench must keep: typed bench minutes count toward the floor
  const scaleAll = S > room;
  const f = scaleAll ? room / (S + R) : open.length && S > 0 && room - S < need ? Math.max(0, room - need) / S : 1;
  for (const x of starters) out[x.key] = { min: x.min * f, how: f < 1 ? (scaleAll ? `scaled by ${f.toFixed(2)} with every untyped man to fit your typed minutes` : `scaled to ${f1(x.min * f)} so the bench keeps ${BENCH_FLOOR}`) : null };
  let pool = room - S * f;
  const byRung = !scaleAll && pool >= R; // the rest is more than the rungs hold: raised in proportion, not trickled
  open.forEach(({ k, i }) => {
    const label = `${ORD(6 + i)} man`;
    if (i >= ladder.length) { out[k] = { min: 0, how: `${label}, past the ${ORD(5 + ladder.length)}-man ladder` }; return; }
    if (!isNum(ladder[i])) { out[k] = { min: 0, how: `${label}, no ladder figure for this rung` }; return; }
    const rung = ladder[i], base = `${label}, ladder ${f1(rung)}`;
    if (scaleAll) out[k] = { min: rung * f, how: `${base}, scaled by ${f.toFixed(2)} with every untyped man to fit your typed minutes` };
    else if (byRung) {
      const v = R > 0 ? (rung * pool) / R : 0;
      out[k] = { min: v, how: Math.abs(v - rung) < 0.05 ? base : `${base}, raised to ${f1(v)} (more minutes left than the ladder holds, shared by rung)` };
    } else {
      const take = Math.max(0, Math.min(rung, pool));
      pool -= take;
      out[k] = { min: take, how: take >= rung - 1e-9 ? base : take > 0 ? `${base}; takes the ${f1(take)} left` : `${base}; nothing left of the ${TEAM_MINUTES}` };
    }
  });
  return out;
}

/**
 * The men who start, as a set (Adam, 11-07): { five: [keys, any count], why: { key: { for, how } }, notes }. The chart's named starters who are playing and
 * not flipped away; every man marked S, on the chart (`flips`) or off it (`extraIns`: [{ key }], a key of the caller's own); then, while fewer than five,
 * the named backup of each starter who is not playing (out, not on the board, or on the injured list), unless Adam flipped that backup himself.
 * Positions play no part. Marking a man never moves anyone else; six or more marked all start (fiveNotes says so).
 */
export function chartFive(chart, active, flips, extraIns = []) {
  const five = [], why = {}, notes = [];
  for (const s of chart.starters) if (active(s.key) && (flips[s.key] === undefined || flips[s.key] === "starter")) five.push(s.key);
  const mark = (k) => { five.push(k); why[k] = { for: null, how: "you marked him S" }; };
  for (const k of Object.keys(flips)) if (flips[k] === "starter" && chart.men[k] && active(k) && !five.includes(k)) mark(k);
  for (const e of extraIns) if (!five.includes(e.key)) mark(e.key);
  for (const s of chart.starters) { // an Out starter's named backup starts only while fewer than five are marked (Adam, 11-07)
    if (five.length >= 5) break;
    const b = s.backup;
    if (active(s.key) || !b || !active(b) || flips[b] !== undefined || five.includes(b)) continue;
    five.push(b); why[b] = { for: s.key, how: `named backup, ${s.backup_source ?? SEED_SOURCE}` };
  }
  return { five, why, notes };
}

/**
 * Each man's minutes off the chart (Adam, 11-07): { minutes: { key: { min, basis, median } }, starters: [keys], total, notes: [text] }. `state`:
 *   figures: { season: "2025-26", group: { G, F, C }, ladder: [..], own: { key: his own starter MPG or null } } from the server (depth-figures.js),
 *     or { missing: reason }; without them no man has a figure, and the basis says why.
 *   extraIns: [{ key, pos0, role }] men off the chart Adam flipped to Starter (a starter like anyone) or Bench+ / Bench (the end of that group's order);
 *   outs, absent (chart men not on tonight's board), flips: { key: role }, typed: { key: minutes }; a key on neither the chart nor extraIns is ignored.
 * Starters (chartFive) take starterFigure; the bench in ladder order (Bench+ first, then the chart's bench order, then anyone else on the chart in chart
 * order, then the men off it) shares the rest of TEAM_MINUTES by shareMinutes; Out of rotation and the injured list play 0. min is null with no figure.
 */
export function chartMinutes(chart, state = {}) {
  if (!state.settled && Object.keys(state.typed ?? {}).length) { // a typed figure that is what the sharing gives him anyway is no edit: it moves nobody (settleTyped)
    const edits = settleTyped(state.typed, (rest) => Object.fromEntries(Object.entries(chartMinutes(chart, { ...state, typed: rest, settled: true }).minutes).map(([k, v]) => [k, v.min])));
    return chartMinutes(chart, { ...state, typed: edits, echo: Object.fromEntries(Object.entries(state.typed).filter(([k]) => !(k in edits))), settled: true });
  }
  const men = chart.men, extra = (state.extraIns ?? []).filter((e) => e && typeof e.key === "string" && !men[e.key]);
  const extraOf = Object.fromEntries(extra.map((e) => [e.key, { ...e, role: e.role ?? "starter" }]));
  const keys = [...Object.keys(men), ...Object.keys(extraOf)];
  const asked = Object.fromEntries(Object.entries(state.flips ?? {}).filter(([k, r]) => men[k] && DEPTH_ROLES.includes(r)));
  const typed = Object.fromEntries(Object.entries(state.typed ?? {}).filter(([k, v]) => (men[k] || extraOf[k]) && isNum(v)));
  const outSet = new Set((state.outs ?? []).filter((k) => men[k])), absent = new Set((state.absent ?? []).filter((k) => men[k]));
  const down = (k) => !extraOf[k] && (outSet.has(k) || absent.has(k) || (men[k].role === "injured" && asked[k] === undefined));
  const active = (k) => !down(k);
  const { five, why } = chartFive(chart, (k) => Boolean(men[k]) && active(k), asked, extra.filter((e) => extraOf[e.key].role === "starter"));
  const roleOf = (k) => (five.includes(k) ? "starter" : extraOf[k] ? extraOf[k].role : asked[k] ?? (men[k].role === "starter" ? "bench" : men[k].role));
  const order = [...new Set([...chart.bench, ...chart.starters.map((s) => s.key), ...chart.oor, ...chart.injured])];
  const benchOf = (role) => [...order.filter((k) => active(k) && roleOf(k) === role), ...Object.keys(extraOf).filter((k) => roleOf(k) === role)];
  const benched = chart.starters.map((s) => s.key).filter((k) => active(k) && !five.includes(k) && (asked[k] === "bench" || asked[k] === "bench_plus")); // a starter he flipped to the bench is its 6th man (Adam, 11-07)
  const ladder = [...new Set([...benched, ...benchOf("bench_plus"), ...benchOf("bench")])];
  const fig = state.figures ?? { missing: "no season figures were read" };
  const minutes = {};
  const set = (k, min, basis, median = false) => { minutes[k] = { min: min === null ? null : r3(min), basis, median }; };
  const pos0 = (k) => men[k]?.positions[0] ?? extraOf[k]?.pos0;
  const starts = five.filter((k) => !(k in typed)).map((k) => ({ key: k, ...(fig.missing ? { min: null, basis: `no season figures (${fig.missing})` } : starterFigure(fig, k, pos0(k))) }));
  const typedSum = Object.entries(typed).filter(([k]) => active(k)).reduce((s, [, v]) => s + v, 0);
  const nameOf = (k) => men[k]?.name ?? extraOf[k]?.name ?? k;
  const blank = fig.missing ? null : starts.find((x) => !isNum(x.min)) ?? null; // a starter with no figure: the bench waits on him, never raised over a blank
  const share = fig.missing || blank ? {} : shareMinutes(starts, ladder, fig.ladder ?? [], typedSum, Object.fromEntries(ladder.filter((k) => k in typed).map((k) => [k, typed[k]])));
  const startsFor = (k) => (why[k] ? (why[k].for ? `starts for ${men[why[k].for].name} (${why[k].how})` : why[k].how) : null);
  for (const k of keys) {
    if (down(k)) { set(k, 0, absent.has(k) ? "not on tonight's board" : "out"); continue; }
    if (k in typed) { set(k, typed[k], "typed by you"); continue; }
    if (isNum(state.echo?.[k])) { set(k, state.echo[k], "typed by you"); continue; } // typed at his own figure: shown as typed, shared as if untyped
    const s = starts.find((x) => x.key === k);
    if (s) { const sh = share[k]; set(k, sh ? sh.min : s.min, [s.basis, sh?.how, startsFor(k)].filter(Boolean).join("; "), s.median === true); continue; }
    if (share[k]) { set(k, share[k].min, share[k].how); continue; }
    if (fig.missing && ladder.includes(k)) { set(k, null, `no season figures (${fig.missing})`); continue; }
    if (blank && ladder.includes(k)) { set(k, null, `waiting on ${nameOf(blank.key)}'s starter figure (${blank.basis})`); continue; }
    set(k, 0, roleOf(k) === "injured" ? "injured" : "out of rotation");
  }
  const total = Object.values(minutes).reduce((s, v) => (isNum(v.min) ? s + v.min : s), 0);
  const totalNote = totalMissNote(total, typedSum, fig, blank && nameOf(blank.key));
  return { minutes, starters: five, total: r3(total), total_note: totalNote, notes: [...fiveNotes(chart, five, (k) => Boolean(men[k]) && active(k), why, asked), ...(totalNote ? [totalNote] : [])] };
}

/**
 * The typed minutes that are real edits: { key: minutes } without the men typed at the figure the sharing gives them untyped (within SAME_MIN, a thousandth kept).
 * Such a man is no edit, so he is shared as if untyped and nobody moves; this is the one place that rule lives, for Ours here and the TwoGun source in console-engine.js.
 * `minutesWith(edits)`: { key: minutes } for everyone when only `edits` is typed. The no-edits are the largest set of typed men who each get exactly their typed figure when all of them
 * are left untyped together (two men typed at their own figures are judged together, and so is a man typed beside a real edit, whatever order they are listed in). More than SETTLE_MAX
 * typed men are all kept as edits, the old rule.
 */
export const SAME_MIN = 0.0006;
const SETTLE_MAX = 6;
export function settleTyped(typed, minutesWith) {
  const keys = Object.keys(typed), n = keys.length;
  if (n === 0 || n > SETTLE_MAX) return typed;
  const bits = (m) => keys.filter((_, i) => (m >> i) & 1).length, kept = (m) => Object.fromEntries(keys.filter((_, i) => !((m >> i) & 1)).map((k) => [k, typed[k]]));
  const masks = [...Array((1 << n) - 1).keys()].map((i) => i + 1).sort((a, b) => bits(b) - bits(a) || a - b); // every non-empty set of men to leave untyped, the largest first
  for (const mask of masks) {
    const got = minutesWith(kept(mask));
    if (keys.every((k, i) => !((mask >> i) & 1) || (isNum(got?.[k]) && Math.abs(got[k] - typed[k]) <= SAME_MIN))) return kept(mask);
  }
  return typed;
}

/** Why the team's minutes are not 240, naming the cause; null when they are, within 0.05. */
function totalMissNote(total, typedSum, fig, waitingOn) {
  if (Math.abs(total - TEAM_MINUTES) <= 0.05) return null;
  if (fig.missing) return `The ${TEAM_MINUTES} is not shared: no season figures (${fig.missing}).`;
  if (waitingOn) return `The ${TEAM_MINUTES} is not shared: waiting on ${waitingOn}'s starter figure.`;
  if (typedSum > TEAM_MINUTES) return `Typed minutes are ${f1(typedSum - TEAM_MINUTES)} over the ${TEAM_MINUTES}.`;
  return total < TEAM_MINUTES ? `No bench men left to take the remaining ${f1(TEAM_MINUTES - total)} of the ${TEAM_MINUTES}.` : `The team's minutes total ${f1(total)}, not ${TEAM_MINUTES}.`;
}

/** The roles note when the starters are not five: six or more marked, or fewer than five, naming each starter out and why nobody stepped in: no named backup playing, or a backup he flipped (`flips`: { key: role }). */
export function fiveNotes(chart, five, active, why = {}, flips = {}) {
  if (five.length > 5) return [`${five.length} starters marked: unmark one.`];
  if (five.length === 5) return [];
  const missed = chart.starters.filter((s) => !active(s.key) && !Object.values(why).some((w) => w.for === s.key));
  const flipped = (s) => s.backup && active(s.backup) && flips[s.backup] !== undefined;
  const bare = missed.filter((s) => !flipped(s)).map((s) => chart.men[s.key].name);
  const parts = [...(bare.length ? [`${bare.join(", ")} out with no named backup playing`] : []), ...missed.filter(flipped).map((s) => `${chart.men[s.key].name} out, his backup ${chart.men[s.backup].name} is marked ${DEPTH_ROLE_LABEL[flips[s.backup]]}`)];
  return [`Only ${five.length} starters on the ${chart.team} chart tonight${parts.length ? ` (${parts.join("; ")})` : ""}: mark a man S.`];
}

