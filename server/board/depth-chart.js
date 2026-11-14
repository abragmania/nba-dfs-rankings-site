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
// Minutes: none are worked here any more (Adam 11-12, one minutes model): the minutes engine's three-tier model (server/board/tiers.js) gives every figure. Usual stays on the chart as information and feeds no minutes figure.
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
 * The typed minutes that are real edits: { key: minutes } without the men typed at the figure the sharing gives them untyped (within SAME_MIN, a thousandth kept).
 * Such a man is no edit, so he is shared as if untyped and nobody moves; this is the one place that rule lives, for the TwoGun source in console-engine.js.
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

