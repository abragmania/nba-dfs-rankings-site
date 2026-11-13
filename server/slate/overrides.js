// Adam's per-slate overrides (Adam, 5:20 PM ET 2026-10-29: "bring all the functionality from that over"): per DraftKings id
// a bump in steps, a typed projection, a typed projected ownership, a star. Ported from NFLDFSRankings
// server/overrides/store.js and server/overrides/merge.js at 7e49266 (that project's rules D28 and D72), adapted to this
// app: one file per slate, data/slates/<slate>/overrides.json, written atomically; it never modifies slate.json. Ceiling is
// left out throughout: a bump never moves the ceiling.
// Effective figures (the board, the optimizer and the DK file all read these): the projection is the figure to scale (the
// typed projection when one is set, else the base) x (1 + 5% x steps). Adam, 5:41 PM ET 2026-10-29: "if there's a typed
// number, thumbs up and down increase or decrease the typed number"; as in the NFL app's merge.js, the bump stays stored
// as steps on top of the typed number (so a press can be reversed), and typing a new number keeps the existing bump.
// Value is recomputed from the effective projection (per $1,000, two decimals, as the slate's own value is); projected
// ownership is the typed one when set. A bump is refused for a man with no number to scale (no typed number, no base).
// "Reset all overrides" clears typed numbers and bumps, never stars (NFL D72); a row's reset does the same for one man.
// `min` holds the minutes a console Apply set, so the board's Min and Chg show the applied scenario. Only an Apply writes it: the overrides
// route refuses it. Display only: the projection reaches the optimizer and the DK file through `proj`, and no build reads minutes.
// `auto` lists, per section (proj, min), the men whose stored number a send wrote from news or the engine, not from his hand (Adam 11-12: only his
// own numbers wear the marker and the reset). Absent means his; the figures are the same either way. A number he types (the overrides route) is his.
import fs from "../../site/shim/fs.js";
import path from "../../site/shim/path.js";
import { dataDir } from "../../site/shim/log.js";
import { writeFileAtomic } from "../../site/shim/atomic.js";
import { BUMP_STEP_PCT, BUMP_MAX_STEPS, PROJ_MAX, OWN_MAX } from "../board/override-limits.js";
import { isNum, isPlain, round2 } from "../board/figures.js";

export { BUMP_STEP_PCT, BUMP_MAX_STEPS, PROJ_MAX, OWN_MAX };
const SECTIONS = ["proj", "own", "bump", "stars"];
// Typed per-player notes were retired (Adam, 2026-11-09). A file's `notes` key is kept on disk exactly as found through every
// read, save and reset, but is never checked, shown, sent to the page or accepted from it.
/** A man's applied minutes are 0 to a team's whole 240; his own ceiling is the console's to hold. */
const MINUTES_MAX = 240;

/** An overrides error: code OVERRIDES_UNREADABLE (the file), OVERRIDES_INVALID (a value) or BUMP_NO_PROJECTION (a bump with nothing to scale). */
export class OverridesError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const AUTO_SECTIONS = ["proj", "min"]; // proj, min: figures a send wrote from news or the engine. pin: projections a send wrote from his console marks (not typed on the board, so a board reset leaves them)
const AUTO_LISTS = [...AUTO_SECTIONS, "pin"];
const EMPTY_AUTO = () => ({ proj: [], min: [], pin: [] });
// A slate with no file yet is flag-aware from its first write (auto present, empty), so every number a send writes is told from a typed one; only a file already on disk without the key stays a pre-flag file.
const EMPTY = () => ({ proj: {}, own: {}, bump: {}, min: {}, auto: EMPTY_AUTO(), stars: [], notes: {}, updated_at: null });
export const PROJ_TOL = 0.05; // DK points: the engine rounds minutes x rate to hundredths and the rate to four places
export const MIN_TOL = 0.05; // minutes: stored minutes are kept to thousandths, shown ones to hundredths
/** `{ auto }` for a record that has any flag or is flag-aware (`aware`: its source already had the key), else `{}`. A file with no `auto` key is a pre-flag file, which a send may re-mark freely; once the key is written, even empty, it stays. */
const autoPart = (auto, rec, aware = auto !== undefined) => { const a = cleanAuto(auto, rec); return aware || a.proj.length || a.min.length || a.pin.length ? { auto: a } : {}; };
/** The auto lists of a record: both sections always, ids only for a number the record holds (a flag never outlives its number). */
function cleanAuto(auto, rec) {
  const out = EMPTY_AUTO();
  for (const list of AUTO_LISTS) out[list] = [...new Set((auto?.[list] ?? []).filter((id) => has(rec[list === "pin" ? "proj" : list] ?? {}, id)))];
  return out;
}

export const overridesFile = (slate) => path.join(dataDir(), "slates", slate, "overrides.json");

/** A value check shared by the file read and a change: null when `v` is good for `section`, else the reason. */
function badValue(section, v) {
  if (section === "proj") return isNum(v) && v >= 0 && v <= PROJ_MAX ? null : `must be a number from 0 to ${PROJ_MAX}`;
  if (section === "own") return isNum(v) && v >= 0 && v <= OWN_MAX ? null : `must be a percentage from 0 to ${OWN_MAX}`;
  if (section === "bump") return Number.isInteger(v) && v !== 0 && Math.abs(v) <= BUMP_MAX_STEPS ? null : `must be a whole number of steps from -${BUMP_MAX_STEPS} to ${BUMP_MAX_STEPS}, never 0`;
  if (section === "min") return isNum(v) && v >= 0 && v <= MINUTES_MAX ? null : `must be a number from 0 to ${MINUTES_MAX}`;
  return null;
}

/** Throws OVERRIDES_INVALID (naming the field) unless `obj` is a well-formed overrides record. */
export function validateOverrides(obj) {
  const invalid = (msg) => { throw new OverridesError("OVERRIDES_INVALID", msg); };
  if (!isPlain(obj)) invalid("The overrides must be an object.");
  for (const section of ["proj", "own", "bump", "min"]) {
    const sec = obj[section] ?? {};
    if (!isPlain(sec)) invalid(`"${section}" must be an object keyed by DraftKings id.`);
    for (const [id, v] of Object.entries(sec)) {
      const why = badValue(section, v);
      if (why) invalid(`The ${section} value for ${id.slice(0, 40)} ${why}.`);
    }
  }
  if (!isPlain(obj.notes ?? {})) invalid('"notes" must be an object.');
  if (!isPlain(obj.auto ?? {})) invalid('"auto" must be an object.');
  const extra = Object.keys(obj.auto ?? {}).filter((k) => !AUTO_LISTS.includes(k));
  if (extra.length) invalid(`"auto" has an unknown section: ${extra[0].slice(0, 20)}.`);
  for (const sec of AUTO_LISTS) {
    const list = obj.auto?.[sec] ?? [];
    if (!Array.isArray(list) || list.some((id) => typeof id !== "string" || id === "")) invalid(`"auto.${sec}" must be a list of DraftKings ids.`);
  }
  const stars = obj.stars ?? [];
  if (!Array.isArray(stars) || stars.some((id) => typeof id !== "string" || id === "")) invalid('"stars" must be a list of DraftKings ids.');
  if (new Set(stars).size !== stars.length) invalid('"stars" repeats an id.');
  // A typed projection and a bump for one man is well formed: the bump scales the typed number (Adam, 2026-10-29 5:41 PM ET).
}

/** The record as the page may see it: everything but the retired `notes` kept on disk. */
export const publicOverrides = ({ notes, ...rest }) => rest;

/**
 * The slate's overrides, always the full shape. No file (or an empty one) is the empty shape; a file that cannot be read,
 * is not JSON, or fails the write's own check throws OVERRIDES_UNREADABLE, never partial or empty data (it fails closed).
 */
export function readOverrides(slate) {
  const file = overridesFile(slate);
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return EMPTY();
    throw new OverridesError("OVERRIDES_UNREADABLE", `This slate's overrides file could not be read (${e?.message ?? e}).`);
  }
  if (raw.trim() === "") return EMPTY();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new OverridesError("OVERRIDES_UNREADABLE", `This slate's overrides file is not valid JSON (${e.message}).`);
  }
  try {
    validateOverrides(parsed);
  } catch (e) {
    throw new OverridesError("OVERRIDES_UNREADABLE", `This slate's overrides file is not well formed: ${e.message}`);
  }
  return {
    proj: { ...(parsed.proj ?? {}) }, own: { ...(parsed.own ?? {}) }, bump: { ...(parsed.bump ?? {}) }, min: { ...(parsed.min ?? {}) }, ...autoPart(parsed.auto, parsed),
    stars: [...(parsed.stars ?? [])], notes: { ...(parsed.notes ?? {}) }, updated_at: parsed.updated_at ?? null,
  };
}

/** Writes the slate's overrides atomically, stamping updated_at; throws OVERRIDES_INVALID on a bad record. Returns the record. */
export function writeOverrides(slate, obj) {
  validateOverrides(obj);
  const record = {
    slate, proj: { ...(obj.proj ?? {}) }, own: { ...(obj.own ?? {}) }, bump: { ...(obj.bump ?? {}) }, min: { ...(obj.min ?? {}) }, ...autoPart(obj.auto, obj),
    stars: [...(obj.stars ?? [])], notes: { ...(obj.notes ?? {}) }, updated_at: new Date().toISOString(),
  };
  writeFileAtomic(overridesFile(slate), JSON.stringify(record, null, 1) + "\n");
  return record;
}

/**
 * Checks a POST body at the boundary against the slate's players. One of three shapes:
 *   { resetAll: true } -> { ok, kind: "resetAll" }; { reset: dk_id } -> { ok, kind: "reset", id };
 *   { proj?, own?, bump?, stars? } -> { ok, kind: "changes", changes }, each section keyed by a DraftKings id on the
 *   slate: proj and own a number or null (null removes), bump a whole number of steps -10..10 (0 or null removes),
 *   stars true or false.
 * Anything else is { ok: false, message }.
 */
export function checkChanges(body, slateData) {
  const bad = (message) => ({ ok: false, message });
  if (!isPlain(body)) return bad("Body must be a JSON object.");
  const known = new Set((slateData?.players ?? []).map((p) => String(p.dk_id)));
  const keys = Object.keys(body);
  if ("resetAll" in body || "reset" in body) {
    if (keys.length !== 1) return bad("A reset is sent on its own.");
    if ("resetAll" in body) return body.resetAll === true ? { ok: true, kind: "resetAll" } : bad('"resetAll" must be true.');
    if (typeof body.reset !== "string" || !known.has(body.reset)) return bad(`"reset" must be a DraftKings id on this slate.`);
    return { ok: true, kind: "reset", id: body.reset };
  }
  const unknown = keys.filter((k) => !SECTIONS.includes(k));
  if (unknown.length) return bad(`Unknown override field: ${unknown.map((k) => k.slice(0, 20)).join(", ")}.`);
  const changes = {};
  let count = 0;
  for (const section of SECTIONS) {
    if (!(section in body)) continue;
    const sec = body[section];
    if (!isPlain(sec)) return bad(`"${section}" must be an object keyed by DraftKings id.`);
    changes[section] = {};
    for (const [id, raw] of Object.entries(sec)) {
      if (!known.has(id)) return bad(`Player id ${id.slice(0, 40)} is not on this slate, so nothing was saved.`);
      let v = raw;
      if (section === "stars") {
        if (typeof v !== "boolean") return bad(`The star for ${id.slice(0, 40)} must be true or false.`);
      } else if (section === "bump" && v === 0) v = null;
      if (section !== "stars" && v !== null) {
        const why = badValue(section, v);
        if (why) return bad(`The ${section === "proj" ? "projection" : section === "own" ? "ownership" : "bump"} for ${id.slice(0, 40)} ${why}.`);
        // Typed numbers are kept to hundredths, the slate's own precision (review round 2).
        if (section === "proj" || section === "own") v = round2(v);
      }
      changes[section][id] = v;
      count++;
    }
  }
  if (!count) return bad("The change names no player.");
  return { ok: true, kind: "changes", changes };
}

/**
 * Pure: `current` with checked `changes` applied, as a new record. As the NFL app's applyOverrideChanges does, a typed
 * projection never touches the man's bump: typing a new number keeps the steps, which then scale the new number. A bump
 * sent for a man with no number to scale (no typed projection after this change, and a base in `players` that is not a
 * number) throws BUMP_NO_PROJECTION. `players`: the slate's players (dk_id, projection).
 */
export function applyChanges(current, changes, players = []) {
  const next = { proj: { ...current.proj }, own: { ...current.own }, bump: { ...current.bump }, min: { ...current.min }, stars: [...current.stars], notes: { ...current.notes }, updated_at: current.updated_at };
  const held = cleanAuto(current.auto, current), auto = { proj: new Set(held.proj), min: new Set(held.min), pin: new Set(held.pin) };
  const baseOf = new Map((players ?? []).map((p) => [String(p.dk_id), p.projection]));
  for (const [id, v] of Object.entries(changes.proj ?? {})) {
    auto.proj.delete(id); auto.pin.delete(id); // a number set here is typed on the board, his, unless changes.auto says a send wrote it
    if (v !== null) { next.proj[id] = v; continue; }
    delete next.proj[id];
    // With the typed number gone, a man whose base is not a number has nothing left for his steps to scale: they go too
    // (review round 2), so no bump is ever stored on nothing.
    if (baseOf.has(id) && !isNum(baseOf.get(id))) delete next.bump[id];
  }
  for (const [id, v] of Object.entries(changes.own ?? {})) {
    if (v === null) delete next.own[id];
    else next.own[id] = v;
  }
  for (const [id, v] of Object.entries(changes.min ?? {})) {
    auto.min.delete(id);
    if (v === null) delete next.min[id];
    else next.min[id] = v;
  }
  for (const [id, v] of Object.entries(changes.bump ?? {})) {
    if (v === null) { delete next.bump[id]; continue; }
    if (!has(next.proj, id) && !isNum(baseOf.get(id))) throw new OverridesError("BUMP_NO_PROJECTION", `Player ${id.slice(0, 40)} has no projection to raise or lower; type one first.`);
    next.bump[id] = v;
  }
  for (const [id, v] of Object.entries(changes.stars ?? {})) {
    const on = next.stars.includes(id);
    if (v && !on) next.stars.push(id);
    else if (!v && on) next.stars = next.stars.filter((s) => s !== id);
  }
  // changes.auto { proj|min: { id: true (news or engine) | false (his console marks) } } re-marks men holding a number, after the numbers, so a number left as it was is marked too.
  // A projection the console wrote for his marks is also listed in `pin`: it is his, but not typed on the board, so a board reset leaves it.
  for (const sec of AUTO_SECTIONS) {
    for (const [id, on] of Object.entries(changes.auto?.[sec] ?? {})) {
      if (!has(next[sec], id)) continue;
      if (on) auto[sec].add(id); else auto[sec].delete(id);
      if (sec === "proj") { if (on) auto.pin.delete(id); else auto.pin.add(id); }
    }
  }
  Object.assign(next, autoPart({ proj: [...auto.proj], min: [...auto.min], pin: [...auto.pin] }, next, current.auto !== undefined || changes.auto !== undefined));
  return next;
}

/**
 * What a board reset clears, by section: a projection typed on the board (one no send wrote: not news's or the engine's, not from his console marks), every
 * typed ownership and every bump. Never a number the console or news wrote, minutes included: those are changed in the console. The one definition Reset all, the row reset and the count use.
 */
export function hisNumbers(o) {
  const auto = cleanAuto(o.auto, o), sent = new Set([...auto.proj, ...auto.pin]);
  return { proj: Object.keys(o.proj).filter((id) => !sent.has(id)), own: Object.keys(o.own), bump: Object.keys(o.bump) };
}

/** True when the record holds a number a board reset would clear. */
export const hasNumbers = (o) => Object.values(hisNumbers(o)).some((ids) => ids.length > 0);

/** Pure: one man's projection, ownership and bump typed on the board removed; his star and every number the console or news wrote stay (NFL D72). */
export function resetPlayer(current, id) {
  const his = hisNumbers(current);
  const next = { ...current, proj: { ...current.proj }, own: { ...current.own }, bump: { ...current.bump }, min: { ...current.min }, stars: [...current.stars], notes: { ...current.notes } };
  if (his.proj.includes(id)) delete next.proj[id];
  delete next.own[id];
  delete next.bump[id];
  return next;
}

/** Pure: every projection, ownership and bump typed on the board cleared; stars stay (NFL D72); the retired notes are carried through untouched. The console's and news's numbers, minutes included, stay. */
export function resetAll(current) {
  const his = hisNumbers(current);
  const next = { ...current, proj: { ...current.proj }, own: {}, bump: {}, min: { ...current.min }, stars: [...current.stars], notes: { ...current.notes } };
  for (const id of his.proj) delete next.proj[id];
  return next;
}

/** The bump multiplier, (100 + 5 x steps) / 100 so 20 at +2 is exactly 22; 1 at 0 steps. */
export const bumpFactor = (steps) => (Number.isInteger(steps) && steps ? (100 + BUMP_STEP_PCT * steps) / 100 : 1);

/** The effective projection: (typed when set, else base) x bumpFactor(steps), two decimals; a missing figure stays missing (R1). */
export function effectiveProjection(base, typed, steps) {
  const fig = typed != null ? typed : base;
  if (!isNum(fig)) return fig ?? null;
  if (!steps) return fig;
  // Worked in whole hundredths so a half rounds up as written (33.3 at +5% is 34.97, never 34.96 from 34.964999...).
  return Math.round((Math.round(fig * 100) * (100 + BUMP_STEP_PCT * steps)) / 100) / 100;
}

/** Value from a projection: points per $1,000 of salary, two decimals; null when either is missing (R1). */
export function valueFrom(projection, salary) {
  return isNum(projection) && Number.isInteger(salary) && salary > 0 ? round2((projection * 1000) / salary) : null;
}

/** The players with only the applied minutes merged: the figures a typed number or a bump works on (under our engine, the projection after applied minutes). For applyChanges' base. */
export const minutesBase = (players, overrides) => mergeOverrides(players, { ...EMPTY(), min: { ...(overrides?.min ?? {}) }, auto: overrides?.auto ?? EMPTY_AUTO() });

/**
 * Which of one man's stored send numbers does not stand (R4, Adam 11-13): { proj, min, no_figure }. Only a number listed in auto.proj / auto.min is ever set aside; Adam's own numbers and his
 * console marks (auto.pin) always stand. A send's numbers come from the console's scenario maths (console-engine.js: scenario Outs, pins, flips, usage-scaled DK/min), which the minutes
 * engine (`ours`) never sees, so on a team the board is held for (`held`, scenarios.js heldTeams) they are never compared with it: the server resend refreshes them (resend.js) and the
 * board foot says when it could not. Two cases only:
 *  - no_figure: under our engine the man has no figure (ours.projection not a number, not Out), so a send's projection stands in for nothing (shown null, said).
 *  - a team NOT held (held is a Set without it): a send's number that no longer equals the engine's goes, and the man's stored 0 and stored minutes are one decision (both go or both stand).
 * `held` null means the caller cannot tell the teams, so no comparison is made. Minutes stored for a man the engine has Out are already set aside by mergeOverrides.
 */
export function staleSendOf(p, o, held = null) {
  const none = { proj: false, min: false, no_figure: false };
  if (p.proj_source !== "ours") return none;
  const id = String(p.dk_id), auto = cleanAuto(o.auto, { proj: o.proj ?? {}, min: o.min ?? {} });
  const sp = has(o.proj ?? {}, id) && auto.proj.includes(id) && !auto.pin.includes(id) ? o.proj[id] : null;
  const sm = has(o.min ?? {}, id) && auto.min.includes(id) ? o.min[id] : null;
  if (sp == null && sm == null) return none;
  const ours = p.ours, outTonight = ours?.playing === false;
  if (!outTonight && !isNum(ours?.projection)) return { proj: sp != null, min: sm != null, no_figure: true }; // stored minutes x the rate would stand in for the figure the engine lacks, so they go with the projection
  if (!(held instanceof Set) || held.has(p.team) || !ours) return none;
  const projOff = sp != null && Math.abs(sp - (outTonight ? 0 : ours.projection)) > PROJ_TOL;
  const minOff = sm != null && !outTonight && isNum(ours.minutes) && Math.abs(sm - ours.minutes) > MIN_TOL;
  return projOff || minOff ? { proj: sp != null, min: sm != null && !outTonight, no_figure: false } : none;
}

/**
 * The slate's players with the overrides applied, without adding or dropping anyone and without touching the inputs.
 * Every player gets starred (true/false); the retired notes are not added. A player with a typed number or a bump also gets
 * projection, value and proj_own as the effective figures, base: { projection, value, proj_own } (the slate's own), and
 * ovr: { steps (0 when none), projection (typed or null), proj_own (typed or null) }. The ceiling is never changed. A man with applied minutes
 * gets minutes as those and base_minutes as the slate's own; they alone leave his projection, value, ownership and ovr as they are, except under our minutes engine
 * (proj_source "ours" with a rate), where his projection becomes those minutes x our DK/min and the typed number and bump work on that.
 */
export function mergeOverrides(players, overrides, { held = null } = {}) {
  const o = overrides ?? EMPTY();
  const stars = new Set(o.stars ?? []);
  return (players ?? []).map((p) => {
    const id = String(p.dk_id);
    const stale = staleSendOf(p, o, held); // a send's number the engine's figure has moved off (a team not held), or one the engine has no figure for: not used, and said (stale_auto)
    const typedProj = has(o.proj ?? {}, id) && !stale.proj ? o.proj[id] : null;
    const storedMin = has(o.min ?? {}, id) && !stale.min;
    const typedOwn = has(o.own ?? {}, id) ? o.own[id] : null;
    const steps = has(o.bump ?? {}, id) ? o.bump[id] : 0; // the real steps, on a typed row too
    const out = { ...p, starred: stars.has(id), ...(stale.proj || stale.min ? { stale_auto: stale } : {}) };
    if (stale.no_figure) out.proj_note = `A ${stale.proj ? `projection (${o.proj[id]})` : "minutes number"} a send wrote is not used: the engine has no figure for him`;
    // auto: this figure came from a send's news or engine numbers, not his hand; the board marks and resets only his (the figure itself is the same).
    // Minutes count only when they are applied: under our engine a man it has Out ignores them (the proj_note below), so they carry no mark. pin: the projection is the console's, from his marks.
    const minApplied = storedMin && !(p.proj_source === "ours" && p.ours?.playing === false);
    const autoProj = typedProj != null && (o.auto?.proj ?? []).includes(id), autoMin = minApplied && (o.auto?.min ?? []).includes(id), pin = typedProj != null && (o.auto?.pin ?? []).includes(id);
    if (autoProj || autoMin || pin) out.auto = { proj: autoProj, min: autoMin, pin };
    let q = p; // the figures the typed number and bump work on
    if (storedMin && p.proj_source === "ours" && p.ours?.playing === false) {
      // Under our engine the Minutes page decides who plays: console minutes on a man it has Out are ignored, and said (the console is being retired).
      out.proj_note = `Your console minutes (${o.min[id]}) are ignored: he is Out tonight on the Minutes page`;
    } else if (storedMin) {
      out.minutes = o.min[id]; out.base_minutes = p.minutes ?? null;
      // Under our minutes engine the projection is minutes x DK/min (Adam 11-10), so applied minutes carry it: the shown minutes times our rate, never the engine's minutes' projection.
      if (p.proj_source === "ours" && isNum(p.ours?.rate)) {
        const pr = round2(o.min[id] * p.ours.rate);
        q = { ...p, projection: pr, value: valueFrom(pr, p.salary) };
        Object.assign(out, { projection: q.projection, value: q.value, proj_note: `Projection = your applied ${o.min[id]} minutes x our DK/min ${p.ours.rate}` });
      }
    }
    if (typedProj == null && typedOwn == null && !steps) return out;
    const projection = effectiveProjection(q.projection, typedProj, steps);
    const moved = projection !== q.projection;
    return {
      ...out,
      projection,
      value: moved ? valueFrom(projection, p.salary) : q.value,
      proj_own: typedOwn ?? p.proj_own,
      base: { projection: q.projection, value: q.value, proj_own: p.proj_own },
      ovr: { steps, projection: typedProj, proj_own: typedOwn },
    };
  });
}
