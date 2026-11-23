// Sending each team's on-screen scenario to the one overrides path (typed projections), and taking it back. Pure: the route reads and
// writes the files. A plan is worked out on the server from the saved work and the posted scenario keys, so preview and Apply are the same sums.
import crypto from "../../site/shim/crypto.js";
import { keyOf, outsOf, scenario, teamFor, emptyPins } from "../board/console-engine.js";
import { hasPins, label, pinsSame, tableName } from "../board/console-model.js";
import { effectiveProjection, mergeOverrides, MIN_TOL } from "./overrides.js";
import { bumpIn } from "./mode-marks.js";
import { PROJ_MAX } from "../board/override-limits.js";
import { isNum, isPlain, round2, tonightRate } from "../board/figures.js";
import { validKey, heldTeams } from "./scenarios.js";
import { newsOwned } from "../board/console-marks.js";
import { defaultSourceOf, MINUTE_SOURCES } from "../board/depth-chart.js";

/** Why no send goes out while the projection setting cannot be read (buildInputs gives source_default "unknown"): the board is blank then, so TwoGun's minutes must not be sent onto it. Null otherwise. */
export const SOURCE_UNKNOWN_WHY = "the projection setting could not be read, so the board shows no projections and nothing is sent until it is fixed";
export const sourceRefusal = (inputs) => (inputs?.source_default === "unknown" ? SOURCE_UNKNOWN_WHY : null);

const MOVE_FLOOR = 0.05; // the console shows tenths
const MIN_FLOOR = 0.0005; // minutes are kept to thousandths, so a team's total survives the rounding

/** Checks the posted { team: scenario key } against the inputs: { ok, keys } with every team filled in (Tonight when not named), or { ok: false, message }. */
export function checkKeys(posted, inputs) {
  if (!isPlain(posted)) return { ok: false, message: '"scenarios" must map each team to its scenario key.' };
  const keys = {};
  for (const [code, t] of Object.entries(inputs.teams)) keys[code] = keyOf(t.tonight);
  for (const [code, key] of Object.entries(posted)) {
    if (!Object.hasOwn(inputs.teams, code)) return { ok: false, message: `${code.slice(0, 8)} is not a team on this slate.` };
    const t = inputs.teams[code];
    if (!validKey(key)) return { ok: false, message: `${code}'s scenario key is not well formed.` };
    const known = new Set(t.men.map((p) => p.id));
    if (!outsOf(key).every((id) => known.has(id))) return { ok: false, message: `${code}'s scenario names a man who is not on the team now.` };
    keys[code] = keyOf(outsOf(key));
  }
  return { ok: true, keys };
}

/** The posted "teams" (the console sends only these, Adam 11-07): null when absent (every team), a Set when well formed, else { message }. */
export function checkTeams(posted, inputs) {
  if (posted === undefined) return { ok: true, only: null };
  if (!Array.isArray(posted) || posted.length > 40 || !posted.every((t) => typeof t === "string" && Object.hasOwn(inputs.teams, t))) return { ok: false, message: '"teams" must list teams on this slate.' };
  return { ok: true, only: new Set(posted) };
}

/** Pins that go nowhere in this send: on a scenario that names or pins a man no longer on the team, or on a key that is neither sent, saved nor Tonight. Never carried forward. */
export function orphanedPins(inputs, file, keys) {
  const out = [];
  for (const [code, rec] of Object.entries(file.teams)) {
    if (!Object.hasOwn(inputs.teams, code)) continue;
    const t = inputs.teams[code];
    const known = new Set(t.men.map((p) => p.id)), tonight = keyOf(t.tonight), nameOf = Object.fromEntries(t.men.map((p) => [p.id, p.name]));
    for (const [key, pins] of Object.entries(rec.pins ?? {})) {
      const ids = Object.values(pins).flatMap((sec) => Object.keys(sec ?? {}));
      if (!ids.length) continue;
      if (key !== keys[code] && pinsSame(pins, rec.pins?.[keys[code]])) continue; // a copy of the marks on show holds nothing different: nothing is held back
      const stale = !outsOf(key).every((id) => known.has(id));
      const gone = ids.filter((id) => !known.has(id)).length;
      const unsent = key !== keys[code] && key !== tonight && key !== "" && !(rec.saved ?? []).includes(key);
      // who: the men holding the pins, by name (a man no longer on the team has no name to give); scenario: its name, null when it names a man no longer on the team
      const who = (list) => [...new Set(list.map((id) => nameOf[id]).filter(Boolean))];
      const scenario = stale ? null : label(shapedTeam(t), key);
      if (stale || unsent) out.push({ team: code, key, count: ids.length, who: who(ids), scenario });
      else if (gone) out.push({ team: code, key, count: gone, who: [], scenario, gone: true });
    }
  }
  return out;
}

const shapedTeam = (t) => ({ ...t, byId: Object.fromEntries(t.men.map((p) => [p.id, p])), pl: t.men, tonightKey: keyOf(t.tonight) });

/** The team record as the console's newsOwned reads it: the news entries, the pins and the scenario on show. */
const newsView = (rec, key) => ({ news: rec?.news ?? {}, pins: rec?.pins ?? {}, outs: outsOf(key) });

/**
 * Whether a man's number in this send is his own hand (Adam 11-12: only his own numbers wear the board's marker): a pin on him, a hand-out edit
 * naming him, or an Out / back-in he marked himself. Men moved only by news, the engine's own figures or a teammate's change are not his.
 * A flip or Out the lineup news made and that still stands as it left him is news's, not his (console-marks.js newsOwned, the one definition).
 */
function isHis(rec, key, pins, r, t) {
  const owned = newsOwned(newsView(rec, key));
  if (["m", "u", "d", "p"].some((k) => Object.hasOwn(pins[k] ?? {}, r.id))) return true;
  if (Object.hasOwn(pins.r ?? {}, r.id) && !owned.r.has(r.id)) return true;
  const outs = outsOf(key), edited = (h) => ["m", "u"].some((k) => Object.hasOwn(h?.[k] ?? {}, r.id));
  if (outs.some((sitter) => edited(rec?.handouts?.[sitter])) || (outs.length >= 2 && edited(rec?.combos?.[keyOf(outs)]))) return true;
  const tonightOut = t.tonight.includes(r.id);
  return r.out ? !tonightOut && !owned.out.has(r.id) : tonightOut;
}

/**
 * Notes the flag a send gives a number the board holds: plan.auto[section][id] is true when news or the engine wrote it, false when it is his. Counted in
 * plan.flag_moves when the stored flag differs. `refresh`: the number is left as it was, so it may go from his to automatic only in a file with no flags
 * yet (a legacy file); a number he typed that equals the engine's stays his. A number this send writes takes the flag it computes.
 */
function setAuto(plan, ctx, section, id, his, refresh = false) {
  const stored = (ctx.overrides.auto?.[section] ?? []).includes(id), pinned = section === "proj" && (ctx.overrides.auto?.pin ?? []).includes(id);
  if (refresh && !stored && ctx.overrides.auto !== undefined) return; // flag-aware file: a figure not listed as news's is his (typed on the board or pinned) and stays as it is
  plan.auto[section][id] = !his;
  if (stored === his || (section === "proj" && his && !pinned)) plan.flag_ids.add(`${section}:${id}`);
}

/** A news Out's 0 left on a team this send does not plan (its applied key is gone, so nothing re-sends it): still news's, so it is marked so, never his. Only a number still the Apply's own, on a team asked for, for a man still Out as the news left him. */
function flagNewsOuts(plan, ctx, file, only) {
  for (const [code, rec] of Object.entries(file.teams ?? {})) {
    if (only && !only.has(code)) continue;
    const owned = newsOwned(newsView(rec, rec?.on ?? ""));
    for (const id of owned.out) {
      if (ctx.men.has(id) || ctx.applied?.set?.[id]?.to !== ctx.overrides.proj?.[id] || ctx.overrides.proj?.[id] === undefined) continue;
      setAuto(plan, ctx, "proj", id, false); // the number is still the Apply's own and news still owns the man, so it is news's even in a flag-aware file
    }
  }
}

/**
 * One man's scenario minutes into the plan when the board shows otherwise: 1 if they move, else 0. Back on the slate's own figure removes the entry. Each man goes, however small, so the board holds the scenario's minutes exactly.
 * R4 (Adam 11-17, 3:28 PM): no send freezes a number the live figure already gives. `close`: every man of the team is within MIN_TOL of the board's own figure (planTeam), so a man he did not
 * type gets no stored number and a stored one comes off, and the board follows each new pull, news read and engine change by itself. Otherwise every figure that differs is stored, as before,
 * so the team's sum is the scenario's exactly. His typed minutes (pins.m) are stored whatever they are. `keep`: a projection stands stored on him (projStored), so his minutes are stored too.
 */
function planMinutes(plan, r, ctx, his, close = false, keep = false) {
  if (!isNum(r.min)) return 0;
  const to = Math.round(r.min * 1000) / 1000, base = ctx.base.get(r.id).minutes, typed = ctx.overrides.min?.[r.id];
  if (keep && !r.out) { // review round 2, finding 4: a man whose projection stands stored keeps the minutes it was made on, so a pull cannot move one without the other
    if (typed !== undefined && Math.abs(to - typed) < MIN_FLOOR) { setAuto(plan, ctx, "min", r.id, his, true); return 0; }
    plan.min[r.id] = to;
    setAuto(plan, ctx, "min", r.id, his);
    return 1;
  }
  if (close && !r.pinned?.m) {
    if (typed === undefined) return 0;
    plan.min[r.id] = null;
    return 1;
  }
  if (Math.abs(to - (typed ?? base ?? Infinity)) < MIN_FLOOR) { if (typed !== undefined) setAuto(plan, ctx, "min", r.id, his, true); return 0; }
  if (typed === undefined && !isNum(base) && to === 0) return 0;
  plan.min[r.id] = isNum(base) && Math.abs(to - base) < MIN_FLOOR ? null : to;
  if (plan.min[r.id] !== null) setAuto(plan, ctx, "min", r.id, his);
  return 1;
}

/** Why a man has no projection in the scenario: the row's own minutes reason first (a flipped man's role figure says why it is missing), then his inputs'. */
function missingWhy(r, man) {
  const min = r.missing.find((m) => m.startsWith("min: "));
  return min ? min.slice(5) : Object.values(man.missing)[0] ?? "no projection";
}

/** One man's scenario projection into the plan (the send's projection rules, Adam 11-07 and 11-09). `r.proj` is the figure to send; null names why it is missing. */
function planProj(plan, ctx, t, man, r, his, hasPin) {
  const typedNow = ctx.overrides.proj?.[r.id], earlier = ctx.applied?.set?.[r.id];
  const fromApply = earlier?.to === typedNow;
  const from = ctx.board.get(r.id).projection, baseProj = ctx.base.get(r.id).projection;
  // An Out (Apply's 0) took what was on the board, and he is back in: it comes back as it stood, his typed number or the slate's own (Adam, 11-09).
  if (r.proj === null) {
    if (earlier && fromApply && earlier.to === 0 && !r.out) return restoreProj(plan, man, t, earlier, ctx); // no model figure now, so nothing else would take the 0 away
    if (typedNow !== undefined && fromApply) setAuto(plan, ctx, "proj", r.id, his, true); // an Out's 0 stays on the board: marked his only if he marked the Out
    const held = earlier && ctx.overrides.proj?.[r.id] === earlier.to ? `; his earlier applied projection ${earlier.to} is still on the board` : "";
    plan.missing.push({ name: man.name, team: t.code, why: `${missingWhy(r, man)}${held}` });
    return;
  }
  const to = round2(Math.max(0, Math.min(PROJ_MAX, r.proj)));
  if (earlier && fromApply && earlier.to === 0 && earlier.prev !== null && !hasPin && !r.out) return restoreProj(plan, man, t, earlier, ctx);
  if (earlier && fromApply && !hasPin && !r.out && isNum(baseProj) && Math.abs(to - baseProj) < MOVE_FLOOR) {
    // Back on the slate's own figure with no mark of his on him (an undo chip): the typed number comes off and he is on the live figure the chip
    // showed, never an older typed number from before an Apply (Adam, 11-07: one undo-chip rule).
    return restoreProj(plan, man, t, { ...earlier, prev: null }, ctx);
  }
  const after = effectiveProjection(baseProj, to, bumpIn(ctx.overrides, "GPP", r.id)); // the console is not per mode: GPP's thumbs, as its board (ctx.board) is merged
  if (isNum(from) && Math.abs(after - from) < MOVE_FLOOR) { if (typedNow !== undefined && fromApply) setAuto(plan, ctx, "proj", r.id, his, true); plan.unchanged++; return; }
  if (typedNow !== undefined && !fromApply && !hasPin && !r.out) { plan.kept.push({ id: r.id, name: man.name, team: t.code, typed: typedNow, would: to }); return; }
  plan.typed[r.id] = to;
  setAuto(plan, ctx, "proj", r.id, his);
  plan.changes.push({ id: r.id, name: man.name, short: tableName(shapedTeam(t), man), team: t.code, from: from ?? null, to: after, move: isNum(from) ? round2(after - from) : null });
}

/** Whether a projection stands stored on him once this plan is written (a send's number or his own): then his minutes are stored with it, never left to the engine alone (R4, review round 2). */
const projStored = (plan, ctx, id) => { const v = Object.hasOwn(plan.typed, id) ? plan.typed[id] : ctx.overrides.proj?.[id]; return v !== undefined && v !== null; };

/** His pins on a scenario with the typed minutes a role change set aside taken out (typed-aside.js; the money review of 11-20, finding 3): Apply treats only numbers in use as his. rows: the scenario's (min_aside). Pure. */
export function livePins(pins, rows) {
  const aside = new Set((rows ?? []).filter((r) => r.min_aside).map((r) => r.id));
  return aside.size ? { ...pins, m: Object.fromEntries(Object.entries(pins?.m ?? {}).filter(([id]) => !aside.has(id))) } : pins;
}

/** One team's moves into the plan. A hand-typed board number with no pin in this scenario, not one an Apply set, stays and is listed as kept. On our engine a man on his own call or the engine's Out follows the engine (followEngine). */
function planTeam(plan, t, rec, key, ctx) {
  const pins = rec?.pins?.[key] ?? emptyPins();
  const res = scenario(teamFor({ ...t, source_default: ctx.dflt }, rec), outsOf(key), pins);
  const live = livePins(pins, res.rows); // the money review of 11-20, finding 3: a typed number a role change set aside is not his on the board (typed-aside.js)
  const before = plan.changes.length;
  const onBoard = (r) => ctx.board.has(r.id) && t.men.find((p) => p.id === r.id)?.board;
  const close = res.rows.filter(onBoard).every((r) => r.pinned?.m || pageTyped(ctx.base.get(r.id)) !== null || (isNum(r.min) && isNum(ctx.base.get(r.id).minutes) && Math.abs(r.min - ctx.base.get(r.id).minutes) <= MIN_TOL));
  let minMoves = 0;
  for (const r of res.rows) {
    const man = t.men.find((p) => p.id === r.id);
    if (r.clamped) plan.clamped.push({ name: man.name, team: t.code });
    if (r.back_on_zero) plan.back_on_zero.push({ name: man.name, team: t.code });
    if (!r.out && t.tonight.includes(r.id)) plan.back_in.push({ name: man.name, team: t.code }); // the board has him Out and this scenario has him playing: an old applied key, or his choice; either way, named
    if (!man.board || !ctx.board.has(r.id)) {
      if (!r.out && t.tonight.includes(r.id)) plan.not_on_board.push({ name: man.name, team: t.code });
      continue;
    }
    ctx.men.set(r.id, { man, t });
    const his = isHis(rec, key, live, r, t);
    const followed = followEngine(plan, ctx, t, man, r, live, his);
    if (followed !== null) { minMoves += followed; continue; }
    planProj(plan, ctx, t, man, r, his, ["m", "u", "d", "p", "r"].some((k) => Object.hasOwn(live[k] ?? {}, r.id)));
    const kept = projStored(plan, ctx, r.id);
    minMoves += planMinutes(plan, r, ctx, his, close && !kept, kept);
  }
  return { moves: plan.changes.length - before, min_moves: minMoves, totals: res.totals };
}

/** An engine-Out man's projection on the send: 0 in place of any other number (his typed one included), the number held in applied.set to come back when he plays. 1 when it moves. */
function zeroOut(plan, ctx, t, man, his) {
  const typedNow = ctx.overrides.proj?.[man.id], set = ctx.applied?.set?.[man.id];
  if (typedNow === undefined) return 0; // the engine's own 0
  if (typedNow === 0) { if (set?.to === 0) setAuto(plan, ctx, "proj", man.id, his, true); return 0; }
  const from = ctx.board.get(man.id).projection;
  plan.typed[man.id] = 0;
  setAuto(plan, ctx, "proj", man.id, his);
  plan.changes.push({ id: man.id, name: man.name, short: tableName(shapedTeam(t), man), team: t.code, from: from ?? null, to: 0, move: isNum(from) ? round2(-from) : null });
  return 1;
}

const PIN_UNSENT = { m: "minutes", u: "usage", d: "DK/min" };
/**
 * R4 (Adam 11-17; review round 2): on the scenario's send, a man whose board figure is the engine's on his own call or the engine's Out follows the engine, never the Console. Null for a man
 * the Console's numbers still decide; else the minutes moves. Engine Out: his stored minutes come off and his projection is 0 (zeroOut). His Minutes-page minutes, or his In against the
 * Console's Out: his minutes are the engine's, a projection pin of his is still sent (p as typed; d times his engine minutes), an Apply's projection on him comes off, and any pin not sent
 * is named in `missing`. Where the Console disagrees about him, that is named in `missing` too (G62).
 */
function followEngine(plan, ctx, t, man, r, pins, his) {
  const p = ctx.base.get(r.id);
  if (p?.proj_source !== "ours" || typeof p.ours?.playing !== "boolean") return null;
  const page = pageTyped(p), engineOut = p.ours.playing === false, hisOut = engineOut && (p.his === "out" || p.ours.marks?.status?.by === "you");
  if (!engineOut && page === null && (!r.out || p.his === "out")) return null; // review round 4: the engine playing a man the Console has Out on the news follows the engine (Adam 5:34 PM: "if he's IN -- projection"); his own Out stands
  const note = (why) => plan.missing.push({ name: man.name, team: t.code, why, kind: "disagree" });
  let moves = 0;
  if (Object.hasOwn(ctx.overrides.min ?? {}, r.id)) { plan.min[r.id] = null; moves++; }
  if (engineOut) {
    zeroOut(plan, ctx, t, man, r.out ? his : hisOut);
    if (!r.out) note(`${man.name} is Out ${hisOut ? "on his own call" : "in the engine"}, and the Console's numbers for his teammates have him playing`);
    return moves;
  }
  const mins = p.ours.minutes, to = Object.hasOwn(pins.p ?? {}, r.id) ? pins.p[r.id] : Object.hasOwn(pins.d ?? {}, r.id) && isNum(mins) ? round2(mins * pins.d[r.id]) : undefined;
  if (to !== undefined) planProj(plan, ctx, t, man, { ...r, out: false, proj: to }, his, true);
  else { const set = ctx.applied?.set?.[r.id]; if (set && ctx.overrides.proj?.[r.id] === set.to) restoreProj(plan, man, t, set, ctx); }
  const typedTonight = p.ours.marks?.minutes?.undo === true; // typed on the Minutes page tonight; a standing or look-back override of his has no undo there
  const hisIn = p.his === "in", whose = page !== null ? `his ${typedTonight ? "Minutes-page" : "typed"} ${page} minutes on ${man.name}` : `${man.name} playing ${hisIn ? "on his own call" : "in the engine"}`;
  for (const k of ["m", "u", "d"]) if (Object.hasOwn(pins[k] ?? {}, r.id) && !(k === "d" && to !== undefined && !Object.hasOwn(pins.p ?? {}, r.id))) plan.his_notes.push({ name: man.name, team: t.code, why: `${whose} stand${page !== null ? "" : "s"} over his Console ${PIN_UNSENT[k]} pin of ${pins[k][r.id]}${k === "u" ? "; the engine's DK/min stands" : ""}` });
  if (r.out) note(page === null && !hisIn ? `the Console has ${man.name} Out and the engine has him playing; the board shows the engine's figures` : `the Console has ${man.name} Out, but ${whose} stand${page !== null ? "" : "s"}`);
  return moves;
}

/** His Minutes-page minutes on a man (typed tonight or a standing override: the engine's mark is his), or null. The engine's figure is then his number, and no send stores one over it (R4, 11-17). */
export function pageTyped(p) {
  return p?.proj_source === "ours" && p.ours?.playing !== false && p.ours?.marks?.minutes?.by === "you" && isNum(p.ours.minutes) ? p.ours.minutes : null;
}

const PIN_WORDS = { m: "minutes", u: "a usage", d: "a DK/min", p: "a projection" };
/** Whether a role the news flipped a man to is the role the engine gives him: Starter for Starter, any bench tier for a bench flip, not playing (or 0 minutes) for out of rotation.
 *  The news writes no "out" flip (console-card.js: an Out is a scenario Out, kind "out"); one read here is taken as out of rotation. */
const sameRole = (role, p) => (role === "starter" ? p?.ours?.tier === "starter" : role === "oor" || role === "out" ? p?.ours?.playing === false || p?.ours?.minutes === 0 : p?.ours?.playing === true && p.ours.tier !== "starter");

/**
 * R4 (Adam 11-17, 3:28 PM: board minutes are the current engine plus the current news; no send freezes a number; only his typed minutes stand as typed): a held team whose scenario is only
 * the news, on our engine, is the engine itself, which reads the same news and is worked again on every read. { ok, why }: ok when the team feeds the optimizer from Ours (or Ours + my edits),
 * he has no pin on the scenario and no role flip of his own (a flip the news made counts only where the engine gives him another role), the board's base is the engine's for every man on it,
 * and the scenario's Outs are the men the engine has not playing (a man the engine has In or Out on his own call, Minutes page or Console, agrees whatever the scenario says).
 * Otherwise `why` names the first difference as a clause ("because <why>") and `kind` says whose it is: "choice" (his pin, his own flip, TwoGun's minutes chosen; the foot's left-out lines)
 * or "conflict" (the engine and the Console disagree, or the engine gave no figures; the foot's unchecked lines, so the self-check is not green). Only marks on men on the team and playing
 * in the scenario count, as the scenario itself reads them (console-engine.js pinsOnPlaying).
 */
export function engineOwns(t, rec, key, ctx) {
  const choice = (why) => ({ ok: false, why, kind: "choice", notes: [] });
  const src = MINUTE_SOURCES.includes(rec?.source) ? rec.source : ctx.dflt;
  if (src === "twogun") return choice(MINUTE_SOURCES.includes(rec?.source) ? "he set its Optimizer minutes to TwoGun" : "the board's projection setting is TwoGun, so its Optimizer minutes are TwoGun's by default");
  const outs = new Set(outsOf(key)), name = (id) => t.men.find((m) => m.id === id)?.name ?? id;
  const onBoard = t.men.map((m) => [m, ctx.base.get(m.id)]).filter(([, p]) => p); // a man off the board (TwoGun's Out list) carries no figure either way
  if (onBoard.some(([, p]) => p.proj_source === "twogun")) return choice("he set its Optimizer minutes to Ours on a board that shows TwoGun's projections");
  if (onBoard.some(([, p]) => p.proj_source !== "ours")) return { ok: false, why: "the board's players carry no figures from our engine", kind: "conflict", notes: [] }; // no engine wired (a caller with no ourPlayers): the Console's numbers are sent, and the check is not green
  // review round 3: an engine with no figures for the team fails closed (nothing planned, stripped or written; the key stays), never a switch to the Console's numbers
  if (!onBoard.length) return { ok: false, blank: true, kind: "conflict", why: "none of its men is on the board", notes: [] };
  const blank = engineBlank(t, ctx);
  if (blank) return { ok: false, blank: true, kind: "conflict", why: blank, notes: [] };
  const live = (sec) => Object.entries(sec ?? {}).filter(([id]) => t.men.some((m) => m.id === id) && !outs.has(id));
  const pins = rec?.pins?.[key] ?? {};
  for (const k of ["m", "u", "d", "p"]) { const [hit] = live(pins[k]); if (hit) return choice(`he pinned ${PIN_WORDS[k]} on ${name(hit[0])} in the Console`); }
  // his usage hand-outs for a sitter of his (not on Tonight) and his combined ones: the scenario's usage reads them, the engine does not (console-engine.js usageFor)
  const sitter = [...outs].find((id) => !t.tonight.includes(id) && Object.keys(rec?.handouts?.[id]?.u ?? {}).length);
  if (sitter) return choice(`he set usage hand-outs for ${name(sitter)} in the Console`);
  if (outs.size >= 2 && Object.keys(rec?.combos?.[keyOf([...outs])]?.u ?? {}).length) return choice(`he set combined usage hand-outs for ${[...outs].map(name).join(" + ")} in the Console`);
  const newsFlips = newsOwned(newsView(rec, key)).r, notes = [];
  for (const [id, role] of live(pins.r)) {
    if (!newsFlips.has(id)) return choice(`he flipped ${name(id)}'s role in the Console`);
    if (!sameRole(role, ctx.base.get(id))) notes.push({ name: name(id), why: `the news flipped ${name(id)} to ${role.replace("_", " ")} in the Console, a role the engine does not give him; the board shows the engine's figures`, kind: "disagree" });
  }
  // review round 3: a man the engine has no row for is skipped and named; an Out the Console and the engine disagree on, not his call, follows the engine ("engine plus news") and is named
  for (const [man, p] of onBoard) {
    if (typeof p.ours?.playing !== "boolean") { notes.push({ name: man.name, why: `the engine has no figures for him${p.ours?.missing ? ` (${p.ours.missing})` : ""}, so his earlier numbers stand` }); continue; }
    const engineOut = p.ours.playing === false;
    if (engineOut !== outs.has(man.id) && p.his !== (engineOut ? "out" : "in")) notes.push({ name: man.name, why: engineOut ? `the engine has ${man.name} Out and the Console has him playing; the board shows the engine's figures` : `the Console has ${man.name} Out and the engine has him playing; the board shows the engine's figures`, kind: "disagree" });
  }
  return { ok: true, why: null, kind: null, notes };
}

/** An Apply record on a man whose typed number is gone (he cleared it on the board): the record is dropped, so it holds no team and restores nothing later (review round 3). True when dropped.
 *  Counted in plan.dropped, never as a moved number (review round 4): the send writes for it, and no note says a number moved. */
function dropGone(plan, ctx, t, man) {
  if (!ctx.applied?.set?.[man.id] || ctx.overrides.proj?.[man.id] !== undefined) return false;
  plan.typed[man.id] = null; // nothing to remove on the board; applyRecord drops the set entry of a man restoring
  plan.restoring.add(man.id);
  plan.dropped++;
  return true;
}

/** No engine figures for the team: why, or null. Only a board on our engine is judged; a man off the board carries no figure either way (review rounds 3 and 4). */
function engineBlank(t, ctx) {
  const onBoard = t.men.map((m) => ctx.base.get(m.id)).filter((p) => p && p.proj_source === "ours");
  if (!onBoard.length || onBoard.some((p) => typeof p.ours?.playing === "boolean")) return null;
  return `the engine has no figures for its men${onBoard[0].ours?.missing ? ` (${onBoard[0].ours.missing})` : ""}`;
}

/** An earlier Apply's projection on a man comes off: he goes back to what he had (his typed number, or the board's own). */
function restoreProj(plan, man, t, set, ctx) {
  const after = effectiveProjection(ctx.base.get(man.id).projection, set.prev, bumpIn(ctx.overrides, "GPP", man.id)); // GPP's thumbs, as planApply's board
  const from = ctx.board.get(man.id).projection;
  plan.typed[man.id] = set.prev;
  plan.restoring.add(man.id);
  plan.changes.push({ id: man.id, name: man.name, short: tableName(shapedTeam(t), man), team: t.code, from: from ?? null, to: after ?? null, move: isNum(from) && isNum(after) ? round2(after - from) : null });
}

/**
 * A team he has moved back to Tonight, with no pins: each man an earlier Apply set, whose typed number is still that one, goes back to what he had. A man our engine has Out shows 0 instead
 * (zeroOut; the number held in applied.set) and makes the team `held`, not undone, so its applied key stays and his number comes back when he plays (review round 2, finding 1).
 * Only a team with an applied key has been moved back: a record with none, written before keys were kept, is left for Reverse.
 */
function undoTeam(plan, t, ctx) {
  if (!Object.hasOwn(ctx.applied?.keys ?? {}, t.code)) return { moves: 0, min_moves: 0, held: false };
  let moves = 0, minMoves = 0, held = false;
  for (const man of t.men) {
    ctx.men.set(man.id, { man, t });
    const set = ctx.applied?.set?.[man.id], p = ctx.base.get(man.id);
    if (p?.proj_source === "ours" && typeof p.ours?.playing !== "boolean") continue; // no engine row for him: whether he plays is unknown, so his numbers stand (review round 4)
    if (Object.hasOwn(ctx.overrides.min ?? {}, man.id)) { plan.min[man.id] = null; minMoves++; }
    if (!ctx.board.has(man.id)) continue;
    if (dropGone(plan, ctx, t, man)) { moves++; continue; }
    if (p?.ours?.playing === false && (set || (ctx.overrides.proj?.[man.id] ?? 0) !== 0)) { moves += zeroOut(plan, ctx, t, man, p.his === "out"); held = true; continue; }
    if (!set || ctx.overrides.proj?.[man.id] !== set.to) continue;
    restoreProj(plan, man, t, set, ctx);
    moves++;
  }
  return { moves, min_moves: minMoves, held };
}

/**
 * A held team engineOwns names (R4, 11-17): every stored minutes figure comes off, so the board is the engine's. A man the engine has Out shows 0: a projection on him (his typed one
 * included) becomes the send's 0, its earlier number held in applied.set (applyRecord) to come back when he plays. A man playing goes back to what an earlier Apply took from him; a number
 * he typed on the board, with no Apply on it, stands.
 */
function engineTeam(plan, t, ctx) {
  let moves = 0, minMoves = 0;
  for (const man of t.men) {
    ctx.men.set(man.id, { man, t });
    const p = ctx.base.get(man.id);
    if (p && typeof p.ours?.playing !== "boolean") continue; // no engine row for him: his numbers stand, and engineOwns named him (review round 3)
    if (Object.hasOwn(ctx.overrides.min ?? {}, man.id)) { plan.min[man.id] = null; minMoves++; }
    if (!p || !ctx.board.has(man.id)) continue;
    if (dropGone(plan, ctx, t, man)) { moves++; continue; }
    const typedNow = ctx.overrides.proj?.[man.id], set = ctx.applied?.set?.[man.id];
    if (p.ours.playing === false) { moves += zeroOut(plan, ctx, t, man, p.his === "out"); continue; }
    if (!set || typedNow !== set.to) continue;
    restoreProj(plan, man, t, set, ctx);
    moves++;
  }
  return { moves, min_moves: minMoves };
}

/**
 * The preview's rows, one for each man whose projection or minutes the send moves: projection movers first in their order, then men whose minutes
 * alone move, largest first. Each carries minutes and projection as the board holds them now and after. DK/min after is the after projection over the after
 * minutes, the sum the board's DK/m TON does, so the two agree. The board holds no scenario rate, so the "from" rate is Tonight's, even over an earlier Apply. A missing figure stays null.
 */
function changedRows(plan, ctx) {
  const row = (id, change) => {
    const { man, t } = ctx.men.get(id), now = ctx.board.get(id);
    const held = now?.projection ?? null;
    const minFrom = now?.minutes ?? null;
    const minTo = Object.hasOwn(plan.min, id) ? plan.min[id] ?? ctx.base.get(id)?.minutes ?? null : minFrom;
    const projTo = change ? change.to : held;
    return { id, name: man.name, short: tableName(shapedTeam(t), man), team: t.code, min_from: minFrom, min_to: minTo, rate_from: man.out ? null : man.rate ?? null, rate_to: tonightRate(projTo, minTo), proj_from: change ? change.from : held, proj_to: projTo, move: change ? change.move : isNum(held) ? 0 : null };
  };
  const moved = new Set(plan.changes.map((c) => c.id));
  const minBy = (r) => (isNum(r.min_from) && isNum(r.min_to) ? Math.abs(r.min_to - r.min_from) : Infinity);
  const minOnly = Object.keys(plan.min).filter((id) => !moved.has(id)).map((id) => row(id, null)).sort((a, b) => minBy(b) - minBy(a) || a.name.localeCompare(b.name));
  return [...plan.changes.map((c) => row(c.id, c)), ...minOnly];
}

/**
 * What Apply would do for the posted scenarios: { changes: largest move first, rows (changedRows, the preview's table), typed: { id: number, or null for a removal }, min: { id: minutes,
 * or null for a removal }, min_moves (how many), restoring (the men going back to before an earlier Apply), teams: [{ team, key, name, moves,
 * min_moves, min_total }], refused (always empty: no team total refuses Apply, Adam 11-06), kept,
 * missing, clamped, back_on_zero, not_on_board, orphaned_pins, unchanged, basis }. A team on Tonight with no pins or role flips, on TwoGun minutes, sends nothing but
 * that undoing. min_total is the team's minutes for reference only. `from` and `to` are the effective board figures, so a man's thumbs bump on top
 * of the typed number is counted; each sent man's bump is in the basis.
 */
export function planApply(inputs, file, overrides, players, keys, only = null) {
  if (sourceRefusal(inputs)) throw new Error(`Nothing can be planned: ${SOURCE_UNKNOWN_WHY}.`); // the route and the resend refuse before this; a caller that did not is stopped here
  const ctx = {
    overrides, applied: file.applied, men: new Map(), dflt: defaultSourceOf(inputs),
    board: new Map(mergeOverrides(players, overrides, { held: heldTeams(file), mode: "GPP" }).map((p) => [String(p.dk_id), p])), // the console cannot know a build mode: the board as GPP shows it (Adam 1:24 PM 11-20, thumbs per mode)
    base: new Map(players.map((p) => [String(p.dk_id), p])),
  };
  const plan = { changes: [], typed: {}, min: {}, auto: { proj: {}, min: {} }, flag_ids: new Set(), restoring: new Set(), teams: [], refused: [], kept: [], missing: [], his_notes: [], dropped: 0, clamped: [], back_on_zero: [], not_on_board: [], back_in: [], unchanged: 0 };
  for (const t of Object.values(inputs.teams)) {
    if (only && !only.has(t.code)) continue; // a team not asked for is not planned, sent or undone (the console sends only the teams he changed)
    const rec = Object.hasOwn(file.teams, t.code) ? file.teams[t.code] : null, key = keys[t.code], tonight = keyOf(t.tonight);
    const name = label(shapedTeam(t), key);
    const ownSource = Boolean(rec?.source) && rec.source !== ctx.dflt; // a source other than the board's default feeds the optimizer here, so Tonight with no pins is still a send
    const blankFirst = engineBlank(t, ctx); // review round 4: a team with no engine figures is held as it stands, before any undo could restore a number onto a man Out
    if (blankFirst && (Object.hasOwn(file.applied?.keys ?? {}, t.code) || key !== tonight || hasPins(rec?.pins?.[key]) || ownSource)) {
      plan.teams.push({ team: t.code, key, tonight, name, moves: 0, min_moves: 0, min_total: null, held: true, blank: true, stored_why: blankFirst, stored_kind: "conflict" });
      plan.missing.push({ name: t.code, team: t.code, why: `${t.code} was not sent: ${blankFirst}`, kind: "blank" });
      continue;
    }
    if (key === tonight && !hasPins(rec?.pins?.[key]) && !ownSource) {
      const { moves, min_moves, held } = undoTeam(plan, t, ctx);
      if (held) plan.teams.push({ team: t.code, key, tonight, name, moves, min_moves, min_total: null, held: true }); // a man our engine has Out still holds an Apply number: the key stays until he plays (review round 2)
      else if (moves || min_moves) plan.teams.push({ team: t.code, key, tonight, name, moves, min_moves, min_total: null, undone: true });
      continue;
    }
    const owns = engineOwns(t, rec, key, ctx);
    for (const n of owns.notes) plan.missing.push({ name: n.name, team: t.code, why: n.why, ...(n.kind ? { kind: n.kind } : {}) });
    if (owns.blank) { // review round 3: no engine figures for the team: nothing planned, stripped or written, the key kept, and the foot says why (unchecked)
      plan.teams.push({ team: t.code, key, tonight, name, moves: 0, min_moves: 0, min_total: null, held: true, blank: true, stored_why: owns.why, stored_kind: owns.kind });
      plan.missing.push({ name: t.code, team: t.code, why: `${t.code} was not sent: ${owns.why}`, kind: "blank" }); // the page's preview and Apply answer say it (G62)
      continue;
    }
    if (owns.ok) { // held on the news (and engine-vs-Console differences that are not his call, named): what an earlier send stored comes off and the board is the engine's (R4, 11-17)
      const { moves, min_moves } = engineTeam(plan, t, ctx);
      plan.teams.push({ team: t.code, key, tonight, name, moves, min_moves, min_total: null, held: true, engine: true });
      continue;
    }
    const { moves, min_moves, totals } = planTeam(plan, t, rec, key, ctx);
    plan.teams.push({ team: t.code, key, tonight, name, moves, min_moves, min_total: totals.min, held: true, stored_why: owns.why, stored_kind: owns.kind }); // stored_why, stored_kind: why the board keeps the Console's numbers here, not the engine's (resend.json, board foot)
  }
  plan.min_moves = Object.keys(plan.min).length;
  flagNewsOuts(plan, ctx, file, only);
  plan.flag_moves = plan.flag_ids.size; // numbers left as they are whose "his or news's" mark changes: written, not counted as a move
  // A mark that moved no number is still held: the applied record names its team and scenario, so a reload sends it again and the header does not call it unsent.
  plan.holds = plan.teams.some((t) => { const ak = file.applied?.keys?.[t.team], k = typeof ak === "string" ? ak : ak?.key; return t.held && !t.blank && k !== t.key; });
  plan.changes.sort((a, b) => Math.abs(b.move ?? Infinity) - Math.abs(a.move ?? Infinity) || a.name.localeCompare(b.name));
  plan.rows = changedRows(plan, ctx);
  plan.orphaned_pins = orphanedPins(inputs, file, keys).filter((o) => !only || only.has(o.team));
  plan.basis = planBasis(plan, overrides, keys);
  plan.pull = inputs.basis?.pull ?? null;
  plan.base = baseOf(plan, ctx);
  return plan;
}

/**
 * The send's basis (the CONSOLE_MOVED check, console-route.js): a hash of only what the send writes, so a preview and a send with nothing real moved between them always match (Adam 11-21).
 * In it: each sent projection with the number it replaces and its GPP thumbs bump, each minutes figure, the posted keys, each his-or-news mark the send writes (plan.auto) and
 * those that move, and each team's applied-key outcome with its Tonight. Never a stamp, a clock or a note (pins held on a scenario not on show are said in the preview, never written).
 * Pure and deterministic: entries sorted.
 */
export function planBasis(plan, overrides, keys) {
  const sent = Object.entries(plan.typed).sort().map(([id, to]) => [id, to, overrides.proj?.[id] ?? null, bumpIn(overrides, "GPP", id)]); // GPP's thumbs: the console is not per mode
  const teams = plan.teams.map((t) => [t.team, t.key, t.tonight ?? null, Boolean(t.held), Boolean(t.undone), Boolean(t.blank)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const auto = ["proj", "min"].map((s) => [s, Object.entries(plan.auto?.[s] ?? {}).sort()]);
  const body = { sent, min: Object.entries(plan.min).sort(), keys: Object.entries(keys).sort(), teams, auto, ...(plan.flag_ids.size ? { flags: [...plan.flag_ids].sort() } : {}) };
  return crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16);
}

/** What TwoGun had under each man this Apply sends a number for: { id: { min, out } }, his minutes and out flag in the pull the console read.
 *  The pull check (minute-misses.js) compares a newer pull against this. A man only going back to what he had is left out. */
function baseOf(plan, ctx) {
  const base = {};
  for (const id of new Set([...Object.keys(plan.typed), ...Object.keys(plan.min)])) {
    const sends = (Object.hasOwn(plan.typed, id) && !plan.restoring.has(id)) || (Object.hasOwn(plan.min, id) && plan.min[id] !== null);
    const man = ctx.men.get(id)?.man;
    if (sends && man) base[id] = { min: man.out ? 0 : isNum(man.min) ? man.min : null, out: Boolean(man.out) };
  }
  return base;
}

/** The overrides change an Apply makes and the applied record that goes with it. A man an earlier Apply set whose typed number is still that one keeps his first `prev`. */
export function applyRecord(plan, overrides, applied, atIso) {
  const set = { ...(applied?.set ?? {}) };
  const proj = {};
  for (const [id, to] of Object.entries(plan.typed)) {
    proj[id] = to;
    if (plan.restoring?.has(id)) { delete set[id]; continue; } // he is back to what he had: nothing of Apply's left on him
    const now = overrides.proj?.[id] ?? null;
    set[id] = { to, prev: set[id] && set[id].to === now ? set[id].prev : now };
  }
  // Per team, the scenario on the board and the Tonight it was made on ({ key, tonight }; an older record holds the key alone): a reload opens there,
  // rebased from that Tonight onto the current one, and only moving off it undoes it.
  const keys = { ...(applied?.keys ?? {}) };
  for (const t of plan.teams) {
    if (t.blank) continue; // no engine figures: the key stays as it was (review round 3)
    if (t.undone) delete keys[t.team];
    else if (t.moves > 0 || t.min_moves > 0 || t.held || Object.hasOwn(keys, t.team)) keys[t.team] = { key: t.key, tonight: t.tonight };
  }
  const minLeft = Object.keys({ ...(overrides.min ?? {}), ...plan.min }).some((id) => (Object.hasOwn(plan.min, id) ? plan.min[id] !== null : true));
  // What TwoGun had under each applied man, kept until his numbers come off: a man this Apply touched takes this pull's figure, or none when he went back.
  const base = { ...(applied?.base ?? {}) };
  for (const id of new Set([...Object.keys(plan.typed), ...Object.keys(plan.min)])) {
    if (Object.hasOwn(plan.base ?? {}, id)) base[id] = plan.base[id];
    else delete base[id];
  }
  const flagOnly = Boolean(applied) && plan.flag_moves > 0 && !plan.changes.length && !plan.min_moves && !plan.holds; // only marks changed: the record keeps the time and pull of the send that wrote its numbers
  const out = Object.keys(set).length || minLeft || Object.keys(keys).length ? { at: flagOnly ? applied.at : atIso, set, keys, base, pull: (flagOnly ? applied.pull : plan.pull) ?? null } : null;
  return { changes: { proj, min: plan.min, auto: plan.auto ?? { proj: {}, min: {} } }, applied: out };
}

/** The overrides change a reverse makes: only men whose typed number is still what Apply set; anyone he has typed over since is left and named. Every applied minutes figure comes off, since only an Apply sets them. */
export function reverseChanges(applied, overrides, players) {
  const proj = {}, kept = [];
  const names = new Map(players.map((p) => [String(p.dk_id), p.name]));
  for (const [id, { to, prev }] of Object.entries(applied?.set ?? {})) {
    if (overrides.proj?.[id] === to) proj[id] = prev;
    else if (names.has(id)) kept.push(names.get(id));
  }
  const min = Object.fromEntries(Object.keys(overrides.min ?? {}).map((id) => [id, null]));
  return { changes: { proj, min }, restored: Object.keys(proj).length, restored_min: Object.keys(min).length, kept };
}
