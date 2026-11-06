// The one game-row check, shared by the server (its log cache) and the card (the server's answer), so a row the card
// cannot draw is caught as a reasoned error and never reaches the table; plus the two calendar helpers both sides
// share (month names, season labels), one copy each. Pure; no I/O.
import { isoToEastern } from "./board-util.js";
const ET_DATE = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });

/** A fetch stamp for a footnote: "3:52 PM ET" when it is from today (`today` is "YYYY-MM-DD" Eastern), else "Oct 12, 3:52 PM ET". */
export function fetchedAt(iso, today) {
  const t = isoToEastern(iso);
  if (!t) return null;
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(Date.parse(iso));
  return d === today ? t : `${ET_DATE.format(Date.parse(iso))}, ${t}`;
}
/** Month abbreviations, January first. */
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A season end year -> its label: 2027 -> "2026-27". */
export const seasonLabel = (endYear) => `${endYear - 1}-${String(endYear % 100).padStart(2, "0")}`;
const NUMS = ["min", "pts", "reb", "ast", "fg3m", "fg3a", "stl", "blk", "to", "dk"];

/** Why a game row is unusable, or null when it is fine. needTeam: Basketball-Reference rows must carry his team. */
export function gameRowProblem(g, { needTeam = false } = {}) {
  if (!g || typeof g !== "object") return "a game row is not an object";
  if (typeof g.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(g.date)) return `a game row has no date (${JSON.stringify(g.date)})`;
  for (const k of NUMS) if (typeof g[k] !== "number" || !Number.isFinite(g[k])) return `the ${g.date} game has no ${k}`;
  if (needTeam && (typeof g.team !== "string" || !g.team)) return `the ${g.date} game has no team`;
  return null;
}

/** The first problem among a list of rows, or null. */
export const gamesProblem = (games, opts) => {
  for (const g of games) { const why = gameRowProblem(g, opts); if (why) return why; }
  return null;
};

/** A game-log row's USG% cell from the card's usage state (card-usage.js): the figure from Basketball-Reference's game
 *  log for that date, "…" while it loads, or a dash with the reason (never zero). dash(title) is the board's dash. */
export function usgCell(date, usage, dash) {
  const wait = '<td class="u" title="Loading usage from Basketball-Reference">…</td>';
  const f = logFault(usage);
  if (f?.wait) return wait;
  if (f) return `<td class="u">${dash(f.cell)}</td>`;
  const g = usage.data.game_usage.value.games.find((x) => x.date === date);
  const why = gameFault(g);
  if (why) return `<td class="u">${dash(GAME_WHY[why])}</td>`;
  return `<td class="u">${g.usg.toFixed(1)}</td>`;
}

// The reasons usgCell (hover title) and usgNote (sentence under the table) share, so the two never disagree.
const GAME_WHY = { noRow: "Basketball-Reference's game log has no row for this game yet", blank: "Basketball-Reference left this game's USG% blank" };
/** Why one game has no figure ("noRow" | "blank"), or null when it has one. g is its row in the usage answer, if any. */
const gameFault = (g) => (!g ? "noRow" : Number.isFinite(g.usg) ? null : "blank");
/** Why the whole log has no figures: { wait: true } while loading or polling, { cell, note, paused? } when it is missing
 *  for every game, or null when the log was read (its games may still lack a figure each). paused: the server says
 *  Basketball-Reference has paused this app (game_usage.retry_at), so nothing is retried and the note needs no pointer. */
function logFault(usage) {
  if (!usage || usage.state === "idle" || usage.state === "loading") return { wait: true };
  if (usage.state === "error") return { cell: `no usage figures: ${usage.message}`, note: `the usage figures could not be loaded (${usage.message})` };
  const gu = usage.data.game_usage;
  if (gu.pending) {
    if (!usage.gaveUp) return { wait: true };
    if (usage.pollError) return { cell: `the last refresh failed (${usage.pollError})`, note: `the last refresh failed (${usage.pollError})` };
    return { cell: "still loading after several tries; reopen the card", note: "Basketball-Reference was still loading after several tries" };
  }
  if (gu.error && gu.retry_at) {
    const t = fetchedAt(gu.retry_at, usage.data.today);
    return { cell: `no usage figures: ${gu.error}`, paused: true, note: `Basketball-Reference has paused this app ${t ? `until ${t}` : "for a while"}; close and reopen the card after then` };
  }
  if (gu.error) return { cell: `no usage figures: ${gu.error}`, note: `Basketball-Reference could not be read (${gu.error})` };
  return null;
}

/** The plain-English sentence under the game log when USG% is missing for some or all games, or null while it loads or
 *  when every game has a figure. A log-wide fault ends with what happens next: "Trying again…" while a retry is
 *  scheduled (usage.retrying, card-usage.js), a pointer to reopen once retries are used up, nothing for a permanent
 *  error or a pause. A per-game fault has no pointer (a reopen returns the same cached log). Never a zero. */
export function usgNote(games, usage) {
  if (!games?.length) return null;
  const f = logFault(usage);
  if (f?.wait) return null;
  const strip = (s) => s.replace(/[.\s]+$/, "");
  if (f) {
    const tail = f.paused ? "" : usage.retrying ? " Trying again…" : usage.retriesOut || usage.gaveUp ? " Close and reopen the card to try again." : "";
    return `USG% missing for every game: ${strip(f.note)}.${tail}`;
  }
  const gu = usage.data.game_usage;
  const byDate = new Map(gu.value.games.map((x) => [x.date, x]));
  const faults = games.map((g) => gameFault(byDate.get(g.date))).filter(Boolean);
  if (!faults.length) return null;
  const noRow = faults.filter((x) => x === "noRow").length, blank = faults.length - noRow;
  const one = faults.length === 1;
  const read = noRow && gu.value.as_of ? fetchedAt(gu.value.as_of, usage.data.today) : null;
  const seen = read ? ` (log read ${read})` : "";
  const log = "Basketball-Reference's game log";
  const why = noRow && blank ? `${log} has no row yet for ${noRow} and left ${blank} blank${seen}`
    : noRow ? `${log} has no row for ${one ? "that game" : "those games"} yet${seen}`
    : `Basketball-Reference left ${one ? "that game's" : "those games'"} USG% blank`;
  return `USG% missing for ${faults.length === games.length ? "every game" : `${faults.length} of ${games.length} games`}: ${why}.`;
}

