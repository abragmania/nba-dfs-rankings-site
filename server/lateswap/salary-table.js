// DraftKings' salary table, on the right of its entries file: every man on the draft group, including one who has since left the
// board. It supplies slate.departed, so such a man's tip can still be read. Pure: no DOM, no fs, no clock. A tip is only ever read
// from his own Game Info; one that cannot be read stays null, and entry-state.js then treats him as untimed, failing closed.
import { parseCsv } from "../lib/csv.js";
import { SLOTS, isSalary } from "../board/slots.js";
import { ENTRY_COLUMNS } from "./entries-csv.js";

const REQUIRED = ["Name + ID", "Name", "ID", "Roster Position", "Salary", "Game Info", "TeamAbbrev"];
const WIDTH = 64; // columns read per row; the table starts just after the 12 entry columns and has 9
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fail = (error) => ({ ok: false, error });

/** Game Info ("MIL@BOS 11/04/2026 07:30PM ET") -> { game, tip, date }, tip in the slate's own stamp form ("Wed, Nov 4, 7:30 PM ET") and
 *  date as "2026-11-04". Each is null when it cannot be read: an impossible date or time, or any zone but ET, is never converted. */
export function readGameInfo(text) {
  const m = /^(\S+@\S+)\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})\s?([AP])M\s+ET$/i.exec(text.trim());
  if (!m) return { game: /^\S+@\S+/.exec(text.trim())?.[0] ?? null, tip: null, date: null };
  const [mon, day, year, hour, minute] = [+m[2], +m[3], +m[4], +m[5], +m[6]];
  const date = new Date(Date.UTC(year, mon - 1, day));
  const real = date.getUTCMonth() === mon - 1 && date.getUTCDate() === day && hour >= 1 && hour <= 12 && minute <= 59;
  if (!real) return { game: m[1], tip: null, date: null };
  return { game: m[1], tip: `${DAYS[date.getUTCDay()]}, ${MONTHS[mon - 1]} ${day}, ${hour}:${m[6]} ${m[7].toUpperCase()}M ET`, date: `${m[4]}-${m[2]}-${m[3]}` };
}

/** One table row as a man; { man } or { error } naming the row's man and the column at fault. */
function manFromCells(get) {
  const id = get("ID"), name = get("Name");
  const who = name || id || "A row";
  if (!/^\d+$/.test(id)) return { error: `the ID column for ${who} is ${JSON.stringify(id)}` };
  if (!name) return { error: `the Name column for ${id} is empty` };
  const nameId = get("Name + ID");
  if (!nameId.endsWith(`(${id})`)) return { error: `the Name + ID column for ${name} is ${JSON.stringify(nameId)}` };
  const salary = Number(get("Salary"));
  if (!/^\d+$/.test(get("Salary")) || !isSalary(salary)) return { error: `the Salary column for ${name} is ${JSON.stringify(get("Salary"))}` };
  const roster = get("Roster Position").split("/").map((s) => s.trim());
  if (!roster.every((s) => SLOTS.includes(s))) return { error: `the Roster Position column for ${name} is ${JSON.stringify(get("Roster Position"))}` };
  const team = get("TeamAbbrev");
  if (!team) return { error: `the TeamAbbrev column for ${name} is empty` };
  return { man: { dk_id: id, name, name_id: nameId, team, salary, roster_positions: roster, ...readGameInfo(get("Game Info")) } };
}

/**
 * readSalaryTable(text) -> { ok: true, men: [{ dk_id, name, name_id, team, salary, roster_positions, game, tip, date }] } or { ok: false, error }.
 * name_id is the Name + ID text as DraftKings issued it. A missing required column, or a malformed ID, Name, Name + ID, Salary, Roster
 * Position or TeamAbbrev in any row, refuses the table and names it.
 * Game Info is not a refusal row by row: an unreadable tip leaves that man's tip null. If no man at all has a readable tip, the column
 * itself is malformed and is refused. Rows are numbered by the shared parser through a stand-in header, because the file's own header
 * stops before this table.
 */
export function readSalaryTable(text) {
  if (typeof text !== "string") return fail("The entries file must be text.");
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const columns = Array.from({ length: WIDTH }, (_, i) => `c${i}`);
  const { rows, warnings } = parseCsv(`${columns.join(",")}\n${body}`);
  if (warnings.length) return fail(warnings[0].message);
  const cellsOf = (row) => columns.slice(ENTRY_COLUMNS.length).map((c) => (row[c] ?? "").trim());
  const matched = (row) => REQUIRED.filter((c) => cellsOf(row).includes(c));
  const at = rows.findIndex((row) => matched(row).length >= 3);
  if (at < 0) return fail(`The entries file has no salary table: no row names its columns (${REQUIRED.join(", ")}).`);
  const missing = REQUIRED.filter((c) => !matched(rows[at]).includes(c));
  if (missing.length) return fail(`The salary table is missing column${missing.length === 1 ? "" : "s"} ${missing.join(", ")}.`);
  const head = cellsOf(rows[at]);
  const men = [], seen = new Set();
  for (const row of rows.slice(at + 1)) {
    const cells = cellsOf(row);
    if (!REQUIRED.some((c) => cells[head.indexOf(c)])) continue; // an entry row below the table's end, or a blank one
    const read = manFromCells((c) => cells[head.indexOf(c)]);
    if (read.error) return fail(`The salary table is malformed: ${read.error}.`);
    if (seen.has(read.man.dk_id)) return fail(`The salary table lists ID ${read.man.dk_id} twice.`);
    seen.add(read.man.dk_id);
    men.push(read.man);
  }
  if (!men.length) return fail("The salary table lists no men.");
  if (!men.some((p) => p.tip != null)) return fail("The salary table's Game Info column is malformed: no man has a readable tip.");
  return { ok: true, men };
}

/** slate.departed: the table's men who are not on the newest pull's players. Works from men kept in storage as well as a fresh read. */
export function departedFrom(men, players) {
  const on = new Set(players.map((p) => p.dk_id));
  return men.filter((p) => !on.has(p.dk_id));
}
