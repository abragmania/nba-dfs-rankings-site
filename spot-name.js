// A lineup spot's name (Adam's contest entry: Cash, GPP #1 ...). The one rule, shared by the page and the server (slate/spots.js).
export const SPOT_NAME_MAX = 40;
/** Spots for one slate: a guard on the file's size, far above a night's use (the page plans Assign in order within it too). */
export const MAX_SPOTS = 40;
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

/** A spot name as typed: trimmed text of 1 to 40 characters with no control characters, not a name an object cannot hold safely; else null. */
export function cleanSpotName(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.length <= SPOT_NAME_MAX && !/[\u0000-\u001f]/.test(t) && !FORBIDDEN.has(t) ? t : null;
}
