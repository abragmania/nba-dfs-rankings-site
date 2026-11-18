// Our depth chart by position (Adam 11-17, 2:07-2:58 PM): one position per man, five columns PG, SG, SF, PF and C, the starter on top; never DraftKings' positions. Pure ES module shared by the
// server's minutes engine (server/minutes/engine.js, personal-view.js) and the console page (console-tier.js, console-chart.js), so the board and the page place every man the same way
// (tests/depth_chart_minutes.test.mjs holds the two equal).
// The chart is a SEED (the position sources' consensus, server/minutes/pos-consensus.js: { PG: [keys], ..., none: [keys with no position] }) with Adam's MOVES replayed on it in time order. A move
// { key, pos, after, before, at } puts the man in column `pos` directly below `after` (null: at the top) or, when `after` is not in that column, directly above `before` (null: at the bottom). His
// moves are standing (they carry to later nights) and win over every source; only his newest move per man is kept (addMove), so the list never grows past the team's men.
// Bench order (Adam 2:14 PM): Bench+ men first, then every 2nd, then every 3rd and below, ties broken by a blend of last 10 and season minutes a game (Adam 11:40 AM 11-18, bench-blend.js); men with no position after them.
import { ordinal } from "./team-fill.js";

export const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
export const MOVES_MAX = 80; // more moves than this on one team is refused (a team has at most about 20 men)
const KEY = /^[a-z0-9-]{1,80}$/, ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;
const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Null when `m` is a well-formed move, else why. Checked on every read and write (store.js) and on the route (outside input). */
export function badMove(m) {
  if (!isPlain(m)) return "a move is not an object";
  if (!KEY.test(m.key ?? "")) return "a move names no man";
  if (!POSITIONS.includes(m.pos)) return `a move's position must be one of ${POSITIONS.join(", ")}`;
  for (const k of ["after", "before"]) if (!(m[k] === null || (typeof m[k] === "string" && KEY.test(m[k]) && m[k] !== m.key))) return `a move's ${k} must be another man or null`;
  if (!ISO.test(m.at ?? "")) return "a move has no time";
  if (Object.keys(m).some((k) => !["key", "pos", "after", "before", "at"].includes(k))) return "a move carries a field it should not";
  return null;
}
/** Null when `list` is a well-formed moves list, else why. */
export function badMoves(list) {
  if (!Array.isArray(list)) return "the moves must be a list";
  if (list.length > MOVES_MAX) return `more than ${MOVES_MAX} moves`;
  for (const m of list) { const why = badMove(m); if (why) return why; }
  if (new Set(list.map((m) => m.key)).size !== list.length) return "a man has two moves (only his newest is kept)";
  return null;
}

/** An empty seed: every column empty. */
export const emptySeed = () => ({ ...Object.fromEntries(POSITIONS.map((p) => [p, []])), none: [] });

/**
 * The whole chart: the seed with the moves replayed in order. Returns { cols: { PG: [keys], ... }, none: [keys with no position], posOf: Map key -> position (null: none), moved: Set of keys his moves
 * placed, bad: [{ key, why }] the moves skipped as not well formed }. A man a move names who is not in the seed is placed all the same (he may be on another night's list). Pure.
 */
export function chartCols(seed, moves = []) {
  const cols = Object.fromEntries(POSITIONS.map((p) => [p, [...(seed?.[p] ?? [])]]));
  let none = [...(seed?.none ?? [])];
  const moved = new Set(), bad = [];
  for (const m of moves ?? []) {
    const why = badMove(m);
    if (why) { bad.push({ key: typeof m?.key === "string" ? m.key.slice(0, 80) : null, why }); continue; } // never trusted blindly: a bad move is skipped and counted (G62; the store refuses one on write)
    for (const p of POSITIONS) cols[p] = cols[p].filter((k) => k !== m.key);
    none = none.filter((k) => k !== m.key);
    const col = cols[m.pos], a = m.after === null ? -1 : col.indexOf(m.after), b = m.before === null ? -1 : col.indexOf(m.before);
    const at = a >= 0 ? a + 1 : b >= 0 ? b : m.after === null ? 0 : col.length; // below the man above him, else above the man below him, else the top (he was put at the top) or the bottom
    col.splice(at, 0, m.key);
    moved.add(m.key);
  }
  const posOf = new Map();
  for (const p of POSITIONS) for (const k of cols[p]) posOf.set(k, p);
  for (const k of none) posOf.set(k, null);
  return { cols, none, posOf, moved, bad };
}

/**
 * No empty column tonight (the lead, 11-17): a position with no man of `present` (Set of keys) takes the best man with any vote or listing there (alts: key -> { P: { score, espn } }, pos-consensus.js): first one the
 * lineup pages name in the five (`likely`, Set of keys) who sits in a column holding two of that five, then any man of the five, then the higher score, then ESPN's place there, then name. Never a man Adam moved
 * (his moves win) and never a column's only man tonight. The man goes at the column's end, behind tonight's Out men, so an Out starter keeps his healthy place. A column stays empty only when no man present has
 * a vote or listing for it. Returns { chart (chartCols's shape), fills: [{ key, from (null: no position), to }] }. Pure.
 */
export function fillEmpty(chart, present, alts, likely = new Set(), nameOf = (k) => k) {
  const cols = Object.fromEntries(POSITIONS.map((p) => [p, [...chart.cols[p]]])), posOf = new Map(chart.posOf);
  let none = [...chart.none];
  const fills = [], here = (p) => cols[p].filter((k) => present.has(k));
  for (const p of POSITIONS) {
    if (here(p).length) continue;
    const pages = (q) => (q ? here(q).filter((k) => likely.has(k)).length : 0);
    const cands = [...present].filter((k) => alts?.[k]?.[p] && !chart.moved.has(k) && (!posOf.get(k) || here(posOf.get(k)).length > 1)).map((k) => {
      const from = posOf.get(k) ?? null, a = alts[k][p];
      return { k, from, two: likely.has(k) && pages(from) >= 2 ? 0 : 1, five: likely.has(k) ? 0 : 1, score: a.score, espn: Number.isInteger(a.espn) ? a.espn : 99 };
    }).sort((x, y) => x.two - y.two || x.five - y.five || y.score - x.score || x.espn - y.espn || String(nameOf(x.k)).localeCompare(String(nameOf(y.k))));
    const c = cands[0];
    if (!c) continue;
    if (c.from) cols[c.from] = cols[c.from].filter((k) => k !== c.k); else none = none.filter((k) => k !== c.k);
    cols[p].push(c.k);
    posOf.set(c.k, p);
    fills.push({ key: c.k, from: c.from, to: p });
  }
  return { chart: { cols, none, posOf, moved: chart.moved, bad: chart.bad ?? [] }, fills };
}

/**
 * One starter at every position (Adam 6:26 PM 11-18: "There's supposed to be a starter at every position on the DC"; 3:02 PM: an Out starter's spot is taken by the next man up). For the chart's DISPLAY only (the
 * five, roles and minutes come from the chart before it: review of 11-18, finding 1). After fillEmpty, a column holding none of tonight's `five` (Set of keys) takes one of the five who sits in a column holding
 * two or more of them, or in no column; a man starting tonight never leaves a column where he is the only starter, and a man Adam moved never moves (his moves stand, as in fillEmpty).
 * Best fit first, over every such column and man: the higher vote or listing for that column (alts), then ESPN's place there, then the lower man in his column (that column keeps its top starter), then PG..C
 * order, then name. With fewer of the five here than columns (a short five), only a man with a vote or listing there moves (the short-five fill covers the rest). He goes directly above the column's first present
 * man, so he tops tonight's view and the Out men keep their healthy places. Returns { chart, shifts: [{ key, from (null: no position), to, over (the man Adam moved who topped that column, or null) }],
 * blocked: [{ pos, keys (the spare starters left where Adam moved them) }] (a column still with no starter only because of his moves) }. Pure.
 */
export function balanceFive(chart, present, five, alts = {}, nameOf = (k) => k) {
  const cols = Object.fromEntries(POSITIONS.map((p) => [p, [...chart.cols[p]]])), posOf = new Map(chart.posOf);
  let none = [...chart.none];
  const shifts = [], starts = (p) => cols[p].filter((k) => present.has(k) && five.has(k)), moved = chart.moved ?? new Set();
  const short = [...five].filter((k) => present.has(k)).length < POSITIONS.length;
  const spare = () => [...none.filter((k) => present.has(k) && five.has(k)), ...POSITIONS.filter((q) => starts(q).length > 1).flatMap((q) => starts(q))];
  for (;;) {
    const empty = POSITIONS.filter((p) => !starts(p).length), donors = spare().filter((k) => !moved.has(k));
    const pairs = empty.flatMap((p) => donors.map((k) => {
      const from = posOf.get(k) ?? null, a = alts?.[k]?.[p];
      return { k, p, from, score: a?.score ?? 0, espn: Number.isInteger(a?.espn) ? a.espn : 99, idx: from ? cols[from].indexOf(k) : -1 };
    })).filter((x) => !short || x.score > 0)
      .sort((x, y) => y.score - x.score || x.espn - y.espn || y.idx - x.idx || POSITIONS.indexOf(x.p) - POSITIONS.indexOf(y.p) || String(nameOf(x.k)).localeCompare(String(nameOf(y.k))));
    const d = pairs[0];
    if (!d) break; // the five cannot spread further: each column left keeps its order (a short five's fill covers it)
    if (d.from) cols[d.from] = cols[d.from].filter((k) => k !== d.k); else none = none.filter((k) => k !== d.k);
    const at = cols[d.p].findIndex((k) => present.has(k)), top = at < 0 ? null : cols[d.p][at];
    cols[d.p].splice(at < 0 ? cols[d.p].length : at, 0, d.k);
    posOf.set(d.k, d.p);
    shifts.push({ key: d.k, from: d.from, to: d.p, over: top && moved.has(top) ? top : null });
  }
  const held = spare().filter((k) => moved.has(k)), blocked = held.length ? POSITIONS.filter((p) => !starts(p).length).map((pos) => ({ pos, keys: held })) : [];
  return { chart: { cols, none, posOf, moved: chart.moved, bad: chart.bad ?? [] }, shifts, blocked };
}

/** The team note on the shifts and blocked columns (balanceFive): "One starter at every position tonight: Quenton Jackson moved to PG from SG (SG holds two of tonight's five and PG none)". */
export function shiftNote(shifts, nameOf, blocked = []) {
  const said = shifts.map((s) => `${nameOf(s.key)} moved to ${s.to} from ${s.from ?? "no position"} (${s.from ? `${s.from} holds two of tonight's five and ${s.to} none` : `he has no position and ${s.to} has no starter`})${s.over ? `; he starts at ${s.to} above your move of ${nameOf(s.over)}` : ""}`);
  const held = blocked.map((b) => `${b.pos} has no starter tonight: the spare starter${b.keys.length === 1 ? ", " : "s, "}${b.keys.map(nameOf).join(" and ")}, ${b.keys.length === 1 ? "is" : "are"} where you moved ${b.keys.length === 1 ? "him" : "them"}, and your moves stand`);
  return said.length || held.length ? [said.length ? `One starter at every position tonight: ${said.join("; ")}` : null, ...held].filter(Boolean).join(". ") : null;
}

/** The team note on each fill (fillEmpty):"Our chart had no healthy SF tonight: Kevin Huerter moved there from SG (his next-best vote); move him back on the chart to undo it". */
export const fillNote = (fills, nameOf) => (fills.length ? `Our chart had no healthy man at ${fills.map((f) => f.to).join(" and ")} tonight: ${fills.map((f) => `${nameOf(f.key)} moved to ${f.to} from ${f.from ?? "no position"}`).join("; ")} (his next-best vote there; your own move overrides it)` : null);

/** Tonight's view: the chart cut to the men in `present` (a Set of keys), in chart order; a present man the chart does not hold goes to `none`. { PG: [keys], ..., none: [keys] }. Pure. */
export function tonightCols(chart, present) {
  const view = Object.fromEntries(POSITIONS.map((p) => [p, chart.cols[p].filter((k) => present.has(k))]));
  const placed = new Set(POSITIONS.flatMap((p) => view[p]));
  view.none = [...chart.none.filter((k) => present.has(k)), ...[...present].filter((k) => !placed.has(k) && !chart.none.includes(k))];
  return view;
}

/** For a short five: the top man not in the five of each column holding nobody of the five (PG..C order). five: Set of keys. */
export const shortFiveFill = (view, five) => POSITIONS.filter((p) => !view[p].some((k) => five.has(k))).map((p) => view[p].find((k) => !five.has(k))).filter(Boolean);

/** The top man of each column tonight, in PG..C order. */
export const columnTops = (view) => POSITIONS.map((p) => view[p][0]).filter(Boolean);

/**
 * Each present man's place: Map key -> { pos (null: no position), idx (his place in his column, 0 the top), rank (off the five: 1 + the men above him in his column who are not in the five, so the first man
 * behind the five is 1, a "2nd"; null in the five or with no position), tag ("S" in the five, else "2nd", "3rd", ...; "" with no position) }. five: Set of keys starting tonight. Pure.
 */
export function depthPlaces(view, five) {
  const out = new Map();
  for (const p of POSITIONS) {
    let off = 0;
    view[p].forEach((k, idx) => {
      if (five.has(k)) { out.set(k, { pos: p, idx, rank: null, tag: "S" }); return; }
      off++;
      out.set(k, { pos: p, idx, rank: off, tag: ordinal(off + 1) });
    });
  }
  for (const k of view.none) out.set(k, { pos: null, idx: null, rank: null, tag: five.has(k) ? "S" : "" });
  return out;
}

/**
 * The healthy chart (the lead's fix of 11-17): the chart cut to tonight's men AND the team's Out men, each in his place; its column tops are the healthy five. Map key -> { pos, rank (as depthPlaces, against
 * the healthy five), starter (a healthy top) }. Used for an Out man's healthy role (pairing); bench spots count the men here tonight only (Adam 3:02 PM 11-18). Pure.
 */
export function healthyPlaces(chart, keys) {
  const view = tonightCols(chart, keys), tops = new Set(columnTops(view)), pl = depthPlaces(view, tops);
  return new Map([...pl].map(([k, p]) => [k, { pos: p.pos, rank: p.rank, idx: p.idx, starter: tops.has(k) }]));
}

/**
 * The move that puts `key` at place `index` (0 the top) of column `pos` in tonight's view (his own place left out first), anchored on the men around him there. Pure.
 */
export function moveAt(view, key, pos, index, at) {
  const col = (view[pos] ?? []).filter((k) => k !== key), i = Math.max(0, Math.min(Number.isInteger(index) ? index : col.length, col.length));
  return { key, pos, after: i > 0 ? col[i - 1] : null, before: col[i] ?? null, at };
}

/** One step up (dir -1) or down (+1) in his own column: the move, or null at the edge or with no position. */
export function stepMove(view, key, dir, at) {
  const p = POSITIONS.find((x) => view[x].includes(key));
  if (!p) return null;
  const i = view[p].indexOf(key), j = i + dir;
  if (j < 0 || j >= view[p].length) return null;
  return moveAt(view, key, p, j, at);
}

/** Another position for him at the same depth (clamped to the new column's length). */
export function posMove(view, key, pos, at) {
  const from = POSITIONS.find((x) => view[x].includes(key)), i = from ? view[from].indexOf(key) : (view[pos] ?? []).length;
  return from === pos ? null : moveAt(view, key, pos, i, at);
}

/** The moves list with `move` as his newest (his older move dropped). */
export const addMove = (moves, move) => [...(moves ?? []).filter((m) => m.key !== move.key), move];

/**
 * The bench in Adam's order (2:14 PM 11-17): men = [{ key, bplus (Bench+ tonight), blend (his blend of last 10 and season minutes a game, bench-blend.js benchBlend; null with no game) }] off the five; places:
 * depthPlaces. Bench+ first, then rank 1 (the 2nds), rank 2 (the 3rds) and on, then the men with no position; inside a group the higher blend first (Adam 11:40 AM 11-18; none last), then the chart's own
 * order. Returns the men in that order, each with `group` (0 Bench+, n the rank, 99 no position). Pure.
 */
export function benchOrder(men, places) {
  const groupOf = (m) => (m.bplus ? 0 : places.get(m.key)?.rank ?? 99);
  const blend = (m) => (typeof m.blend === "number" && Number.isFinite(m.blend) ? m.blend : -1);
  // the last tie-break is the name (when given), never the list's order: the board's engine and the console list the men in different orders and must agree
  return men.map((m, i) => ({ ...m, group: groupOf(m), i })).sort((a, b) => a.group - b.group || blend(b) - blend(a) || (places.get(a.key)?.idx ?? 99) - (places.get(b.key)?.idx ?? 99) || String(a.name ?? "").localeCompare(String(b.name ?? "")) || a.i - b.i);
}
