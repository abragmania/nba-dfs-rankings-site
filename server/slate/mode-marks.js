// Thumbs (bump) and stars kept per mode (Adam 1:22-1:24 PM ET 11-20, "q7 yes separate q8 yes"; PROJECT.md spec "Cash and GPP apart"): the
// projections themselves (typed projection and ownership, applied minutes, his In) stay shared; a thumb or a star set while on Cash is Cash's
// only, GPP's likewise. Kept inside the slate's overrides.json, so they travel with it (the sync, the lock copy, the public site):
//   { ...shared numbers, bump, stars (GPP's), modes: { Cash: { bump, stars, replaced? } } }
// GPP's set stays where the single set always was, so every reader that cannot know a mode (the console, news, the nightly checks, a server
// still on older code) reads GPP's. Carry-over: with no Cash entry the file is from before the split and Cash reads the same top-level set, so
// nothing he set is lost; the first thumb or star change in EITHER mode first gives Cash its own copy of that set, so from then on a change in
// one mode never touches the other.
// Cash's entry is judged on its own: one that cannot be read is unreadable alone (GPP and the shared numbers stand) and is never read as no
// thumbs and no stars. Every reader of Cash's then refuses (code OVERRIDES_UNREADABLE: its builds, its re-fills); every write keeps the entry
// exactly as stored, except a thumb or star change in Cash, which first copies the whole file aside to <slate>/history/overrides-unreadable-
// <stamp>.json (never lost) and then starts Cash empty, marked replaced until its next thumb or star change. A damaged top-level set is a
// damaged file, unreadable whole, as any damaged shared part is (overrides.js readOverrides). Pure apart from copyAside.
import fs from "../../site/shim/fs.js";
import path from "../../site/shim/path.js";
import { BUMP_MAX_STEPS } from "../board/override-limits.js";

export const MARK_MODES = Object.freeze(["Cash", "GPP"]);
const OWN = "Cash"; // the one mode with an entry of its own; GPP's set is the top level
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const coded = (code, message) => Object.assign(new Error(message), { code });

/** Cash's stored entry checked: { bump, stars, replaced? }. Throws (plain Error, the why) when it cannot be used. */
export function parseMarks(one) {
  if (!plain(one)) throw new Error("is not an object");
  const bump = one.bump ?? {}, stars = one.stars ?? [];
  if (!plain(bump)) throw new Error('"bump" is not an object keyed by DraftKings id');
  for (const [id, v] of Object.entries(bump)) {
    if (!(Number.isInteger(v) && v !== 0 && Math.abs(v) <= BUMP_MAX_STEPS)) throw new Error(`the bump for ${id.slice(0, 40)} is not a whole number of steps from -${BUMP_MAX_STEPS} to ${BUMP_MAX_STEPS}`);
  }
  if (!Array.isArray(stars) || stars.some((id) => typeof id !== "string" || id === "")) throw new Error('"stars" is not a list of DraftKings ids');
  if (new Set(stars).size !== stars.length) throw new Error('"stars" repeats an id');
  if (one.replaced != null && !plain(one.replaced)) throw new Error('"replaced" is not an object');
  return { bump: { ...bump }, stars: [...stars], ...(plain(one.replaced) ? { replaced: { ...one.replaced } } : {}) };
}

/** Why a stored `modes` value cannot be read at all (the whole file is then unreadable, as any damaged shared part is), or null. */
export function badModes(modes) {
  if (modes === undefined) return null;
  if (!plain(modes)) return '"modes" must be an object holding the Cash thumbs and stars';
  const extra = Object.keys(modes).filter((k) => k !== OWN);
  return extra.length ? `"modes" has an unknown part: ${extra[0].slice(0, 20)} (GPP's thumbs and stars are the top-level bump and stars)` : null;
}

/** The stored `modes` (already past badModes) read: { Cash?: { bump, stars, replaced? } | { unreadable: why, raw } }. */
export function readModes(modes) {
  if (!modes || !Object.hasOwn(modes, OWN)) return {};
  try { return { [OWN]: parseMarks(modes[OWN]) }; } catch (e) { return { [OWN]: { unreadable: `the ${OWN} part ${e.message}`, raw: modes[OWN] } }; }
}

/** The `modes` as written: a readable Cash entry checked again (a bad one throws, code OVERRIDES_INVALID), an unreadable one as it was stored. */
export function modesFile(modes) {
  const e = modes?.[OWN];
  if (e === undefined) return {};
  if (e?.unreadable) return { [OWN]: e.raw };
  try { return { [OWN]: parseMarks(e) }; } catch (err) { throw coded("OVERRIDES_INVALID", `The ${OWN} thumbs and stars ${err.message}.`); }
}

/** A record's `modes` copied so a change never touches the record it came from (an unreadable entry is kept as the same object). */
export const copyModes = (modes) => Object.fromEntries(Object.entries(modes ?? {}).map(([m, e]) => [m, e?.unreadable ? e : parseMarks(e)]));

/** Whether the record holds Cash's own entry (readable or not): the split has happened. */
const cashOwn = (o) => o?.modes != null && typeof o.modes === "object" && Object.hasOwn(o.modes, OWN);

/**
 * One mode's thumbs and stars: { bump, stars, carried } (carried: the set from before the split, read by both modes until the first thumb or
 * star change). Throws code OVERRIDES_UNREADABLE when Cash's entry cannot be read (never empty marks in its place; a file read raw, as the
 * back-tests read the copy at lock, is judged here as readOverrides judges it), and OVERRIDES_INVALID for a mode other than Cash or GPP.
 */
export function marksOf(o, mode) {
  if (!MARK_MODES.includes(mode)) throw coded("OVERRIDES_INVALID", `Thumbs and stars are kept for Cash and GPP only, not ${String(mode).slice(0, 20)}.`);
  const split = cashOwn(o);
  if (mode === OWN && split) {
    const e = o.modes[OWN];
    let why = e?.unreadable ?? null, own = null;
    if (!why) { try { own = parseMarks(e); } catch (err) { why = `the ${OWN} part ${err.message}`; } }
    if (why) throw coded("OVERRIDES_UNREADABLE", `This slate's ${OWN} thumbs and stars could not be read (${why}), so nothing that needs them was worked out. A thumb or star change in ${OWN} starts them again; the old file is kept in the slate's history folder first.`);
    return { bump: own.bump, stars: own.stars, carried: false };
  }
  return { bump: o?.bump ?? {}, stars: o?.stars ?? [], carried: !split };
}

/** A man's bump steps in one mode (0 with none); throws as marksOf does. The readers that cannot know a mode (the console, news, the self-check, the back-tests) ask GPP's. */
export const bumpIn = (o, mode, id) => marksOf(o, mode).bump[String(id)] ?? 0;

/** One mode's thumbs and stars, or none when they cannot be read: for what a board reset clears and the board's shown-figures fallback only. */
export function marksOrNone(o, mode) {
  try { return marksOf(o, mode); } catch (e) { if (e.code !== "OVERRIDES_UNREADABLE") throw e; return { bump: {}, stars: [], carried: false, unreadable: true }; }
}

/**
 * Where a thumb or star change of `mode` is made in the fresh record `next` (applyChanges' or a reset's copy), to edit in place: the record
 * itself for GPP, Cash's own entry for Cash. Before the first such change Cash is given its own copy of the carried set, so the change stays
 * in its mode. A replaced mark on Cash has been seen and goes (the route puts it back on the change that did the replacing). Throws
 * OVERRIDES_UNREADABLE for a Cash change while Cash cannot be read: the route replaces it first (replaceUnreadable).
 */
export function marksHolder(next, mode) {
  marksOf(next, mode); // throws for an unreadable Cash or a mode that is not Cash or GPP
  if (!cashOwn(next)) next.modes = { ...(next.modes ?? {}), [OWN]: { bump: { ...(next.bump ?? {}) }, stars: [...(next.stars ?? [])] } };
  if (mode !== OWN) return next;
  const { bump, stars } = next.modes[OWN];
  next.modes = { ...next.modes, [OWN]: { bump: { ...bump }, stars: [...stars] } };
  return next.modes[OWN];
}

/** What the page foot says about the marks: { carried: [modes reading the set from before the split, when it holds a mark], unreadable: { Cash: why } | null, replaced: { Cash: { at, copy, why } } | null }. */
export function marksTrouble(o) {
  const e = cashOwn(o) ? o.modes[OWN] : undefined;
  const carried = !e && (Object.keys(o?.bump ?? {}).length || (o?.stars ?? []).length) ? [...MARK_MODES] : [];
  return { carried, unreadable: e?.unreadable ? { [OWN]: e.unreadable } : null, replaced: e && !e.unreadable && e.replaced ? { [OWN]: e.replaced } : null };
}

/**
 * Before a thumb or star change in a mode that cannot be read: the overrides file copied whole to <its folder>/history/overrides-unreadable-<stamp>.json
 * (COPYFILE_EXCL; a failed copy throws code COPY_ASIDE_FAILED and nothing is written). Returns { at, copy, why } (copy in words, slates/<slate>/history/...).
 */
export function copyAside(file, slate, why) {
  const at = new Date().toISOString(), name = `overrides-unreadable-${at.replace(/[:.]/g, "-")}.json`;
  try {
    fs.mkdirSync(path.join(path.dirname(file), "history"), { recursive: true });
    fs.copyFileSync(file, path.join(path.dirname(file), "history", name), fs.constants.COPYFILE_EXCL);
  } catch (e) {
    throw coded("COPY_ASIDE_FAILED", `Nothing was written: the overrides file of ${slate} could not be copied aside (${e.message}).`);
  }
  return { at, copy: `slates/${slate}/history/${name}`, why }; // plain strings: the public site's path stand-in has no posix
}

/** The record with an unreadable mode started empty (so the change that follows has a mode to edit). Pure. */
export const replaceUnreadable = (o, mode) => ({ ...o, modes: { ...(o.modes ?? {}), [mode]: { bump: {}, stars: [] } } });
/** The record with the replaced mark (copyAside's answer) on that mode, after the change that replaced it. Pure. */
export const markReplaced = (o, mode, replaced) => ({ ...o, modes: { ...o.modes, [mode]: { ...o.modes[mode], replaced } } });

/** The answer's words for a change that replaced an unreadable mode. */
export const replacedMarksWords = (mode, r) => `Your ${mode} thumbs and stars could not be read (${r.why}); the old file is kept at ${r.copy}, and ${mode} now starts from this change.`;
