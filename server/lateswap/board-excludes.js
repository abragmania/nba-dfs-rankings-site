// The board's excludes on the Entries late swap screen, kept per mode (Adam 11-14; his yes 5:14 PM ET 11-19 and "yes go" 12:42 PM ET 11-20:
// Cash and GPP keep fully separate locks and excludes). One re-fill can cover spots of both modes, so each spot honours only its own
// mode's excludes: a GPP exclude never keeps a man out of a Cash spot, nor the reverse. Pure; one copy for the screen and the engine.
import { modeFromName } from "./maps.js";
import { inMode } from "../board/mode-rows.js";

export const LS_MODES = Object.freeze(["Cash", "GPP"]);
const isIds = (a) => Array.isArray(a) && a.every((id) => typeof id === "string");

/** A spot's mode: the run's mode when one is given, else the spot row's, else its name's (as the engine's other mode tests). */
export const spotModeOf = (state, spot, mode = null) => mode ?? (Object.hasOwn(state.spots, spot) ? state.spots[spot].mode : modeFromName(spot));

// Thumbs and stars per mode (Adam 1:24 PM ET 11-20; server/board/mode-rows.js): the screen's slate rows carry each mode's part, and every
// figure of a spot (its re-fill, its options, its totals, the Min % costing) is that spot's own mode's.
/** Whether a mode's thumbs and stars could not be read: its rows' part is marked marks_unknown (effective-players.js mergedFor). */
const unknownIn = (ctx, mode) => (ctx.players ?? []).some((p) => p?.modes?.[mode]?.marks_unknown === true);
/** A man as a spot of `mode` scores and shows him: that mode's thumbs and stars over the shared row; undefined off the slate. While that
 *  mode's thumbs and stars cannot be read his projection, value and ownership are missing (G62, R1: shown as a dash, never the figures
 *  without them), so every spot total and option of that mode is missing too. */
export const manFor = (ctx, id, mode) => { const p = inMode(ctx.man(id), mode); return p?.marks_unknown ? { ...p, projection: null, value: null, proj_own: null } : p; };
/** The refusal words for a spot of `mode` when that mode's thumbs and stars could not be read, else null: the spot is never re-filled on
 *  figures without them (fails closed); the other mode's spots go ahead. */
export const marksGap = (ctx, mode) => (unknownIn(ctx, mode) ? `The ${mode} thumbs and stars could not be read, so this spot was not re-filled; a ${mode} thumb or star change starts them again.` : null);
/** The screen's one foot line per mode whose thumbs and stars could not be read (screen-model.js marksNotes). */
export const marksNotesOf = (ctx) => LS_MODES.filter((m) => unknownIn(ctx, m)).map((m) => `The ${m} thumbs and stars could not be read; ${m} spot figures are not shown and ${m} spots do not re-fill.`);

/** Whether `excluded` is one list of ids for every spot, or { Cash: ids, GPP: ids } with each spot reading its own mode's. */
export const excludedOk = (ex) => isIds(ex) || (ex != null && typeof ex === "object" && !Array.isArray(ex) && Object.keys(ex).every((k) => LS_MODES.includes(k)) && LS_MODES.every((m) => isIds(ex[m])));

/** The men excluded for a spot of this mode. */
export const excludedFor = (ex, mode) => (Array.isArray(ex) ? ex : ex?.[mode] ?? []);

/** The refusal words when a re-fill cannot know who is excluded in a mode (its list unreadable or not given), else null. Review 11-20
 *  (money): a re-fill fails closed, never runs as if nobody were excluded; a picked option is his own choice and is not checked here. */
export function excludesGap(picks) {
  const b = boardExcludes(picks), missing = LS_MODES.filter((m) => b[m] === null);
  return missing.length ? `The board's ${missing.join(" and ")} excluded men could not be read, so nothing was re-filled. A lock or exclude change on the board's Player list replaces the file.` : null;
}

/**
 * The board's saved excludes as the route reads them (store.js readPicks: { Cash: { excluded }, GPP: { excluded } }), per mode:
 * { Cash: ids | null, GPP: ids | null }, null where that mode's list was not available or could not be read (its `unreadable`). A flat { excluded } (one list, a caller with no
 * modes) is the same list for both.
 */
export function boardExcludes(picks) {
  if (Array.isArray(picks?.excluded)) { const one = picks.excluded.map(String); return { Cash: one, GPP: one }; }
  return Object.fromEntries(LS_MODES.map((m) => [m, Array.isArray(picks?.[m]?.excluded) && !picks[m].unreadable ? picks[m].excluded.map(String) : null])); // a mode store.js could not read is not known (review 11-20)
}
