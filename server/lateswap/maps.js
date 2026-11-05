// The two maps of entries late swap (Adam, 11-04), one JSON-ready state per slate. Pure: no DOM, no fs, no clock.
// Map 1, entrySpots: Entry ID -> spot name, or null for unassigned. Map 2, spots: spot name -> { lineup, atUpload, proven }.
// Changing one never changes the other, and an entry's lineup is always its spot's lineup. entries holds each row as read from
// the file: its uploaded lineup is what DraftKings holds. A spot named in map 1 with no row in map 2 has an empty lineup.
import { SLOTS } from "../board/slots.js";
import { readEntries, ENTRY_COLUMNS } from "./entries-csv.js";
import { readSalaryTable } from "./salary-table.js";
import { isCashContest } from "./shell.js";

const VERSION = 1;
const META_COLUMNS = ENTRY_COLUMNS.length - SLOTS.length;
const CASH = "Cash";
const BLANK = Object.freeze(SLOTS.map(() => null));
const isBlank = (lineup) => lineup.every((id) => id == null);
const keyOf = (lineup) => lineup.join("|");
export const sameLineup = (a, b) => a.every((id, i) => id === b[i]);

/** The spot's lineup, 8 dk_ids or nulls in SLOTS order. */
export function lineupOf(state, spot) {
  return Object.hasOwn(state.spots, spot) ? state.spots[spot].lineup : BLANK;
}

/** What each entry holds now, read through both maps: { entryId: { spot, lineup } }, lineup being a copy of its spot's current lineup and
 *  null when the entry is unassigned. Entries never store a lineup of their own, so changing a spot's lineup reaches them all here. */
export function entryHoldings(entrySpots, spots) {
  const out = {};
  for (const [entryId, spot] of Object.entries(entrySpots)) {
    out[entryId] = { spot, lineup: spot == null ? null : [...(Object.hasOwn(spots, spot) ? spots[spot].lineup : BLANK)] };
  }
  return out;
}

/** The rows assigned to a spot, in file order. */
export function spotEntries(state, spot) {
  return state.entries.filter((e) => state.entrySpots[e.entryId] === spot);
}

/** Every spot name in either map: map 2's order, then any only map 1 names. */
export function spotNames(state) {
  return [...new Set([...Object.keys(state.spots), ...Object.values(state.entrySpots).filter((s) => s != null)])];
}

/** The optimizer mode a new spot starts with, read from its name once; after that the spot row's mode holds, so a rename does not change it. */
export const modeFromName = (name) => (/^cash/i.test(name) ? "Cash" : "GPP");

/** A usable spot name, trimmed, or null. */
export function cleanName(name) {
  if (typeof name !== "string") return null;
  const t = name.trim();
  return t && t.length <= 40 && !["__proto__", "constructor", "prototype"].includes(t) ? t : null;
}

const isDoubleUp = (e) => isCashContest(e.contestName); // the one cash rule (shell.js), shared with Auto-fill

/** Entries grouped by identical uploaded lineup, biggest group first, ties by first appearance. Reservations are not a group. */
export function lineupGroups(entries) {
  const groups = new Map();
  for (const e of entries) {
    if (isBlank(e.uploaded)) continue;
    const key = keyOf(e.uploaded);
    if (!groups.has(key)) groups.set(key, { lineup: e.uploaded, entryIds: [] });
    groups.get(key).entryIds.push(e.entryId);
  }
  return [...groups.values()].sort((a, b) => b.entryIds.length - a.entryIds.length);
}

/** Map 1 and map 2 proposed from a first upload: double-ups to Cash (a second double-up lineup to Cash #2), every other group of
 *  identical lineups to the next GPP number, biggest first. A blank double-up goes to Cash; any other reservation stays unassigned. */
export function proposeSpots(entries) {
  const entrySpots = {}, spots = {};
  const place = (groups, nameAt) => groups.forEach((g, k) => {
    const spot = nameAt(k);
    spots[spot] = { lineup: [...g.lineup], atUpload: [...g.lineup], atUploadWhy: null, mode: modeFromName(spot), proven: null, notes: [], duplicate: null, confirmedOut: [] };
    for (const id of g.entryIds) entrySpots[id] = spot;
  });
  place(lineupGroups(entries.filter(isDoubleUp)), (k) => (k === 0 ? CASH : `${CASH} #${k + 1}`));
  place(lineupGroups(entries.filter((e) => !isDoubleUp(e))), (k) => `GPP #${k + 1}`);
  for (const e of entries) if (isBlank(e.uploaded)) entrySpots[e.entryId] = isDoubleUp(e) ? CASH : null;
  return { entrySpots, spots };
}

/**
 * The file checked against the slate it is uploaded to; { ok: true, entries, file, men } or { ok: false, error }. Refused, in words: no
 * entries, a salary table that cannot be read, a Game Info date other than the slate's date, or no man on the slate. A man off the
 * slate on an otherwise good file is not a refusal: he is flagged on his entry.
 */
function readForSlate(text, slate) {
  const date = /^(\d{4}-\d{2}-\d{2})-/.exec(slate?.name ?? "")?.[1];
  if (!date) return { ok: false, error: `The slate name ${JSON.stringify(slate?.name ?? null)} carries no date, so this file cannot be checked against it.` };
  if (!Array.isArray(slate.players) || !slate.players.length) return { ok: false, error: "The slate has no players; its state is unknown, so this file was not read." };
  const read = readEntries(text);
  if (!read.ok) return read;
  if (!read.entries.length) return { ok: false, error: "The entries file holds no entries." };
  const table = readSalaryTable(text);
  if (!table.ok) return table;
  const other = table.men.find((p) => p.date != null && p.date !== date);
  if (other) return { ok: false, error: `This file is for another night: ${other.name}'s game is on ${other.date}, and the slate ${slate.name} is ${date}.` };
  const on = new Set(slate.players.map((p) => p.dk_id));
  const inRows = read.entries.flatMap((e) => e.uploaded.filter((id) => id != null));
  if (!table.men.some((p) => on.has(p.dk_id)) || (inRows.length && !inRows.some((id) => on.has(id)))) return { ok: false, error: `No man in this file is on the slate ${slate.name}.` };
  return { ok: true, entries: read.entries, file: read.file, men: table.men };
}

/** A first upload: startState(text, slate) -> { ok: true, state } or { ok: false, error }. slate = { name, players }. */
export function startState(text, slate, { empty = false } = {}) {
  const read = readForSlate(text, slate);
  if (!read.ok) return read;
  // empty: a new slate starts with nothing mapped (Adam, 11-04); the screen asks for this, and a fill makes each spot's row (settleRows).
  const { entrySpots, spots } = empty ? { entrySpots: Object.fromEntries(read.entries.map((e) => [e.entryId, null])), spots: {} } : proposeSpots(read.entries);
  return { ok: true, state: { version: VERSION, slate: slate.name, file: read.file, fileMen: read.men, entries: read.entries, entrySpots, spots, proposals: {}, unusable: {}, gone: [] } };
}

/** The spot a new entry's lineup matches, by a spot's current lineup, then what it held at upload; null when none. */
function matchSpot(state, lineup) {
  if (isBlank(lineup)) return null;
  const names = Object.keys(state.spots);
  return names.find((s) => sameLineup(state.spots[s].lineup, lineup)) ?? names.find((s) => state.spots[s].atUpload && sameLineup(state.spots[s].atUpload, lineup)) ?? null;
}

/**
 * The entries file uploaded again: { ok: true, state, report } or { ok: false, error }. Every known Entry ID keeps its spot and takes
 * its uploaded lineup from the new file, which is what DraftKings now holds. A new entry is unassigned, with a proposal when its lineup
 * matches a spot. An entry gone from the file leaves the maps, stays listed in state.gone and is reported. No spot's lineup changes;
 * the file is the baseline an entry's changes are measured against, so one differing from its spot is simply a changed entry (Adam, 11-04:
 * he does not edit lineups on DraftKings). A spot's atUpload follows the new file, ignoring blank entries; if its entries with men hold
 * different lineups, atUpload is null with the reason in atUploadWhy, never a stale lineup. Unusable marks and go-aheads stay.
 * report = { kept, added: [{ entryId, contestName, proposedSpot }], gone, skipped, oddIds, atUploadUnknown: [{ spot, reason }] }.
 */
export function reuploadEntries(state, text, slate) {
  if (slate?.name !== state.slate) return { ok: false, error: `These entries are for ${state.slate}; the slate given is ${JSON.stringify(slate?.name ?? null)}.` };
  const read = readForSlate(text, slate);
  if (!read.ok) return read;
  const known = new Set(state.entries.map((e) => e.entryId)), inFile = new Set(read.entries.map((e) => e.entryId));
  const entrySpots = {}, proposals = {}, added = [];
  for (const e of read.entries) {
    if (known.has(e.entryId)) { entrySpots[e.entryId] = state.entrySpots[e.entryId] ?? null; if (state.proposals[e.entryId] != null) proposals[e.entryId] = state.proposals[e.entryId]; continue; }
    const back = state.gone.find((g) => g.entryId === e.entryId); // missing from one file and back in a later one: it keeps the spot it had
    if (back) { entrySpots[e.entryId] = back.spot ?? null; added.push({ entryId: e.entryId, contestName: e.contestName, proposedSpot: null, returned: true, returnedTo: back.spot ?? null }); continue; }
    const proposedSpot = matchSpot(state, e.uploaded);
    entrySpots[e.entryId] = null;
    if (proposedSpot != null) proposals[e.entryId] = proposedSpot;
    added.push({ entryId: e.entryId, contestName: e.contestName, proposedSpot });
  }
  const left = state.entries.filter((e) => !inFile.has(e.entryId)).map((e) => ({ entryId: e.entryId, contestName: e.contestName, spot: state.entrySpots[e.entryId] ?? null }));
  const next = { ...state, file: read.file, fileMen: read.men, entries: read.entries, entrySpots, proposals, gone: [...state.gone.filter((g) => !inFile.has(g.entryId)), ...left] };
  const spots = {}, atUploadUnknown = [];
  for (const [spot, row] of Object.entries(state.spots)) {
    const members = spotEntries(next, spot).filter((e) => !isBlank(e.uploaded));
    if (!members.length) { spots[spot] = row; continue; } // nobody in this file says what the spot held
    if (members.every((e) => sameLineup(e.uploaded, members[0].uploaded))) { spots[spot] = { ...row, atUpload: [...members[0].uploaded], atUploadWhy: null }; continue; }
    const reason = `${spot}'s entries hold different lineups in this file (${members.map((e) => e.entryId).join(", ")}), so what it held at upload is unknown.`;
    spots[spot] = { ...row, atUpload: null, atUploadWhy: reason };
    atUploadUnknown.push({ spot, reason });
  }
  const report = { kept: read.entries.filter((e) => known.has(e.entryId)).map((e) => e.entryId), added, gone: left, skipped: read.file.skipped, oddIds: read.file.oddIds, atUploadUnknown };
  return { ok: true, state: settleRows({ ...next, spots }), report };
}

/** Map 1 only: moves entries to a spot, or unassigns them with spot null. { state, error }; no lineup changes. */
export function moveEntries(state, args) {
  const { entryIds, spot } = args ?? {};
  const name = spot === null ? null : cleanName(spot);
  if (spot !== null && name == null) return { state, error: `${JSON.stringify(spot ?? null)} is not a usable spot name.` };
  if (!Array.isArray(entryIds) || !entryIds.length) return { state, error: "Say which entries move." };
  const unknown = entryIds.filter((id) => !state.entries.some((e) => e.entryId === id));
  if (unknown.length) return { state, error: `No such entry: ${unknown.join(", ")}.` };
  const proposals = { ...state.proposals };
  for (const id of entryIds) delete proposals[id];
  const entrySpots = { ...state.entrySpots };
  for (const id of entryIds) entrySpots[id] = name;
  const next = { ...state, entrySpots, proposals };
  return { state: args.derive === true ? settleRows(next) : next, error: null }; // derive: a single move makes the row of a spot that has none (a batch settles once, at its end)
}

/** A row made from the entries named to a spot: what they hold in the file is what the spot held at upload. Entries holding different
 *  lineups, or none, leave atUpload unknown (atUploadWhy says why) and the spot has no lineup until one is given. */
function rowFromMembers(state, name) {
  const members = spotEntries(state, name).filter((e) => !isBlank(e.uploaded));
  const same = members.length > 0 && members.every((e) => sameLineup(e.uploaded, members[0].uploaded));
  const why = members.length && !same ? `${name}'s entries hold different lineups in the file (${members.map((e) => e.entryId).join(", ")}), so what it held at upload is unknown.` : null;
  return { lineup: same ? [...members[0].uploaded] : [...BLANK], atUpload: same ? [...members[0].uploaded] : null, atUploadWhy: why, mode: modeFromName(name), proven: null, notes: [], duplicate: null, confirmedOut: [], derived: true };
}

/**
 * Called once, after a whole batch of moves. A spot named by entries with no row yet gets one made from them (rowFromMembers). A row that
 * was made that way, still has no lineup and no known upload (its entries disagreed), is made again from its members as they are now, so
 * splitting such a spot leaves a spot that can be reset. A row that exists is never deleted or rebuilt otherwise: an emptied row stays,
 * with the lineup it had, and entries moving in and out never change a spot's lineup.
 */
export function settleRows(state) {
  const spots = { ...state.spots }, named = new Set(Object.values(state.entrySpots).filter((s) => s != null));
  for (const name of named) {
    if (!Object.hasOwn(spots, name)) spots[name] = rowFromMembers(state, name);
    else if (spots[name].derived === true && isBlank(spots[name].lineup) && spots[name].atUpload === null) spots[name] = { ...spots[name], ...rowFromMembers(state, name), notes: spots[name].notes, confirmedOut: spots[name].confirmedOut };
  }
  return { ...state, spots };
}

/** An undo's last step: the rows a fill made (the list comes back in the fill's answer) are dropped, if they are still as made and empty. */
export function dropRows(state, names) {
  const spots = { ...state.spots }, named = new Set(Object.values(state.entrySpots).filter((s) => s != null));
  for (const name of names) {
    const row = Object.hasOwn(spots, name) ? spots[name] : null;
    if (row?.derived === true && !named.has(name) && sameLineup(row.lineup, row.atUpload ?? BLANK)) delete spots[name];
  }
  return { ...state, spots };
}

/** Renames a spot in both maps; his entries and its lineup stay as they are. { state, error }. */
export function renameSpot(state, args) {
  const { from, to } = args ?? {};
  const name = cleanName(to);
  if (name == null) return { state, error: `${JSON.stringify(to ?? null)} is not a usable spot name.` };
  if (!spotNames(state).includes(from)) return { state, error: `No spot called ${from}.` };
  if (name === from) return { state, error: null };
  if (spotNames(state).includes(name)) return { state, error: `There is already a spot called ${name}.` };
  const followName = (row) => (row.duplicate?.matchedSpot === from ? { ...row, duplicate: { ...row.duplicate, matchedSpot: name } } : row);
  const spots = Object.fromEntries(Object.entries(state.spots).map(([s, row]) => [s === from ? name : s, followName(row)]));
  const entrySpots = Object.fromEntries(Object.entries(state.entrySpots).map(([id, s]) => [id, s === from ? name : s]));
  const proposals = Object.fromEntries(Object.entries(state.proposals).map(([id, s]) => [id, s === from ? name : s]));
  const unusable = Object.fromEntries(Object.entries(state.unusable).map(([s, ids]) => [s === from ? name : s, ids]));
  const gone = state.gone.map((g) => (g.spot === from ? { ...g, spot: name } : g));
  return { state: { ...state, spots, entrySpots, proposals, unusable, gone }, error: null };
}

/**
 * The go-ahead for a man Out or gone who is in a spot's lineup: he may now be written to its entries. args { spot, man }. Sets only the
 * spot's confirmedOut: the lineup, proven, notes and duplicate stay. A started man still wins at export. { state, error }.
 */
export function confirmOutMan(state, args) {
  const { spot, man } = args ?? {};
  if (!spotNames(state).includes(spot)) return { state, error: `No such spot: ${JSON.stringify(spot ?? null)}.` };
  if (typeof man !== "string" || !lineupOf(state, spot).includes(man)) return { state, error: `${JSON.stringify(man ?? null)} is not in ${spot}'s lineup.` };
  const row = state.spots[spot];
  if (row.confirmedOut.includes(man)) return { state, error: null };
  return { state: { ...state, spots: { ...state.spots, [spot]: { ...row, confirmedOut: [...row.confirmedOut, man] } } }, error: null };
}

/** The men taken out of this spot: state.unusable is { spot name: [dk_id] }, because a removal never carries to another spot (Adam, 11-04). */
export function unusableIn(state, spot) {
  return Object.hasOwn(state.unusable, spot) ? state.unusable[spot] : [];
}

/** Undoes "unusable" for a man taken out of a spot by mistake: later re-fills of that spot may use him again. No lineup or entry
 *  changes, and no other spot's mark. { state, error }. */
export function restoreUsable(state, args) {
  const { spot, man } = args ?? {};
  if (!unusableIn(state, spot).includes(man)) return { state, error: `${JSON.stringify(man ?? null)} is not marked unusable in ${JSON.stringify(spot ?? null)}.` };
  const left = unusableIn(state, spot).filter((id) => id !== man);
  const unusable = { ...state.unusable, [spot]: left };
  if (!left.length) delete unusable[spot];
  return { state: { ...state, unusable }, error: null };
}

/** The state as JSON text, for the screen job to store per slate. */
export function serializeState(state) {
  return JSON.stringify(state);
}

const isLineup = (v) => Array.isArray(v) && v.length === SLOTS.length && v.every((id) => id === null || typeof id === "string");
const isPlain = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const isText = (v) => typeof v === "string";
const orNull = (v) => v === null || isText(v);
const isTexts = (v) => Array.isArray(v) && v.every(isText);

const cellOk = (c, i) => isPlain(c) && c.slot === SLOTS[i] && isText(c.raw) && orNull(c.dk_id) && orNull(c.name) && typeof c.locked === "boolean";
/** A stored entry is whole: 4 leading columns, 8 cells in slot order, and an uploaded lineup that is what its cells say. */
const entryOk = (e) => isPlain(e) && isText(e.entryId) && isLineup(e.uploaded) && Array.isArray(e.cells) && e.cells.length === SLOTS.length && e.cells.every(cellOk)
  && e.uploaded.every((id, i) => id === e.cells[i].dk_id) && isText(e.rowText) && isTexts(e.metaRaw) && e.metaRaw.length === META_COLUMNS && isTexts(e.lockedInFile) && isTexts(e.readFlags);
const manOk = (p) => isPlain(p) && isText(p.dk_id) && isText(p.name) && isText(p.name_id) && isText(p.team) && Number.isInteger(p.salary) && isTexts(p.roster_positions) && orNull(p.game) && orNull(p.tip) && orNull(p.date);
const duplicateOk = (d) => d === null || (isPlain(d) && typeof d.altered === "boolean" && isText(d.text) && isText(d.matchedSpot) && orNull(d.reason));
const goneOk = (g) => isPlain(g) && isText(g.entryId) && isText(g.contestName) && orNull(g.spot);
const spotOk = (r) => isPlain(r) && isLineup(r.lineup) && (r.atUpload === null || isLineup(r.atUpload)) && orNull(r.atUploadWhy) && (r.mode === "Cash" || r.mode === "GPP") && [true, false, null].includes(r.proven) && isTexts(r.notes) && duplicateOk(r.duplicate) && isTexts(r.confirmedOut);

/** What is wrong with a stored state, as a sentence, or null. */
function stateProblem(s) {
  if (!isPlain(s)) return "The stored state is not an object.";
  if (s.version !== VERSION) return `The stored state is version ${JSON.stringify(s.version ?? null)}; this app reads version ${VERSION}.`;
  if (!isText(s.slate) || !s.slate) return "The stored state names no slate.";
  if (!isPlain(s.file) || !isText(s.file.headerText) || !isText(s.file.eol) || typeof s.file.namedCells !== "boolean") return "The stored state has no file header.";
  if (!Array.isArray(s.entries) || !isPlain(s.entrySpots) || !isPlain(s.spots) || !isPlain(s.proposals) || !isPlain(s.unusable) || !Object.values(s.unusable).every(isTexts) || !Array.isArray(s.gone) || !Array.isArray(s.fileMen)) return "The stored state is missing a part.";
  if (!Object.values(s.entrySpots).every(orNull)) return "The stored entries-to-spots map holds a value that is not a spot name.";
  if (!Object.values(s.proposals).every(isText)) return "The stored proposals hold a value that is not a spot name.";
  if (!s.gone.every(goneOk)) return "The stored list of entries gone from the file is not readable.";
  const badMan = s.fileMen.find((p) => !manOk(p));
  if (badMan !== undefined) return `The stored salary table man ${JSON.stringify(badMan?.dk_id ?? null)} is not readable.`;
  for (const e of s.entries) {
    if (!entryOk(e)) return `Stored entry ${JSON.stringify(e?.entryId ?? null)} is not readable.`;
    if (!Object.hasOwn(s.entrySpots, e.entryId)) return `Stored entry ${e.entryId} has no line in the entries-to-spots map.`;
  }
  const ids = new Set(s.entries.map((e) => e.entryId));
  if (ids.size !== s.entries.length) return "The stored state lists an entry twice.";
  for (const id of Object.keys(s.entrySpots)) if (!ids.has(id)) return `The entries-to-spots map names entry ${id}, which the stored state does not hold.`;
  for (const [spot, row] of Object.entries(s.spots)) if (!spotOk(row)) return `Stored spot ${spot} is not readable.`;
  return null;
}

/** Restores a stored state: { ok: true, state } or { ok: false, error }, checked at this boundary. */
export function restoreState(text) {
  let s;
  try { s = JSON.parse(text); } catch (e) { return { ok: false, error: `The stored state is not JSON: ${e.message}` }; }
  const problem = stateProblem(s);
  return problem ? { ok: false, error: problem } : { ok: true, state: s };
}
