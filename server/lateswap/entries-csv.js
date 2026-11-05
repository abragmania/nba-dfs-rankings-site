// DraftKings entries file, read and written (entries late swap). Pure: no DOM, no fs, so a browser runs it too. Built against
// the real file in tests/fixtures/lateswap/dk-entries-2026-11-04.csv: columns Entry ID, Contest Name, Contest ID, Entry Fee, the
// 8 slots, then a blank column and DraftKings' instructions and salary table, which are ignored. Fields are parsed by the shared
// server/lib/csv.js; rawColumns only keeps each column's original text, which that parser does not, because an unchanged entry
// goes back out exactly as it came in.
import { parseCsv } from "../lib/csv.js";
import { SLOTS } from "../board/slots.js";

const META = ["Entry ID", "Contest Name", "Contest ID", "Entry Fee"];
export const ENTRY_COLUMNS = [...META, ...SLOTS];
const N_COLS = ENTRY_COLUMNS.length;

/** The original text of each record's first N_COLS columns, and the file's line ending. A record is what parseCsv calls one:
 *  a blank line is none, and a newline inside quotes does not end one. */
function rawColumns(text) {
  const records = [];
  let eol = null, raws = [], fieldStart = 0, inQuotes = false;
  const endField = (end) => { if (raws.length < N_COLS) raws.push(text.slice(fieldStart, end)); };
  const endRecord = (end) => {
    endField(end);
    if (raws.length > 1 || raws[0].trim() !== "") records.push(raws);
    raws = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes; // a doubled "" inside quotes toggles twice
    else if (inQuotes) continue;
    else if (ch === ",") { endField(i); fieldStart = i + 1; } else if (ch === "\n") {
      const end = text[i - 1] === "\r" ? i - 1 : i;
      eol ??= text.slice(end, i + 1);
      endRecord(end);
      fieldStart = i + 1;
    }
  }
  if (fieldStart < text.length || raws.length) endRecord(text.length);
  return { records, eol: eol ?? "\r\n" };
}

/** A slot's text: "Name (id)", a bare id, or "Name (id) (LOCKED)" (not seen in the real file, which was taken before any tip; a
 *  man so marked is held in his slot). Returns { dk_id, name, locked }; empty is a reservation's open slot; anything else is unreadable. */
function readCell(value) {
  const v = value.trim();
  if (!v) return { dk_id: null, name: null, locked: false };
  if (/^\d+$/.test(v)) return { dk_id: v, name: null, locked: false };
  const m = /^(.*?)\s*\((\d+)\)(\s*\(locked\))?$/i.exec(v);
  if (!m) return { dk_id: null, name: null, locked: false, unreadable: true };
  return { dk_id: m[2], name: m[1] || null, locked: Boolean(m[3]) };
}

/** What stops the header being read as the entries format, as a sentence; null when it is. */
function headerProblem(names) {
  const missing = ENTRY_COLUMNS.filter((c) => !names.includes(c));
  if (missing.length) return `This is not a DraftKings entries file: missing column${missing.length === 1 ? "" : "s"} ${missing.join(", ")}.`;
  const off = ENTRY_COLUMNS.find((c, i) => names[i] !== c);
  return off ? `This is not a DraftKings entries file: the columns must start ${ENTRY_COLUMNS.join(", ")}; ${off} is out of place.` : null;
}

function entryFromRow(row, raws) {
  const cells = SLOTS.map((slot, k) => ({ slot, raw: raws[META.length + k] ?? "", ...readCell(row[slot] ?? "") }));
  const uploaded = cells.map((c) => c.dk_id);
  const readFlags = cells.filter((c) => c.unreadable).map((c) => `${c.slot} cannot be read: "${c.raw}".`);
  const twice = [...new Set(uploaded.filter((id, i) => id != null && uploaded.indexOf(id) !== i))];
  for (const id of twice) readFlags.push(`${cells.find((c) => c.dk_id === id).name ?? id} is in this entry twice.`);
  return {
    entryId: row["Entry ID"].trim(), contestName: row["Contest Name"].trim(), contestId: row["Contest ID"].trim(), entryFee: row["Entry Fee"].trim(),
    rowText: raws.join(","),
    metaRaw: raws.slice(0, META.length),
    cells,
    uploaded,
    lockedInFile: cells.filter((c) => c.locked).map((c) => c.dk_id),
    readFlags,
  };
}

/**
 * readEntries(text) -> { ok: true, file: { headerText, eol, namedCells, skipped, oddIds }, entries } or { ok: false, error }. A row
 * with no Entry ID is skipped and counted; so is one whose Entry ID is not a number (its text kept in oddIds). A row with an
 * Entry ID and empty slots is a reservation: its slots are open. A missing column refuses the file and names the column.
 */
export function readEntries(text) {
  if (typeof text !== "string") return { ok: false, error: "The entries file must be text." };
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const { headers, rows, warnings } = parseCsv(body);
  if (warnings.length) return { ok: false, error: warnings[0].message };
  if (!headers.length) return { ok: false, error: "The entries file is empty." };
  const problem = headerProblem(headers);
  if (problem) return { ok: false, error: problem };
  const { records, eol } = rawColumns(body);
  if (records.length !== rows.length + 1) return { ok: false, error: "The entries file's rows could not be read consistently." };
  const entries = [], oddIds = [], seen = new Set();
  let skipped = 0;
  for (const [k, row] of rows.entries()) {
    const id = row["Entry ID"].trim();
    if (!/^\d+$/.test(id)) { skipped++; if (id) oddIds.push(id); continue; }
    if (seen.has(id)) return { ok: false, error: `Entry ID ${id} appears twice in the entries file.` };
    seen.add(id);
    entries.push(entryFromRow(row, records[k + 1]));
  }
  const namedCells = entries.some((e) => e.cells.some((c) => c.name != null)) || !entries.some((e) => e.cells.some((c) => c.dk_id != null));
  return { ok: true, file: { headerText: records[0].join(","), eol, namedCells, skipped, oddIds }, entries };
}

const csvCell = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** An entry's row for the upload file, holding `lineup` (8 dk_ids in SLOTS order). A slot still holding the uploaded man keeps its text; a
 *  changed slot is cellOf(dk_id). The uploaded lineup gives the uploaded text. An empty slot throws: a row with no lineup makes the
 *  DraftKings upload fail, so no path may write one. */
export function entryRow(entry, lineup, cellOf) {
  if (lineup.some((id) => id == null)) throw new Error(`Entry ${entry.entryId} has an empty slot, so no row can be written for it.`);
  if (lineup.every((id, i) => id === entry.uploaded[i])) return entry.rowText;
  const slots = lineup.map((id, i) => (id === entry.uploaded[i] ? entry.cells[i].raw : csvCell(cellOf(id))));
  return [...entry.metaRaw, ...slots].join(",");
}
