// The board checks itself before Adam sees it (global rule G65). A pure function over the built slate (the object /api/slate returns), that slate's overrides.json and the lineup read:
// it returns every figure that does not follow from its inputs, each as { check, dk_id, name, team, shown, expected, why } in plain English, and counts and names what it could not check or left out (G62).
//  1. projection_math: a playing man's projection = effectiveProjection(minutes x the engine's DK/min (ours.rate), no typed number, his bump steps), within PROJ_TOL. Exempt only a number typed on the board:
//     in overrides.proj and in neither auto.proj nor auto.pin (the test hisNumbers uses in overrides.js). A bump is checked, never exempt. A file with no auto flags is from before them: its stored figures are
//     exempt but named "stored before the auto flags existed", never "typed by you".
//  2. minutes_ceiling: the engine's minutes are no higher than his role ceiling (ours.ceiling, structured, from tiers.js). The Out men's pot is NEVER allowed past it: tiers.js shareOut gives each man
//     room = ceiling - figure - already added, so what nobody can take is left unassigned. Exempt only typed minutes (marks.minutes by "you", undo true) and a standing minutes override in use (ours.standing_min);
//     a look-back override line is checked.
//  3. stored_override: a number a send wrote (listed in auto.proj / auto.min) must equal what the engine computes now; Adam's own number passes. A man Out has his stored minutes set aside, said.
//  4. hidden_by_lower_source / conflict: board-check-sources.js.
//  5. team_240: each team's playing minutes, as shown, add to TEAM_MINUTES within TEAM_TOL.
import { isNum, round2, isOut } from "../board/figures.js";
import { effectiveProjection, PROJ_TOL, MIN_TOL } from "./overrides.js";
import { checkHiddenByLowerSource } from "./board-check-sources.js";

export { PROJ_TOL, MIN_TOL }; // one copy, in overrides.js (the board's own stale test uses them too)
export const TEAM_MINUTES = 240; // regulation; overtime is never counted (the engine's box minutes are overtime-scaled to 240)
export const TEAM_TOL = 5; // the engine lands within 0.02 of 240 unless nobody can take the pot; 5 minutes (about 2%) leaves room for a typed whole-minute number and still catches a missing starter (about 20)
export const CHECKS = ["projection_math", "minutes_ceiling", "stored_override", "hidden_by_lower_source", "team_240"];

const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
const fail = (check, p, shown, expected, why) => ({ check, dk_id: String(p.dk_id), name: p.name, team: p.team, shown, expected, why });

/** A collector of named groups, one per check and reason: { check, why, count, names }. cap: names kept (default 4). Used for what was not checked and what was exempt. */
export function makeGroups() {
  const map = new Map();
  return {
    add(check, why, name, n = 1, cap = 4) { const k = `${check}|${why}`; const e = map.get(k) ?? { check, why, count: 0, names: [] }; e.count += n; if (name && e.names.length < cap) e.names.push(name); map.set(k, e); },
    list: () => [...map.values()],
  };
}

/** Check 1. */
function checkProjection(players, c) {
  const { o, bad, un, ex, auto, flagged, held } = c;
  for (const p of players) {
    const ours = p.ours, id = String(p.dk_id), steps = o.bump?.[id] ?? 0;
    if (has(o.proj, id) && !auto.proj.has(id) && !auto.pin.has(id)) { ex.add("projection_math", flagged ? "typed by you on the board" : "stored before the auto flags existed (cannot be told from typed)", p.name); continue; }
    if (has(o.proj, id) && held.has(p.team) && !p.stale_auto?.proj) { ex.add("projection_math", HELD_WHY, p.name); continue; } // the console's scenario maths, not minutes x the engine's rate: the resend keeps it current, checkResend says when it did not
    if (!ours) { un.add("projection_math", "the engine has no figures for him", p.name); continue; }
    if (ours.playing === false) {
      if (p.his === "in") { ex.add("projection_math", "you put him In against our minutes engine, so his figure is yours or TwoGun's", p.name); continue; }
      if (isNum(p.projection) && p.projection !== 0) bad.push(fail("projection_math", p, p.projection, 0, `${p.name} is not playing tonight but shows ${f2(p.projection)} DK points`));
      continue;
    }
    if (!isNum(p.minutes)) { un.add("projection_math", "he has no minutes", p.name); continue; }
    if (!isNum(ours.rate)) { un.add("projection_math", "he has no DK/min rate", p.name); continue; }
    if (!isNum(p.projection)) { un.add("projection_math", "he shows no projection", p.name); continue; }
    const base = round2(p.minutes * ours.rate), expected = effectiveProjection(base, null, steps);
    if (Math.abs(p.projection - expected) > PROJ_TOL) bad.push(fail("projection_math", p, p.projection, expected, `${p.name} shows ${f2(p.projection)} DK points, but ${f1(p.minutes)} minutes x ${ours.rate} DK/min${steps ? ` with his ${steps > 0 ? "+" : ""}${steps} bump` : ""} is ${f2(expected)}`));
  }
}

/** Check 2. */
function checkCeiling(players, c) {
  const { bad, un, ex } = c;
  for (const p of players) {
    const ours = p.ours;
    if (!ours || ours.playing === false || !isNum(ours.minutes)) continue; // no minutes: check 1 counts him
    if (ours.marks?.minutes?.by === "you" && ours.marks.minutes.undo === true) { ex.add("minutes_ceiling", "minutes typed by you", p.name); continue; }
    if (ours.standing_min === true) { ex.add("minutes_ceiling", "a standing minutes override of yours is in use", p.name); continue; }
    if (!isNum(ours.ceiling)) { un.add("minutes_ceiling", "no role ceiling is on file for him (a man with no games in his role, or a view saved before ceilings were kept)", p.name); continue; }
    if (ours.minutes > ours.ceiling + MIN_TOL) bad.push(fail("minutes_ceiling", p, ours.minutes, ours.ceiling, `${p.name} has ${f1(ours.minutes)} minutes, above his role ceiling of ${f1(ours.ceiling)} (${ours.tier ?? "no tier"})`));
  }
}

/** Check 3. A file with no `auto` key is from before the flags: its differing numbers cannot be told from Adam's, so they are counted. */
function checkStored(players, c) {
  const { o, bad, un, ex, auto, flagged, nameOf } = c, byId = new Map(players.map((p) => [String(p.dk_id), p])), gone = new Set();
  const sections = [["proj", "projection", f2, PROJ_TOL, "DK points"], ["min", "minutes", f1, MIN_TOL, "minutes"]];
  for (const [sec, noun, fmt, tol, unit] of sections) {
    for (const [id, stored] of Object.entries(o[sec] ?? {})) {
      if ((flagged && !auto[sec].has(id)) || auto.pin.has(id)) continue; // Adam's own number passes
      const p = byId.get(id);
      if (p?.stale_auto?.[sec]) { ex.add("stored_override", p.stale_auto.no_figure ? `a send's ${noun} number is not used: the engine has no figure for him` : `a stored ${noun} number a send wrote no longer equals the engine's, so it is ignored and the engine's figure shows`, p.name); continue; } // overrides.js staleSendOf, applied by the board
      if (p && c.held.has(p.team)) { ex.add("stored_override", HELD_WHY, p.name); continue; }
      if (!p) { if (!gone.has(id)) un.add("stored_override", "a stored projection or minutes number for a man no longer on the board", nameOf(id), 1, 99); gone.add(id); continue; } // once a man, whichever numbers he holds
      if (sec === "min" && p.ours?.playing === false) { ex.add("stored_override", "stored minutes set aside while he is Out", p.name); continue; }
      const ours = p.ours?.[noun];
      if (p.proj_source !== "ours" || !isNum(ours)) { un.add("stored_override", `the engine has no ${noun} for him to compare with`, p.name); continue; }
      if (Math.abs(stored - ours) <= tol) continue;
      if (!flagged) { un.add("stored_override", "the overrides file has no auto flags (written before they existed), so a stored number that differs from the engine's cannot be told from Adam's", p.name); continue; }
      bad.push(fail("stored_override", p, stored, ours, `${p.name}'s stored ${noun} is ${fmt(stored)} ${unit}, a number a send wrote, but the engine computes ${fmt(ours)} now`));
    }
  }
}

/** Who plays, for check 5: the engine's word under our projections; under TwoGun's, the shown figures (minutes above 0 and not on the Out list). */
function playsOf(p, slate, outKeys) {
  if (p.his) return p.his === "in"; // his own call (out-pool.js) decides who plays
  if (slate.proj_source === "ours") return p.ours?.playing !== false;
  return isNum(p.minutes) ? p.minutes > 0 && !isOut(p.injury_status) && !outKeys.has(`${p.team}|${p.name}`) : null; // null: no minutes shown, cannot tell
}

/** Check 5: each team's playing minutes, as shown, add to 240 within TEAM_TOL. */
function checkTeams(players, slate, c) {
  const outKeys = new Set((slate.out ?? []).map((o) => `${o.team}|${o.name}`)), teams = new Map();
  for (const p of players) {
    const t = teams.get(p.team) ?? { sum: 0, missing: [] }, plays = playsOf(p, slate, outKeys);
    if (plays === null || (plays && !isNum(p.minutes))) t.missing.push(p.name); else if (plays) t.sum += p.minutes;
    teams.set(p.team, t);
  }
  for (const [team, t] of teams) {
    if (t.missing.length) { c.un.add("team_240", `${team}'s total cannot be added: ${t.missing.length} playing ${t.missing.length === 1 ? "man has" : "men have"} no minutes`, team); continue; }
    if (Math.abs(t.sum - TEAM_MINUTES) > TEAM_TOL) c.bad.push({ check: "team_240", dk_id: null, name: null, team, shown: round2(t.sum), expected: TEAM_MINUTES, why: `${team}'s playing men add to ${f1(t.sum)} minutes, not ${TEAM_MINUTES} (allowed: within ${TEAM_TOL})` });
  }
}

const HELD_WHY = "a held team's send number comes from the console's scenario maths and is kept current by the server's resend, not compared with the engine";

/** Check 3b: held teams' send numbers are only as current as the last resend. Names, by team, what was not refreshed and why (G62); `resend`: { record, problem, held, currentPull } from board-check-route.js. */
function checkResend(players, c, resend) {
  const { un, auto, held } = c;
  if (resend?.locked === true) return; // after lock nothing is re-sent; the last record is final and "locked" is not an unchecked state
  if (resend?.problem && !held.size) { un.add("stored_override", `held teams, if any, cannot be told: ${resend.problem}`); return; }
  const withNumbers = (teams) => players.filter((p) => teams.includes(p.team) && (auto.proj.has(String(p.dk_id)) || auto.min.has(String(p.dk_id)))).length;
  const teams = [...held].sort().filter((t) => withNumbers([t]) > 0);
  if (!teams.length) return;
  const n = withNumbers(teams), rec = resend?.record ?? null;
  if (resend?.problem || rec?.problem) un.add("stored_override", `held teams' numbers cannot be called current: ${resend?.problem ?? rec.problem}`, teams.join(","), n);
  else if (!rec) un.add("stored_override", "held teams' numbers cannot be called current: no resend of them is recorded for this slate", teams.join(","), n);
  else if (rec.status === "blocked" && rec.why === "the slate is locked") return;
  else if (rec.status === "blocked") un.add("stored_override", `held teams' numbers were not refreshed by the last pull: ${rec.why}`, teams.join(","), n);
  else {
    if (resend.currentPull && rec.pull !== resend.currentPull) un.add("stored_override", `held teams' numbers were last re-sent against pull ${rec.pull ?? "unknown"}, but the board is on pull ${resend.currentPull}`, teams.join(","), n);
    if (rec.usage_state && rec.usage_state !== "ready") un.add("stored_override", `the usage table was ${rec.usage_state} at the last resend${rec.usage_message ? ` (${rec.usage_message})` : ""}, so scenario numbers that need it were not refreshed`, teams.join(","), n);
    for (const m of rec.missing ?? []) un.add("stored_override", `a held man the last resend could not refresh keeps his earlier number: ${m.why}`, `${m.name} (${m.team})`);
  }
}

/** One plain line per failure or conflict, for the board's foot. */
export const failureLine = (f) => (f.name ? `${f.name} (${f.team}): ${f.why}` : f.why);
const names = (u) => (u.names.length ? ` (${u.names.join(", ")}${u.count > u.names.length ? ", and more" : ""})` : "");
/** One plain line per kind of man the check could not evaluate, with the count and the names. */
export const uncheckedLine = (u) => `${u.count} not checked (${u.check.replace(/_/g, " ")}): ${u.why}${names(u)}`;
/** One plain line per kind of exemption, with the count and the names. */
export const exemptLine = (u) => `${u.count} left out of ${u.check.replace(/_/g, " ")}: ${u.why}${names(u)}`;

/**
 * Runs the checks. slate: what /api/slate returns; overrides: that slate's overrides record (readOverrides shape); lineups: readNewsLineups' answer or null; nowMs: the clock.
 * Returns { slate, checked_at, men, checks, failures, conflicts, unchecked, exempt, *_lines, ok }. ok: nothing failed, conflicted or was left unchecked. A missing input is counted, never a throw.
 */
export function checkBoard({ slate, overrides = null, overridesProblem = null, lineups = null, resend = null, depth = null, nowMs = Date.now() }) {
  const players = Array.isArray(slate?.players) ? slate.players : [], un = makeGroups(), ex = makeGroups(), bad = [], conflicts = [];
  const o = { proj: {}, min: {}, bump: {}, ...(overrides ?? {}) };
  const known = new Map([...players.map((p) => [String(p.dk_id), p.name]), ...(slate?.out ?? []).filter((x) => x.dk_id != null).map((x) => [String(x.dk_id), x.name])]);
  const c = { o, bad, un, ex, flagged: o.auto !== undefined, auto: { proj: new Set(o.auto?.proj ?? []), min: new Set(o.auto?.min ?? []), pin: new Set(o.auto?.pin ?? []) }, held: new Set(resend?.held ?? []), nameOf: (id) => known.get(String(id)) ?? `id ${id} (no longer on the board)` };
  if (!overrides) un.add("stored_override", overridesProblem ?? "the slate's overrides were not given to the check");
  if (!players.length) un.add("projection_math", "the slate has no players");
  else if (slate.proj_source !== "ours") {
    un.add("projection_math", `the board shows ${slate.proj_source === "twogun" ? "TwoGun's" : "no known"} projections, so there is no engine rate to check them against`, null, players.length);
    un.add("minutes_ceiling", "the board shows TwoGun's minutes, so there is no engine ceiling to check them against", null, players.length);
  } else {
    checkProjection(players, c);
    checkCeiling(players, c);
  }
  checkStored(players, c);
  if (resend) checkResend(players, c, resend);
  bad.push(...checkHiddenByLowerSource({ slate, players, lineups, nowMs }, un, conflicts));
  checkTeams(players, slate ?? {}, c);
  if (depth?.problem) un.add("depth_chart_age", `the depth charts' ages could not be read: ${depth.problem}`);
  for (const u of depth?.unreadable ?? []) un.add("depth_chart_age", `a depth chart could not be read, so its age is unknown: ${u.why}`, u.team);
  for (const a of depth?.ages ?? []) if (a.stale) un.add("depth_chart_age", a.line, a.team); // a chart older than 3 days: its injured list may be stale (depth-refresh.js); the refresh keeps tonight's teams current
  const unchecked = un.list(), exempt = ex.list();
  return { slate: slate?.slate ?? null, checked_at: new Date(nowMs).toISOString(), men: players.length, checks: CHECKS, failures: bad, conflicts, unchecked, exempt,
    failure_lines: bad.map(failureLine), conflict_lines: conflicts.map(failureLine), unchecked_lines: unchecked.map(uncheckedLine), exempt_lines: exempt.map(exemptLine), depth_lines: depth?.lines ?? [], ok: !bad.length && !unchecked.length && !conflicts.length };
}
