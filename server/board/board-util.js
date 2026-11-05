// Small helpers shared by the board page and the optimizer panel.
import { isKnownTeam } from "./teams.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const money = (n) => "$" + n.toLocaleString("en-US");
/** A figure at one decimal; null when it is not a number. */
export const dec1 = (v) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(1) : null);

/** A selector that finds the same control after a redraw: its tag and data attributes, data-count aside (a thumbs button's count
 *  changes with each press). Null for a control with no data attributes. */
export function focusSelector(a) {
  const attrs = [...a.attributes].filter((t) => t.name.startsWith("data-") && t.name !== "data-count");
  return attrs.length ? a.tagName.toLowerCase() + attrs.map((t) => `[${t.name}="${CSS.escape(t.value)}"]`).join("") : null;
}

/** Runs draw(), which replaces `root`'s inside, and puts the keyboard focus (and a text box's caret) back on the same control:
 *  the one with the same tag and data attributes, data-count aside (a thumbs button's count changes with each press). A control
 *  with no data attributes, or gone after the redraw, keeps nothing. */
export function keepFocus(root, draw) {
  const a = typeof document === "undefined" ? null : document.activeElement; // the tests draw with no page
  if (!a) { draw(); return; }
  const sel = a !== root && root.contains(a) ? focusSelector(a) : null;
  const start = sel && a.tagName === "INPUT" && a.type === "text" ? a.selectionStart : null, end = start == null ? null : a.selectionEnd;
  draw();
  if (!sel) return;
  const el = root.querySelector(sel);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (start != null) el.setSelectionRange(start, end);
}

/** Team logo, or a text chip for a team code the logo folder does not have. */
export function logo(team, cls = "") {
  if (!isKnownTeam(team)) return `<span class="chipx ${cls}" title="No logo for ${esc(team)}">${esc(team ?? "?")}</span>`;
  return `<img class="logo ${cls}" src="logos/${esc(team)}.svg" alt="${esc(team)}">`;
}

// Every time the app shows is US Eastern, labelled "ET" (Adam's ruling, 2026-10-29). Stored stamps stay as their source
// wrote them (TwoGun writes Central, "Thu, Oct 29, 10:22 AM CT"); the conversion happens here, at display, through the
// time-zone database (Intl), never by adding an hour by hand, so it stays right across daylight-saving changes.
const ET_TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const etTime = (ms) => ET_TIME.format(ms).replace(/[  ]/g, " ") + " ET";

/** An ISO stamp with an offset ("2026-10-29T11:38:32-04:00") shown in Eastern time: "11:38 AM ET".
 *  Display only; the stored stamp is untouched. Null when the stamp has no offset or cannot be read. */
export function isoToEastern(s) {
  const ms = isoMs(s);
  return ms == null ? null : etTime(ms);
}
/** An ISO stamp with an offset -> its UTC instant in milliseconds; null when it has no offset or cannot be read. */
function isoMs(s) {
  if (typeof s !== "string" || !/T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)$/.test(s)) return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const ZONE_FMT = new Map();
/** Milliseconds a time zone is ahead of UTC at instant `ms` (negative west of Greenwich), read from Intl. */
function zoneOffset(ms, timeZone) {
  if (!ZONE_FMT.has(timeZone)) ZONE_FMT.set(timeZone, new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }));
  const p = Object.fromEntries(ZONE_FMT.get(timeZone).formatToParts(ms).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
/** A wall-clock time in a zone -> the UTC instant. Two passes, so a time just after a daylight-saving change lands right. */
function wallToUtc(y, mon, d, h, mi, timeZone) {
  const wall = Date.UTC(y, mon, d, h, mi);
  const first = wall - zoneOffset(wall, timeZone);
  return wall - zoneOffset(first, timeZone);
}

/** TwoGun's Central stamp ("Thu, Oct 29, 7:00 PM CT") -> "8:00 PM ET". The stamp has no year: of the year `refMs`
 *  (default now) falls in on Central time, the one before and the one after, it is the one whose calendar puts that date on
 *  the stamp's weekday and whose instant is nearest `refMs`. Null when the stamp is not in that form or no nearby year fits. */
export function centralToEastern(s, refMs = Date.now()) {
  const ms = centralToMs(s, refMs);
  return ms == null ? null : etTime(ms);
}

const WALL_ZONE = { C: "America/Chicago", E: "America/New_York" };
/** A year-less wall-time stamp ("Thu, Oct 29, 7:00 PM CT" or "... ET") in one of `zones` (letters of WALL_ZONE) -> the UTC
 *  instant in milliseconds, with the year chosen as centralToEastern says (the reference year read in the stamp's zone). */
function wallStampToMs(s, refMs, zones) {
  const m = typeof s === "string" ? /^(?:([A-Za-z]{3})[a-z]*,?\s+)?([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{1,2}):(\d{2})\s?([AP])M\s+([CE])[DS]?T$/i.exec(s.trim()) : null;
  if (!m || !zones.includes(m[7].toUpperCase())) return null;
  const timeZone = WALL_ZONE[m[7].toUpperCase()];
  const mon = MON[m[2].toLowerCase()], day = +m[3], hr = +m[4], mi = +m[5];
  const dow = m[1] ? DOW[m[1].toLowerCase()] : undefined;
  if (mon === undefined || (m[1] && dow === undefined) || hr < 1 || hr > 12 || mi > 59) return null;
  const h = (hr % 12) + (m[6].toUpperCase() === "P" ? 12 : 0);
  const ref = new Date(refMs + zoneOffset(refMs, timeZone)).getUTCFullYear();
  const fits = (y) => { const d = new Date(Date.UTC(y, mon, day)); return d.getUTCDate() === day && (dow === undefined || d.getUTCDay() === dow); };
  const options = [ref - 1, ref, ref + 1].filter(fits).map((y) => wallToUtc(y, mon, day, h, mi, timeZone));
  if (!options.length) return null;
  return options.reduce((a, b) => (Math.abs(b - refMs) < Math.abs(a - refMs) ? b : a));
}

/** TwoGun's Central stamp -> the UTC instant in milliseconds, with the year chosen as centralToEastern says; null when unreadable. */
export function centralToMs(s, refMs = Date.now()) {
  return wallStampToMs(s, refMs, "C");
}

/** A tip time as the slate file stores it -> the UTC instant in milliseconds: TwoGun's Central stamp, the same form in
 *  Eastern ("Thu, Oct 29, 8:00 PM ET"; same year rule), or an ISO stamp with an offset. Null for anything else (missing,
 *  a bare time with no date, or a form that cannot be placed on the clock safely). */
export function tipMs(s, refMs = Date.now()) {
  return wallStampToMs(s, refMs, "CE") ?? isoMs(s);
}

/** The slate's own date (from its name, "2026-10-29-main") at noon UTC: the reference that settles the year of a year-less
 *  stamp, the same one the board page uses. Null when the name carries no date. */
export function slateRefMs(slateName) {
  const m = /^(\d{4})-(\d{2})-(\d{2})-/.exec(String(slateName ?? ""));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], 12) : null;
}

/** A slate's stamp writer: tipWhen(name)(stamp) is shortTime against the slate's date (today's clock when the name has none). */
export const tipWhen = (slateName) => { const ref = slateRefMs(slateName) ?? Date.now(); return (s) => shortTime(s, ref); };

/** Any stamp the slate file carries -> its time in Eastern: "Thu, Oct 29, 7:00 PM CT" -> "8:00 PM ET", an ISO stamp with
 *  an offset -> "11:38 AM ET", an Eastern wall time ("... 8:00 PM ET") keeps its time. Anything else is returned as the
 *  file wrote it, because it cannot be converted safely. Null in, null out. */
export function shortTime(s, refMs = Date.now()) {
  if (typeof s !== "string" || !s) return null;
  const et = centralToEastern(s, refMs);
  if (et) return et;
  const e = s.match(/(\d{1,2}:\d{2}\s?[AP]M)\s+E[DS]?T\s*$/i);
  if (e) return `${e[1]} ET`;
  return isoToEastern(s) ?? s;
}

export const ICON = {
  lock: '<svg viewBox="0 0 16 16" width="13" height="13"><path fill="currentColor" d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2h.5A1 1 0 0 1 13 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h.5zm1.5 0h4V5a2 2 0 0 0-4 0v2z"/></svg>',
  x: '<svg viewBox="0 0 16 16" width="12" height="12"><path stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M4 4l8 8M12 4l-8 8"/></svg>',
  bolt: '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M9.5 1L3 9h4l-1 6 6.5-8h-4z"/></svg>',
};

const INJ = { probable: ["P", "var(--gr)"], questionable: ["Q", "var(--bl)"], doubtful: ["D", "var(--or)"], out: ["O", "var(--rd)"] };
/** Injury-status letter badge in Basketball Monster's colours (P green, Q blue, D orange, O red); other statuses show
 *  their first letter dimmed. The title keeps the full word. Missing status renders nothing. */
export function injBadge(status) {
  const s = String(status ?? "").trim();
  if (!s) return "";
  const [letter, bg] = INJ[s.toLowerCase()] ?? [s[0].toUpperCase(), "var(--dim)"];
  return `<span class="st" style="background:${bg}" title="${esc(s)} (injury report)">${esc(letter)}</span>`;
}

/**
 * The header's Board and Injuries stamps from a slate file's as_of_by_source. A connector-built slate keeps them under
 * board.csv / get_nba_projections / get_nba_slate; a database-row slate keeps them under twogun_row, whose injury_report
 * is the report's bare Central stamp from the row's meta.report (no source suffix, so the stamp parser reads it), or null
 * when the row gives none (`injuriesAbsent`: the header says "missing" rather than a dash).
 */
export function topStamps(slate) {
  const by = slate?.as_of_by_source ?? {};
  const row = by.twogun_row ?? null;
  const injuries = by.get_nba_slate?.injury_report ?? row?.injury_report ?? null;
  return { board: by["board.csv"]?.updated ?? by.get_nba_projections?.last_updated ?? row?.updated ?? null, injuries, injuriesAbsent: injuries === null && row !== null };
}
