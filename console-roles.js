// A team on an engine source (Ours) takes its roles from the engine (resolveFromTier below). On the TwoGun source, a team with the engine's inputs takes its five from them
// (the lineup pages' agreed five, else TwoGun's flags) and its other roles from the saved chart, or the rule when the chart is missing (resolveFromChart); a team with neither
// uses the formula (resolveByRule), which says so in its note.
// The console's roles (Adam, 11-06): Starter, Bench+, Bench, Out of rotation, Out. Pure ES module shared by the page and the
// server, as console-engine.js is. A man's role is Out when he is out in the scenario (its key); otherwise the role he flipped
// him to (pins.r), else the rule below. Exactly five starters, always: the flipped starters count first, the rest are filled
// from the men not flipped, TwoGun's starter flag first, then Tonight's minutes. A man not flipped and not starting is Bench+
// by the engine's rule where the team has the engine's inputs (Adam 10:25 AM 11-18, bench-plus-rule.js: 20+ a game over 5+ games off
// the bench this season); only a team without them falls back to last season's 24+ minutes a game starting under 40% (bench_plus_ok), Bench when
// Tonight's minutes are above 0, else Out of rotation. Making a man Starter when five start sends the starter with the fewest
// minutes now to Bench; moving a starter to Bench+, Bench or Out of rotation makes the man playing off the bench with the most minutes
// now a Starter. A starter marked Out flips nobody: the rule fills the five. Each such
// move is a flip of its own, named so the page can show it and Ctrl+Z takes it back.
import { isNum } from "./figures.js";
import { oursUse, rolesFromEngine, fiveIsSet, tierStarters, chartUse, chartStarters, unmatchedNote, playsDespiteInjured, callLook } from "./console-ours.js";
import { tierScenario, withStanding } from "./console-tier.js";
import { benchPlusBy } from "./bench-plus-rule.js";
import { trimToFive } from "./role-marks.js";

/** The engine's Bench+ rule on a man's rows from the inputs (tier-inputs.js [min, started 1 | 0 | null, date]): true or false, or null when the inputs hold no row list for him. */
const ruleBenchPlus = (team, id) => { const rows = team.tier?.men?.[id]?.rows; return Array.isArray(rows) ? benchPlusBy(rows.map(([min, s]) => ({ min, started: s === 1 ? true : s === 0 ? false : null }))).ok : null; };

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
  if (chartUse(team).ok || use.ok) return resolveFromChart(team, outSet, flips); // a team with the engine's inputs takes its five from them even when its chart is missing or fails its check
  const res = resolveByRule(team, outSet, flips);
  const why = use.why ?? chartUse(team).why;
  if (why) res.note = `Starters by TwoGun's flag and Tonight's minutes: ${why}.${res.note ? ` ${res.note}` : ""}`;
  return res;
}

/** Roles for a team on the TwoGun source (or with no engine inputs): the five is the engine's (the lineup pages' agreed five, else TwoGun's starter flags, his S marks first; tierStarters) when the team has the inputs, else the saved depth chart's (console-ours.js chartStarters). With the engine's five the chart fills only places it leaves open, so a chart-injured man the pages start starts. A man outside the five keeps his chart role; a man not on the chart gets the rule's bench role. */
function resolveFromChart(team, outSet, flips) {
  const flipped = liveFlips(team, outSet, flips), roles = {};
  const hasChart = chartUse(team).ok, chartOf = (f) => (hasChart ? chartStarters(team, outSet, f) : { ids: [], notes: [] });
  const tier = oursUse(team).ok ? tierStarters(team, outSet, flipped) : null;
  const won = tier ? withStanding(team, flipped) : flipped; // the flips his newer standing marks do not beat (console-tier.js flipWins)
  const { ids, notes } = tier ? engineChartFive(team, outSet, flipped, won, tier, chartOf) : chartOf(flipped);
  const five = new Set(ids), toRole = { bench_plus: "bench_plus", bench: "bench", oor: "oor", injured: "oor", starter: "bench" }, standing = tier ? withStanding(team, {}) : {}; // his standing marks (Adam 10:25 AM 11-18)
  for (const p of team.men) {
    if (outSet.has(p.id)) roles[p.id] = "out";
    else if (Object.hasOwn(flipped, p.id) && won[p.id] === flipped[p.id] && (flipped[p.id] !== "starter" || five.has(p.id))) roles[p.id] = flipped[p.id]; // a flip his newer standing mark beats is not his role; an S call the five-starter rule benched takes his bench role below
    else if (five.has(p.id)) roles[p.id] = "starter";
    else if (standing[p.id] === "bench_plus" || standing[p.id] === "bench") roles[p.id] = standing[p.id];
    else {
      const m = hasChart && p.depth_key ? team.depth.men[p.depth_key] : null;
      const rule = tier ? ruleBenchPlus(team, p.id) : null, plusOk = rule ?? p.bench_plus_ok; // the engine's Bench+ rule where its rows are here (the review of 11-18), else last season's flag
      const chartRole = m && !playsDespiteInjured(team, p, outSet) ? toRole[m.role] : null;
      const role = chartRole && (rule === null || (chartRole !== "bench" && chartRole !== "bench_plus")) ? chartRole : plusOk ? "bench_plus" : isNum(p.min) && p.min > 0 ? "bench" : chartRole ?? "oor";
      roles[p.id] = won[p.id] === "starter" ? benchedCall(role) : role;
    }
  }
  return { roles, flipped, note: [...notes, unmatchedNote(team)].filter(Boolean).join(" ") || null };
}

/** A Starter call the five-starter rule benched says the man plays (the review of 11-20, round 2): his bench role, never Out of rotation (0 minutes), which becomes Bench. */
const benchedCall = (role) => (role === "oor" ? "bench" : role);

/**
 * The TwoGun source's five for a team with the engine's inputs: { ids, notes }. The engine's five (tier: tierStarters; never more than five, Q13), with the S calls it cannot place in the places it leaves open
 * (withUnplaced), and the saved chart's five (chartOf(flips): console-ours.js chartStarters, over the flips less the S calls already in the five, so it never makes room for a man already counted) filling a short one.
 */
function engineChartFive(team, outSet, flipped, won, tier, chartOf) {
  const u = withUnplaced(team, outSet, flipped, won, tier.ids), base = u.ids, said = u.note ? [u.note] : [];
  if (base.length < 5) {
    const chart = chartOf(Object.fromEntries(Object.entries(flipped).filter(([id, r]) => !(r === "starter" && base.includes(id))))), ids = [...new Set([...base, ...chart.ids])].slice(0, 5);
    return { ids, notes: [...tier.notes, ...(ids.length < 5 ? chart.notes : []), ...said] }; // the chart's count notes describe its own set, not the merged one: kept only while the merged five is still short
  }
  return { ids: base, notes: [...tier.notes, ...said] };
}

/** Whether the engine places a man's S call itself (console-tier.js tierFive): he has its inputs and is in its order, so his call is never placed a second time here. */
const enginePlaces = (team, id) => Object.hasOwn(team.tier.men, id) && team.tier.order.includes(id);

/**
 * One rule on both sources (the lead's ruling of 11-20: the board must match the Console): an S call that stands (won: his flips and standing marks merged, the round-2 review) on a man the engine cannot place
 * (no engine inputs, or not in its order) fills only a place the engine's five (ids) leaves open, by tonight's board order, then id; on a full five it is not used and the note says so (G62), because the board's
 * engine cannot know him. { ids, left: [ids not used], note }.
 */
function withUnplaced(team, outSet, flipped, won, ids) {
  const ord = (id) => { const o = team.men.find((p) => p.id === id)?.order; return isNum(o) ? o : Infinity; }, five = [...ids], left = [];
  const unplaced = Object.keys(won).filter((id) => won[id] === "starter" && team.men.some((p) => p.id === id) && !five.includes(id) && !enginePlaces(team, id) && !outSet.has(id))
    .sort((a, b) => (ord(a) < ord(b) ? -1 : ord(a) > ord(b) ? 1 : a < b ? -1 : a > b ? 1 : 0));
  for (const id of unplaced) (five.length < STARTERS ? five.push(id) : left.push(id));
  const whose = callLook(team, flipped).whoseOf, name = (id) => team.men.find((p) => p.id === id)?.name ?? id;
  return { ids: five, left, note: left.length ? left.map((id) => `${whose(id)} on ${name(id)} is not used: the minutes engine has no inputs for him, and its five is full`).join("; ") : null };
}

/** The roles from the minutes engine (Adam 11-12): Starter is tonight's five (the lineup pages' five, else TwoGun's flags) with every man marked S; Bench+ and Bench are the engine's tiers, his marks forcing them. A man with no inputs for the engine is Bench or Out of rotation by TwoGun's minutes. */
function resolveFromTier(team, outSet, flips) {
  const flipped = liveFlips(team, outSet, flips), res = tierScenario(team, outSet, flipped, {}, true), { notes } = tierStarters(team, outSet, flipped), roles = {}, won = withStanding(team, flipped); // a flip his newer standing mark beats is not his role (console-tier.js flipWins)
  // never more than five (Adam 3:52 PM 11-20, Q13): the engine's five stands, its minutes being worked on it; an S call it cannot place fills only a place it leaves open (withUnplaced)
  const u = withUnplaced(team, outSet, flipped, won, res.five), five = new Set(u.ids), cut = [];
  for (const p of team.men) {
    if (outSet.has(p.id)) roles[p.id] = "out";
    else if (Object.hasOwn(flipped, p.id) && won[p.id] === flipped[p.id] && (flipped[p.id] !== "starter" || five.has(p.id))) roles[p.id] = flipped[p.id];
    else {
      const r = res.roles[p.id] ?? (isNum(p.min) && p.min > 0 ? "bench" : "oor"), off = r === "starter" && !five.has(p.id); // the round-2 review: a "starter" the plan gives a man outside the five (one typed with no place in its order) is never a sixth
      if (off && !u.left.includes(p.id)) cut.push(p.name ?? p.id);
      roles[p.id] = off ? (isNum(p.min) && p.min > 0 ? "bench" : "oor") : r;
      if (won[p.id] === "starter" && roles[p.id] !== "starter") roles[p.id] = benchedCall(roles[p.id]);
    }
  }
  const said = cut.length ? `${cut.join(", ")} not used as a starter: the minutes engine's five is full` : null; // G62
  return { roles, flipped, note: [...notes, u.note, said].filter(Boolean).join(" ") || null };
}

function resolveByRule(team, outSet, flips) {
  const flipped = liveFlips(team, outSet, flips);
  const roles = {};
  const playing = team.men.filter((p) => !outSet.has(p.id));
  for (const p of team.men) if (outSet.has(p.id)) roles[p.id] = "out";
  for (const [id, role] of Object.entries(flipped)) roles[id] = role;
  const need = Math.max(0, STARTERS - Object.values(flipped).filter((r) => r === "starter").length);
  const open = playing.filter((p) => !Object.hasOwn(flipped, p.id)).sort(fillOrder), benchRole = (p) => (p.bench_plus_ok ? "bench_plus" : isNum(p.min) && p.min > 0 ? "bench" : "oor");
  for (const p of open.slice(0, need)) roles[p.id] = "starter";
  for (const p of open.slice(need)) roles[p.id] = benchRole(p);
  // never more than five (Adam 3:52 PM 11-20, Q13): more than five S marks go by the one rule, the man with the fewest of Tonight's minutes benched, named
  const manOf = (id) => team.men.find((p) => p.id === id), calls = Object.keys(flipped).filter((id) => flipped[id] === "starter");
  const cut = calls.length > STARTERS ? trimToFive(calls, calls, { ...callLook(team, flipped), figOf: (id) => tonightMin(manOf(id)), nameOf: (id) => manOf(id).name }) : { benched: [], notes: [] }; // whoseOf: a news call is never named as his (the review of 11-20)
  for (const id of cut.benched) roles[id] = benchedCall(benchRole(manOf(id)));
  if (cut.notes.length) return { roles, flipped, note: cut.notes.join(" ") };
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
  if (fiveIsSet(team)) { // the five (the engine's where the team has its inputs, else the chart's) is a set: marking a man never moves another, only a man a fill place went to can change, and the move names him
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
 *   Team with the engine's inputs or a chart, on either source: the man out is flipped to Bench and the man in marked S; S-marked men take fill places before the order's fill (console-tier.js tierFive), so exactly those two change.
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
  if (fiveIsSet(team)) {
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
