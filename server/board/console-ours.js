// The console's "ours" minutes (Adam 11-12: one minutes model): the tier engine's (console-tier.js over tiers.js) for the scenario's Outs, there being no second copy of the minutes logic in the console. Pure,
// shared by the page and the server.
// team.source says which minutes feed the optimizer: "twogun" (the default, the engine's own), "ours" (the tier engine with the scenario's outs), or "ours_edits" (the tier engine that also knows his marks
// and typed minutes, so the other men move with them). His typed minutes and marks always win on their own man whichever source is on. The tier engine's inputs are team.tier (server/minutes/tier-inputs.js).
import { MINUTE_SOURCES, badChart, chartFive, fiveNotes } from "./depth-chart.js";
import { tierUse, tierScenario } from "./console-tier.js";
import { isNum } from "./figures.js";

export const sourceOf = (team) => (MINUTE_SOURCES.includes(team.source) ? team.source : "twogun");

/** Whether the team's minutes can come from the engine, and if not why: { ok: true } or { ok: false, why } (why null for an older fixture with no engine field at all). */
export const oursUse = tierUse;

/** { id: { min, basis, median, tier, flag } } for the men the engine has inputs for, or null when the team has none. `withEdits`: his marks and typed minutes go in. */
export function oursFor(team, outSet, flips = {}, typed = {}, withEdits = false) {
  if (!oursUse(team).ok) return null;
  const res = tierScenario(team, outSet, flips, typed, withEdits), out = {};
  for (const p of team.men) if (res.minutes[p.id]) out[p.id] = res.minutes[p.id];
  Object.defineProperty(out, "totalNote", { value: res.notes.length ? res.notes.join("\n") : null, enumerable: false }); // the engine's notes for the team: the five, the pot, the trims; not a man
  return out;
}

/** The five as man ids, and notes: { ids, notes }. The engine's five (the lineup pages' five, else TwoGun's flags), with every man he marked S. */
export function tierStarters(team, outSet, flips) {
  const res = tierScenario(team, outSet, flips, {}, true);
  return { ids: res.five, notes: res.notes.filter((n) => /starters marked|Only \d+ starters/.test(n)) };
}

// ---- the saved depth chart's five: roles only, for inputs baked before the engine's `tier` existed (an older published console-inputs.json) and for a team the engine could not read. It gives no minutes. ----
const keyOfMan = (team, p) => (team.depth && p.depth_key && team.depth.men[p.depth_key] ? p.depth_key : null);
const checked = new WeakMap();
const badOnce = (chart) => { if (!checked.has(chart)) checked.set(chart, badChart(chart)); return checked.get(chart); };

/** Whether the team's saved chart can name its five: { ok: true } or { ok: false, why } (why null for a team with no chart field at all). */
export function chartUse(team) {
  if (team.depth === undefined) return { ok: false, why: null };
  if (team.depth === null) return { ok: false, why: team.depth_problem ?? `no depth chart for ${team.code ?? "this team"}` };
  const bad = badOnce(team.depth);
  return bad ? { ok: false, why: `the ${team.depth.team} depth chart fails its check (${bad})` } : { ok: true };
}

/** Whether a man is on the chart's injured list and still plays tonight: on the board with TwoGun minutes, and not Out in the scenario (TwoGun's status, applied news and Adam's marks all land in outSet). */
export function playsDespiteInjured(team, p, outSet) {
  const k = keyOfMan(team, p);
  return Boolean(k) && team.depth.men[k].role === "injured" && !outSet.has(p.id) && isNum(p.min) && p.min > 0;
}

/** One foot note per team (G68) for the chart-injured men who play tonight on this path (chart roles, TwoGun's minutes), names after a colon; null when none or when the roles come from the engine. Never split on its periods. */
export function injuredPlayNote(team, outSet) {
  if (rolesFromEngine(team) || !chartUse(team).ok) return null;
  const names = team.men.filter((p) => playsDespiteInjured(team, p, outSet)).map((p) => p.name);
  return names.length ? `On the ${team.depth.team} chart's injured list but playing tonight, in a bench role on TwoGun's minutes: ${names.join(", ")}` : null;
}

/** The chart's five as man ids, and notes: { ids, notes }. A set (depth-chart.js chartFive): the named starters who play and are not flipped away, every man marked S, and while fewer than five the named backup of a starter not playing. */
export function chartStarters(team, outSet, flips) {
  const keyOf = {}, idOf = {};
  for (const p of team.men) { const k = keyOfMan(team, p); if (k) { keyOf[p.id] = k; idOf[k] = p.id; } }
  const flipKeys = {};
  for (const [id, role] of Object.entries(flips)) if (keyOf[id]) flipKeys[keyOf[id]] = role;
  const manOf = (k) => team.men.find((p) => p.id === idOf[k]); // G68: a chart-injured man tonight's sources have playing is a normal rotation man; one Out (outSet) or with no minutes stays out
  const active = (k) => idOf[k] !== undefined && !outSet.has(idOf[k]) && (team.depth.men[k].role !== "injured" || flipKeys[k] !== undefined || playsDespiteInjured(team, manOf(k), outSet));
  const extra = team.men.filter((p) => !keyOfMan(team, p) && flips[p.id] === "starter" && !outSet.has(p.id)).map((p) => ({ key: `~${p.id}` }));
  const { five, why, notes } = chartFive(team.depth, active, flipKeys, extra);
  const ids = five.map((k) => (k.startsWith("~") ? k.slice(1) : idOf[k]));
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

/** Whether the roles come from the engine: it has inputs and Ours feeds the optimizer. With the TwoGun source the roles stay the chart's or the formula's, so a confirmed new starter can still be flipped and sent (news-apply). */
export const rolesFromEngine = (team) => oursUse(team).ok && sourceOf(team) !== "twogun";

/** The roles of a scenario from the engine: { id: "starter" | "bench_plus" | "bench" | "oor" | "out" }. */
export const tierRoles = (team, outSet, flips) => tierScenario(team, outSet, flips, {}, true).roles;
