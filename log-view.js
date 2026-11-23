// The Log tab's pure half (Adam 6:05 PM 11-21: "simply logs every (projection-related) change made ... It's searchable and you can filter by team"): the filters, the search and the markup.
// The lines come from GET /api/slate/<slate>/change-log (server/slate/change-log.js), newest first. Nothing here reads the page or the network; log-tab.js draws and listens.
import { esc, logo } from "./board-util.js";

/** The By filter's choices, in order: key -> label. News holds the lineup check's flips too. */
export const BY_FILTERS = Object.freeze([["all", "All"], ["you", "You"], ["news", "News"], ["engine", "Engine"], ["pull", "Pull"], ["console", "Console"]]);
const BY_OF = { you: ["you"], news: ["news", "lineup check"], engine: ["engine"], pull: ["pull"], console: ["console"] };
const BY_LABEL = { you: "You", news: "News", "lineup check": "Lineup check", engine: "Engine", pull: "Pull", console: "Console" };
const KIND_WORD = { out_in: "In / Out", role: "Role", minutes: "Minutes", projection: "Projection", thumb: "Thumb" };
/** The most rows drawn at once; the rest are counted at the foot (G62) and a search or filter narrows them. */
export const ROW_CAP = 1500;

/** What changed, in words: "Projection (GPP)". Pure. */
export const whatWord = (r) => `${KIND_WORD[r.kind] ?? r.kind}${r.mode ? ` (${r.mode})` : ""}`;
/** A from or to value as shown: a number to one decimal, a word as it is, a missing one as an em dash. Pure. */
export const valueText = (v) => (typeof v === "number" ? v.toFixed(1) : v == null || v === "" ? "—" : String(v));
/** The writer as shown. Pure. */
export const byWord = (by) => BY_LABEL[by] ?? String(by ?? "");

const ET_TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const ET_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" });
const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
/** A line's time in Eastern: "6:12 PM", with the weekday when it is not the day of `refIso` (the newest line). Pure. */
export function timeText(iso, refIso = null) {
  const ms = Date.parse(iso ?? "");
  if (!Number.isFinite(ms)) return "—";
  const t = ET_TIME.format(ms).replace(/[  ]/g, " ");
  const ref = Date.parse(refIso ?? "");
  return Number.isFinite(ref) && ET_DATE.format(ms) !== ET_DATE.format(ref) ? `${ET_DAY.format(ms)} ${t}` : t;
}

/** The words a search looks through for one line. Pure. */
const haystack = (r) => [r.name, r.team, whatWord(r), valueText(r.from), valueText(r.to), byWord(r.by), r.by, r.why].join(" ").toLowerCase();

/**
 * The change lines a view shows: rows (newest first) with the start markers left out, then the team filter (a Set of team codes; empty: every team), the By filter (BY_FILTERS key) and the search
 * (every word must be found in the player, team, what changed, the values, the writer or the why). Order kept. Pure.
 */
export function filterRows(rows, { q = "", teams = new Set(), by = "all" } = {}) {
  const words = String(q ?? "").toLowerCase().split(/\s+/).filter(Boolean), allowed = by === "all" ? null : new Set(BY_OF[by] ?? [by]);
  return (rows ?? []).filter((r) => r.kind !== "start" && r.kind !== "roster" && (!teams.size || teams.has(r.team)) && (!allowed || allowed.has(r.by)) && (!words.length || words.every((w) => haystack(r).includes(w))));
}

/** The teams the chips offer: the slate's (its board), then any a line names that the board does not, sorted. Pure. */
export function chipTeams(slateTeams, rows) {
  const out = new Set(slateTeams ?? []);
  for (const r of rows ?? []) if (r.team) out.add(r.team);
  return [...out].sort();
}

/** The direction of a numeric move, for its colour: "up", "dn" or "". Pure. */
const dirOf = (r) => (typeof r.from === "number" && typeof r.to === "number" ? (r.to > r.from ? "up" : r.to < r.from ? "dn" : "") : r.kind === "out_in" ? (r.to === "Out" ? "dn" : r.to === "In" ? "up" : "") : "");

/** The top bar: search, team chips with logos (All first), the By filter. Pure. */
export function barHtml({ q = "", teams = [], on = new Set(), by = "all" }) {
  const chip = (t) => `<button class="chip tchip${on.has(t) ? " on" : ""}" data-lgteam="${esc(t)}" title="Only ${esc(t)}'s changes (click again to drop)">${logo(t, "xs")}${esc(t)}</button>`;
  const byChip = ([k, label]) => `<button class="lg-by${by === k ? " on" : ""}" data-lgby="${k}">${label}</button>`;
  return `<div class="lg-bar"><input id="lgSearch" class="lg-search" type="search" placeholder="Search player, team or words" value="${esc(q)}" autocomplete="off" spellcheck="false">`
    + `<div class="lg-teams"><button class="chip tchip lg-all${on.size ? "" : " on"}" data-lgteam="" title="Every team">All</button>${teams.map(chip).join("")}</div>`
    + `<span class="lg-k">By</span><span class="lg-bys">${BY_FILTERS.map(byChip).join("")}</span></div>`;
}

/** The table of change lines (at most ROW_CAP). ref: the newest line's time, so an older day's line carries its weekday. Pure. */
export function tableHtml(rows, ref = null) {
  if (!rows.length) return `<div class="lg-empty">No change matches.</div>`;
  const body = rows.slice(0, ROW_CAP).map((r) => {
    const d = dirOf(r), by = String(r.by ?? "").replace(/\s+/g, "-");
    return `<tr><td class="lg-at">${esc(timeText(r.at, ref))}</td><td class="lg-tm">${r.team ? `${logo(r.team, "xs")}<b>${esc(r.team)}</b>` : "—"}</td>`
      + `<td class="lg-nm">${r.dk_id ? `<span class="nm" role="button" tabindex="0" data-dk-id="${esc(r.dk_id)}">${esc(r.name ?? r.dk_id)}</span>` : esc(r.name ?? "—")}</td>`
      + `<td class="lg-wh">${esc(whatWord(r))}</td><td class="lg-ft"><span class="lg-f">${esc(valueText(r.from))}</span><span class="lg-ar ${d}">→</span><span class="lg-to ${d}">${esc(valueText(r.to))}</span></td>`
      + `<td class="lg-bw"><span class="lg-tag b-${esc(by)}">${esc(byWord(r.by))}</span></td><td class="lg-why" title="${esc(r.why)}">${esc(r.why)}</td></tr>`;
  }).join("");
  return `<table class="lg-t"><colgroup><col class="c-at"><col class="c-tm"><col class="c-nm"><col class="c-wh"><col class="c-ft"><col class="c-bw"><col class="c-why"></colgroup>`
    + `<thead><tr><th>Time (ET)</th><th>Team</th><th>Player</th><th>What changed</th><th>From → To</th><th>By</th><th>Why</th></tr></thead><tbody>${body}</tbody></table>`;
}

/**
 * The foot's lines (G64): rows shown of all, what was not drawn, older lines the answer left in the file, bad and repeated lines, when logging began, men new to the log or gone from the board
 * (`marks`: the start and roster lines, oldest first), and the last problem the app kept. Pure.
 */
export function footLines({ shown, total, bad = 0, repeats = 0, older = 0, marks = [], state = "ok", writeProblem = null }) {
  const lines = [`${shown} of ${total} change${total === 1 ? "" : "s"} shown.`];
  if (shown > ROW_CAP) lines.push(`Only the newest ${ROW_CAP} are drawn; ${shown - ROW_CAP} more match. Search or pick a team to see them.`);
  if (older) lines.push(`${older} older line${older === 1 ? " is" : "s are"} in the log file but not sent to this page (it carries the newest ${total - older}).`);
  if (bad) lines.push(`${bad} line${bad === 1 ? "" : "s"} of the log could not be read and ${bad === 1 ? "is" : "are"} left out.`);
  if (repeats) lines.push(`${repeats} line${repeats === 1 ? " repeats" : "s repeat"} one already shown (the same change copied in from the other computer) and ${repeats === 1 ? "is" : "are"} shown once.`);
  if (state === "none") lines.push("Nothing has been logged on this slate yet: the first change made sets the base.");
  const cap = (s) => String(s ?? "").replace(/^./, (c) => c.toUpperCase());
  for (const s of [...marks].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) lines.push(`${timeText(s.at)} ET: ${cap(s.why)}.`);
  if (writeProblem) lines.push(`${timeText(writeProblem.at)} ET: ${cap(writeProblem.why)}.`);
  lines.push("Logged: each change to a man's minutes, projection (Cash and GPP where they differ), In or Out and role, by the step that made it; a move under 0.1 is not logged.");
  return lines;
}

/** The foot. Pure. */
export const footHtml = (lines) => `<div class="lg-foot">${lines.map((l) => `<div>${esc(l)}</div>`).join("")}</div>`;
