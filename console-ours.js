// The console's "ours" minutes: the saved depth chart (depth-chart.js) joined to the team's men. A man is on the chart when his
// depth_key (the chart key the inputs route joins him to, by Basketball-Reference id, else by name) is a man of team.depth. Pure,
// shared by the page and the server.
// team.source says which minutes feed the optimizer: "twogun" (the default, the engine's own), "ours" (the chart with the scenario's
// outs), or "ours_edits" (the chart that also knows his role flips and typed minutes, so the other men move with them). His typed
// minutes and flips always win on their own man whichever source is on. The chart's minutes need team.depth_figures, last season's
// figures the inputs carry in (server/slate/depth-figures.js).
import { badChart, chartFive, chartMinutes, fiveNotes, MINUTE_SOURCES } from "./depth-chart.js";

export const sourceOf = (team) => (MINUTE_SOURCES.includes(team.source) ? team.source : "twogun");

const keyOfMan = (team, p) => (team.depth && p.depth_key && team.depth.men[p.depth_key] ? p.depth_key : null);
const checked = new WeakMap();
/** badChart's answer for a chart object, worked once per object. */
const badOnce = (chart) => {
  if (!checked.has(chart)) checked.set(chart, badChart(chart));
  return checked.get(chart);
};

/** Whether the team's chart can be used, and if not why: { ok: true } or { ok: false, why }. A team with no chart field at all (an older fixture) is { ok: false, why: null }. */
export function chartUse(team) {
  if (team.depth === undefined) return { ok: false, why: null };
  if (team.depth === null) return { ok: false, why: team.depth_problem ?? `no depth chart for ${team.code ?? "this team"}` };
  const bad = badOnce(team.depth);
  return bad ? { ok: false, why: `the ${team.depth.team} depth chart fails its check (${bad})` } : { ok: true };
}

/** The season figures for chartMinutes: the server's team.depth_figures with each board man's own starter MPG keyed "~<id>" beside the chart keys. */
export function chartFiguresOf(team) {
  const f = team.depth_figures;
  if (!f) return { missing: `no season figures for ${team.code ?? "this team"}` };
  if (f.missing) return f;
  const tilde = (map) => Object.fromEntries(Object.entries(map ?? {}).map(([id, v]) => [`~${id}`, v]));
  return { ...f, own: { ...(f.chart ?? {}), ...tilde(f.board) }, why: { ...(f.why?.chart ?? {}), ...tilde(f.why?.board) } };
}

/**
 * { id: { min, basis, median } } for the men on the chart (and, with edits, the men off it whom he flipped into the rotation), or null when the team has
 * no usable chart. `withEdits`: flips and typed minutes go in.
 */
export function oursFor(team, outSet, flips = {}, typed = {}, withEdits = false) {
  if (!chartUse(team).ok) return null;
  const extra = withEdits ? extraInsOf(team, outSet, flips) : [];
  const idOf = Object.fromEntries(extra.map((e) => [e.key, e.key.slice(1)]));
  const state = { outs: [], absent: [], flips: {}, typed: {}, extraIns: extra, figures: chartFiguresOf(team) };
  for (const p of team.men) {
    const k = keyOfMan(team, p);
    if (withEdits && !k && Object.hasOwn(typed, p.id) && idOf[`~${p.id}`]) state.typed[`~${p.id}`] = typed[p.id];
    if (!k) continue;
    idOf[k] = p.id;
    if (outSet.has(p.id)) state.outs.push(k);
    if (withEdits && Object.hasOwn(flips, p.id)) state.flips[k] = flips[p.id];
    if (withEdits && Object.hasOwn(typed, p.id)) state.typed[k] = typed[p.id];
  }
  state.absent = Object.keys(team.depth.men).filter((k) => idOf[k] === undefined); // on the chart, not on tonight's board
  const res = chartMinutes(team.depth, state), out = {};
  for (const [k, v] of Object.entries(res.minutes)) if (idOf[k] !== undefined) out[idOf[k]] = v;
  Object.defineProperty(out, "totalNote", { value: res.total_note, enumerable: false }); // why the chart's minutes are not 240, for the roles note; not a man
  return out;
}

/** A man's first board position ("PG/SG" -> "PG"), or undefined. */
const posOfMan = (p) => (typeof p.pos === "string" ? p.pos.split("/")[0] || undefined : undefined);
const EXTRA_ROLES = ["starter", "bench_plus", "bench"];

/** The men off the chart whom Adam flipped into the rotation and who are playing: [{ key: "~<id>", pos0, name, role }]: a starter like anyone, or the end of the bench order. */
export function extraInsOf(team, outSet, flips) {
  return team.men.filter((p) => !keyOfMan(team, p) && EXTRA_ROLES.includes(flips[p.id]) && !outSet.has(p.id)).map((p) => ({ key: `~${p.id}`, pos0: posOfMan(p), name: p.name, role: flips[p.id] }));
}

/**
 * The chart's starters as man ids, and notes: { ids: [..], notes: [text] }. A set (chartFive): the chart's named starters who play and are not flipped away,
 * every man he marked S on the chart or off it, and while fewer than five the named backup of a starter who is not playing. A chart man not on tonight's
 * board is not playing. A man on the chart's injured list whom TwoGun has playing is named, never given a role from his minutes.
 */
export function chartStarters(team, outSet, flips) {
  const keyOf = {}, idOf = {};
  for (const p of team.men) { const k = keyOfMan(team, p); if (k) { keyOf[p.id] = k; idOf[k] = p.id; } }
  const flipKeys = {};
  for (const [id, role] of Object.entries(flips)) if (keyOf[id]) flipKeys[keyOf[id]] = role;
  const active = (k) => idOf[k] !== undefined && !outSet.has(idOf[k]) && !(team.depth.men[k].role === "injured" && flipKeys[k] === undefined);
  const extra = extraInsOf(team, outSet, flips).filter((e) => e.role === "starter");
  const { five, why, notes } = chartFive(team.depth, active, flipKeys, extra);
  const ids = five.map((k) => (k.startsWith("~") ? k.slice(1) : idOf[k]));
  for (const p of team.men) {
    const k = keyOf[p.id];
    if (k && team.depth.men[k].role === "injured" && !outSet.has(p.id) && flips[p.id] === undefined && (p.min ?? 0) > 0) notes.push(`${p.name} is on the chart's injured list but TwoGun has him playing: flip his role or update the chart.`);
  }
  return { ids, notes: [...notes, ...fiveNotes(team.depth, five, active, why, flipKeys)] };
}

/** The men the chart could not be joined to, as a sentence for the roles note; null when every board man and rotation man matched. */
export function unmatchedNote(team) {
  const u = team.depth_unmatched;
  if (!u || (!u.board?.length && !u.chart?.length)) return null;
  const parts = [];
  if (u.board?.length) parts.push(`on the board: ${u.board.join(", ")}`);
  if (u.chart?.length) parts.push(`on the chart: ${u.chart.join(", ")}`);
  return `Not matched to the chart (${parts.join("; ")}).`;
}
