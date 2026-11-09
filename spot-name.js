// A lineup spot's name (Adam's contest entry: Cash, GPP #1 ...). The one rule, shared by the page and the server (slate/spots.js).
export const SPOT_NAME_MAX = 40;
/** The most GPP-style spots one slate holds: one for each contest entry Adam can put a lineup in (the page plans Assign in order within it too). Cash spots do not count against it. */
export const MAX_SPOTS = 150;
/** The most spots of any kind, Cash included: a sane ceiling over the 150. */
export const MAX_TOTAL_SPOTS = MAX_SPOTS + 25;
/** A Cash spot (the name the late swap engine also reads as Cash, lateswap/maps.js modeFromName). */
export const isCashSpot = (name) => /^cash/i.test(name);
/** Whether `names` (the spots held) have room for a spot called `name`: an existing one always; a Cash one up to the total ceiling; any other up to MAX_SPOTS of them. */
export function hasRoomFor(names, name) {
  if (names.includes(name)) return true;
  if (names.length >= MAX_TOTAL_SPOTS) return false;
  return isCashSpot(name) || names.filter((n) => !isCashSpot(n)).length < MAX_SPOTS;
}
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

/** A spot name as typed: trimmed text of 1 to 40 characters with no control characters, not a name an object cannot hold safely; else null. */
export function cleanSpotName(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.length <= SPOT_NAME_MAX && !/[\u0000-\u001f]/.test(t) && !FORBIDDEN.has(t) ? t : null;
}
