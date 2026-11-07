// The latest build (Adam, 2026-11-07: "the only lineups that should save are the ones I press Save on"): a slate keeps only its
// last build, which a new build of either mode replaces, so a reload or a restart still shows it. Per slate, in
// data/cache/builds/<slate>.json (beside the saved lineups and the spots; it stays on this machine, never on GitHub):
//   { slate, builds: [ { id, mode, built_at, lineups: [{ ids: [8 dk ids in slot order] }], rows: { dk_id: row }, skipped, note,
//                        partial, stamps } ] }   (one build at most; a file from before keeps up to ten, and only its newest is read)
// `rows` are the men the build answered with (one row per man however many lineups hold him), so a card keeps drawing the figures
// it was built with. Saved lineups are another file and are never touched here. Pure file access and checks; the route is in server.js.
import fs from "../../site/shim/fs.js";
import path from "../../site/shim/path.js";
import { dataRoot } from "./store.js";
import { writeFileAtomic } from "../../site/shim/atomic.js";
import { SLOTS, MAX_COUNT } from "../board/slots.js";

import { ROW_KEYS, KEEP_BUILDS } from "../board/recent-builds.js";

export { KEEP_BUILDS };
export const MAX_LINEUPS_PER_BUILD = MAX_COUNT;
const MODES = ["Cash", "GPP"];

const buildsFile = (slate) => path.join(dataRoot(), "cache", "builds", `${slate}.json`);
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const idOk = (v) => typeof v === "string" && v.length > 0 && v.length <= 40;
const isIds = (v) => Array.isArray(v) && v.length === SLOTS.length && v.every(idOk);
const scalar = (v) => v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

/** One row as kept: only the figures a card draws, scalars and short lists of text. A row that is not one is { problem }. */
function cleanRow(id, r) {
  if (!plain(r) || String(r.dk_id) !== id) return { problem: `the row for ${id.slice(0, 40)} is not that man's` };
  const out = {};
  for (const k of ROW_KEYS) {
    if (!(k in r) || r[k] === undefined) continue;
    const v = r[k];
    if (Array.isArray(v) ? v.length > 12 || !v.every((x) => typeof x === "string" && x.length <= 20) : !scalar(v) || (typeof v === "string" && v.length > 200)) return { problem: `the row for ${id.slice(0, 40)} has a wrong ${k}` };
    out[k] = v;
  }
  return { row: out };
}

/** A build checked and cleaned: { ok: true, build } or { ok: false, message }. The server never keeps more than the shape below. */
export function checkBuild(b) {
  const bad = (message) => ({ ok: false, message });
  if (!plain(b)) return bad("A build must be an object.");
  if (!idOk(b.id)) return bad('"id" must be text of 1 to 40 characters.');
  if (!MODES.includes(b.mode)) return bad('"mode" must be "Cash" or "GPP".');
  if (!Number.isFinite(b.built_at)) return bad('"built_at" must be a time in milliseconds.');
  if (!Array.isArray(b.lineups) || b.lineups.length < 1 || b.lineups.length > MAX_LINEUPS_PER_BUILD) return bad(`A build holds 1 to ${MAX_LINEUPS_PER_BUILD} lineups.`);
  const lineups = [];
  for (const l of b.lineups) {
    if (!plain(l) || !isIds(l.ids)) return bad(`Each lineup is { "ids": ${SLOTS.length} player ids in slot order }.`);
    lineups.push({ ids: [...l.ids] });
  }
  if (!plain(b.rows)) return bad('"rows" must be the men the build answered with.');
  const rows = {};
  for (const id of new Set(lineups.flatMap((l) => l.ids))) {
    if (!Object.hasOwn(b.rows, id)) continue; // a man with no row is drawn from the board when his lineup is shown
    const r = cleanRow(id, b.rows[id]);
    if (r.problem) return bad(r.problem);
    rows[id] = r.row;
  }
  const note = b.note == null ? null : typeof b.note === "string" && b.note.length <= 600 ? b.note : undefined;
  if (note === undefined) return bad('"note" must be text of at most 600 characters.');
  const skipped = b.skipped ?? [];
  if (!Array.isArray(skipped) || skipped.length > 300 || skipped.some((s) => !plain(s) || Object.values(s).some((v) => !scalar(v) || (typeof v === "string" && v.length > 300)))) return bad('"skipped" must be a list of short records.');
  if (b.partial != null && (!plain(b.partial) || Object.values(b.partial).some((v) => !scalar(v)))) return bad('"partial" must be a short record.');
  if (b.stamps != null && (!plain(b.stamps) || JSON.stringify(b.stamps).length > 8000)) return bad('"stamps" must be a short record.');
  return { ok: true, build: { id: b.id, mode: b.mode, built_at: b.built_at, lineups, rows, skipped, note, partial: b.partial ?? null, stamps: b.stamps ?? null } };
}

/** The slate's latest build (a list of one), or none when there is no file. A file written before a slate kept one build holds up to
 *  ten, newest first: only the newest is answered, and the next write leaves only one. An unreadable or wrongly shaped file throws
 *  (the request becomes a 500): a list that cannot be read is unknown, never empty. */
export function readBuilds(slate) {
  const file = buildsFile(slate);
  if (!fs.existsSync(file)) return { slate, builds: [] };
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!plain(saved) || !Array.isArray(saved.builds)) throw new Error(`cache/builds/${slate}.json has no builds list`);
  const builds = saved.builds.slice(0, KEEP_BUILDS);
  for (const b of builds) { const c = checkBuild(b); if (!c.ok) throw new Error(`cache/builds/${slate}.json: ${c.message}`); }
  return { slate, builds };
}

/** Checks a POST body: { put: build } (a new build, which replaces the one held, or the held one again after a discard or a swap)
 *  or { remove: id }. */
export function checkBuildsBody(body) {
  if (!plain(body)) return { ok: false, message: "Body must be a JSON object." };
  if ("remove" in body) return idOk(body.remove) ? { ok: true, kind: "remove", id: body.remove } : { ok: false, message: '"remove" must be a build id.' };
  if (!("put" in body)) return { ok: false, message: 'Send { "put": build } or { "remove": id }.' };
  const c = checkBuild(body.put);
  return c.ok ? { ok: true, kind: "put", build: c.build } : c;
}

/** The builds after one change, newest first and no more than KEEP_BUILDS (one: a new build replaces the last). A put whose id is
 *  held replaces that build where it stands (a discard or a swap on it). A put of a build older than the one held is refused, so a
 *  swap made on an old build in another window never brings it back over the newer one. Returns { ok, builds } or
 *  { ok: false, status, code, message }. */
export function applyBuilds(current, checked) {
  if (checked.kind === "remove") {
    if (!current.some((b) => b.id === checked.id)) return { ok: false, status: 404, code: "NO_BUILD", message: "No such build." };
    return { ok: true, builds: current.filter((b) => b.id !== checked.id) };
  }
  const held = current.some((b) => b.id === checked.build.id);
  if (!held && current.some((b) => b.built_at > checked.build.built_at)) return { ok: false, status: 409, code: "NEWER_BUILD", message: "A newer build has replaced this one." };
  const next = held ? current.map((b) => (b.id === checked.build.id ? checked.build : b)) : [checked.build, ...current];
  return { ok: true, builds: next.slice(0, KEEP_BUILDS) };
}

/** Writes the slate's builds (atomically) and returns what a GET answers. */
export function writeBuilds(slate, builds) {
  writeFileAtomic(buildsFile(slate), JSON.stringify({ slate, builds }) + "\n");
  return { slate, builds };
}
