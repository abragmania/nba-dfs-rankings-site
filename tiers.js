// Our minutes engine's three-tier model (Adam 11-12, replacing the rung/slot ladder), pure; tests/minutes_tiers.test.mjs on frozen fixtures.
//  1. Tiers. Starter: tonight's five (the lineup pages' confirmed or agreed five, else TwoGun's starter flags on the board, said "expected"; a short five is filled from tonight's order).
//     Bench+: a regular with real minutes: at least BENCH_PLUS_AVG minutes (overtime-scaled, the ledger rows' own) in at least BENCH_PLUS_GAMES of the team's last RECENT_GAMES games (Adam 11-12; not an
//     average). Bench: everyone else, a man with no recent games included. An injury never moves a man up a tier.
//  2. His own figure is ROLE DEPENDENT: the mean of his minutes in this season's games he played in tonight's role (started, or came off the bench). Last season's role games would fill a
//     thin sample, but no source on file carries last season's per-game role (the ESPN logs have no starter flag), so only this season's are read. No game in the role: TwoGun's number for
//     tonight, flagged "no games in this role" (R1: missing when TwoGun has none). Never his usual across roles, a blend across roles, or a slot or rung average.
//     Exception (Adam 11-13): a man with NO played game this season in any role, matched to the box scores, whose depth chart carries a usual above 0 (m.chart_usual) takes that usual as figure
//     and ceiling (source and basis "chart", flag "no_games_chart" naming TwoGun's number); with no chart usual he keeps TwoGun's number as above. A man with games, none in tonight's role, keeps TwoGun's. Kept on TwoGun's number too, with the reason: the box scores (m.seen_played) or the chart's own basis (m.chart_games) show a game, or no usual above 0.
//  3. His ceiling: the CEILING_QUANTILE of his same-role games; fewer than CEILING_MIN_GAMES, his best; none, TwoGun's number. Never a single-game high otherwise.
//  4. Pot: the team's figures against 240. Under 240 (the Out men's minutes): starters are filled first, each up to his ceiling; then Bench+ up to theirs, men sharing a position with an Out man
//     first; then Bench in order of recent minutes, a man with no recent game last. Over 240: trimmed in reverse tier order (Bench, fewest recent minutes first, toward 0; then Bench+ in proportion; starters last), each trim said in the team's notes. What nobody can take is named, never dropped (G62).
//  4b. A standing usual or cap override applies only in the role it was set for (Starter, or off the bench; ovGate): its stored role, else the role he held most often before its set date.
//  5. Minutes limit: TwoGun far below his own figure (FAR_BELOW share and FAR_BELOW_MIN minutes) flags the row; both figures are shown, ours stands.
//     Adam 11-13: a returning man's minutes (chart basis, returning rotation man, back from injury) come FIRST off the bench men at his position who covered for him (coverReturns: in proportion to their
//     figures, none below 0, a usual or minutes figure never reduced, each coverer's ceiling lowered by what he gave so the pot cannot refill the cut), before this pot step; what they cannot give is left to the usual order, and each team's note and each coverer's why say it.
//     A returning man who is in tonight's five is not cut from the bench (his place already moves the man he displaced to the bench figure), said in the note.
//     Adam 11-13: any man in the five with fewer than CEILING_MIN_GAMES starter games takes the larger of TwoGun's number and his own starter figure, with a ceiling up to the Out starter he replaces (m.replaces, read from the outs' starter_fig; unknown: the team's median starter figure).
//     The chart's usual (step 2) stands in only when last season's majority role (m.last_gs of m.last_games) is tonight's role; a mismatch keeps TwoGun's number, said; last_gs unknown keeps the chart's usual, said.
// RECENT_GAMES, BENCH_PLUS_*, CEILING_*, FAR_BELOW* are working values Adam may tune. Typed minutes and standing minutes overrides are applied after this (figures.js), never rescaled.
import { isNum } from "./figures.js";

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
export const OUT_RELEVANT_AVG = 15; // an Out man who is not a starter counts for "same position first" only when he averages this much this season
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

const POS_EXPAND = { G: ["PG", "SG"], F: ["SF", "PF"] };
const posSet = (m) => new Set((m.positions ?? []).flatMap((p) => POS_EXPAND[p] ?? [p]).filter((p) => p !== "UTIL"));
/** Why a bench man's minutes are not moved for someone else (null: he can be). `takes` true: minutes are taken from him (a returning man is refused too); false: he receives (refused only for a standing override). */
const standsWhy = (c, takes) => (takes && c.returning ? "returning himself" : c.used.includes("usual") ? "your usual override stands" : isNum(c.m.ov?.minutes) && c.tier !== "bench" && c.minutes_gate?.ok !== false ? "your minutes override stands" : null);
const poss = (n) => (/s$/i.test(n) ? `${n}'` : `${n}'s`);

/**
 * Adam 11-13: each returning man's figure comes first off the non-starter, non-returning men who share a DraftKings position with him (G = PG+SG, F = SF+PF), in proportion to their current figures, none below 0.
 * known: [{ m, tier, figure, used, returning }]; a man whose usual is overridden, or whose minutes override applies (not Bench), is never a coverer. Returning men go in order of figure, descending.
 * Returns { cuts: Map id -> [{ from (name), minutes }], moves: [{ name, figure, taken, left, from: [{ name, minutes }] }] }. Pure; does not change `known`.
 */
export function coverReturns(known) {
  const live = new Map(known.map((x) => [x.m.id, x.figure])), pos = new Map(known.map((x) => [x.m.id, posSet(x.m)])), cuts = new Map(), moves = [];
  for (const r of known.filter((x) => x.returning && x.figure > EPS).sort((a, b) => b.figure - a.figure)) {
    const base = { name: r.m.name, figure: r.figure, taken: 0, left: r.figure, from: [], skipped: [] };
    if (r.tier === "starter") { moves.push({ ...base, inFive: true }); continue; } // promoted into the five: his place already moves the man he displaced to the bench figure; a bench cut as well would count it twice
    const rp = pos.get(r.m.id);
    if (!rp.size) { moves.push({ ...base, noPositions: true }); continue; }
    const sharing = known.filter((c) => c !== r && !c.pinFill && c.tier !== "starter" && [...pos.get(c.m.id)].some((p) => rp.has(p)));
    const why = (c) => standsWhy(c, true);
    const cov = sharing.filter((c) => !why(c)), skipped = sharing.filter((c) => why(c)).map((c) => ({ name: c.m.name, why: why(c) }));
    const res = shareOut(cov.map((c) => ({ id: c.m.id, w: live.get(c.m.id), room: live.get(c.m.id) })), r.figure);
    const from = [];
    for (const c of cov) {
      const v = res.added.get(c.m.id) ?? 0;
      if (v <= EPS) continue;
      live.set(c.m.id, live.get(c.m.id) - v); from.push({ name: c.m.name, minutes: v });
      cuts.set(c.m.id, [...(cuts.get(c.m.id) ?? []), { from: r.m.name, minutes: v }]);
    }
    moves.push({ ...base, taken: r.figure - res.left, left: res.left, from, skipped, noSharer: !sharing.length });
  }
  return { cuts, moves };
}

/**
 * Adam 11-13: the console's typed man. shifts: [{ name, typed, auto, delta (auto - typed), positions }]. A cut (delta > 0) goes first to the non-starter men sharing a DraftKings position with him, in proportion to their figures, none past his ceiling;
 * a raise takes first from the same men, in proportion, none below 0. A man with a standing override and a typed position-mate are skipped, named. Biggest change first. Returns { moved: Map id -> signed minutes the man received, ceilUp: Map id -> ceiling given back, by: Map id -> [{ name, typed, auto, minutes }], moves }.
 * Pure; does not change `known`.
 */
export function shiftTyped(known, shifts, gives = new Map()) {
  const live = new Map(known.map((x) => [x.m.id, x.figure])), pos = new Map(known.map((x) => [x.m.id, posSet(x.m)])), moved = new Map(), by = new Map(), moves = [], ceilUp = new Map();
  // a typed returning man set below his figure hands back what he took from each coverer: that much is room again (the ceiling he lowered is raised), so the cut that sticks still holds against the pot
  const regain = (c, s) => (gives.get(c.m.id) ?? []).filter((g) => g.from === s.name).reduce((t, g) => t + g.minutes, 0);
  for (const s of shifts.filter((x) => Math.abs(x.delta) > EPS).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))) {
    const give = s.delta > 0, amt = Math.abs(s.delta), base = { name: s.name, typed: s.typed, auto: s.auto, override: s.override, give, amount: amt, to: [], left: amt, skipped: [] }, rp = posSet(s);
    if (!rp.size) { moves.push({ ...base, noPositions: true }); continue; }
    const near = known.filter((c) => !isNum(c.m.pinned) && c.tier !== "starter" && [...pos.get(c.m.id)].some((p) => rp.has(p))), ok = near.filter((c) => !standsWhy(c, !give));
    const skipped = near.filter((c) => standsWhy(c, !give)).map((c) => ({ name: c.m.name, why: standsWhy(c, !give) }))
      .concat(shifts.filter((o) => o !== s && !o.in_five && [...posSet(o)].some((p) => rp.has(p))).map((o) => ({ name: o.name, why: "your typed minutes stand" })));
    const res = shareOut(ok.map((c) => ({ id: c.m.id, w: live.get(c.m.id) + (give ? regain(c, s) : 0), room: give ? Math.max(0, (c.ceiling ?? live.get(c.m.id)) + regain(c, s) - live.get(c.m.id)) : live.get(c.m.id) })), amt), to = [];
    for (const c of ok) {
      const v = res.added.get(c.m.id) ?? 0;
      if (v <= EPS) continue;
      if (give) { const back = Math.min(v, regain(c, s)); if (back > EPS) ceilUp.set(c.m.id, (ceilUp.get(c.m.id) ?? 0) + back); }
      live.set(c.m.id, live.get(c.m.id) + (give ? v : -v)); moved.set(c.m.id, (moved.get(c.m.id) ?? 0) + (give ? v : -v)); to.push({ name: c.m.name, minutes: v });
      by.set(c.m.id, [...(by.get(c.m.id) ?? []), { name: s.name, typed: s.typed, auto: s.auto, minutes: give ? v : -v }]);
    }
    moves.push({ ...base, to, left: res.left, skipped, noSharer: !near.length });
  }
  return { moved, by, moves, ceilUp };
}

/** The team note for one typed man's move (shiftTyped). */
export function shiftNote(mv) {
  const head = `You typed ${mv.name} ${r1(mv.typed)} (auto ${r1(mv.auto)}${mv.override ? ", his standing minutes override" : ""}): ${r1(mv.amount)} ${mv.give ? "to" : "from"} the bench men at his position first`;
  const sk = mv.skipped.length ? `; not changed: ${mv.skipped.map((x) => `${x.name} (${x.why})`).join(", ")}` : "";
  if (mv.noPositions) return `${head}: no position of his is on file, so none could be matched and all ${r1(mv.amount)} are left to the usual order`;
  if (mv.to.length) return `${head}: ${mv.to.map((f) => `${f.name} ${mv.give ? "+" : "-"}${r1(f.minutes)}`).join(", ")}; ${r1(mv.left)} left to the usual order${sk}`;
  return `${head}: ${mv.noSharer ? "no bench man left to move shares his position" : "none could take or give them"}, all ${r1(mv.amount)} left to the usual order${sk}`;
}

/** The team note for one returning man's move (coverReturns): what was taken from whom, who was skipped and why, what is left. */
export function returnNote(mv) {
  const sk = mv.skipped.length ? `; not cut: ${mv.skipped.map((s) => `${s.name} (${s.why})`).join(", ")}` : "";
  if (mv.inFive) return `${mv.name} back in the five: his ${r1(mv.figure)} minutes are not also cut from the bench men at his position, because his place in the five already moves the man he displaced down to the bench`;
  if (mv.noPositions) return `${mv.name} back: ${r1(mv.figure)} minutes; no position of his is on file, so no bench man could be matched and all ${r1(mv.figure)} are left to the usual order`;
  if (mv.from.length) return `${mv.name} back: ${r1(mv.figure)} minutes taken from the bench men at his position first: ${mv.from.map((f) => `${f.name} -${r1(f.minutes)}`).join(", ")}; ${r1(mv.left)} left to the usual order${sk}`;
  return `${mv.name} back: ${r1(mv.figure)} minutes ${mv.noSharer ? "none to take from at his position (no bench man shares it)" : "none to take from at his position"}, all left to the usual order${sk}`;
}

const tierWords = { starter: "Starter", bench_plus: "Bench+", bench: "Bench" };

/**
 * Tonight's minutes for one team. men: [{ id, key, name, lid (ledger id or null), tg (TwoGun's minutes or null), positions, in_five, replaces: [names of the Out starters he takes the place of], last_mpg (last
 * season's minutes a game, for a man with no games this season; last_missing: true when last season's minutes are not on file), ov: { usual, cap } (standing overrides' values, or {}) }]; rowsOf(lid) -> this season's played games [{ min, started }]; games: the team's ledger
 * games (null: none read); teamMinutes: what the team's men share (240; the console's typed minutes come off it); outs: [{ name, lid, positions, starter }] (Out for a reason); five: { kind, note }; boxNote: why games are unusable, or null.
 * ov may carry `meta` ({ usual, cap, minutes: { role, set } }) and `minutes` (the standing minutes override's value): each override applies only in the role it was set for (ovGate); the entry's `skipped`
 * lists those it did not apply [{ field, text }] and `minutes_gate` is the minutes override's gate (null with none; its use stays with figures.js and console-tier.js).
 * Returns { byId: Map id -> { auto (null when missing), figure, computed, ceiling, computed_ceiling, tier, basis, why, used, skipped, minutes_gate, flag, n }, notes, total (null when a figure is missing), pot }. Pure.
 */
export function tierPlan({ men, rowsOf, games, outs = [], five, boxNote = null, teamMinutes: TEAM_MINUTES = GAME_MINUTES, shifts = [], since: sinceIn, teamGames: teamGamesIn, chartNeedsOutMost = CHART_NEEDS_OUT_MOST }) {
  // since / teamGames: given by the console's payload (no ledger games there); else read from `games`
  const notes = [], by = new Map(), unmatched = [], chartMen = [], noLast = [], since = sinceIn === undefined ? (games ?? []).slice(-RECENT_GAMES)[0]?.date ?? null : sinceIn, teamGames = teamGamesIn ?? (games ?? []).length;
  if (five?.note) notes.push(five.note);
  notes.push(`Starters: ${five.kind === "expected" ? `expected, TwoGun's starter flags (${five.why ? `the lineup pages' five was not used: ${five.why}` : "the lineup pages have not posted a five"})` : `the lineup pages' ${five.kind} five`}`);
  if (boxNote) notes.push(boxNote);
  // Adam 11-13: the team's median starter figure tonight (the five's own starter-role means), the stand-in when an Out starter's own figure is unknown
  const fiveFigs = boxNote ? [] : men.filter((m) => m.in_five && m.lid && !(m.replaces ?? []).length).map((m) => roleFigure(rowsOf(m.lid) ?? [], "starter", null)).filter((r) => r.source === "role").map((r) => r.value), medianStarter = quantile(fiveFigs, 0.5);
  for (const m of men) {
    const rows = boxNote || !m.lid ? [] : rowsOf(m.lid) ?? [], recent = recentOf(rows, since);
    if (!boxNote && !m.lid) unmatched.push(m.name);
    // a returning rotation man (Out for most of this season's games with a real last season, or back from an injury that kept him Out for most of the last 10) takes his tier from his own minutes then
    let returning = null, noFile = false;
    if (!m.in_five && recent.big < BENCH_PLUS_GAMES && !boxNote) {
      const allMean = rows.length ? rows.reduce((s, r) => s + r.min, 0) / rows.length : null, window = Math.min(RECENT_GAMES, teamGames);
      if (!rows.length && teamGames > 0 && (m.out_season ?? 0) * 2 > teamGames && m.last_unknown) noLast.push(m.name);
      noFile = !rows.length && teamGames > 0 && (m.out_season ?? 0) * 2 > teamGames && m.last_missing === true; // last season's minutes are not on file: said on his row, never read as Bench silently
      if (!rows.length && teamGames > 0 && (m.out_season ?? 0) * 2 > teamGames && (m.last_games ?? 0) >= RETURN_LAST_GAMES && isNum(m.last_mpg) && m.last_mpg >= BENCH_PLUS_AVG)
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
    const inScope = !chartNeedsOutMost || (m.out_season ?? 0) * 2 > teamGames;
    // Adam 11-13: the chart's usual is last season's minutes whatever the role, so it stands in only when last season's majority role (games started over half) is tonight's role; last_gs unknown: it stands, said
    const lastRole = isNum(m.last_gs) && isNum(m.last_games) && m.last_games > 0 ? (m.last_gs * 2 > m.last_games ? "starter" : "bench") : null, chartBase = noGames && usable && !mismatch && inScope, roleMismatch = chartBase && lastRole !== null && lastRole !== role;
    const chartOk = chartBase && !roleMismatch;
    const roleOff = roleMismatch ? `his chart usual ${r1(m.chart_usual)} is last season's ${lastRole === "starter" ? "starter" : "bench"} minutes and ${role === "starter" ? "he starts" : "he is on the bench"} tonight, ${isNum(m.tg) ? `so TwoGun's ${m.tg} is used` : "and TwoGun has no number, so his minutes are missing (not guessed)"}` : null;
    const noUsualText = "No games this season and his depth chart has no usual above 0: TwoGun's number is used";
    const outText = isNum(m.out_season) ? `Out for only ${m.out_season} of the team's ${teamGames} games` : "his Out count is not on file";
    const tail = noGames && usable && mismatch ? mismatch : noGames && !usable ? noUsualText : noGames && usable && !inScope ? `no games this season but ${outText}, so his depth chart's usual (${r1(m.chart_usual)}) is not used: only an injured or inactive man takes it` : roleOff; // said on the TwoGun-number row
    if (chartOk) f = { value: m.chart_usual, ceiling: m.chart_usual, n: 0, source: "chart" };
    // Adam 11-13: a man thrust into the five with fewer than CEILING_MIN_GAMES starter games takes the larger of TwoGun's number and his own role figure, with room up to the Out starter he replaces (the largest of them; unknown: the median starter figure)
    let promo = null, pf = null;
    if (tier === "starter" && (m.replaces ?? []).length && f.n < CEILING_MIN_GAMES && (f.source === "role" || f.source === "twogun")) {
      const cands = m.replaces.map((nm) => ({ nm, v: outs.find((o) => o.name === nm)?.starter_fig })).map((c) => ({ nm: c.nm, v: isNum(c.v) ? c.v : null })), known = cands.filter((c) => c.v !== null);
      const top = known.reduce((b, c) => (b === null || c.v > b.v ? c : b), null), anyUnknown = known.length < cands.length;
      const via = anyUnknown && isNum(medianStarter) && (!top || medianStarter > top.v) ? { nm: "the team's median starter figure", v: medianStarter } : top ? { nm: `${top.nm}'s`, v: top.v } : null;
      const fig = f.source === "role" && isNum(m.tg) ? Math.max(f.value, m.tg) : f.value;
      if (via) {
        pf = { value: fig, ceiling: Math.max(fig, f.ceiling ?? fig, via.v) };
        promo = `promoted to the five for ${m.replaces.join(", ")}: ${isNum(m.tg) ? `TwoGun ${m.tg}` : "no TwoGun number"}${f.source === "role" ? `, his ${f.n} starter game${f.n === 1 ? "" : "s"} ${r1(fig)}` : ""}, room up to ${via.nm} ${r1(via.v)} as a starter`;
      } else promo = "not promoted: the Out starter's figure and the team's median starter figure are unknown";
    }
    let value = pf ? pf.value : f.value, ceiling = pf ? pf.ceiling : f.ceiling;
    const computed = value, computedCeiling = ceiling, used = [];
    let words;
    const pre = returning ? `${returning}; ` : noFile ? "last season's minutes are not on file, so he cannot be recognized as a returning rotation man; " : "";
    if (f.source === "role") words = `${pre}${tierWords[tier]}: mean ${r1(f.value)} over ${f.n} game${f.n === 1 ? "" : "s"} he played ${ROLE_WORD[role]} this season, ceiling ${r1(f.ceiling)} (${f.n < CEILING_MIN_GAMES ? `his best: under ${CEILING_MIN_GAMES} games` : `the ${Math.round(CEILING_QUANTILE * 100)}th percentile of them`})${f.n < CEILING_MIN_GAMES ? "; last season's role games are not on file" : ""}`;
    else if (f.source === "chart") words = `${pre}${tierWords[tier]}${m.replaces.length ? ` (takes ${m.replaces.join(", ")}'s place in the five)` : ""}: no games this season, so his depth chart's usual ${r1(f.value)} minutes, his ceiling too; TwoGun has ${isNum(m.tg) ? m.tg : "none"}`;
    else if (f.source === "twogun") words = `${pre}${tierWords[tier]}${m.replaces.length ? ` (takes ${m.replaces.join(", ")}'s place in the five)` : ""}: no games ${ROLE_WORD[role]} this season, so TwoGun's ${r1(f.value)} minutes, his ceiling too (flag: no games in this role; last season's role games are not on file)${tail ? `; ${tail}` : ""}`;
    else words = `${pre}${tierWords[tier]}: no games ${ROLE_WORD[role]} this season and TwoGun has no minutes for him: minutes missing, not guessed (RULES R1)${tail ? `; ${tail}` : ""}`;
    if (promo) words += `; ${promo}`;
    const meta = m.ov.meta ?? {}, skipped = [], ovNow = {};
    for (const f of ["usual", "cap"]) {
      if (!isNum(m.ov[f])) continue;
      const g = ovGate(m.ov[f], meta[f], rows, role);
      if (g.ok) ovNow[f] = m.ov[f]; else skipped.push({ field: f, text: g.text });
    }
    const minutesGate = isNum(m.ov.minutes) ? ovGate(m.ov.minutes, meta.minutes, rows, role) : null;
    if (isNum(ovNow.usual)) { value = ovNow.usual; used.push("usual"); }
    if (isNum(ovNow.cap)) { ceiling = ovNow.cap; used.push("cap"); if (isNum(value) && value > ceiling) value = ceiling; } else if (isNum(ovNow.usual) && isNum(ceiling) && ceiling < ovNow.usual) { ceiling = ovNow.usual; used.push("cap"); }
    if (isNum(ovNow.usual) && !isNum(ceiling)) { ceiling = ovNow.usual; used.push("cap"); }
    if (used.length) words += `; your standing override sets his ${used.map((u) => (u === "usual" ? "figure" : "ceiling")).join(" and ")}`;
    if (skipped.length) words += `; ${skipped.map((x) => x.text).join("; ")}`;
    const overridden = used.includes("usual");
    const basis = overridden ? "override" : f.source === "none" ? "none" : f.source === "twogun" ? "twogun" : f.source === "chart" ? "chart" : m.replaces.length && tier === "starter" ? "replaces" : tier;
    let flag = null;
    if ((f.source === "role" || f.source === "chart") && isNum(m.tg) && isNum(value) && m.tg < value * (1 - FAR_BELOW) && value - m.tg >= FAR_BELOW_MIN)
      flag = { kind: "twogun_far_below", twogun: m.tg, own: r1(value), text: `Minutes limit: TwoGun has ${m.tg}, far below his own ${r1(value)} (over ${Math.round(FAR_BELOW * 100)}% and ${FAR_BELOW_MIN}+ minutes under); both are shown, ours is used` };
    if (!overridden && f.source === "chart") flag = { kind: "no_games_chart", twogun: m.tg ?? null, own: r1(value), text: `No games this season: his depth chart's usual ${r1(f.value)}${used.includes("cap") ? `, capped by your override at ${r1(ceiling)},` : ""} is used; TwoGun has ${isNum(m.tg) ? m.tg : "none"}${flag ? `; ${flag.text}` : ""}${lastRole === null ? "; last season's role is not on file, so the chart's usual is not checked against tonight's role" : ""}` };
    if (!overridden && f.source === "twogun") flag = m.lid || boxNote ? { kind: "no_role_games", twogun: m.tg, own: null, text: tail === noUsualText ? noUsualText : `${noGames ? "No games this season" : "No games in this role"}: TwoGun's number is used${tail ? `; ${tail}` : ""}` } : { kind: "not_matched", twogun: m.tg, own: null, text: "Not matched to the box scores, so no games of his were read: TwoGun's number is used" };
    if (!overridden && f.source === "none") flag = m.lid || boxNote ? { kind: "no_figure", twogun: null, own: null, text: `No games in this role and no TwoGun minutes: his minutes are missing${tail ? `; ${tail}` : ""}` } : { kind: "not_matched", twogun: null, own: null, text: "Not matched to the box scores and TwoGun has no minutes: his minutes are missing" };
    if (!overridden && f.source === "chart") chartMen.push(`${m.name} (chart ${r1(f.value)}, TwoGun ${isNum(m.tg) ? m.tg : "none"})`);
    by.set(m.id, { m, tier, recent, skipped, minutes_gate: minutesGate, figure: value, computed, ceiling, computed_ceiling: computedCeiling, basis, words, used, flag, n: f.n, source: f.source, returning: Boolean(returning) || f.source === "chart" });
  }
  for (const x of by.values()) if (isNum(x.m.pinned) && !isNum(x.figure)) { x.figure = x.m.pinned; x.ceiling = x.m.pinned; x.returning = false; x.pinFill = true; } // typed with no figure of ours: he is pinned at his typed minutes, nothing to move first
  const all = [...by.values()], known = all.filter((x) => isNum(x.figure)), missing = all.filter((x) => !isNum(x.figure));
  const { cuts: gives, moves } = coverReturns(known), given = new Map(); // Adam 11-13: a returning man's minutes come off his position's bench men first
  for (const x of known) { const g = (gives.get(x.m.id) ?? []).reduce((s, c) => s + c.minutes, 0); if (g > 0) { given.set(x.m.id, g); x.figure -= g; if (isNum(x.ceiling)) x.ceiling -= g; } } // the cut sticks (Adam 11-13): his pot room is measured from his figure before the cut, i.e. his ceiling is lowered by what he gave
  const { moved, by: shiftBy, moves: shiftMoves, ceilUp } = shiftTyped(known, shifts, gives); // Adam 11-13: a typed man's difference from his auto figure goes first to the bench men at his position; the cut sticks as for a returning man
  for (const x of known) { const v = moved.get(x.m.id) ?? 0; if (v !== 0) { x.figure += v; if (v < 0 && isNum(x.ceiling)) x.ceiling += v; if (isNum(x.ceiling)) x.ceiling += ceilUp.get(x.m.id) ?? 0; } }
  for (const x of known) if (isNum(x.m.pinned)) x.figure = x.m.pinned; // a typed man stands as typed (Adam 11-13): in every figure above like any man, in no pot stage and no trim list
  const free = known.filter((x) => !isNum(x.m.pinned)), room = (x) => Math.max(0, x.figure - Math.max(0, moved.get(x.m.id) ?? 0)); // a man's shift receipt is never trimmed back
  const sum = known.reduce((s, x) => s + x.figure, 0), out = new Map(), gap = TEAM_MINUTES - sum;
  const outWords = outs.length ? ` (Out: ${outs.map((o) => o.name).join(", ")})` : "", potWord = outs.length ? "Out men's pot" : "team's pot";
  if (noLast.length) notes.push(`${noLast.length} ${noLast.length === 1 ? "man" : "men"} Out for most of this season ha${noLast.length === 1 ? "s" : "ve"} no row in last season's totals, so cannot be recognized as returning: ${noLast.join(", ")}`);
  if (chartMen.length) notes.push(`${chartMen.length} ${chartMen.length === 1 ? "man" : "men"} with no game this season take${chartMen.length === 1 ? "s" : ""} their depth chart's usual instead of TwoGun's: ${chartMen.join(", ")}`);
  if (unmatched.length) notes.push(`${unmatched.length} ${unmatched.length === 1 ? "man" : "men"} not matched to the box scores, so no games were read (TwoGun's number is used): ${unmatched.join(", ")}`);
  for (const mv of moves) notes.push(returnNote(mv));
  if (shiftMoves.length > 1) notes.push(`Typed minutes worked in order of size of change, biggest first (the order typed is not kept): ${shiftMoves.map((m) => m.name).join(", ")}`);
  for (const mv of shiftMoves) notes.push(shiftNote(mv));
  const potState = { returning: moves.map((mv) => ({ name: mv.name, figure: r1(mv.figure), taken: r1(mv.taken), left: r1(mv.left), from: mv.from.map((f) => ({ name: f.name, minutes: r1(f.minutes) })) })), sum: r1(sum), gap: r1(gap), out: outs.map((o) => o.name), by_tier: { starter: 0, bench_plus: 0, bench: 0 }, trimmed: null, unassigned: 0 };
  const extra = new Map(known.map((x) => [x.m.id, 0]));
  const cut = new Map(known.map((x) => [x.m.id, 0])), tail = new Map();
  if (gap < -EPS) {
    // over 240: trim in reverse tier order (Adam 11-12): Bench first, the fewest recent minutes first, toward 0; then Bench+ in proportion; starters last, only when both are at 0
    let over = -gap;
    const trimmed = { bench: 0, bench_plus: 0, starter: 0 };
    const take = (tier, list, how) => {
      for (const x of list) { if (over <= EPS) break; const c = Math.min(room(x), over); cut.set(x.m.id, c); over -= c; trimmed[tier] += c; tail.set(x.m.id, how); }
    };
    const benchUp = free.filter((x) => x.tier === "bench").sort((a, b) => (a.recent.n > 0) - (b.recent.n > 0) || a.recent.total - b.recent.total);
    take("bench", benchUp, "Bench trimmed first, the fewest recent minutes first");
    for (const t of ["bench_plus", "starter"]) {
      const list = free.filter((x) => x.tier === t), tot = list.reduce((s, x) => s + room(x), 0), amount = Math.min(over, tot);
      if (over <= EPS || !tot) continue;
      for (const x of list) { const c = (amount * room(x)) / tot; cut.set(x.m.id, c); trimmed[t] += c; tail.set(x.m.id, t === "starter" ? "starters last: Bench and Bench+ already at 0" : "Bench+ trimmed in proportion"); }
      over -= amount;
    }
    potState.trimmed = trimmed;
    if (over > 0.005) notes.push(`${r1(over)} minutes over ${TEAM_MINUTES} could not be trimmed: your typed minutes and the men no trim may touch add to ${r1(TEAM_MINUTES + over)}`);
    notes.push(`The team's figures add to ${r1(sum)}, over ${TEAM_MINUTES}${outWords}: trimmed in reverse tier order: Bench ${r1(trimmed.bench)}, Bench+ ${r1(trimmed.bench_plus)}, starters ${r1(trimmed.starter)}`);
  } else if (gap > EPS && missing.length) {
    // a man with no figure is not 0 in the pot: nothing is handed out while any figure is missing (R1), said
    notes.push(`The team's figures add to ${r1(sum)}, ${r1(gap)} short of ${TEAM_MINUTES}${outWords}: the pot is not handed out while ${missing.map((x) => x.m.name).join(", ")} ha${missing.length === 1 ? "s" : "ve"} no figure`);
  } else if (gap > EPS) {
    let left = gap;
    const stage = (name, list, label) => {
      const r = shareOut(list.map((x) => ({ id: x.m.id, w: x.figure, room: Math.max(0, (x.ceiling ?? x.figure) - x.figure - extra.get(x.m.id)) })), left);
      for (const [id, v] of r.added) if (v > 0) { extra.set(id, extra.get(id) + v); tail.set(id, `${tail.get(id) ?? ""}${tail.get(id) ? "; " : ""}${label}`); }
      potState.by_tier[name] += left - r.left; left = r.left;
    };
    const outPos = new Set(outs.filter((o) => o.starter || (isNum(o.avg) && o.avg >= OUT_RELEVANT_AVG)).flatMap((o) => o.positions ?? []));
    const shares = (x) => (x.m.positions ?? []).some((p) => outPos.has(p));
    stage("starter", free.filter((x) => x.tier === "starter"), "starters first");
    const bp = free.filter((x) => x.tier === "bench_plus");
    if (left > EPS) stage("bench_plus", bp.filter(shares), "Bench+, a position the Out men play");
    if (left > EPS) stage("bench_plus", bp.filter((x) => !shares(x)), "Bench+");
    const bench = free.filter((x) => x.tier === "bench").sort((a, b) => (b.recent.n > 0) - (a.recent.n > 0) || b.recent.total - a.recent.total);
    for (const x of bench) { if (left <= EPS) break; stage("bench", [x], "Bench, in order of recent minutes"); }
    potState.unassigned = left;
    notes.push(`The team's figures add to ${r1(sum)}; the ${r1(gap)} left${outWords} goes in tier order: starters ${r1(potState.by_tier.starter)}, Bench+ ${r1(potState.by_tier.bench_plus)}, Bench ${r1(potState.by_tier.bench)}`);
    if (left > 0.005) notes.push(`${r1(left)} minutes are not given to anyone: every man who could take them is at his ceiling, so the team adds to ${r1(TEAM_MINUTES - left)}`);
  }
  for (const x of known) {
    const e = extra.get(x.m.id) ?? 0, c = cut.get(x.m.id) ?? 0, auto = x.figure + e - c, t = tail.get(x.m.id);
    const gv = given.get(x.m.id) ?? 0, sv = moved.get(x.m.id) ?? 0, shiftWords = (shiftBy.get(x.m.id) ?? []).map((c) => `; ${c.minutes > 0 ? "plus" : "minus"} ${r1(Math.abs(c.minutes))} for ${poss(c.name)} typed ${r1(c.typed)} (auto ${r1(c.auto)})`).join(""), cutWords = (gives.get(x.m.id) ?? []).map((c) => `; minus ${r1(c.minutes)} for ${poss(c.from)} return`).join("");
    out.set(x.m.id, { auto, figure: x.figure + gv - sv, computed: x.computed, ceiling: x.ceiling, computed_ceiling: x.computed_ceiling, tier: x.tier, basis: x.basis, used: x.used, skipped: x.skipped, minutes_gate: x.minutes_gate, flag: x.flag, n: x.n,
      why: `${x.words}${cutWords}${shiftWords}${e > 0 ? `; plus ${r1(e)} from the ${potWord} (${t})` : ""}${c > 0 ? `; minus ${r1(c)}: the team's figures are over ${TEAM_MINUTES} (${t})` : ""} = ${r1(auto)}` });
  }
  for (const x of missing) out.set(x.m.id, { auto: null, figure: null, computed: null, ceiling: null, computed_ceiling: null, tier: x.tier, basis: x.basis, used: x.used, skipped: x.skipped, minutes_gate: x.minutes_gate, flag: x.flag, n: 0, why: x.words });
  return { byId: out, notes, total: missing.length ? null : sum + [...extra.values()].reduce((s, v) => s + v, 0) - [...cut.values()].reduce((s, v) => s + v, 0), pot: potState };
}
