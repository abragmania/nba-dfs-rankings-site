// Lineup spots (Adam, 2026-11-04): his contest entries map to spots (Cash, GPP #1, GPP #2 and up), and each spot holds exactly one
// saved lineup. This file is spots -> lineups, per slate, in data/cache/spots/<slate>.json (beside the saved lineups; it stays on
// this machine, never on GitHub):
//   { slate, spots: { "<name>": { lineup_id, slots, assigned_at, last? } } }
// `slots` are the 8 DraftKings ids in slot order (PG SG SF PF C G F UTIL), exactly as the saved lineup keeps them and as the DK
// file is written, copied from the saved lineup when the spot is assigned, so the spot still knows its lineup after the saved one
// is deleted. An empty spot is a name with { lineup_id: null, slots: null, assigned_at: null }, the one empty shape. When a saved
// lineup that holds a spot is deleted the spot is emptied and what it held is kept under `last` ({ lineup_id, slots, assigned_at,
// vacated_at, why }), nothing else keeps history. One lineup may hold several spots; a spot holds one lineup, so assigning moves
// it. Pure file access and checks; the route is in server.js. Nothing else reads the file yet (the late swap screen will).
import fs from "../../site/shim/fs.js";
import path from "../../site/shim/path.js";
import { dataRoot, hiddenIdAliases } from "./store.js";
import { writeFileAtomic } from "../../site/shim/atomic.js";
import { SLOTS } from "../board/slots.js";
import { cleanSpotName, SPOT_NAME_MAX, MAX_SPOTS } from "../board/spot-name.js";

export { cleanSpotName, SPOT_NAME_MAX, MAX_SPOTS };
const EMPTY = { lineup_id: null, slots: null, assigned_at: null };

const spotsFile = (slate) => path.join(dataRoot(), "cache", "spots", `${slate}.json`);

const isIds = (v) => Array.isArray(v) && v.length === SLOTS.length && v.every((id) => typeof id === "string" && id);
const isStamp = (v) => typeof v === "string" && v.length > 0 && v.length <= 64;
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Why a stored entry is not a spot, or null. A held spot has all three fields; an empty one has none. */
function entryProblem(name, e) {
  if (cleanSpotName(name) !== name) return `the name "${String(name).slice(0, 40)}" is not a spot name`;
  if (!plain(e)) return `spot "${name}" is not an object`;
  const held = e.lineup_id !== null;
  if (held ? !(typeof e.lineup_id === "string" && e.lineup_id.length > 0 && e.lineup_id.length <= 40 && isIds(e.slots) && isStamp(e.assigned_at)) : !(e.slots === null && e.assigned_at === null)) return `spot "${name}" has a wrong lineup_id, slots or assigned_at`;
  if ("last" in e && e.last !== undefined && !(plain(e.last) && typeof e.last.lineup_id === "string" && isIds(e.last.slots))) return `spot "${name}" has a wrong last`;
  return null;
}

/** The slate's spots, or none when there is no file. An unreadable or wrongly shaped file throws (the request becomes a 500),
 *  never an empty map: a spot that cannot be read is unknown, not empty. */
export function readSpots(slate) {
  const file = spotsFile(slate);
  if (!fs.existsSync(file)) return { slate, spots: {} };
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!plain(saved) || !plain(saved.spots)) throw new Error(`cache/spots/${slate}.json has no spots map`);
  for (const [name, e] of Object.entries(saved.spots)) {
    const why = entryProblem(name, e);
    if (why) throw new Error(`cache/spots/${slate}.json: ${why}`);
  }
  return { slate, spots: saved.spots };
}

/** The slate's spots as the screens should see them: a spot holding the id of an older-file copy the Saved list hides reads as holding
 *  the shown lineup of the same mode and men. Only the reading changes; the saved lineups file is never rewritten, and a later write of
 *  the spots stores the shown id. */
export function readSpotsShown(slate) {
  const { spots } = readSpots(slate);
  const alias = hiddenIdAliases(slate);
  if (!alias.size) return { slate, spots };
  return { slate, spots: Object.fromEntries(Object.entries(spots).map(([n, e]) => [n, e.lineup_id !== null && alias.has(e.lineup_id) ? { ...e, lineup_id: alias.get(e.lineup_id) } : e])) };
}

/** A spots map with its keys in order, as text: two maps are the same exactly when this is. */
export const canon = (spots) => JSON.stringify(Object.keys(spots).sort().map((n) => [n, spots[n]]));

/** Checks a POST body: { assign: { spot, lineup_id, confirmed? } }, { release: spot, lineup_id } (the lineup the page thinks holds
 *  it), { remove: spot } (an empty spot's name), { bulk: { assignments: [{ spot, lineup_id }], expect: { spot: lineup_id|null },
 *  confirmed: [lineup ids] } } (Assign in order: all of it or none) or { restore: { spots, expect } } (Undo of a bulk).
 *  Returns { ok: true, kind, ... } or { ok: false, message }. */
export function checkSpotsBody(body) {
  const bad = (message) => ({ ok: false, message });
  if (!plain(body)) return bad("Body must be a JSON object.");
  const idOk = (v) => typeof v === "string" && v.length > 0 && v.length <= 40;
  if ("bulk" in body) {
    const b = body.bulk;
    if (!plain(b) || !Array.isArray(b.assignments) || !b.assignments.length || b.assignments.length > MAX_SPOTS) return bad(`"bulk" needs 1 to ${MAX_SPOTS} assignments.`);
    const seen = new Set(), assignments = [];
    for (const a of b.assignments) {
      const spot = plain(a) ? cleanSpotName(a.spot) : null;
      if (!spot || !idOk(a?.lineup_id)) return bad('Each assignment is { "spot": name, "lineup_id": id }.');
      if (seen.has(spot)) return bad(`Spot "${spot}" is in the list twice.`);
      seen.add(spot);
      assignments.push({ spot, lineupId: a.lineup_id });
    }
    if (!plain(b.expect) || assignments.some(({ spot }) => !Object.hasOwn(b.expect, spot) || !(b.expect[spot] === null || idOk(b.expect[spot])))) return bad('"expect" must say which lineup (or null) each spot holds now.');
    const confirmed = b.confirmed ?? [];
    if (!Array.isArray(confirmed) || confirmed.some((x) => !idOk(x))) return bad('"confirmed" must be a list of saved lineup ids.');
    return { ok: true, kind: "bulk", assignments, expect: b.expect, confirmed };
  }
  if ("restore" in body) {
    const r = body.restore;
    if (!plain(r) || !plain(r.spots) || !plain(r.expect)) return bad('"restore" needs { "spots": the earlier spots, "expect": the spots as they are now }.');
    if (Object.keys(r.spots).length > MAX_SPOTS) return bad(`At most ${MAX_SPOTS} spots for one slate.`);
    for (const [name, e] of Object.entries(r.spots)) { const why = entryProblem(name, e); if (why) return bad(why); }
    return { ok: true, kind: "restore", spots: r.spots, expect: r.expect };
  }
  if ("release" in body) {
    const spot = cleanSpotName(body.release);
    if (!spot) return bad('"release" must be a spot name of 1 to 40 characters.');
    return idOk(body.lineup_id) ? { ok: true, kind: "release", spot, lineupId: body.lineup_id } : bad('"lineup_id" must be the saved lineup id the spot holds now.');
  }
  if ("remove" in body) {
    const spot = cleanSpotName(body.remove);
    return spot ? { ok: true, kind: "remove", spot } : bad('"remove" must be a spot name of 1 to 40 characters.');
  }
  const a = body.assign;
  if (!plain(a)) return bad('Send { "assign": { "spot": name, "lineup_id": id } }, { "release": name, "lineup_id": id } or { "remove": name }.');
  const spot = cleanSpotName(a.spot);
  if (!spot) return bad('"spot" must be a name of 1 to 40 characters.');
  if (!idOk(a.lineup_id)) return bad('"lineup_id" must be a saved lineup id.');
  if ("confirmed" in a && typeof a.confirmed !== "boolean") return bad('"confirmed" must be true or false.');
  return { ok: true, kind: "assign", spot, lineupId: a.lineup_id, confirmed: a.confirmed === true };
}

/** A saved lineup whose only illegality is a man no longer on the board (readLineups' stale with that one reason). */
const offBoardOnly = (l) => l.stale === true && Array.isArray(l.reasons) && l.reasons.length === 1 && /^No longer on this slate/.test(l.reasons[0]);

/**
 * The spots after one change. `lineups` is the slate's saved list as readLineups answers it (the slots come from there, never
 * from the body). Returns { ok: true, spots } (a new map) or { ok: false, status, code, message }.
 */
export function applySpots(current, checked, lineups, now = new Date().toISOString()) {
  const fail = (status, code, message) => ({ ok: false, status, code, message });
  if (checked.kind === "restore") {
    if (canon(current) !== canon(checked.expect)) return fail(409, "SPOTS_CHANGED", "The spots changed since that assignment; nothing was undone.");
    return { ok: true, spots: checked.spots };
  }
  if (checked.kind === "bulk") return applyBulk(current, checked, lineups, now);
  const has = Object.hasOwn(current, checked.spot);
  if (checked.kind === "remove") {
    if (!has) return fail(404, "NO_SPOT", "No such spot.");
    if (current[checked.spot].lineup_id !== null) return fail(409, "SPOT_HELD", "That spot holds a lineup; empty it first.");
    const next = { ...current };
    delete next[checked.spot];
    return { ok: true, spots: next };
  }
  if (checked.kind === "release") {
    if (!has) return fail(404, "NO_SPOT", "No such spot.");
    if (current[checked.spot].lineup_id !== checked.lineupId) return fail(409, "SPOT_MOVED", "That spot no longer holds that lineup.");
    return { ok: true, spots: { ...current, [checked.spot]: { ...EMPTY } } };
  }
  const l = lineups.find((x) => String(x.id) === checked.lineupId);
  if (!l) return fail(404, "NO_LINEUP", "No saved lineup with that id.");
  if (!isIds(l.slots)) return fail(400, "BAD_SPOT", "That saved lineup has no 8 player ids.");
  if (l.legal === false) {
    if (!offBoardOnly(l)) return fail(400, "BAD_SPOT", "That saved lineup is not legal on this slate now, so it cannot hold a spot.");
    if (!checked.confirmed) return fail(409, "NEEDS_CONFIRM", "That saved lineup holds a man who is not on the board; confirm to give it a spot anyway.");
  }
  if (!has && Object.keys(current).length >= MAX_SPOTS) return fail(400, "TOO_MANY", `At most ${MAX_SPOTS} spots for one slate.`);
  return { ok: true, spots: { ...current, [checked.spot]: { lineup_id: String(l.id), slots: [...l.slots], assigned_at: now } } };
}

/** Assign in order, all or none: every assignment is checked first (the saved lineup exists and is legal, or off the board only and
 *  confirmed; the spot holds the lineup the page expected), then the whole set is applied to a new map. One refusal changes nothing. */
function applyBulk(current, checked, lineups, now) {
  const fail = (status, code, message) => ({ ok: false, status, code, message });
  const stale = checked.assignments.filter(({ spot }) => (Object.hasOwn(current, spot) ? current[spot].lineup_id : null) !== checked.expect[spot]);
  if (stale.length) return fail(409, "SPOT_MOVED", `Spots changed since the page read them (${stale.map((a) => a.spot).join(", ")}); nothing was changed.`);
  const next = { ...current };
  for (const { spot, lineupId } of checked.assignments) {
    const l = lineups.find((x) => String(x.id) === lineupId);
    if (!l) return fail(404, "NO_LINEUP", `No saved lineup with id ${lineupId}; nothing was changed.`);
    if (!isIds(l.slots)) return fail(400, "BAD_SPOT", "A saved lineup has no 8 player ids; nothing was changed.");
    if (l.legal === false) {
      if (!offBoardOnly(l)) return fail(400, "BAD_SPOT", `Saved lineup ${lineupId} is not legal on this slate now, so it cannot hold a spot; nothing was changed.`);
      if (!checked.confirmed.includes(lineupId)) return fail(409, "NEEDS_CONFIRM", `Saved lineup ${lineupId} holds a man who is not on the board; confirm it or leave it out; nothing was changed.`);
    }
    if (!Object.hasOwn(next, spot) && Object.keys(next).length >= MAX_SPOTS) return fail(400, "TOO_MANY", `At most ${MAX_SPOTS} spots for one slate; nothing was changed.`);
    next[spot] = { lineup_id: String(l.id), slots: [...l.slots], assigned_at: now };
  }
  return { ok: true, spots: next };
}

/** Writes the slate's spots (atomically) and returns what a GET answers. */
export function writeSpots(slate, spots) {
  writeFileAtomic(spotsFile(slate), JSON.stringify({ slate, spots }, null, 1) + "\n");
  return { slate, spots };
}

/** A saved lineup (or a list of ids: it and its hidden copies) is being deleted: every spot it holds is emptied (the one empty shape) and what it held is kept under `last`.
 *  Called before the lineup is removed, so a failed write leaves the lineup in place. Returns the names emptied. */
export function vacateSpots(slate, lineupId, now = new Date().toISOString()) {
  const { spots } = readSpots(slate);
  const ids = new Set((Array.isArray(lineupId) ? lineupId : [lineupId]).map(String)); // one write for all the ids (a lineup and its hidden copies)
  const held = Object.keys(spots).filter((n) => ids.has(spots[n].lineup_id));
  if (!held.length) return [];
  const next = { ...spots };
  for (const n of held) next[n] = { ...EMPTY, last: { lineup_id: spots[n].lineup_id, slots: spots[n].slots, assigned_at: spots[n].assigned_at, vacated_at: now, why: "the saved lineup was deleted" } };
  writeSpots(slate, next);
  return held;
}
