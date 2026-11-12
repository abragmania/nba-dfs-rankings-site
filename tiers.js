// Our minutes engine's three-tier model (Adam 11-12, replacing the rung/slot ladder), pure; tests/minutes_tiers.test.mjs on frozen fixtures.
//  1. Tiers. Starter: tonight's five (the lineup pages' confirmed or agreed five, else TwoGun's starter flags on the board, said "expected"; a short five is filled from tonight's order).
//     Bench+: a regular with real minutes in the team's last RECENT_GAMES games (BENCH_PLUS_GAMES of them, BENCH_PLUS_AVG a game when he played). Bench: everyone else, a man with no recent
//     games included. An injury never moves a man up a tier.
//  2. His own figure is ROLE DEPENDENT: the mean of his minutes in this season's games he played in tonight's role (started, or came off the bench). Last season's role games would fill a
//     thin sample, but no source on file carries last season's per-game role (the ESPN logs have no starter flag), so only this season's are read. No game in the role: TwoGun's number for
//     tonight, flagged "no games in this role" (R1: missing when TwoGun has none). Never his usual across roles, a blend across roles, or a slot or rung average.
//  3. His ceiling: the CEILING_QUANTILE of his same-role games; fewer than CEILING_MIN_GAMES, his best; none, TwoGun's number. Never a single-game high otherwise.
//  4. Pot: the team's figures against 240. Under 240 (the Out men's minutes): starters are filled first, each up to his ceiling; then Bench+ up to theirs, men sharing a position with an Out man
//     first; then Bench in order of recent minutes, a man with no recent game last. Over 240: trimmed in reverse tier order (Bench, fewest recent minutes first, toward 0; then Bench+ in proportion; starters last), each trim said in the team's notes. What nobody can take is named, never dropped (G62).
//  5. Minutes limit: TwoGun far below his own figure (FAR_BELOW share and FAR_BELOW_MIN minutes) flags the row; both figures are shown, ours stands.
// RECENT_GAMES, BENCH_PLUS_*, CEILING_*, FAR_BELOW* are working values Adam may tune. Typed minutes and standing minutes overrides are applied after this (figures.js), never rescaled.
import { isNum } from "./figures.js";

const GAME_MINUTES = 240; // no import from tools/: the console page runs this file in the browser (server/board is what the page can load)
export const RETURN_LAST_GAMES = 20; // a returning rotation man needs this many games last season (a working value)
export const RECENT_GAMES = 10;
export const BENCH_PLUS_GAMES = 6;
export const BENCH_PLUS_AVG = 15;
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

/** A man's recent games: his own games (any team) dated on or after `since`, the date of the team's RECENT_GAMES-th last game (null: none). { n (played), total, avg (when he played) }. Pure. */
export function recentOf(rows, since) {
  const mine = since ? rows.filter((r) => r.date >= since) : [];
  const total = mine.reduce((s, r) => s + r.min, 0);
  return { n: mine.length, total, avg: mine.length ? total / mine.length : null };
}

/** One man's figure and ceiling for a role from his rows ({ min, started }): { value, ceiling, n, source: "role" | "twogun" | "none" }. Pure. */
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

const tierWords = { starter: "Starter", bench_plus: "Bench+", bench: "Bench" };

/**
 * Tonight's minutes for one team. men: [{ id, key, name, lid (ledger id or null), tg (TwoGun's minutes or null), positions, in_five, replaces: [names of the Out starters he takes the place of], last_mpg (last
 * season's minutes a game, for a man with no games this season), ov: { usual, cap } (standing overrides' values, or {}) }]; rowsOf(lid) -> this season's played games [{ min, started }]; games: the team's ledger
 * games (null: none read); teamMinutes: what the team's men share (240; the console's typed minutes come off it); outs: [{ name, lid, positions, starter }] (Out for a reason); five: { kind, note }; boxNote: why games are unusable, or null.
 * Returns { byId: Map id -> { auto (null when missing), figure, computed, ceiling, computed_ceiling, tier, basis, why, used, flag, n }, notes, total (null when a figure is missing), pot }. Pure.
 */
export function tierPlan({ men, rowsOf, games, outs = [], five, boxNote = null, teamMinutes: TEAM_MINUTES = GAME_MINUTES, since: sinceIn, teamGames: teamGamesIn }) {
  // since / teamGames: given by the console's payload (no ledger games there); else read from `games`
  const notes = [], by = new Map(), unmatched = [], noLast = [], since = sinceIn === undefined ? (games ?? []).slice(-RECENT_GAMES)[0]?.date ?? null : sinceIn, teamGames = teamGamesIn ?? (games ?? []).length;
  if (five?.note) notes.push(five.note);
  notes.push(`Starters: ${five.kind === "expected" ? `expected, TwoGun's starter flags (${five.why ? `the lineup pages' five was not used: ${five.why}` : "the lineup pages have not posted a five"})` : `the lineup pages' ${five.kind} five`}`);
  if (boxNote) notes.push(boxNote);
  for (const m of men) {
    const rows = boxNote || !m.lid ? [] : rowsOf(m.lid) ?? [], recent = recentOf(rows, since);
    if (!boxNote && !m.lid) unmatched.push(m.name);
    // a returning rotation man (Out for most of this season's games with a real last season, or back from an injury that kept him Out for most of the last 10) takes his tier from his own minutes then
    let returning = null;
    if (!m.in_five && recent.n < BENCH_PLUS_GAMES && !boxNote) {
      const allMean = rows.length ? rows.reduce((s, r) => s + r.min, 0) / rows.length : null, window = Math.min(RECENT_GAMES, teamGames);
      if (!rows.length && teamGames > 0 && (m.out_season ?? 0) * 2 > teamGames && m.last_unknown) noLast.push(m.name);
      if (!rows.length && teamGames > 0 && (m.out_season ?? 0) * 2 > teamGames && (m.last_games ?? 0) >= RETURN_LAST_GAMES && isNum(m.last_mpg) && m.last_mpg >= BENCH_PLUS_AVG)
        returning = `returning rotation man: ${r1(m.last_mpg)} a game over ${m.last_games} games last season, Out for ${m.out_season} of the team's ${teamGames} games this season`;
      else if (rows.length && window > 0 && (m.out_recent ?? 0) * 2 > window && allMean >= BENCH_PLUS_AVG)
        returning = `back from injury: ${r1(allMean)} a game over ${rows.length} earlier game${rows.length === 1 ? "" : "s"} this season, Out for ${m.out_recent} of the team's last ${window}`;
    }
    const tier = m.tier_force ?? (m.in_five ? "starter" : (recent.n >= BENCH_PLUS_GAMES && recent.avg >= BENCH_PLUS_AVG) || returning ? "bench_plus" : "bench");
    const role = tier === "starter" ? "starter" : "bench", f = roleFigure(rows, role, m.tg);
    let value = f.value, ceiling = f.ceiling;
    const computed = value, computedCeiling = ceiling, used = [];
    let words;
    const pre = returning ? `${returning}; ` : "";
    if (f.source === "role") words = `${pre}${tierWords[tier]}: mean ${r1(f.value)} over ${f.n} game${f.n === 1 ? "" : "s"} he played ${ROLE_WORD[role]} this season, ceiling ${r1(f.ceiling)} (${f.n < CEILING_MIN_GAMES ? `his best: under ${CEILING_MIN_GAMES} games` : `the ${Math.round(CEILING_QUANTILE * 100)}th percentile of them`})${f.n < CEILING_MIN_GAMES ? "; last season's role games are not on file" : ""}`;
    else if (f.source === "twogun") words = `${pre}${tierWords[tier]}${m.replaces.length ? ` (takes ${m.replaces.join(", ")}'s place in the five)` : ""}: no games ${ROLE_WORD[role]} this season, so TwoGun's ${r1(f.value)} minutes, his ceiling too (flag: no games in this role; last season's role games are not on file)`;
    else words = `${pre}${tierWords[tier]}: no games ${ROLE_WORD[role]} this season and TwoGun has no minutes for him: minutes missing, not guessed (RULES R1)`;
    if (isNum(m.ov.usual)) { value = m.ov.usual; used.push("usual"); }
    if (isNum(m.ov.cap)) { ceiling = m.ov.cap; used.push("cap"); if (isNum(value) && value > ceiling) value = ceiling; } else if (isNum(m.ov.usual) && isNum(ceiling) && ceiling < m.ov.usual) { ceiling = m.ov.usual; used.push("cap"); }
    if (isNum(m.ov.usual) && !isNum(ceiling)) { ceiling = m.ov.usual; used.push("cap"); }
    if (used.length) words += `; your standing override sets his ${used.map((u) => (u === "usual" ? "figure" : "ceiling")).join(" and ")}`;
    const overridden = used.includes("usual");
    const basis = overridden ? "override" : f.source === "none" ? "none" : f.source === "twogun" ? "twogun" : m.replaces.length && tier === "starter" ? "replaces" : tier;
    let flag = null;
    if (f.source === "role" && isNum(m.tg) && isNum(value) && m.tg < value * (1 - FAR_BELOW) && value - m.tg >= FAR_BELOW_MIN)
      flag = { kind: "twogun_far_below", twogun: m.tg, own: r1(value), text: `Minutes limit: TwoGun has ${m.tg}, far below his own ${r1(value)} (over ${Math.round(FAR_BELOW * 100)}% and ${FAR_BELOW_MIN}+ minutes under); both are shown, ours is used` };
    if (!overridden && f.source === "twogun") flag = m.lid || boxNote ? { kind: "no_role_games", twogun: m.tg, own: null, text: "No games in this role: TwoGun's number is used" } : { kind: "not_matched", twogun: m.tg, own: null, text: "Not matched to the box scores, so no games of his were read: TwoGun's number is used" };
    if (!overridden && f.source === "none") flag = m.lid || boxNote ? { kind: "no_figure", twogun: null, own: null, text: "No games in this role and no TwoGun minutes: his minutes are missing" } : { kind: "not_matched", twogun: null, own: null, text: "Not matched to the box scores and TwoGun has no minutes: his minutes are missing" };
    by.set(m.id, { m, tier, recent, figure: value, computed, ceiling, computed_ceiling: computedCeiling, basis, words, used, flag, n: f.n, source: f.source });
  }
  const all = [...by.values()], known = all.filter((x) => isNum(x.figure)), missing = all.filter((x) => !isNum(x.figure));
  const sum = known.reduce((s, x) => s + x.figure, 0), out = new Map(), gap = TEAM_MINUTES - sum;
  const outWords = outs.length ? ` (Out: ${outs.map((o) => o.name).join(", ")})` : "", potWord = outs.length ? "Out men's pot" : "team's pot";
  if (noLast.length) notes.push(`${noLast.length} ${noLast.length === 1 ? "man" : "men"} Out for most of this season ha${noLast.length === 1 ? "s" : "ve"} no row in last season's totals, so cannot be recognized as returning: ${noLast.join(", ")}`);
  if (unmatched.length) notes.push(`${unmatched.length} ${unmatched.length === 1 ? "man" : "men"} not matched to the box scores, so no games were read (TwoGun's number is used): ${unmatched.join(", ")}`);
  const potState = { sum: r1(sum), gap: r1(gap), out: outs.map((o) => o.name), by_tier: { starter: 0, bench_plus: 0, bench: 0 }, trimmed: null, unassigned: 0 };
  const extra = new Map(known.map((x) => [x.m.id, 0]));
  const cut = new Map(known.map((x) => [x.m.id, 0])), tail = new Map();
  if (gap < -EPS) {
    // over 240: trim in reverse tier order (Adam 11-12): Bench first, the fewest recent minutes first, toward 0; then Bench+ in proportion; starters last, only when both are at 0
    let over = -gap;
    const trimmed = { bench: 0, bench_plus: 0, starter: 0 };
    const take = (tier, list, how) => {
      for (const x of list) { if (over <= EPS) break; const c = Math.min(x.figure, over); cut.set(x.m.id, c); over -= c; trimmed[tier] += c; tail.set(x.m.id, how); }
    };
    const benchUp = known.filter((x) => x.tier === "bench").sort((a, b) => (a.recent.n > 0) - (b.recent.n > 0) || a.recent.total - b.recent.total);
    take("bench", benchUp, "Bench trimmed first, the fewest recent minutes first");
    for (const t of ["bench_plus", "starter"]) {
      const list = known.filter((x) => x.tier === t), tot = list.reduce((s, x) => s + x.figure, 0), amount = Math.min(over, tot);
      if (over <= EPS || !tot) continue;
      for (const x of list) { const c = (amount * x.figure) / tot; cut.set(x.m.id, c); trimmed[t] += c; tail.set(x.m.id, t === "starter" ? "starters last: Bench and Bench+ already at 0" : "Bench+ trimmed in proportion"); }
      over -= amount;
    }
    potState.trimmed = trimmed;
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
    stage("starter", known.filter((x) => x.tier === "starter"), "starters first");
    const bp = known.filter((x) => x.tier === "bench_plus");
    if (left > EPS) stage("bench_plus", bp.filter(shares), "Bench+, a position the Out men play");
    if (left > EPS) stage("bench_plus", bp.filter((x) => !shares(x)), "Bench+");
    const bench = known.filter((x) => x.tier === "bench").sort((a, b) => (b.recent.n > 0) - (a.recent.n > 0) || b.recent.total - a.recent.total);
    for (const x of bench) { if (left <= EPS) break; stage("bench", [x], "Bench, in order of recent minutes"); }
    potState.unassigned = left;
    notes.push(`The team's figures add to ${r1(sum)}; the ${r1(gap)} left${outWords} goes in tier order: starters ${r1(potState.by_tier.starter)}, Bench+ ${r1(potState.by_tier.bench_plus)}, Bench ${r1(potState.by_tier.bench)}`);
    if (left > 0.005) notes.push(`${r1(left)} minutes are not given to anyone: every man who could take them is at his ceiling, so the team adds to ${r1(TEAM_MINUTES - left)}`);
  }
  for (const x of known) {
    const e = extra.get(x.m.id) ?? 0, c = cut.get(x.m.id) ?? 0, auto = x.figure + e - c, t = tail.get(x.m.id);
    out.set(x.m.id, { auto, figure: x.figure, computed: x.computed, ceiling: x.ceiling, computed_ceiling: x.computed_ceiling, tier: x.tier, basis: x.basis, used: x.used, flag: x.flag, n: x.n,
      why: `${x.words}${e > 0 ? `; plus ${r1(e)} from the ${potWord} (${t})` : ""}${c > 0 ? `; minus ${r1(c)}: the team's figures are over ${TEAM_MINUTES} (${t})` : ""} = ${r1(auto)}` });
  }
  for (const x of missing) out.set(x.m.id, { auto: null, figure: null, computed: null, ceiling: null, computed_ceiling: null, tier: x.tier, basis: x.basis, used: x.used, flag: x.flag, n: 0, why: x.words });
  return { byId: out, notes, total: missing.length ? null : sum + [...extra.values()].reduce((s, v) => s + v, 0) - [...cut.values()].reduce((s, v) => s + v, 0), pot: potState };
}
