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

// The near-name rule (this project's own, moved here from tools/lineups_read.mjs): a caller tries nameKey first and uses
// nearName only when no exact name fits, accepting a near hit only when exactly one man fits and his DK team is
// confirmed: by the team's own roster or row (matchRoster, matchRow), or after the search, for a league-wide search
// (findBbrId, whose caller checks his latest game's team).
/** First names that are the same man's but not a prefix of one another (a prefix of 3+ letters, like nic/nicolas, needs no entry). */
export const NICKNAMES = Object.freeze([["mo", "mohamed"], ["mo", "mouhamed"]]);
const PREFIX_MIN = 3;
/** Whether two first keys may be one man: the same, one a prefix of the other (at least 3 letters), or a nickname pair. */
export function firstNear(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return (s.length >= PREFIX_MIN && l.startsWith(s)) || NICKNAMES.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}
/** Same last name and a near first name ("Alexandre Sarr" and "Alex Sarr"). */
export const nearName = (a, b) => lastKey(a) === lastKey(b) && firstNear(firstKey(a), firstKey(b));
