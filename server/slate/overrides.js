// Adam's per-slate overrides (Adam, 5:20 PM ET 2026-10-29: "bring all the functionality from that over"): per DraftKings id
// a bump in steps, a typed projection, a typed projected ownership, a star and a short note. Ported from NFLDFSRankings
// server/overrides/store.js and server/overrides/merge.js at 7e49266 (that project's rules D28 and D72), adapted to this
// app: one file per slate, data/slates/<slate>/overrides.json, written atomically; it never modifies slate.json. Ceiling is
// left out throughout: a bump never moves the ceiling.
// Effective figures (the board, the optimizer and the DK file all read these): the projection is the figure to scale (the
// typed projection when one is set, else the base) x (1 + 5% x steps). Adam, 5:41 PM ET 2026-10-29: "if there's a typed
// number, thumbs up and down increase or decrease the typed number"; as in the NFL app's merge.js, the bump stays stored
// as steps on top of the typed number (so a press can be reversed), and typing a new number keeps the existing bump.
// Value is recomputed from the effective projection (per $1,000, two decimals, as the slate's own value is); projected
// ownership is the typed one when set. A bump is refused for a man with no number to scale (no typed number, no base).
// "Reset all overrides" clears typed numbers and bumps, never stars or notes (NFL D72); a row's reset does the same for one man.
// `min` holds the minutes a console Apply set, so the board's Min and Chg show the applied scenario. Only an Apply writes it: the overrides
// route refuses it. Display only: the projection reaches the optimizer and the DK file through `proj`, and no build reads minutes.
import fs from "../../site/shim/fs.js";
import path from "../../site/shim/path.js";
import { dataDir } from "../../site/shim/log.js";
import { writeFileAtomic } from "../../site/shim/atomic.js";
import { BUMP_STEP_PCT, BUMP_MAX_STEPS, PROJ_MAX, OWN_MAX, NOTE_MAX } from "../board/override-limits.js";
import { isNum, isPlain, round2 } from "../board/figures.js";

export { BUMP_STEP_PCT, BUMP_MAX_STEPS, PROJ_MAX, OWN_MAX, NOTE_MAX };
const SECTIONS = ["proj", "own", "bump", "stars", "notes"];
/** A man's applied minutes are 0 to a team's whole 240; his own ceiling is the console's to hold. */
const MINUTES_MAX = 240;

/** An overrides error: code OVERRIDES_UNREADABLE (the file), OVERRIDES_INVALID (a value) or BUMP_NO_PROJECTION (a bump with nothing to scale). */
export class OverridesError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const EMPTY = () => ({ proj: {}, own: {}, bump: {}, min: {}, stars: [], notes: {}, updated_at: null });
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export const overridesFile = (slate) => path.join(dataDir(), "slates", slate, "overrides.json");

/** A value check shared by the file read and a change: null when `v` is good for `section`, else the reason. */
function badValue(section, v) {
  if (section === "proj") return isNum(v) && v >= 0 && v <= PROJ_MAX ? null : `must be a number from 0 to ${PROJ_MAX}`;
  if (section === "own") return isNum(v) && v >= 0 && v <= OWN_MAX ? null : `must be a percentage from 0 to ${OWN_MAX}`;
  if (section === "bump") return Number.isInteger(v) && v !== 0 && Math.abs(v) <= BUMP_MAX_STEPS ? null : `must be a whole number of steps from -${BUMP_MAX_STEPS} to ${BUMP_MAX_STEPS}, never 0`;
  if (section === "notes") return typeof v === "string" && v.trim() !== "" && v.length <= NOTE_MAX ? null : `must be text of 1 to ${NOTE_MAX} characters`;
  if (section === "min") return isNum(v) && v >= 0 && v <= MINUTES_MAX ? null : `must be a number from 0 to ${MINUTES_MAX}`;
  return null;
}

/** Throws OVERRIDES_INVALID (naming the field) unless `obj` is a well-formed overrides record. */
export function validateOverrides(obj) {
  const invalid = (msg) => { throw new OverridesError("OVERRIDES_INVALID", msg); };
  if (!isPlain(obj)) invalid("The overrides must be an object.");
  for (const section of ["proj", "own", "bump", "min", "notes"]) {
    const sec = obj[section] ?? {};
    if (!isPlain(sec)) invalid(`"${section}" must be an object keyed by DraftKings id.`);
    for (const [id, v] of Object.entries(sec)) {
      const why = badValue(section, v);
      if (why) invalid(`The ${section} value for ${id.slice(0, 40)} ${why}.`);
    }
  }
  const stars = obj.stars ?? [];
  if (!Array.isArray(stars) || stars.some((id) => typeof id !== "string" || id === "")) invalid('"stars" must be a list of DraftKings ids.');
  if (new Set(stars).size !== stars.length) invalid('"stars" repeats an id.');
  // A typed projection and a bump for one man is well formed: the bump scales the typed number (Adam, 2026-10-29 5:41 PM ET).
}

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
    proj: { ...(parsed.proj ?? {}) }, own: { ...(parsed.own ?? {}) }, bump: { ...(parsed.bump ?? {}) }, min: { ...(parsed.min ?? {}) },
    stars: [...(parsed.stars ?? [])], notes: { ...(parsed.notes ?? {}) }, updated_at: parsed.updated_at ?? null,
  };
}

/** Writes the slate's overrides atomically, stamping updated_at; throws OVERRIDES_INVALID on a bad record. Returns the record. */
export function writeOverrides(slate, obj) {
  validateOverrides(obj);
  const record = {
    slate, proj: { ...(obj.proj ?? {}) }, own: { ...(obj.own ?? {}) }, bump: { ...(obj.bump ?? {}) }, min: { ...(obj.min ?? {}) },
    stars: [...(obj.stars ?? [])], notes: { ...(obj.notes ?? {}) }, updated_at: new Date().toISOString(),
  };
  writeFileAtomic(overridesFile(slate), JSON.stringify(record, null, 1) + "\n");
  return record;
}

/**
 * Checks a POST body at the boundary against the slate's players. One of three shapes:
 *   { resetAll: true } -> { ok, kind: "resetAll" }; { reset: dk_id } -> { ok, kind: "reset", id };
 *   { proj?, own?, bump?, stars?, notes? } -> { ok, kind: "changes", changes }, each section keyed by a DraftKings id on the
 *   slate: proj and own a number or null (null removes), bump a whole number of steps -10..10 (0 or null removes),
 *   stars true or false, notes text (trimmed; "" or null removes).
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
      } else if (section === "notes" && typeof v === "string" && v.trim() === "") v = null;
      else if (section === "bump" && v === 0) v = null;
      if (section !== "stars" && v !== null) {
        const why = badValue(section, section === "notes" && typeof v === "string" ? v.trim() : v);
        if (why) return bad(`The ${section === "proj" ? "projection" : section === "own" ? "ownership" : section === "bump" ? "bump" : "note"} for ${id.slice(0, 40)} ${why}.`);
        if (section === "notes") v = v.trim();
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
  const baseOf = new Map((players ?? []).map((p) => [String(p.dk_id), p.projection]));
  for (const [id, v] of Object.entries(changes.proj ?? {})) {
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
  for (const [id, v] of Object.entries(changes.notes ?? {})) {
    if (v === null) delete next.notes[id];
    else next.notes[id] = v;
  }
  return next;
}

/** Pure: one man's typed projection, typed ownership, bump and applied minutes removed; his star and note stay (NFL D72). */
export function resetPlayer(current, id) {
  const next = { ...current, proj: { ...current.proj }, own: { ...current.own }, bump: { ...current.bump }, min: { ...current.min }, stars: [...current.stars], notes: { ...current.notes } };
  delete next.proj[id];
  delete next.own[id];
  delete next.bump[id];
  delete next.min[id];
  return next;
}

/** Pure: every typed number, bump and applied minutes figure cleared; stars and notes stay (NFL D72). */
export function resetAll(current) {
  return { proj: {}, own: {}, bump: {}, min: {}, stars: [...current.stars], notes: { ...current.notes }, updated_at: current.updated_at };
}

/** True when the record holds a typed number, a bump or applied minutes (what "Reset all overrides" would clear). */
export const hasNumbers = (o) => Object.keys(o.proj).length + Object.keys(o.own).length + Object.keys(o.bump).length + Object.keys(o.min ?? {}).length > 0;

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

/**
 * The slate's players with the overrides applied, without adding or dropping anyone and without touching the inputs.
 * Every player gets starred (true/false) and note (text or null). A player with a typed number or a bump also gets
 * projection, value and proj_own as the effective figures, base: { projection, value, proj_own } (the slate's own), and
 * ovr: { steps (0 when none), projection (typed or null), proj_own (typed or null) }. The ceiling is never changed. A man with applied minutes
 * gets minutes as those and base_minutes as the slate's own; they alone leave his projection, value, ownership and ovr as they are.
 */
export function mergeOverrides(players, overrides) {
  const o = overrides ?? EMPTY();
  const stars = new Set(o.stars ?? []);
  return (players ?? []).map((p) => {
    const id = String(p.dk_id);
    const typedProj = has(o.proj ?? {}, id) ? o.proj[id] : null;
    const typedOwn = has(o.own ?? {}, id) ? o.own[id] : null;
    const steps = has(o.bump ?? {}, id) ? o.bump[id] : 0; // the real steps, on a typed row too
    const out = { ...p, starred: stars.has(id), note: has(o.notes ?? {}, id) ? o.notes[id] : null };
    if (has(o.min ?? {}, id)) { out.minutes = o.min[id]; out.base_minutes = p.minutes ?? null; }
    if (typedProj == null && typedOwn == null && !steps) return out;
    const projection = effectiveProjection(p.projection, typedProj, steps);
    const moved = projection !== p.projection;
    return {
      ...out,
      projection,
      value: moved ? valueFrom(projection, p.salary) : p.value,
      proj_own: typedOwn ?? p.proj_own,
      base: { projection: p.projection, value: p.value, proj_own: p.proj_own },
      ovr: { steps, projection: typedProj, proj_own: typedOwn },
    };
  });
}
