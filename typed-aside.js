// Adam 9:46-9:47 AM 11-20: his typed minutes win over everything, except when the man's role crosses the starter line (Starter to Bench or Bench+, or Bench or Bench+ to Starter) after he typed them:
// then his number is set aside, kept, and the man takes his new role's figure; minutes he types after the change win again ("Q3 ok": his own role flips and marks count as changes too, newest call wins).
// Each typed number carries its stamp { at, role } (the time he typed it and the role the man held then: console-moves.js setPin, the Minutes page's log). A crossing is read from the stamp's role against
// the role now, so it always came after his number; a change on the man stamped at or before his number leaves it standing. A number with no stamp, or a stamp with no role, stands, counted (G62).
// Bench and Bench+ are one side of the line. Pure, runs in the browser too (the Console); tests/typed_aside.test.mjs.
const SIDE = { starter: "starter", bench_plus: "bench", bench: "bench", "B+": "bench" };
const WORD = { starter: "the five", bench: "the bench" };
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
export const STAMP_ROLES = ["starter", "bench_plus", "bench", "oor"];

/** The side of the starter line a role is on: "starter", "bench", or null (out of rotation, Out, unknown). */
export const sideOf = (role) => SIDE[role] ?? null;

/** Null when `s` is a well-formed typed stamp { at (ISO, UTC), role (STAMP_ROLES) }, else the reason. */
export function badTypedStamp(s) {
  if (!s || typeof s !== "object" || Array.isArray(s) || Object.keys(s).some((k) => k !== "at" && k !== "role")) return "a typed stamp holds only at and role";
  if (typeof s.at !== "string" || !ISO.test(s.at) || !Number.isFinite(Date.parse(s.at))) return "a typed stamp's time is not an ISO time";
  return STAMP_ROLES.includes(s.role) ? null : `a typed stamp's role must be one of ${STAMP_ROLES.join(", ")}`;
}

/**
 * Whether his typed number stands tonight. value: his number; stamp: { at, role } or null; roleNow: the man's role in the plan worked as if nothing were typed; change: { at (ISO or null), by ("news" |
 * "you" | "lineup") } for the newest role call on him, or null (the confirmed five's own change carries no time). Returns { use: "typed" } | { use: "typed", unstamped: true } (counted by the caller) |
 * { use: "plan", aside: { value, was, now, at, by } } (his number kept and set aside: the man takes the plan's figure). Pure.
 */
export function typedDecision({ value, stamp, roleNow, change = null }) {
  if (typeof value !== "number" || !Number.isFinite(value)) return { use: "typed" };
  if (!stamp || badTypedStamp(stamp)) return { use: "typed", unstamped: true };
  const was = sideOf(stamp.role), now = sideOf(roleNow);
  if (!was || !now || was === now) return { use: "typed" }; // no crossing (Bench and Bench+ are one side); out of rotation is no figure of a role
  const chMs = Date.parse(change?.at ?? ""), atMs = Date.parse(stamp.at);
  if (Number.isFinite(chMs) && chMs <= atMs) return { use: "typed" }; // the newest call on him is no later than his number: his number stands
  return { use: "plan", aside: { value, was, now, at: Number.isFinite(chMs) ? change.at : null, by: change?.by ?? null } };
}

const ET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
/** The short words on the man: "your 20 set aside: moved to the bench 7:37 PM" (no time when the change carries none). */
export function asideWords(aside) {
  const ms = Date.parse(aside?.at ?? "");
  return `your ${Math.round(aside.value * 10) / 10} set aside: moved to ${WORD[aside.now] ?? aside.now}${Number.isFinite(ms) ? ` ${ET.format(ms).replace(/[  ]/g, " ")}` : ""}`;
}

/** The team's note on typed numbers with no stamp (G62): they stand whatever the role does, named; null when none. names: [text]. */
export function unstampedNote(names) {
  if (!names?.length) return null;
  return `${names.length} typed minutes figure${names.length === 1 ? " has" : "s have"} no time on record, so ${names.length === 1 ? "it stands" : "they stand"} whatever ${names.length === 1 ? "his" : "their"} role does: ${names.join(", ")}`;
}

/** The newest stamped role call on a man (for typedDecision's `change`): the latest of the given candidates [{ at, by }] with a parsable time; null when none. Pure. */
export function newestCall(cands) {
  let best = null;
  for (const c of cands ?? []) { const ms = Date.parse(c?.at ?? ""); if (Number.isFinite(ms) && (!best || ms > best.ms)) best = { ms, at: c.at, by: c.by ?? null }; }
  return best ? { at: best.at, by: best.by } : null;
}

/**
 * Every typed number of a team judged (typedDecision): { kept: { id: v } (his numbers that stand), aside: { id: { value, was, now, at, by, words } }, unstamped: [names], held: [names] }. typed: { id: v }; stampOf(id),
 * roleOf(id) (the plan's role, as if nothing were typed), changeOf(id) (newestCall's answer or null), nameOf(id); skip(id): kept as is (a man Out); planHas(id): whether the plan has a figure for him in his new
 * role. A number that would be set aside where the plan has none stands, named in `held` (the money review of 11-20, finding 2: a man he priced is never left with no minutes). One copy for the Console
 * (console-engine.js, console-tier.js) and the board's engine (personal-view.js). Pure.
 */
export function typedVerdicts(typed, { stampOf, roleOf, changeOf = () => null, nameOf = (id) => id, skip = () => false, planHas = () => true }) {
  const kept = {}, aside = {}, unstamped = [], held = [];
  for (const [id, v] of Object.entries(typed ?? {})) {
    if (skip(id)) { kept[id] = v; continue; }
    const d = typedDecision({ value: v, stamp: stampOf(id) ?? null, roleNow: roleOf(id), change: changeOf(id) });
    if (d.use === "plan" && !planHas(id)) { kept[id] = v; held.push(nameOf(id)); continue; }
    if (d.use === "plan") aside[id] = { ...d.aside, words: asideWords(d.aside) }; else kept[id] = v;
    if (d.unstamped) unstamped.push(nameOf(id));
  }
  return { kept, aside, unstamped, held };
}

/** The team's note on typed numbers a role change would set aside but the plan has no figure for in the new role (G62): they stand, named; null when none. */
export function heldNote(names) {
  if (!names?.length) return null;
  return `${names.length} typed minutes figure${names.length === 1 ? "" : "s"} would be set aside by a role change, but the plan has no figure for ${names.length === 1 ? "him" : "them"} in the new role, so ${names.length === 1 ? "it stands" : "they stand"}: ${names.join(", ")}`;
}

/** The Minutes page's stamp on his typed minutes for a man: the newest log entry that set them, { at, role }, or null when it carries no role (an entry from before 11-20). log: the team's edits log. Pure. */
export function logStamp(log, id) {
  let best = null;
  for (const e of log ?? []) if (e?.kind === "min" && e.id === id && (!best || String(e.at) >= String(best.at))) best = e;
  return best?.role ? { at: best.at, role: best.role } : null;
}
