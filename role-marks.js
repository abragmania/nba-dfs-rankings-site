// Adam's standing role marks (Adam 10:25 AM 11-18: "I can still always change someone from S to B+ to B -- anything I want -- that's just the starting point"), pure; tests/role_marks.test.mjs.
//  Stored on the team's standing chart (data/minutes/charts/<TEAM>.json, server/minutes/store.js) as role_marks: [{ key (the chart key, which stays the same night to night), role, at }], his newest mark per man;
//  a mark stands on later nights until he changes it. One precedence for the board's engine (server/minutes/personal-view.js), own_minutes and the console (console-tier.js): his mark, then the lineup pages'
//  or the chart's five for Starter, then the Bench+ rule (tiers.js benchPlusBy). A per-night role flip already saved in a console scenario still reads over a standing mark (the lead, 11-18).
//  Runs in the browser too (the console page), so nothing is imported from tools/ or server/minutes/.
import { chooseFive } from "./tiers.js";

export const MARK_ROLES = ["starter", "bench_plus", "bench"];
export const ROLE_MARKS_MAX = 60;
const KEY = /^[a-z0-9-]{1,80}$/, ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;
const WORD = { starter: "Starter", bench_plus: "Bench+", bench: "Bench" };

/** Null when `marks` is a well-formed list of role marks ([{ key, role, at? }]; at required when `stamped`), else the reason. One check for the chart file and the route. Pure. */
export function badRoleMarks(marks, { stamped = true } = {}) {
  if (!Array.isArray(marks)) return "the role marks must be a list";
  if (marks.length > ROLE_MARKS_MAX) return `at most ${ROLE_MARKS_MAX} role marks`;
  const seen = new Set();
  for (const m of marks) {
    if (!m || typeof m !== "object" || Array.isArray(m)) return "a role mark is not an object";
    if (Object.keys(m).some((k) => !["key", "role", "at"].includes(k))) return "a role mark holds only key, role and at";
    if (typeof m.key !== "string" || !KEY.test(m.key)) return "a role mark's key is not well formed";
    if (!MARK_ROLES.includes(m.role)) return `${m.key}'s role must be one of ${MARK_ROLES.join(", ")}`;
    if (stamped ? !ISO.test(m.at ?? "") : m.at !== undefined && !ISO.test(m.at)) return `${m.key}'s mark has no well-formed time`;
    if (seen.has(m.key)) return `${m.key} is marked twice`;
    seen.add(m.key);
  }
  return null;
}

/** The marks to save: each kept mark keeps its time, a new or changed one takes `at`. prev, next: [{ key, role, at? }]. Pure. */
export function stampMarks(prev, next, at) {
  const was = new Map((prev ?? []).map((m) => [m.key, m]));
  return next.map((m) => (was.get(m.key)?.role === m.role ? { key: m.key, role: m.role, at: was.get(m.key).at } : { key: m.key, role: m.role, at }));
}

/** One text for a team's saved marks, whatever their order: the console sends the one it read as `base`, and the route refuses a save over marks that moved since (409). Pure. */
export const marksStamp = (marks) => JSON.stringify((marks ?? []).map((m) => [m.key, m.role, m.at ?? null]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));

/**
 * His mark on an Out man (the review of 11-18, money): it sets the role his absence takes away, for the pairing and his lost minutes (tiers.js pairReplaced). A Starter mark makes
 * him an Out starter (a healthy top at his position); a Bench+ or Bench mark makes him an Out bench man, Bench+ only with the Bench+ mark (o.mark). The same for the board's engine and the console. Mutates o.
 */
export function markOut(o, role) {
  if (!MARK_ROLES.includes(role)) return o;
  const starter = role === "starter", was = o.healthy?.starter === true;
  o.mark = role;
  o.starter = starter;
  // flags on the healthy place only (after, holds); since Adam 3:02 PM 11-18 no Out man holds a bench spot (tiers.js placeByChart counts the men here only)
  if (o.healthy) o.healthy = { ...o.healthy, starter, ...(was && !starter ? { after: true } : {}), ...(!was && starter ? { holds: true } : {}) };
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
 * The real five (pages' or chart's or flagged, cut to five) stays and the men marked Starter join it; only a short one is filled, Starter marks taking fill places before the order does; six or more is said.
 * Returns { base (chooseFive's, with the fill), five: Set of ids, notes }. Pure.
 */
export function fiveWithMarks({ pool, conf, tops, fill, flag, want }) {
  const base0 = chooseFive(pool.map((id) => ({ id, starter_flag: flag(id) })), conf, tops, fill), isReal = (id) => (conf?.ids?.length ? conf.ids.includes(id) : tops?.length ? tops.includes(id) : flag(id)); // chooseFive ignores an empty pages' five
  let base = base0;
  if (want.length) {
    const real = [...base0.ids].filter(isReal), five0 = new Set([...real, ...want]), more = pool.filter((id) => !five0.has(id)).slice(0, Math.max(0, 5 - five0.size));
    const took = want.filter((id) => !real.includes(id)).length, cut = base0.note ? base0.note.split("; ").filter((n) => !/ available starters?: \d+ filled/.test(n)) : [];
    const fillNote = more.length ? `${base0.kind === "expected" ? "TwoGun flags" : "the lineup pages' five names"} ${real.length} available starter${real.length === 1 ? "" : "s"}${took ? `; S marks took ${took} place${took === 1 ? "" : "s"}` : ""}: ${more.length} filled from the top of tonight's order` : null;
    base = { ...base0, ids: new Set([...five0, ...more]), note: [...cut, fillNote].filter(Boolean).join("; ") || null };
  }
  const five = new Set([...base.ids, ...want]), notes = [];
  if (five.size > 5) notes.push(`${five.size} starters marked: unmark one.`);
  return { base, five, notes };
}

/**
 * The team's note on his marks that moved the five (G62: said where he looks): men his Bench+ or Bench mark took out of the five he would otherwise have (realIds: the lineup pages', else the chart's, else
 * TwoGun's flagged five, before any mark), and men his Starter mark put in. nameOf(id). Null when none. Pure.
 */
export function marksNote(marks, realIds, five, nameOf) {
  const real = realIds ?? [], out = real.filter((id) => marks[id] === "bench_plus" || marks[id] === "bench"), inn = [...five].filter((id) => marks[id] === "starter" && !real.includes(id));
  if (!out.length && !inn.length) return null;
  const parts = [out.length ? `${out.map((id) => `${nameOf(id)} (${WORD[marks[id]]})`).join(", ")} out of tonight's five` : null, inn.length ? `${inn.map(nameOf).join(", ")} in the five` : null];
  return `Your role marks: ${parts.filter(Boolean).join("; ")}; the next man fills a place as the short-five rule does`;
}
