// Adam's standing role marks (Adam 10:25 AM 11-18: "I can still always change someone from S to B+ to B -- anything I want -- that's just the starting point"), pure; tests/role_marks.test.mjs.
//  Stored on the team's standing chart (data/minutes/charts/<TEAM>.json, server/minutes/store.js) as role_marks: [{ key (the chart key, which stays the same night to night), role, at, slate }], his newest mark per man
//  and slate; a mark lasts the one slate it was made on (Adam 4:27 PM 11-20; marksOfSlate). One precedence for the board's engine (server/minutes/personal-view.js), own_minutes and the console (console-tier.js): his mark, then the lineup pages'
//  or the chart's five for Starter, then the Bench+ rule (tiers.js benchPlusBy). A per-night role flip already saved in a console scenario still reads over a standing mark (the lead, 11-18); the lineup
//  news's own flips (newsFlips) read over it on the board's engine and in the console's whole team plan too, so the team is rebuilt on the five they make (Adam 9:30 AM 11-20).
//  Runs in the browser too (the console page), so nothing is imported from tools/ or server/minutes/.
import { chooseFive, roleFigure } from "./tiers.js";

/** The figure fiveWithMarks compares starters by (Q13): his mean over his starts, else his mean over all his games, else 0. rows: [{ min, started }]. Pure; one copy for both engines. */
export const starterFig = (rows) => roleFigure(rows, "starter", null).value ?? (rows.length ? rows.reduce((s, r) => s + r.min, 0) / rows.length : 0);

export const MARK_ROLES = ["starter", "bench_plus", "bench"];
export const ROLE_MARKS_MAX = 60;
const KEY = /^[a-z0-9-]{1,80}$/, ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/, SLATE = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+$/; // SLATE: server/slate/store.js SLATE_NAME (this file runs in the browser too)
const WORD = { starter: "Starter", bench_plus: "Bench+", bench: "Bench" };

/**
 * Null when `marks` is a well-formed list of role marks ([{ key, role, at?, slate? }]; at required when `stamped`), else the reason. One check for the chart file and the route. slate: the slate the mark
 * was made on (Adam 4:27 PM 11-20: a mark lasts one slate); the route's body never carries it (the server stamps it), and a chart mark without one is an old mark, read but never used. Pure.
 */
export function badRoleMarks(marks, { stamped = true } = {}) {
  if (!Array.isArray(marks)) return "the role marks must be a list";
  if (marks.length > ROLE_MARKS_MAX) return `at most ${ROLE_MARKS_MAX} role marks`;
  const seen = new Set(), fields = stamped ? ["key", "role", "at", "slate"] : ["key", "role", "at"];
  for (const m of marks) {
    if (!m || typeof m !== "object" || Array.isArray(m)) return "a role mark is not an object";
    if (Object.keys(m).some((k) => !fields.includes(k))) return `a role mark holds only ${stamped ? "key, role, at and slate" : "key, role and at"}`;
    if (typeof m.key !== "string" || !KEY.test(m.key)) return "a role mark's key is not well formed";
    if (!MARK_ROLES.includes(m.role)) return `${m.key}'s role must be one of ${MARK_ROLES.join(", ")}`;
    if (stamped ? !ISO.test(m.at ?? "") : m.at !== undefined && !ISO.test(m.at)) return `${m.key}'s mark has no well-formed time`;
    if (m.slate !== undefined && (typeof m.slate !== "string" || !SLATE.test(m.slate))) return `${m.key}'s mark names no well-formed slate`;
    const one = `${m.slate ?? ""}|${m.key}`;
    if (seen.has(one)) return `${m.key} is marked twice`;
    seen.add(one);
  }
  return null;
}

/** The marks to save: each kept mark keeps its time, a new or changed one takes `at`; every one is stamped with `slate`, the slate it was made on. prev (this slate's marks), next: [{ key, role, at? }]. Pure. */
export function stampMarks(prev, next, at, slate) {
  const was = new Map((prev ?? []).map((m) => [m.key, m]));
  return next.map((m) => ({ key: m.key, role: m.role, at: was.get(m.key)?.role === m.role ? was.get(m.key).at : at, slate }));
}

/**
 * A chart's marks split by the slate being built (Adam 4:27 PM 11-20: "remove any alleged marks ... they might be carrying over from previous slates"; the spec: the role buttons apply to tonight only):
 * { live: the marks made on `slate`, the only ones any engine reads; kept: marks of another slate whose night is on or after the earlier of this slate's night and `today` (Eastern, etDay of the engine's
 * moment: a save on tomorrow's slate tonight never clears tonight's still-live marks; the review of 11-20, money), left in the file untouched and named in the team's note; stale: marks of an older night's
 * slate or with no slate (made before marks were tied to one), never used, said in the team's note and cleared from the file by its next save }. Pure.
 */
export function marksOfSlate(marks, slate, today = null) {
  const night = String(slate ?? "").slice(0, 10), floor = today && today < night ? today : night, out = { live: [], kept: [], stale: [] };
  for (const m of marks ?? []) {
    if (slate && m?.slate === slate) out.live.push(m);
    else if (typeof m?.slate === "string" && m.slate.slice(0, 10) >= floor) out.kept.push(m);
    else out.stale.push(m);
  }
  return out;
}

/** The Eastern day (YYYY-MM-DD) of an ISO time or ms, or "an unknown day". Pure. */
export const etDay = (at) => { const d = new Date(at); return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : "an unknown day"; };

/** The team's note on marks of another slate still in force there, not used on this one (G62), or null: "2 of your role marks were made on 2026-11-20-main and are not used on this slate". kept: marksOfSlate's. Pure. */
export function otherSlateMarksNote(kept) {
  if (!kept?.length) return null;
  const by = new Map();
  for (const m of kept) by.set(m.slate, (by.get(m.slate) ?? 0) + 1);
  const n = kept.length, on = [...by].map(([s, k]) => (by.size > 1 ? `${s} (${k})` : s)).join(", ");
  return `${n} of your role marks ${n === 1 ? "was" : "were"} made on ${on} and ${n === 1 ? "is" : "are"} not used on this slate`;
}

/** "2 role marks from 2026-11-18 (A Starter, B Bench)": stale marks (marksOfSlate's) by their slate, else the day they were made (Eastern), or null. nameOf(key). Pure. */
export function staleMarksList(stale, nameOf = (k) => k) {
  if (!stale?.length) return null;
  const from = new Map();
  for (const m of stale) { const k = m.slate ?? etDay(m.at); from.set(k, [...(from.get(k) ?? []), m]); }
  const list = [...from].map(([k, ms]) => `${k} (${ms.map((m) => `${nameOf(m.key)} ${WORD[m.role] ?? m.role}`).join(", ")})`).join("; ");
  return `${stale.length} role mark${stale.length === 1 ? "" : "s"} from ${list}`;
}

/** The team's note on marks not used because they belong to an earlier slate (G62: said where he looks), or null. Pure. */
export function staleMarksNote(stale, nameOf) {
  const list = staleMarksList(stale, nameOf);
  return list ? `${list} not used: role marks last one slate` : null;
}

/** One text for a team's saved marks, whatever their order: the console sends the one it read as `base`, and the route refuses a save over marks that moved since (409). Pure. */
export const marksStamp = (marks) => JSON.stringify((marks ?? []).map((m) => [m.key, m.role, m.at ?? null]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));

/**
 * His mark on an Out man (the review of 11-18, money): it sets the role his absence takes away, for the pairing and his lost minutes (tiers.js pairReplaced). A Starter mark makes
 * him an Out starter (a healthy top at his position); a Bench+ or Bench mark makes him an Out bench man, Bench+ only with the Bench+ mark (o.mark). The same for the board's engine and the console. Mutates o.
 */
export function markOut(o, role) {
  if (!MARK_ROLES.includes(role)) return o;
  const starter = role === "starter";
  o.mark = role;
  o.starter = starter;
  // since Adam 3:02 PM 11-18 no Out man holds a bench spot (tiers.js placeByChart counts the men here only)
  if (o.healthy) o.healthy = { ...o.healthy, starter };
  return o;
}

/** Tonight's marks by man id: { id: role } for the men of `men` ([{ id, key }]) a mark names. Pure. */
export function marksById(marks, men) {
  const byKey = new Map((marks ?? []).map((m) => [m.key, m.role]));
  return Object.fromEntries(men.filter((m) => m.key && byKey.has(m.key)).map((m) => [String(m.id), byKey.get(m.key)]));
}

/**
 * Tonight's five with his marks, the one rule the board's engine and the console share: pool (tonight's playing men in order, less those marked Bench+ or Bench), conf (the lineup pages' five over the pool,
 * or null), tops (the chart's top man at each position over the pool, or null), fill (a short pages' five filled position for position), flag(id) (TwoGun's starter flag), want (men marked Starter in the pool).
 * The real five (pages' or chart's or flagged, cut to five) stays and the men marked Starter join it; only a short one is filled, Starter marks taking fill places before the order does; never more than five
 * (trimToFive: a Starter mark on a full five takes a starter's place, named; equal figures go by `pool`, tonight's order, unless orderOf says otherwise; atOf(id): when his call was made, for two calls in one column).
 * realIds: the five he would have with no mark (realFive); a man who starts only because a starter above him was marked off (his column's next man, the next TwoGun flag) is a fill man, not a real starter,
 * so a man marked Starter takes that place (path sweep 11-20: a swap of one man to Starter and one to Bench always leaves five). Omitted: as before, read on the pool.
 * Returns { base (chooseFive's, with the fill), five: Set of ids, notes }. Pure.
 */
export function fiveWithMarks({ pool, conf, tops, fill, flag, want, realIds = null, posOf = () => null, figOf = () => 0, orderOf = null, atOf = () => NaN, nameOf = (id) => id, whoseOf = () => "Your Starter mark" }) { // whoseOf(id): whose Starter call it is, for the note
  const base0 = chooseFive(pool.map((id) => ({ id, starter_flag: flag(id) })), conf, tops, fill), isReal = (id) => (realIds ? realIds.includes(id) : conf?.ids?.length ? conf.ids.includes(id) : tops?.length ? tops.includes(id) : flag(id)); // chooseFive ignores an empty pages' five
  let base = base0;
  if (want.length) {
    // a short five fills position for position first (fill, as chooseFive does), then tonight's order
    const real = [...base0.ids].filter(isReal), five0 = new Set([...real, ...want]), more = [...new Set([...(fill ?? []).map(String), ...pool])].filter((id) => pool.includes(id) && !five0.has(id)).slice(0, Math.max(0, 5 - five0.size));
    const took = want.filter((id) => !real.includes(id)).length, cut = base0.note ? base0.note.split("; ").filter((n) => !/ available starters?: \d+ filled/.test(n)) : [];
    const fillNote = more.length ? `${base0.kind === "expected" ? "TwoGun flags" : base0.kind === "chart" ? "the depth chart's tops name" : "the lineup pages' five names"} ${real.length} available starter${real.length === 1 ? "" : "s"}${took ? `; S marks took ${took} place${took === 1 ? "" : "s"}` : ""}: ${more.length} filled from the top of tonight's order` : null;
    base = { ...base0, ids: new Set([...five0, ...more]), note: [...cut, fillNote].filter(Boolean).join("; ") || null };
  }
  const at = (id) => { const i = pool.indexOf(id); return i < 0 ? Infinity : i; };
  const { five, notes } = trimToFive(new Set([...base.ids, ...want]), want, { first: want.filter((y) => !isReal(y)), posOf, figOf, orderOf: orderOf ?? at, atOf, nameOf, whoseOf });
  return { base, five, notes };
}

/**
 * Adam 3:52 PM 11-20 (Q13) "there should only EVER be 5 starters": the one rule every five obeys (fiveWithMarks for both engines, console-roles.js and depth-chart.js chartFive for the Console's other
 * resolvers). five: the starters before the rule (any count); want: the men with a Starter call; first: those of them who claim a place before the rest (the calls that put a man in, not the calls on a
 * man already in). While more than five start, a Starter call takes the place of the starter at his own column (posOf), else of the starter with the lowest figure (figOf); a man with a Starter call goes
 * only when none without one is left, and then too the one at his own column first, the older call of two there (atOf: ms, NaN unknown), else the lowest figure. Equal figures go by tonight's order
 * (orderOf: the later man first; unknown is latest), then by id, and the note says so. Each call claims once a round, and which claims next never hangs on the order the marks were made: a call with a
 * starter at his own column first, then the call whose man out has the lower figure, then by id. Returns { five: a new Set, benched: [ids], notes: one sentence per man benched, naming him }. Pure.
 */
export function trimToFive(five, want, { first = [], posOf = () => null, figOf = () => 0, orderOf = () => Infinity, atOf = () => NaN, nameOf = (id) => id, whoseOf = () => "Your Starter mark" } = {}) {
  const out = new Set(five), benched = [], notes = [], claimed = new Set(), lead = new Set(first), look = { posOf, figOf, orderOf, atOf };
  while (out.size > 5) {
    let callers = want.filter((id) => out.has(id) && !claimed.has(id)); // a call already benched by another claims nothing
    if (!callers.length) { if (!claimed.size) break; claimed.clear(); continue; } // round the calls again only when more than ten men hold one
    if (callers.some((id) => lead.has(id))) callers = callers.filter((id) => lead.has(id));
    const c = callers.map((id) => claimOf(id, out, want, look)).sort((a, b) => b.same - a.same || olderFirst(a.at, b.at) || figOf(a.gone) - figOf(b.gone) || idOrder(a.id, b.id))[0];
    claimed.add(c.id);
    out.delete(c.gone);
    benched.push(c.gone);
    notes.push(`${whoseOf(c.id)} on ${nameOf(c.id)} takes ${nameOf(c.gone)}'s place in the five (${c.why})`);
  }
  return { five: out, benched, notes };
}
const idOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const known = (t) => typeof t === "number" && !Number.isNaN(t); // a call's time in ms; Infinity: made on the page just now, the newest
/** Two claims on men who hold a Starter call: the one whose man's call is older first; 0 when either time is unknown or they are equal. */
const olderFirst = (a, b) => (known(a) && known(b) && a !== b ? (a < b ? -1 : 1) : 0);
/**
 * The man one Starter call (id) would bench, and why, in the note's words: { id, same (at his own column), gone, at (gone's call time when he holds a call at that column, else NaN), why }. A man with no
 * call at his column, else any man with none (the lowest figure), else a man with a call at his column (the older call, else the lowest figure), else any man with a call (the lowest figure). trimToFive's.
 */
function claimOf(id, out, want, { posOf, figOf, orderOf, atOf }) {
  const col = posOf(id), inCol = (ys) => (col ? ys.filter((y) => posOf(y) === col) : []), free = [...out].filter((y) => !want.includes(y)), calls = [...out].filter((y) => y !== id && want.includes(y));
  const sameFree = inCol(free), sameCall = free.length ? [] : inCol(calls), from = sameFree.length ? sameFree : free.length ? free : sameCall.length ? sameCall : calls;
  const where = sameFree.length || sameCall.length ? `the starter at his position, ${col}` : null;
  const ats = from === sameCall ? sameCall.map(atOf) : [], oldest = ats.length > 1 && ats.every(known) ? Math.min(...ats) : NaN;
  if (known(oldest) && ats.filter((t) => t === oldest).length === 1) { // the oldest call at his column goes; "the older" only when it is older than the caller's own (the review of 11-20, round 2)
    const mine = atOf(id);
    return { id, same: true, gone: sameCall[ats.indexOf(oldest)], at: oldest, why: `${where}, ${known(mine) && oldest < mine ? "whose Starter call is the older" : "the oldest Starter call there"}` };
  }
  const later = (a, b) => { const x = orderOf(a), y = orderOf(b); return x < y ? 1 : x > y ? -1 : 0; }; // equal figures: the later man in tonight's order goes first (never TwoGun's minutes)
  const gone = [...from].sort((a, b) => figOf(a) - figOf(b) || later(a, b) || idOrder(a, b))[0], twins = from.filter((y) => y !== gone && figOf(y) === figOf(gone)), tied = twins.length > 0;
  const at = from === sameCall ? atOf(gone) : NaN, older = known(at) && known(atOf(id)) && at < atOf(id);
  const tie = `no figure to tell them apart; by ${twins.every((y) => orderOf(y) !== orderOf(gone)) ? "tonight's order" : "id"}`; // by id when the order cannot tell them apart either (both unknown)
  if (older) return { id, same: true, gone, at, why: `${where}, whose Starter call is the older` };
  return { id, same: where !== null, gone, at, why: where ? (tied ? `${where}; ${tie}` : where) : tied ? tie : "the starter with the lowest figure" };
}

/**
 * The five he would have with no mark, as chooseFive reads it before the fill (fiveWithMarks realIds): the lineup pages' five (conf, before the men marked off leave it), else the chart's tops over tonight's
 * men before any mark (tops), else the first five TwoGun flags on tonight's order with the men marked off still in it (order). Ids as strings. Pure.
 */
export function realFive({ order, conf, tops, flag }) {
  if (conf?.ids?.length) return conf.ids.map(String);
  if (tops?.length) return tops.map(String).slice(0, 5);
  return order.map(String).filter(flag).slice(0, 5);
}

/**
 * The lineup news's role calls still in force on a scenario (Adam 9:30 AM 11-20: a confirmed lineup that changes the five rebuilds the team on it): { id: role } for each man an applied news entry flipped
 * (kind "r") whose flip still stands as it left him (flips[id] === its `to`). Whether such a call reads over a standing mark of his is decided by their times, the newer call winning (Adam 7:28 PM 11-19):
 * withNewsRoles below on the board's engine, console-tier.js flipWins in the Console. news: the team's news entries; flips: the scenario's pins.r. One copy for the console (console-marks.js newsOwned,
 * console-tier.js) and the board's engine (out-pool.js hisCalls). Pure.
 */
export function newsFlips(news, flips) {
  const out = {};
  eachNewsFlip(news, flips, (id, to) => { out[id] = to; });
  return out;
}
/** Whose Starter call a man's is, for trimToFive's note (the review of 11-20: a news call is never named as his): news (newsFlips's, by id), standing (his standing marks, by id). Returns whoseOf(id). Pure. */
export const whoseCall = (news, standing) => (id) => (news?.[id] === "starter" && standing?.[id] !== "starter" ? "The lineup news's Starter call" : "Your Starter mark");

/** When each of those calls was made (its news entry's time, the newest when two name him): { id: at }. Pure. */
export function newsFlipTimes(news, flips) {
  const out = {};
  eachNewsFlip(news, flips, (id, _to, at) => { if (!out[id] || Date.parse(at) > Date.parse(out[id])) out[id] = at; });
  return out;
}
function eachNewsFlip(news, flips, fn) {
  for (const e of Object.values(news ?? {})) if (e?.state === "applied") for (const m of e.men ?? []) if (m?.kind === "r" && m.to !== undefined && flips?.[m.id] === m.to) fn(String(m.id), m.to, e.at);
}

/**
 * His standing marks by id under the news's role calls (newsFlips, by id): { marks (merged), over: [{ id, mark, news }] (a news call that reads over a standing mark of his, for the team's note), byNews: Set of ids
 * whose role is the news's call }. The newer call wins, read from the times (the money review of 11-20, finding 4: never from the order the files were written): marksAt(id) and newsAt(id) are ISO times; a news
 * call reads over his mark only when it is later, or when either time is unknown (as before the times). The Console merges the same way (console-tier.js withStanding). Pure.
 */
export function withNewsRoles(marks, news, { marksAt = () => null, newsAt = () => null } = {}) {
  const out = { ...(marks ?? {}) }, over = [], byNews = new Set();
  for (const [id, role] of Object.entries(news ?? {})) {
    const had = marks?.[id], m = Date.parse(marksAt(id) ?? ""), n = Date.parse(newsAt(id) ?? "");
    if (had !== undefined && had !== role && Number.isFinite(m) && Number.isFinite(n) && n <= m) continue; // his mark is the newer call
    out[id] = role;
    if (had !== role) byNews.add(id);
    if (had !== undefined && had !== role) over.push({ id, mark: had, news: role });
  }
  return { marks: out, over, byNews };
}

/** The team's note on news role calls over his standing marks (G62: said where he looks), or null. over: withNewsRoles's; nameOf(id). Pure. */
export function newsOverNote(over, nameOf) {
  if (!over?.length) return null;
  return `The lineup news's role call${over.length === 1 ? "" : "s"}, newer than your mark${over.length === 1 ? "" : "s"} for tonight's slate, ${over.length === 1 ? "stands" : "stand"} tonight: ${over.map((o) => `${nameOf(o.id)} ${WORD[o.news] ?? o.news} over your ${WORD[o.mark] ?? o.mark}`).join(", ")}; marking him again takes it back`;
}

/**
 * The team's note on his marks that moved the five (G62: said where he looks): men his Bench+ or Bench mark took out of the five he would otherwise have (realIds: the lineup pages', else the chart's, else
 * TwoGun's flagged five, before any mark), and men his Starter mark put in. nameOf(id). Null when none. Pure.
 */
export function marksNote(marks, realIds, five, nameOf) {
  const real = realIds ?? [], out = real.filter((id) => marks[id] === "bench_plus" || marks[id] === "bench"), inn = [...five].filter((id) => marks[id] === "starter" && !real.includes(id));
  if (!out.length && !inn.length) return null;
  const parts = [out.length ? `${out.map((id) => `${nameOf(id)} (${WORD[marks[id]]})`).join(", ")} out of tonight's five` : null, inn.length ? `${inn.map(nameOf).join(", ")} in the five` : null];
  return `Your role marks: ${parts.filter(Boolean).join("; ")}${out.length > inn.length ? "; the next man fills a place as the short-five rule does" : ""}`; // a man marked Starter takes the place of a man marked off (path sweep 11-20)
}
