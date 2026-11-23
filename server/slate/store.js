// Reads slates and reads/writes picks (locked and excluded players, per mode), the working lineup and saved lineups. Pure file access under the data root; no HTTP here.
// Data root: NBADFS_DATA_DIR when set, else the repo's data/ folder (read on every call, as server/lib/log.js does).
import fs from "../../site/shim/fs.js";
import path from "../../site/shim/path.js";
import { dataDir } from "../../site/shim/log.js";
import { writeFileAtomic } from "../../site/shim/atomic.js";
import { SLOTS, checkLineup, setKey, arrangeForLateSwap } from "../board/slots.js";
import { slateRefMs } from "../board/board-util.js";
import { noNamesOk, noOf, NO_NAMES_RULE } from "../board/recent-builds.js";
import { applyHis, joinRowMen, statusFree } from "./out-pool.js";
import { MODES as SPLIT_MODES, readModeFile, saveModeFile, modeTrouble, badBase } from "./mode-file.js";

export const SLATE_NAME = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+$/;
export { MAX_LOCKED } from "../board/merge-saves.js"; // one copy: the page caps a merged save with it too
import { MAX_LOCKED } from "../board/merge-saves.js";

export const dataRoot = dataDir;

const slateFile = (slate) => path.join(dataRoot(), "slates", slate, "slate.json");
const picksFile = (slate) => path.join(dataRoot(), "cache", "picks", `${slate}.json`);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** The manifest's slate lines, newest name first. A missing manifest is an empty list; an unreadable one throws. */
export function listSlates() {
  const file = path.join(dataRoot(), "slates", "manifest.json");
  if (!fs.existsSync(file)) return [];
  const manifest = readJson(file);
  if (!manifest || !Array.isArray(manifest.slates)) throw new Error("manifest.json has no slates list");
  return [...manifest.slates].sort((a, b) => String(b.slate).localeCompare(String(a.slate)));
}

/** slate.json as built, or null when this slate has none, with his own In and Out calls on it (out-pool.js applyHis: p.his, and the Out men he put In added to the pool). The caller has already checked the name against SLATE_NAME. */
export function readSlate(slate) {
  const built = readSlateAsBuilt(slate);
  return built ? applyHis(slate, built) : null;
}

/** slate.json as built, with none of his calls on it (the site bake reads this, so its figures are the same on every machine), or null. Every man TwoGun's board row lists is in the pool, and no status of TwoGun's is kept (out-pool.js statusFree, joinRowMen; Adam 11-19). */
export function readSlateAsBuilt(slate) {
  const file = slateFile(slate);
  if (!fs.existsSync(file)) return null;
  return joinRowMen(statusFree(readJson(file))); // TwoGun's statuses and Out list never leave this read (out-pool.js statusFree); every row man is in the pool
}

// ---------- picks: cache/picks/<slate>.json, kept per mode (Adam 11-14; his yes 5:14 PM ET 11-19 and "yes go" 12:42 PM ET 11-20: Cash and
// GPP keep fully separate locks and excludes, so a lock or an exclude made in one never touches the other) ----------
//   { slate, Cash: { locked, excluded, saved_at, carried?, replaced? }, GPP: { ... } }   (read and written by mode-file.js)
// A file in the shape from before the split ({ slate, locked, excluded, saved_at }) is read as the same lists for BOTH modes, each marked
// carried, so nothing he set before disappears. A mode's first save writes the split shape with its own lists; the other mode keeps the
// carried copy, still marked, until its own first save. The answer counts what is carried (G62); the page names it at its foot (G64).
// A mode that cannot be read is answered `unreadable` (never empty lists in its place): its builds and re-fills refuse, and its next save
// replaces it, the old file copied aside (mode-file.js; review 11-20).
export const PICK_MODES = SPLIT_MODES;
const picksRel = (slate) => `cache/picks/${slate}.json`;
/** One mode's stored lists (ids not checked against the slate). A list present but not a list of text ids makes the mode unreadable (review 11-20). */
function parsePicksMode(one) {
  const list = (k) => {
    const v = one?.[k];
    if (v == null) return [];
    if (!Array.isArray(v) || v.some((id) => typeof id !== "string")) throw new Error(`"${k}" is not a list of player ids`);
    return v;
  };
  return { locked: list("locked"), excluded: list("excluded") };
}
const readPicksFile = (slate) => readModeFile(picksFile(slate), picksRel(slate), parsePicksMode);

/** What is still carried from the shared list of before the split: { modes, locked, excluded } (counts of men on the slate, the same
 *  lists in each carried mode), or null when no mode holds a carried man. */
function carriedOf(byMode) {
  const modes = PICK_MODES.filter((m) => byMode[m].carried && byMode[m].locked.length + byMode[m].excluded.length > 0);
  if (!modes.length) return null;
  return { modes, locked: byMode[modes[0]].locked.length, excluded: byMode[modes[0]].excluded.length };
}

/**
 * The saved picks of both modes: { slate, Cash: { locked, excluded, dropped, saved_at, carried, replaced, unreadable }, GPP: { ... },
 * dropped, saved_at, carried, unreadable, replaced }. Empty lists when none were saved. Ids no longer in the slate's players (slate rebuilt,
 * man gone) are left out of the lists and returned as `dropped` (per mode, and once each at the top), so a stale id can never block the next
 * save. Top-level saved_at is the newer mode's. A mode that cannot be read has empty lists AND `unreadable` (its why); the top-level
 * `unreadable` and `replaced` ({ mode: ... } or null) are for the page foot.
 */
export function readPicks(slate, slateData) {
  const stored = readPicksFile(slate);
  const known = new Set((slateData?.players ?? []).map((p) => String(p.dk_id)));
  const on = (list) => list.filter((id) => known.has(id));
  const out = { slate, dropped: [], saved_at: null, carried: null, ...modeTrouble(stored) };
  for (const m of PICK_MODES) {
    const e = stored?.[m];
    if (e?.unreadable) { out[m] = { locked: [], excluded: [], dropped: [], saved_at: null, carried: false, replaced: null, unreadable: e.unreadable }; continue; }
    const f = e?.fields ?? { locked: [], excluded: [] };
    const dropped = [...f.locked, ...f.excluded].filter((id) => !known.has(id));
    out[m] = { locked: on(f.locked), excluded: on(f.excluded), dropped, saved_at: e?.saved_at ?? null, carried: e?.carried ?? false, replaced: e?.replaced ?? null, unreadable: null };
    for (const id of dropped) if (!out.dropped.includes(id)) out.dropped.push(id);
    if (out[m].saved_at && (!out.saved_at || out[m].saved_at > out.saved_at)) out.saved_at = out[m].saved_at;
  }
  out.carried = carriedOf(out);
  return out;
}

/** One mode's saved picks, as readPicks gives them: { slate, mode, locked, excluded, dropped, saved_at, carried, replaced, unreadable }.
 *  A mode other than Cash or GPP, or one that cannot be read, throws: who is locked or excluded is then unknown (a build refuses). */
export function modePicks(slate, slateData, mode) {
  if (!PICK_MODES.includes(mode)) throw new Error(`Picks are kept for Cash and GPP only, not ${String(mode).slice(0, 20)}.`);
  const one = readPicks(slate, slateData)[mode];
  if (one.unreadable) throw new Error(one.unreadable);
  return { slate, mode, ...one };
}

/**
 * Checks a picks body { mode, locked, excluded, base? } against the slate's players. Returns { ok: true, mode, locked, excluded, base? } or
 * { ok: false, message }. Rule: mode is Cash or GPP (the lists are that mode's only); ids are strings found in the slate's players;
 * no repeats; nobody both locked and excluded.
 */
export function checkPicks(body, slateData) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, message: "Body must be a JSON object." };
  if (!PICK_MODES.includes(body.mode)) return { ok: false, message: '"mode" must be "Cash" or "GPP": locks and excludes are kept per mode. Reload the page if it is older than that.' };
  const known = new Set((slateData.players ?? []).map((p) => String(p.dk_id)));
  const lists = {};
  for (const key of ["locked", "excluded"]) {
    const list = body[key];
    if (!Array.isArray(list)) return { ok: false, message: `"${key}" must be a list of player ids.` };
    for (const id of list) {
      if (typeof id !== "string") return { ok: false, message: `"${key}" holds a non-text id.` };
      if (!known.has(id)) return { ok: false, message: `Unknown player id in "${key}": ${id.slice(0, 40)}` };
    }
    if (new Set(list).size !== list.length) return { ok: false, message: `"${key}" repeats an id.` };
    lists[key] = list;
  }
  if (lists.locked.length > MAX_LOCKED) return { ok: false, message: `At most ${MAX_LOCKED} players can be locked.` };
  const both = lists.locked.filter((id) => lists.excluded.includes(id));
  if (both.length) return { ok: false, message: `A player cannot be both locked and excluded: ${both[0]}` };
  // base: the mode's saved_at as the page last read or saved it (null: none saved), so a page with an older copy cannot save over newer picks (11-13 audit, state 3); absent: no check
  if (badBase(body)) return { ok: false, message: '"base" must be the time the picks were last saved, or null.' };
  return { ok: true, mode: body.mode, locked: lists.locked, excluded: lists.excluded, ...(Object.hasOwn(body, "base") ? { base: body.base } : {}) };
}

/**
 * Sets one mode's lists and keeps the other mode's exactly as stored (ids off the slate, its carried and replaced marks included): one read
 * and one atomic write with nothing awaited between, so two pages saving different modes never undo each other (the audit's "last page
 * wins"). A file in the old shared shape is split here: the other mode keeps the carried copy. A file holding an unreadable mode is copied
 * aside first and only that mode is emptied, marked replaced (mode-file.js saveModeFile). Returns { replaced: null | { copy, emptied, why } }.
 */
export function savePicks(slate, mode, locked, excluded, base = undefined) { // base: the mode's saved_at as the page last saw it (mode-file.js saveModeFile; 11-13 audit, state 3)
  if (!PICK_MODES.includes(mode)) throw new Error(`Picks are kept for Cash and GPP only, not ${String(mode).slice(0, 20)}.`);
  return { replaced: saveModeFile({ file: picksFile(slate), rel: picksRel(slate), slate, mode, fields: { locked, excluded }, parse: parsePicksMode, empty: () => ({ locked: [], excluded: [] }), base }) };
}

// ---------- the working lineup: cache/working/<slate>.json, per mode, each { slots: [8 dk_ids or null in SLOTS order], saved_at } ----------
// The optimizer panel's hand-picked men (server/board/worklineup.js), kept per slate on the server as the picks are.
const workingFile = (slate) => path.join(dataRoot(), "cache", "working", `${slate}.json`);

/** Checks a list of hand-picked men against the slate: up to 8 distinct ids found in its players. { ok, ids } or { ok: false, message }. */
function checkHandIds(list, slateData, what = "Hand-picked") {
  if (!Array.isArray(list) || list.some((id) => typeof id !== "string")) return { ok: false, message: `${what} men must be a list of player ids.` };
  if (list.length > SLOTS.length) return { ok: false, message: `At most ${SLOTS.length} men can be hand-picked.` };
  if (new Set(list).size !== list.length) return { ok: false, message: `${what} men repeat an id.` };
  const known = new Set((slateData.players ?? []).map((p) => String(p.dk_id)));
  const unknown = list.filter((id) => !known.has(id));
  if (unknown.length) return { ok: false, message: `${what} player ${unknown[0].slice(0, 40)} is not on this slate.` };
  return { ok: true, ids: list };
}

/**
 * Checks a working-lineup body { slots: 8 entries, each a player id or null, in SLOTS order }: each man on the slate,
 * once, and legal in his own slot. Returns { ok: true, slots } or { ok: false, message }. The optimize route checks its
 * handPicks (the same 8 entries) here too, with `what` "Hand-picked".
 */
export function checkWorking(body, slateData, what = "Working-lineup") {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, message: "Body must be a JSON object." };
  const { slots } = body;
  if (!Array.isArray(slots) || slots.length !== SLOTS.length || slots.some((id) => id !== null && typeof id !== "string")) {
    return { ok: false, message: `${what} men must be ${SLOTS.length} entries, each a player id or null, in the order ${SLOTS.join(", ")}.` };
  }
  const ids = slots.filter((id) => id !== null);
  const checked = checkHandIds(ids, slateData, what);
  if (!checked.ok) return checked;
  const byId = new Map((slateData.players ?? []).map((p) => [String(p.dk_id), p]));
  const off = slots.findIndex((id, i) => id !== null && !(byId.get(id).roster_positions ?? []).includes(SLOTS[i]));
  if (off >= 0) return { ok: false, message: `${byId.get(slots[off]).name} cannot play ${SLOTS[off]}.` };
  if (badBase(body)) return { ok: false, message: '"base" must be the time the working lineup was last saved, or null.' };
  return { ok: true, slots, ...(Object.hasOwn(body, "base") ? { base: body.base } : {}) };
}

// Kept per mode as the picks are (Adam 11-14, 11-19 and 11-20: Cash and GPP keep fully separate player picks and lineups):
//   { slate, Cash: { slots, saved_at, carried? }, GPP: { slots, saved_at, carried? } }
// A file from before the split ({ slate, slots, saved_at }) is read as the same lineup for both modes, marked carried, until each mode's first save.
const openSlots = () => new Array(SLOTS.length).fill(null);

const workingRel = (slate) => `cache/working/${slate}.json`;
/** One mode's stored lineup: 8 entries (an id or null); anything else makes the mode unreadable (mode-file.js). */
function parseWorkingMode(one) {
  if (one == null) return { slots: openSlots() };
  if (!Array.isArray(one.slots) || one.slots.length !== SLOTS.length || one.slots.some((id) => id != null && typeof id !== "string" && typeof id !== "number")) throw new Error("has no 8-slot list");
  return { slots: one.slots };
}
const readWorkingFile = (slate) => readModeFile(workingFile(slate), workingRel(slate), parseWorkingMode);

/**
 * The saved working lineups: { slate, Cash: { slots, dropped, saved_at, carried, replaced, unreadable }, GPP: { ... }, dropped, saved_at,
 * carried, unreadable, replaced }, 8 open slots for a mode with none. A man no longer on the slate (or no longer legal in his slot) opens his
 * slot and is named in his mode's `dropped` (and once at the top). carried: { modes, men } while a mode still holds the lineup from before
 * the split (G62), else null. A mode that cannot be read has open slots AND `unreadable` (its why), never an empty lineup passed off as his.
 */
export function readWorking(slate, slateData) {
  const stored = readWorkingFile(slate);
  const byId = new Map((slateData?.players ?? []).map((p) => [String(p.dk_id), p]));
  const out = { slate, dropped: [], saved_at: null, carried: null, ...modeTrouble(stored) };
  for (const m of PICK_MODES) {
    const e = stored?.[m];
    if (e?.unreadable) { out[m] = { slots: openSlots(), dropped: [], saved_at: null, carried: false, replaced: null, unreadable: e.unreadable }; continue; }
    const dropped = [];
    const slots = (e?.fields.slots ?? openSlots()).map((id, i) => {
      if (id == null) return null;
      const p = byId.get(String(id));
      if (p && (p.roster_positions ?? []).includes(SLOTS[i])) return String(id);
      dropped.push(String(id));
      return null;
    });
    out[m] = { slots, dropped, saved_at: e?.saved_at ?? null, carried: e?.carried ?? false, replaced: e?.replaced ?? null, unreadable: null };
    for (const id of dropped) if (!out.dropped.includes(id)) out.dropped.push(id);
    if (out[m].saved_at && (!out.saved_at || out[m].saved_at > out.saved_at)) out.saved_at = out[m].saved_at;
  }
  const modes = PICK_MODES.filter((m) => out[m].carried && out[m].slots.some((id) => id !== null));
  out.carried = modes.length ? { modes, men: out[modes[0]].slots.filter((id) => id !== null).length } : null;
  return out;
}

/** One mode's working lineup, as readWorking gives it: { slate, mode, slots, dropped, saved_at, carried, replaced, unreadable }. */
export function modeWorking(slate, slateData, mode) {
  if (!PICK_MODES.includes(mode)) throw new Error(`Working lineups are kept for Cash and GPP only, not ${String(mode).slice(0, 20)}.`);
  return { slate, mode, ...readWorking(slate, slateData)[mode] };
}

/** Sets one mode's working lineup and keeps the other mode's exactly as stored, in one read and one atomic write; a file holding an
 *  unreadable mode is copied aside and only that mode emptied, marked (mode-file.js, as savePicks). Returns { replaced: null | { copy, emptied, why } }. */
export function saveWorking(slate, mode, slots, base = undefined) { // base: the mode's saved_at as the page last saw it (mode-file.js saveModeFile; 11-13 audit, state 3)
  if (!PICK_MODES.includes(mode)) throw new Error(`Working lineups are kept for Cash and GPP only, not ${String(mode).slice(0, 20)}.`);
  return { replaced: saveModeFile({ file: workingFile(slate), rel: workingRel(slate), slate, mode, fields: { slots }, parse: parseWorkingMode, empty: () => ({ slots: openSlots() }), base }) };
}

// ---------- saved lineups: cache/lineups/<slate>.json, { slate, next_id, lineups: [{ id, mode, slots, names, saved_at, no? }] } ----------
export const MAX_SAVED = 300; // per slate (shown lineups, copies in an older file not counted); room for two full builds of 150
const MODES = ["Cash", "GPP"];
const lineupsFile = (slate) => path.join(dataRoot(), "cache", "lineups", `${slate}.json`);

/** The saved file as stored, or an empty one. An unreadable file throws (the request becomes a 500), never an empty list. */
function readLineupsFile(slate) {
  const file = lineupsFile(slate);
  if (!fs.existsSync(file)) return { lineups: [], next_id: 1 };
  const saved = readJson(file);
  if (!saved || !Array.isArray(saved.lineups)) throw new Error(`cache/lineups/${slate}.json has no lineups list`);
  const top = Math.max(0, ...saved.lineups.map((l) => Number(l.id)).filter(Number.isInteger));
  return { lineups: saved.lineups, next_id: Math.max(Number.isInteger(saved.next_id) ? saved.next_id : 1, top + 1) };
}

/**
 * The saved lineups, each re-checked against the slate file as it is now: legal and reasons from the one validator, and
 * stale: true when a man is no longer in the slate's players (a stale lineup is never legal). Nothing is dropped.
 */
export function readLineups(slate, slateData) {
  const byId = new Map((slateData?.players ?? []).map((p) => [String(p.dk_id), p]));
  const { lineups } = readLineupsFile(slate);
  return {
    slate,
    // Each mode-and-men set shows once, even in a file that holds copies (older saves); the file itself is never rewritten for it.
    lineups: dedupeSaved(lineups).map((l) => {
      const ids = Array.isArray(l.slots) ? l.slots.map(String) : [];
      const gone = ids.filter((id) => !byId.has(id));
      const check = checkLineup(ids.map((id) => byId.get(id) ?? null));
      const reasons = gone.length ? [`No longer on this slate: ${gone.join(", ")}.`, ...check.reasons.filter((r) => !/empty slot/.test(r))] : check.reasons;
      const stale = gone.length > 0 || !Array.isArray(l.slots);
      return { ...l, stale, legal: check.ok && !stale, reasons };
    }),
  };
}

/** One lineup { slots: [8 dk_ids], mode } checked by the one validator: { ok, slots, mode } or { ok: false, message, reasons }. */
function checkOne(body, slateData) {
  const bad = (message, reasons = []) => ({ ok: false, message, reasons });
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Body must be a JSON object.");
  if (!MODES.includes(body.mode)) return bad('"mode" must be "Cash" or "GPP".');
  const { slots } = body;
  if (!Array.isArray(slots) || slots.length !== SLOTS.length || slots.some((id) => typeof id !== "string")) {
    return bad(`"slots" must be a list of ${SLOTS.length} player ids in the order ${SLOTS.join(", ")}.`);
  }
  const byId = new Map((slateData.players ?? []).map((p) => [String(p.dk_id), p]));
  const unknown = slots.filter((id) => !byId.has(id));
  if (unknown.length) return bad(`Unknown player id: ${unknown.map((id) => id.slice(0, 40)).join(", ")}`, [`Not in this slate: ${unknown.map((id) => id.slice(0, 40)).join(", ")}.`]);
  const check = checkLineup(slots.map((id) => byId.get(id)));
  if (!check.ok) return bad(`This lineup is not legal: ${check.reasons.join(" ")}`, check.reasons);
  // Late swap's pins (a started man keeps his slot): each must be a man of this lineup, at the slot the lineup gives him.
  let pinned = null;
  if (body.pinned !== undefined && body.pinned !== null) {
    const pins = body.pinned;
    if (typeof pins !== "object" || Array.isArray(pins)) return bad('"pinned" must be an object of player id to slot.');
    for (const [id, slot] of Object.entries(pins)) {
      if (slots.indexOf(id) < 0 || SLOTS[slots.indexOf(id)] !== slot) return bad(`"pinned" must match the lineup: ${id.slice(0, 40)} is not at ${String(slot).slice(0, 10)}.`);
    }
    pinned = Object.keys(pins).length ? pins : null;
  }
  // The NO line of the build it came from (lineup/no-list.js, Adam 11-19): kept with the saved lineup, so it stays after the NO is cleared.
  if (!noNamesOk(body.no)) return bad(NO_NAMES_RULE);
  const no = noOf(body.no); // each name cut to 60 characters, so a long name never refuses the save
  return { ok: true, slots, mode: body.mode, pinned, ...(no ? { no } : {}) };
}
/** A checked lineup as an item to save: slots, mode, pins, and its NO line when it has one. */
const itemOf = (c) => ({ slots: c.slots, mode: c.mode, pinned: c.pinned, ...(c.no ? { no: c.no } : {}) });

export const MAX_BATCH = 150; // lineups in one Save all call: a DraftKings contest's most entries

/**
 * Checks a lineups body. { remove: id } → { ok, remove }. { slots: [8 dk_ids], mode } or { batch: [{ slots, mode }, ...] } (Save
 * all) → { ok, items: [{ slots, mode }] } when every lineup is legal under the one validator (checkLineup); otherwise
 * { ok: false, message, reasons }. A batch is all or nothing: one bad lineup refuses it.
 */
export function checkLineupBody(body, slateData) {
  const bad = (message, reasons = []) => ({ ok: false, message, reasons });
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Body must be a JSON object.");
  if ("remove" in body) {
    if (typeof body.remove !== "string" || !body.remove || body.remove.length > 40) return bad('"remove" must be a saved lineup id.');
    return { ok: true, remove: body.remove };
  }
  if ("batch" in body) {
    if (!Array.isArray(body.batch) || !body.batch.length || body.batch.length > MAX_BATCH) return bad(`"batch" must be a list of 1 to ${MAX_BATCH} lineups.`);
    const items = [];
    for (const [i, one] of body.batch.entries()) {
      const c = checkOne(one, slateData);
      if (!c.ok) return { ...c, message: `Lineup ${i + 1}: ${c.message}` };
      items.push(itemOf(c));
    }
    return { ok: true, items };
  }
  const c = checkOne(body, slateData);
  return c.ok ? { ok: true, items: [itemOf(c)] } : c;
}

/** A saved lineup's identity: its mode and its set of men, whatever the slot order (Adam, 2026-11-09: never saved twice). */
const identity = (l) => `${l.mode}#${setKey(Array.isArray(l.slots) ? l.slots : [])}`;

/** The list with each identity once, the first saved kept, order kept. A lineup with no slots list is never merged. Pure; the file on disk is not touched. */
export function dedupeSaved(lineups) {
  const seen = new Set();
  return lineups.filter((l) => {
    if (!Array.isArray(l.slots)) return true;
    const k = identity(l);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The 8 men in late-swap order (later tips in the more flexible slots), the order every built lineup is made in; as given when a tip is unreadable.
 *  `pinned` (dk_id -> slot) keeps a started man in the slot he holds; only the others are re-seated around him. */
function seated(slate, slots, byPlayer, pinned = null) {
  const a = arrangeForLateSwap(slots.map((id) => byPlayer.get(id)), { refMs: slateRefMs(slate) ?? Date.now(), pinned });
  return a.arranged ? a.slots.map((p) => String(p.dk_id)) : slots;
}

/**
 * Saves checked lineups [{ slots, mode }] in one read-and-write with nothing awaited in between, so two overlapping saves cannot
 * both land: a lineup whose mode and men equal one already saved (or earlier in this call) is skipped. Each saved one is stored
 * in late-swap order. Answers { lineups: the list as readLineups gives it, saved, already }; { over: true, room } when the new ones would take the
 * slate past MAX_SAVED (nothing is written), room being how many more would fit.
 */
export function addLineups(slate, items, slateData) {
  const file = readLineupsFile(slate);
  const byPlayer = new Map((slateData?.players ?? []).map((p) => [String(p.dk_id), p]));
  const have = new Set(file.lineups.map(identity));
  const fresh = [];
  for (const it of items) {
    const k = identity(it);
    if (have.has(k)) continue;
    have.add(k);
    fresh.push(it);
  }
  // The cap counts what the Saved list shows: hidden copies in an older file take no room.
  const room = Math.max(0, MAX_SAVED - dedupeSaved(file.lineups).length);
  if (fresh.length > room) return { over: true, room };
  if (fresh.length) {
    const now = new Date().toISOString();
    // The men's names are kept with the lineup: a man who is Out leaves the slate's players, and his name is all that is left to say who he was.
    const added = fresh.map((it, i) => {
      const slots = seated(slate, it.slots, byPlayer, it.pinned ?? null);
      return { id: String(file.next_id + i), mode: it.mode, slots, names: slots.map((id) => byPlayer.get(id)?.name ?? null), saved_at: now, ...(it.no ? { no: it.no } : {}) };
    });
    writeFileAtomic(lineupsFile(slate), JSON.stringify({ slate, next_id: file.next_id + fresh.length, lineups: [...file.lineups, ...added] }, null, 1) + "\n");
  }
  return { ...readLineups(slate, slateData), saved: fresh.length, already: items.length - fresh.length };
}

/** Hidden id -> shown id for each older-file copy the Saved list hides (same mode, same men as the first saved). Read only; the file is not touched. */
export function hiddenIdAliases(slate) {
  const first = new Map(), out = new Map();
  for (const l of readLineupsFile(slate).lineups) {
    if (!Array.isArray(l.slots)) continue;
    const k = identity(l);
    if (!first.has(k)) first.set(k, String(l.id));
    else out.set(String(l.id), first.get(k));
  }
  return out;
}

/** The ids a delete of lineup `id` takes: itself and any older-file copies of it hidden by the Saved list (same mode, same men); [] when no lineup has that id. */
export function idsRemovedWith(slate, id) {
  const { lineups } = readLineupsFile(slate);
  const target = lineups.find((l) => String(l.id) === id);
  if (!target) return [];
  return lineups.filter((l) => String(l.id) === id || (Array.isArray(target.slots) && Array.isArray(l.slots) && identity(l) === identity(target))).map((l) => String(l.id));
}

/** Removes one saved lineup by id, with its hidden copies (idsRemovedWith), so a copy never surfaces in its place; null when no lineup has that id. */
export function removeLineup(slate, id, slateData) {
  const file = readLineupsFile(slate);
  const gone = new Set(idsRemovedWith(slate, id));
  if (!gone.size) return null;
  const lineups = file.lineups.filter((l) => !gone.has(String(l.id)));
  writeFileAtomic(lineupsFile(slate), JSON.stringify({ slate, next_id: file.next_id, lineups }, null, 1) + "\n");
  return readLineups(slate, slateData);
}
