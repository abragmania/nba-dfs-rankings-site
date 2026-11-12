// Two small pure helpers of server.js, kept apart for its size: the late swap test clock's reader and the optimizer's error classifier. server.js re-exports both.
/**
 * Sorts an optimize() error: one about the slate file or the saved picks (it names "in this slate file", or the players,
 * locked or excluded lists the server itself passed) is the server's data, not the request; anything else is the mode or
 * the settings the request sent.
 */
export function optimizeErrorKind(message) {
  return /in this slate file\.?$/.test(message) || /^(Players|Locked|Excluded) /.test(message) ? "slate" : "settings";
}

/**
 * NBADFS_NOW, the test clock for late swap: unset means the real clock; set, it must be a whole number of milliseconds or an
 * ISO stamp with an offset, else the server refuses to start. Returns { ms } (null when unset) or { error }.
 */
export function readNowSetting(v) {
  if (v == null || v === "") return { ms: null };
  if (/^\d+$/.test(v)) return { ms: Number(v) };
  if (/T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(v) && !Number.isNaN(Date.parse(v))) return { ms: Date.parse(v) };
  return { error: `NBADFS_NOW is "${v}"; it must be milliseconds or an ISO time with an offset, like 2026-10-29T21:00:00-04:00.` };
}
