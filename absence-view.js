// How the page words an injured man's missed games (server/boxes/absence.js): the one date formatter and the two short forms, pure strings, tested in node. The words of the count
// itself ride in the hover title (absence.line); the main view carries only the short form. An unknown count shows nothing. The player panel header and the console's Out row use these.
import { MONTHS } from "./gamerow.js";
import { esc } from "./board-util.js";

/** "2026-11-08" -> "Nov 8"; anything else as it came. */
export function shortDay(day) {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(day ?? ""));
  return m ? `${MONTHS[+m[1] - 1]} ${+m[2]}` : String(day ?? "");
}

const notBoxed = (a) => (a.games_unknown > 0 ? ` &middot; ${a.games_unknown} not boxed yet` : "");

/** The player panel header's span: "Last played Nov 8 · missed 3", "No game this season", plus "· 1 not boxed yet" when some game has no box; "" when the count is unknown. */
export function absenceSpan(a) {
  if (a?.state !== "ok") return "";
  return `<span class="abs" title="${esc(a.line)}">${a.last_played ? `Last played ${esc(shortDay(a.last_played))} &middot; missed ${a.games_missed}` : "No game this season"}${notBoxed(a)}</span>`;
}

/** The console's Out row, after "usual N min": " · missed 3 · last Nov 8", " · no game yet", plus " · 1 not boxed yet"; "" when the count is unknown. */
export function absenceRow(a) {
  if (a?.state !== "ok") return "";
  return ` &middot; <span class="abs" title="${esc(a.line)}">${a.last_played ? `missed ${a.games_missed} &middot; last ${esc(shortDay(a.last_played))}` : "no game yet"}${notBoxed(a)}</span>`;
}
