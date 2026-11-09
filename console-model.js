// The console's state for one slate: the teams from the inputs route, his saved work per team (ST) and the calculations on them,
// through console-engine.js. No page here, so the tests can run it in node.
import { keyOf, outsOf, emptyPins, scenario, teamFor } from "./console-engine.js";
import { MINUTE_SOURCES } from "./depth-chart.js";

const SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;
/** His last name, a generational suffix aside. */
export const lastName = (name) => {
  const words = String(name).trim().split(/\s+/);
  while (words.length > 1 && SUFFIX.test(words.at(-1))) words.pop();
  return words.at(-1);
};
/** "T. Varga": first initial and the rest of the name. */
export const shortName = (name) => {
  const words = String(name).trim().split(/\s+/);
  return words.length > 1 ? `${words[0][0]}. ${words.slice(1).join(" ")}` : words[0];
};
/** A man's name in the table, side panel and sweep: short, or his whole name when another man on the team has the same short one. */
export const tableName = (T, p) => (T.pl.filter((x) => shortName(x.name) === shortName(p.name)).length > 1 ? p.name : shortName(p.name));
/** A man's name on a chip, in a scenario's name and in the history: his last name, or his whole name when another man shares it. */
export const chipName = (T, p) => (T.pl.filter((x) => lastName(x.name) === lastName(p.name)).length > 1 ? p.name : lastName(p.name));
/** Lowercase with accents gone, for the command box's matching. */
export const plain = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
export const sgn = (x) => (Math.abs(x) < 0.05 ? "0.0" : (x > 0 ? "+" : "") + f1(x));
export const dcls = (x) => (Math.abs(x) < 0.05 ? "dim" : x > 0 ? "up" : "dn");

/** What the team's teams object becomes: T per team (men by usual minutes, byId, tonightKey) and ST (his work). Each team opens on the scenario
 *  on show when his work was last saved (rec.on), else the one an Apply last sent (`appliedKeys`: { key, tonight }, or the key alone in an older record),
 *  else Tonight. rec.on is saved with every change, so it is never older than the applied key: a change whose send never landed is not lost on a reload.
 *  Each is rebased from the Tonight it was made on onto this one (moveTo), his pins carried across; an id no longer on the team drops. */
export function buildModel(inputs, saved, appliedKeys = {}) {
  const TEAMS = {}, ST = {};
  for (const [code, input] of Object.entries(inputs.teams)) {
    const T = TEAMS[code] = shapeTeam(input), rec = saved?.[code], S = ST[code] = stateFor(T, rec);
    pruneFlips(T, S);
    const recTonight = typeof rec?.tonight === "string" ? rec.tonight : T.tonightKey;
    const ak = Object.hasOwn(appliedKeys ?? {}, code) ? appliedKeys[code] : undefined;
    const applied = ak === undefined ? null : typeof ak === "string" ? { key: ak, tonight: recTonight } : ak;
    if (typeof rec?.on === "string") moveTo(T, S, outsOf(rec.on), recTonight);
    else if (applied) moveTo(T, S, outsOf(applied.key), typeof applied.tonight === "string" ? applied.tonight : recTonight);
    else moveTo(T, S, outsOf(recTonight), recTonight);
    S.sticky = Boolean(applied) || typeof rec?.on === "string"; // keeps saving where he is, so a reload never falls back to an older applied key
  }
  return { TEAMS, ST };
}

/**
 * Who is out on a Tonight (Adam, 11-07): its outs, plus the men he or the news put Out, minus the men he put back in. `mine` is the explicit record of those
 * ({ out: [ids], in: [ids] }, kept by noteOuts as each change is made), so a later pull can never undo his Out. A man newly Out on TwoGun's list is Out, never "back in". Pure.
 */
export function rebaseOuts(tonight, mine) {
  const next = new Set(outsOf(tonight));
  for (const id of mine.out) next.add(id);
  for (const id of mine.in) next.delete(id);
  return [...next];
}

/** The record seeded from a scenario and the Tonight it was made on, for work saved before `mine` was kept. */
const seedMine = (outs, old) => { const t = new Set(outsOf(old)), now = new Set(outs); return { out: outs.filter((id) => !t.has(id)), in: [...t].filter((id) => !now.has(id)) }; };

/** A change of who is out goes in the record: a man put Out beyond Tonight is his Out (a man TwoGun already has Out is only no longer his back-in, so browsing scenarios marks nobody); a man taken off the list is no longer his Out, and if TwoGun has him Out he is his back-in. `wasKey`: the scenario before the change. */
export function noteOuts(T, S, wasKey) {
  const was = new Set(outsOf(wasKey)), now = new Set(S.outs), tonight = new Set(outsOf(T.tonightKey)), mine = (S.mine ??= { out: [], in: [] });
  for (const id of now) if (!was.has(id)) { if (!tonight.has(id) && !mine.out.includes(id)) mine.out.push(id); mine.in = mine.in.filter((x) => x !== id); }
  for (const id of was) if (!now.has(id)) { mine.out = mine.out.filter((x) => x !== id); if (tonight.has(id) && !mine.in.includes(id)) mine.in.push(id); }
}

/** The team onto the current Tonight: new Tonight + his outs - his ins (`old` only seeds the record for older work), men off the team dropped, and the pins on the scenario
 *  he was on carried to the one he lands on, his entries winning over any already there (moved, or copied from a saved scenario so it stays saved). */
export function moveTo(T, S, outs, old) {
  const from = keyOf(outs);
  S.mine ??= seedMine(outs, old);
  S.outs = rebaseOuts(T.tonightKey, S.mine).filter((id) => T.byId[id]);
  S.tonight = T.tonightKey;
  const to = keyOf(S.outs);
  if (from === to || !hasPins(S.pins[from])) return;
  const moved = S.saved.includes(from) ? structuredClone(S.pins[from]) : S.pins[from], there = S.pins[to] ?? {};
  S.pins[to] = Object.fromEntries([...new Set([...Object.keys(there), ...Object.keys(moved)])].map((k) => [k, { ...there[k], ...moved[k] }]));
  if (!S.saved.includes(from)) delete S.pins[from];
  S.shown = (S.shown ?? []).filter((k) => k !== from && k !== to);
}

function shapeTeam(input) {
  const byId = {};
  for (const p of input.men) byId[p.id] = p;
  return { ...input, pl: input.men, byId, tonightKey: keyOf(input.tonight) };
}

/** His saved record as the working state, on Tonight. A scenario holding pins but not on his list (an earlier Tonight) shows for this session only; it is not written into saved. */
function stateFor(T, rec) {
  const saved = [...(rec?.saved ?? [])], shown = [];
  for (const [key, p] of Object.entries(rec?.pins ?? {})) {
    if (key !== "" && key !== T.tonightKey && !saved.includes(key) && hasPins(p)) shown.push(key);
  }
  return { outs: outsOf(T.tonightKey), tonight: T.tonightKey, source: MINUTE_SOURCES.includes(rec?.source) ? rec.source : "twogun", saved, shown, pins:structuredClone(rec?.pins ?? {}), handouts: structuredClone(rec?.handouts ?? {}), combos: structuredClone(rec?.combos ?? {}), news: structuredClone(rec?.news ?? {}), ...(rec?.mine ? { mine: structuredClone(rec.mine) } : {}) };
}

/** New inputs on the same work (a pull landed): his pins stay and everything he did not pin moves. Every team is rebased on the new Tonight
 *  (moveTo): a team with nothing of his stays on Tonight, his own Outs and back-ins stay his through any number of pulls, and his pins go with the scenario; a man who left is dropped. */
export function refreshTeams(model, inputs) {
  const TEAMS = {};
  for (const [code, input] of Object.entries(inputs.teams)) {
    TEAMS[code] = shapeTeam(input);
    const S = model.ST[code];
    if (!S) { model.ST[code] = stateFor(TEAMS[code], null); continue; }
    moveTo(TEAMS[code], S, S.outs, model.TEAMS[code]?.tonightKey ?? TEAMS[code].tonightKey);
    pruneFlips(TEAMS[code], S);
  }
  model.TEAMS = TEAMS;
}

/** Role flips on men no longer on the team come off, so a stale starter never counts toward the server's five. */
export function pruneFlips(T, S) {
  for (const p of Object.values(S.pins ?? {})) {
    if (!p?.r) continue;
    for (const id of Object.keys(p.r)) if (!T.byId[id]) delete p.r[id];
  }
}

export const hasPins = (p) => Boolean(p) && Object.values(p).some((sec) => Object.keys(sec ?? {}).length > 0);

/** The team's scenarios in the order he reads them: Healthy, Tonight, then his saved ones whose men are all still on the team. */
export function savedFor(T, S) {
  const list = [""];
  if (T.tonightKey !== "") list.push(T.tonightKey);
  for (const key of [...S.saved, ...(S.shown ?? [])]) if (!list.includes(key) && outsOf(key).every((id) => T.byId[id])) list.push(key);
  return list;
}

const outNames = (T, ids) => ids.map((i) => T.byId[i]).filter(Boolean).sort((a, b) => (usualMin(b) ?? 0) - (usualMin(a) ?? 0)).map((p) => chipName(T, p));

/** A scenario's whole name: Tonight, Healthy, or every man out, the biggest first. */
export function fullLabel(T, key) {
  if (key === T.tonightKey) return "Tonight";
  if (key === "") return "Healthy";
  return `${outNames(T, outsOf(key)).join(" + ")} out`;
}

/** The name on a button: the whole name for one or two men out; past that, what differs from Tonight when that is shorter, else the two biggest and a count. */
export function label(T, key) {
  const ids = outsOf(key);
  if (key === T.tonightKey || ids.length <= 2) return fullLabel(T, key);
  const tonight = outsOf(T.tonightKey), extra = ids.filter((i) => !tonight.includes(i)), back = tonight.filter((i) => !ids.includes(i));
  if (extra.length + back.length <= 2) return `Tonight${extra.length ? ` + ${outNames(T, extra).join(" + ")} out` : ""}${back.length ? `, ${outNames(T, back).join(" + ")} in` : ""}`;
  const names = outNames(T, ids);
  return `${names.slice(0, 2).join(" + ")} +${names.length - 2} out`;
}

/** The pins of a scenario (made when he first pins there). */
export function pinsOf(S, key) {
  if (!S.pins[key]) S.pins[key] = emptyPins();
  for (const k of ["m", "u", "d", "p", "r"]) S.pins[key][k] ??= {};
  return S.pins[key];
}

/** The scenario's numbers: rows joined with each man, plus a saved pin never made into an empty record. */
export function calc(T, S, outs) {
  const key = keyOf(outs);
  const res = scenario(teamFor(T, S), outs, S.pins[key] ?? emptyPins());
  return { ...res, rows: res.rows.map((r) => ({ ...r, p: T.byId[r.id] })) };
}

/** A team's work as it is stored: no empty pin sections. Once he has pins or has been off Tonight it also keeps `on` (the scenario on show) and
 *  `tonight` (the Tonight it was made on), so a reload opens where he was, rebased on a newer pull. */
export function recordOf(S) {
  const pins = {};
  for (const [key, p] of Object.entries(S.pins)) {
    const kept = {};
    for (const [k, sec] of Object.entries(p)) if (Object.keys(sec).length) kept[k] = sec;
    if (Object.keys(kept).length) pins[key] = kept;
  }
  const offTonight = S.tonight !== undefined && keyOf(S.outs) !== S.tonight;
  const where = (Object.keys(pins).length || offTonight || S.sticky) && S.tonight !== undefined ? { tonight: S.tonight, on: keyOf(S.outs) } : {};
  const mine = S.mine?.out.length || S.mine?.in.length ? { mine: S.mine } : {};
  return { saved: S.saved, pins, handouts: S.handouts, combos: S.combos, ...where, ...mine, ...(S.source && S.source !== "twogun" ? { source: S.source } : {}), ...(Object.keys(S.news ?? {}).length ? { news: S.news } : {}) };
}

/** His usual minutes: min_healthy where the pull has it, else Tonight's. */
export function usualMin(p) { return typeof p.healthy === "number" ? p.healthy : p.min; }
/** His usual projection: usual minutes times Tonight's rate; null when either is missing. */
export const usualProj = (p) => (typeof usualMin(p) === "number" && typeof p.rate === "number" ? usualMin(p) * p.rate : null);
/** Tonight's figures, which the Chg column, the sweep and the moved colour compare against. A man out Tonight is on 0. */
export const tonightMin = (T, p) => (T.tonight.includes(p.id) ? 0 : p.min);
export const tonightUsg = (T, p) => (T.tonight.includes(p.id) ? 0 : p.usg);
export const tonightProj = (T, p) => (T.tonight.includes(p.id) ? 0 : typeof p.min === "number" && typeof p.rate === "number" ? p.min * p.rate : null);
