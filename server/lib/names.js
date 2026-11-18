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
/** First names that are the same man's but not a prefix of one another and not initials (a prefix of 3+ letters, like nic/nicolas, and initials, like ej/elijah, need no entry). */
export const NICKNAMES = Object.freeze([["mo", "mohamed"], ["mo", "mouhamed"]]);
const PREFIX_MIN = 3;
const INITIALS = 2;
/**
 * Whether two first keys may be one man: the same, one a prefix of the other (at least 3 letters), initials (a two-letter first name, as DraftKings writes EJ, AJ, OG: near a
 * full first name of 3+ letters that starts with its first letter, so ej/elijah), or a nickname pair. Only ever a candidate: the caller's guards (one man fits, his team) decide.
 */
export function firstNear(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length >= PREFIX_MIN && l.startsWith(s)) return true;
  if (s.length === INITIALS && l.length > INITIALS && l[0] === s[0]) return true;
  return NICKNAMES.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}
/** Same last name and a near first name ("Alexandre Sarr" and "Alex Sarr", "EJ Harkless" and "Elijah Harkless"). */
export const nearName = (a, b) => lastKey(a) === lastKey(b) && firstNear(firstKey(a), firstKey(b));

/**
 * The near rule's second step over one confirmed team's candidates, for a caller whose exact nameKey found nobody: the one man near `name` whose name is not exactly in `taken`
 * (the name keys of his DK teammates, so a teammate's own row is never his). { hit } | { ambiguous: [their names] } (two men fit: nothing joins) | null (none fits).
 * A candidate with exactly his name key is never a near hit: the exact name is the caller's step, and a name it refused (two men share it) is not taken here.
 * teammates: the names of his other DK teammates (or chart men): their keys join `taken`, and a hit that one of them is also near (one who joins no candidate exactly) is refused, so one
 * source man is never joined by two board men: { ambiguous: [the hit's key], rivals: [those teammates] }.
 * nameOf reads a candidate's name; idOf tells two candidates apart (default: the name key, so two rows of one man count once).
 */
export function soleNear(cands, name, { nameOf = (c) => c?.name, idOf = (c) => nameKey(nameOf(c)), taken = null, teammates = null } = {}) {
  if (typeof name !== "string" || !name) return null;
  const own = nameKey(name), near = [], mates = (teammates ?? []).filter((t) => typeof t === "string" && t && nameKey(t) !== own);
  const blocked = new Set([...(taken ?? []), ...mates.map(nameKey)]);
  for (const c of cands ?? []) {
    const n = nameOf(c);
    if (typeof n === "string" && n && nameKey(n) !== own && nearName(n, name) && !blocked.has(nameKey(n))) near.push(c);
  }
  const ids = new Set(near.map(idOf));
  if (ids.size > 1) return { ambiguous: [...new Set(near.map(nameOf))] };
  if (!near.length) return null;
  const candKeys = new Set((cands ?? []).map((c) => nameOf(c)).filter((n) => typeof n === "string").map(nameKey)), hitName = nameOf(near[0]);
  const rivals = mates.filter((t) => !candKeys.has(nameKey(t)) && nearName(t, hitName));
  return rivals.length ? { ambiguous: [hitName], rivals } : { hit: near[0] };
}

/** Words for a refused near join (soleNear's ambiguous answer); what: "box-score", "chart". */
export const nearRefusedWords = (r, what) => (r?.rivals ? `his teammate ${r.rivals.join(" and ")} also has a name near ${what} man ${r.ambiguous[0]}, so neither joins` : `two ${what} men on his team have a name near his (${(r?.ambiguous ?? []).join(", ")}), so he joins neither`);
