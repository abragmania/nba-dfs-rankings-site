// A team with the minutes engine's inputs takes its roles from the engine (resolveFromTier below); the formula that follows is only for a team
// without them, and says so in its note.
// The console's roles (Adam, 11-06): Starter, Bench+, Bench, Out of rotation, Out. Pure ES module shared by the page and the
// server, as console-engine.js is. A man's role is Out when he is out in the scenario (its key); otherwise the role he flipped
// him to (pins.r), else the rule below. Exactly five starters, always: the flipped starters count first, the rest are filled
// from the men not flipped, TwoGun's starter flag first, then Tonight's minutes. A man not flipped and not starting is Bench+
// when his last season on this team was 24+ minutes a game starting under 40% (bench_plus_ok, from the inputs), Bench when
// Tonight's minutes are above 0, else Out of rotation. Making a man Starter when five start sends the starter with the fewest
// minutes now to Bench; moving a starter to Bench+, Bench or Out of rotation makes the man playing off the bench with the most minutes
// now a Starter. A starter marked Out flips nobody: the rule fills the five. Each such
// move is a flip of its own, named so the page can show it and Ctrl+Z takes it back.
import { isNum } from "./figures.js";
import { oursUse, rolesFromEngine, tierStarters, chartUse, chartStarters, unmatchedNote } from "./console-ours.js";
import { tierScenario } from "./console-tier.js";

export const STARTERS = 5;
export const ROLES = ["starter", "bench_plus", "bench", "oor", "out"];
/** The roles a flip can hold: Out is the scenario's key, never a flip. */
export const FLIP_ROLES = ["starter", "bench_plus", "bench", "oor"];
export const ROLE_LABEL = { starter: "Starter", bench_plus: "Bench+", bench: "Bench", oor: "Out of rotation", out: "Out" };
export const ROLE_SHORT = { starter: "S", bench_plus: "B+", bench: "B", oor: "OR", out: "Out" };

const tonightMin = (p) => (isNum(p.min) ? p.min : -1);
/** The fill order for the starting five among men not flipped: TwoGun's flag, then Tonight's minutes, then his place in the row. */
const fillOrder = (a, b) => (b.starter === true) - (a.starter === true) || tonightMin(b) - tonightMin(a) || (a.order ?? 0) - (b.order ?? 0);

/** Flips that count: a flip role on a man on the team who is playing in this scenario. */
export function liveFlips(team, outSet, flips) {
  const out = {};
  for (const [id, role] of Object.entries(flips ?? {})) if (FLIP_ROLES.includes(role) && team.men.some((p) => p.id === id) && !outSet.has(id)) out[id] = role;
  return out;
}

/**
 * Every man's role: { roles: { id: role }, flipped: { id: role }, note }. note is null, or a sentence when TwoGun's flags among the
 * men playing are not five and the five were filled or trimmed by Tonight's minutes, or when fewer than five are playing.
 */
export function resolveRoles(team, outSet, flips) {
  const use = oursUse(team);
  if (rolesFromEngine(team)) return resolveFromTier(team, outSet, flips);
  if (chartUse(team).ok) return resolveFromChart(team, outSet, flips);
  const res = resolveByRule(team, outSet, flips);
  const why = use.why ?? chartUse(team).why;
  if (why) res.note = `Starters by TwoGun's flag and Tonight's minutes: ${why}.${res.note ? ` ${res.note}` : ""}`;
  return res;
}

/** Roles only, from the saved depth chart's five (console-ours.js chartStarters): for inputs baked before the engine's tiers existed. A chart man keeps his chart role; a man not on the chart gets the rule's bench role. */
function resolveFromChart(team, outSet, flips) {
  const flipped = liveFlips(team, outSet, flips), roles = {};
  const { ids, notes } = chartStarters(team, outSet, flipped);
  const five = new Set(ids), toRole = { bench_plus: "bench_plus", bench: "bench", oor: "oor", injured: "oor", starter: "bench" };
  for (const p of team.men) {
    if (outSet.has(p.id)) roles[p.id] = "out";
    else if (Object.hasOwn(flipped, p.id)) roles[p.id] = flipped[p.id];
    else if (five.has(p.id)) roles[p.id] = "starter";
    else {
      const m = p.depth_key ? team.depth.men[p.depth_key] : null;
      roles[p.id] = m ? toRole[m.role] : p.bench_plus_ok ? "bench_plus" : isNum(p.min) && p.min > 0 ? "bench" : "oor";
    }
  }
  return { roles, flipped, note: [...notes, unmatchedNote(team)].filter(Boolean).join(" ") || null };
}

/** The roles from the minutes engine (Adam 11-12): Starter is tonight's five (the lineup pages' five, else TwoGun's flags) with every man marked S; Bench+ and Bench are the engine's tiers, his marks forcing them. A man with no inputs for the engine is Bench or Out of rotation by TwoGun's minutes. */
function resolveFromTier(team, outSet, flips) {
  const flipped = liveFlips(team, outSet, flips), res = tierScenario(team, outSet, flipped, {}, true), { notes } = tierStarters(team, outSet, flipped), roles = {};
  for (const p of team.men) {
    if (outSet.has(p.id)) roles[p.id] = "out";
    else if (Object.hasOwn(flipped, p.id)) roles[p.id] = flipped[p.id];
    else roles[p.id] = res.roles[p.id] ?? (isNum(p.min) && p.min > 0 ? "bench" : "oor");
  }
  return { roles, flipped, note: notes.join(" ") || null };
}

function resolveByRule(team, outSet, flips) {
  const flipped = liveFlips(team, outSet, flips);
  const roles = {};
  const playing = team.men.filter((p) => !outSet.has(p.id));
  for (const p of team.men) if (outSet.has(p.id)) roles[p.id] = "out";
  for (const [id, role] of Object.entries(flipped)) roles[id] = role;
  const need = Math.max(0, STARTERS - Object.values(flipped).filter((r) => r === "starter").length);
  const open = playing.filter((p) => !Object.hasOwn(flipped, p.id)).sort(fillOrder);
  for (const p of open.slice(0, need)) roles[p.id] = "starter";
  for (const p of open.slice(need)) roles[p.id] = p.bench_plus_ok ? "bench_plus" : isNum(p.min) && p.min > 0 ? "bench" : "oor";
  let note = null;
  const flagged = playing.filter((p) => p.starter === true).length;
  const starters = Object.values(roles).filter((r) => r === "starter").length;
  if (starters < STARTERS) note = `Only ${starters} men can start: ${playing.length} are playing.`;
  else if (!Object.keys(flipped).length && flagged !== STARTERS) {
    const chosen = playing.filter((p) => roles[p.id] === "starter");
    const added = chosen.filter((p) => p.starter !== true).map((p) => p.name), dropped = playing.filter((p) => p.starter === true && roles[p.id] !== "starter").map((p) => p.name);
    note = `TwoGun flags ${flagged} starters among the men playing, so the five go by Tonight's minutes${added.length ? `: ${added.join(", ")} added` : ""}${dropped.length ? `${added.length ? ";" : ":"} ${dropped.join(", ")} left out` : ""}.`;
  }
  return { roles, flipped, note };
}

/**
 * One role change and the five-starter rule: { outs: [ids out], flips, moved: [{ id, from, to }] }. `minutes`: { id: his minutes on
 * screen now }, used to pick who leaves or joins the five. Out goes in the scenario's outs and takes his flip off; any other role
 * takes him out of the outs and flips him.
 */
export function roleMove(team, outs, flips, id, role, minutes = {}) {
  if (!ROLES.includes(role)) throw new Error(`unknown role ${role}`);
  const before = resolveRoles(team, new Set(outs), flips).roles;
  const nextOuts = new Set(outs), nextFlips = { ...(flips ?? {}) };
  if (role === "out") { nextOuts.add(id); delete nextFlips[id]; } else { nextOuts.delete(id); nextFlips[id] = role; }
  const moved = [];
  if (rolesFromEngine(team) || chartUse(team).ok) { // the engine's five is a set: marking a man never moves another; only a man the five fills in for can change, and the move names him
    const after = resolveRoles(team, nextOuts, nextFlips).roles;
    for (const p of team.men) if (p.id !== id && after[p.id] !== "out" && before[p.id] !== after[p.id] && (before[p.id] === "starter" || after[p.id] === "starter")) moved.push({ id: p.id, from: before[p.id], to: after[p.id] });
    return { outs: [...nextOuts], flips: nextFlips, moved };
  }
  const mins = (p) => (isNum(minutes[p.id]) ? minutes[p.id] : tonightMin(p));
  if (role === "starter" && before[id] !== "starter") {
    const five = team.men.filter((p) => p.id !== id && before[p.id] === "starter" && !nextOuts.has(p.id));
    if (five.length >= STARTERS) {
      const leaves = five.sort((a, b) => mins(a) - mins(b) || (b.order ?? 0) - (a.order ?? 0))[0];
      nextFlips[leaves.id] = "bench";
      moved.push({ id: leaves.id, from: "starter", to: "bench" });
    }
  } else if (before[id] === "starter" && role !== "starter" && role !== "out") {
    // A starter sent out flips nobody: the five fill by the rule and the man who comes in keeps the model's hand-out minutes.
    const rank = { bench_plus: 0, bench: 1, oor: 2 };
    const joins = team.men.filter((p) => p.id !== id && !nextOuts.has(p.id) && Object.hasOwn(rank, before[p.id]))
      .sort((a, b) => mins(b) - mins(a) || rank[before[a.id]] - rank[before[b.id]] || (a.order ?? 0) - (b.order ?? 0))[0];
    if (joins) { moved.push({ id: joins.id, from: before[joins.id], to: "starter" }); nextFlips[joins.id] = "starter"; }
  }
  return { outs: [...nextOuts], flips: nextFlips, moved };
}

/**
 * A starter in and a named man out, as one move (the lineup bar's starter proposal): the pure part of console-moves.js swapStarter.
 * Returns null when nothing is left to do, { call: { id, role } } when the plain role move is the answer (nobody named to leave, or he already starts
 * and only the man to drop has a move), { backIn: { id, role: "bench" } } when the man in is Out in this scenario (he comes back in on a non-starting role
 * first, then the swap is asked again in the scenario he is back in, so both flips land there), else { outs, flips, moved } for the scenario's new flips.
 *   Engine team: the man out is flipped to Bench and the man in marked S; the starters are a set (console-tier.js), so exactly those two change.
 *   Team without the engine's inputs: roleMove's five-starter rule, with any flip it made for a man other than the one named put back as it was.
 * `minutes`: { id: minutes on screen now }, used only by the no-chart rule.
 */
export function swapStarterMove(team, outs, flips, inId, outId, minutes = {}) {
  const outSet = new Set(outs), before = resolveRoles(team, outSet, flips).roles;
  if (!Object.hasOwn(before, inId)) return null;
  const dropOut = before[outId] === "starter" ? outId : null; // a man already benched needs no move
  if (before[inId] === "starter") return dropOut ? { call: { id: dropOut, role: "bench" } } : null;
  if (!dropOut) return { call: { id: inId, role: "starter" } };
  if (outSet.has(inId)) return { backIn: { id: inId, role: "bench" } };
  if (rolesFromEngine(team) || chartUse(team).ok) {
    const next = { ...(flips ?? {}), [inId]: "starter", [dropOut]: "bench" };
    const after = resolveRoles(team, outSet, next).roles;
    const moved = team.men.filter((p) => p.id !== inId && after[p.id] !== "out" && before[p.id] !== after[p.id] && (before[p.id] === "starter" || after[p.id] === "starter")).map((p) => ({ id: p.id, from: before[p.id], to: after[p.id] }));
    return { outs: [...outSet], flips: next, moved };
  }
  const res = roleMove(team, outs, flips, inId, "starter", minutes), kept = { ...res.flips };
  for (const m of res.moved) {
    if (m.id === dropOut) continue;
    if (Object.hasOwn(flips ?? {}, m.id)) kept[m.id] = flips[m.id]; else delete kept[m.id]; // the rule's own pick is not the man the sources drop
  }
  kept[dropOut] = "bench";
  return { outs: res.outs, flips: kept, moved: [{ id: dropOut, from: "starter", to: "bench" }] };
}
