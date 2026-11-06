// Copied once from NFLDFSRankings server/lib/names.js at ea6cb52 (2026-10-29); this project's own copy from here on.
// Player-name matching keys, copied once from NFLDepthCharts server/refresh/clubparse.js (2026-09-13).
// nameKey("Marvin Mims Jr.") -> "marvinmims"; lastKey("Marvin Mims Jr.") -> "mims". Accents and punctuation are
// stripped and generational suffixes dropped so the same player matches across salary files and projections.
const SUFFIX = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
export function nameKey(name) {
  const toks = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, "").split(/\s+/).filter(Boolean);
  while (toks.length > 1 && SUFFIX.has(toks[toks.length - 1])) toks.pop();
  return toks.join("");
}
export function lastKey(name) {
  const toks = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, "").split(/\s+/).filter(Boolean);
  while (toks.length > 1 && SUFFIX.has(toks[toks.length - 1])) toks.pop();
  return toks[toks.length - 1] ?? "";
}
export function firstKey(name) {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, "").split(/\s+/).filter(Boolean)[0] ?? "";
}
