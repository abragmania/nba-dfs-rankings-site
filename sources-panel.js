// The collapsed "Sources and pull times" section at the foot of the page: the stamps, projection source and refresh line that once sat in the header and above the table.
// Pure strings (tested in node); board.js owns the element and keeps it open or shut. Short problem badges stay in the main view (badgeHtml).
import { esc } from "./board-util.js";

const projWord = (s) => (s.proj_source === "ours" ? "Ours (our minutes x DK/min)" : s.proj_source === "twogun" ? "TwoGun's, as pulled" : "unknown");

/** Rows of [label, value, problem?] from the stamp texts already formatted by the page. */
export function sourceRows({ board, injuries, pulled, lock, slate, numbers }) {
  const miss = "missing";
  const rows = [["Board", board ?? miss, board == null], ["Injuries", injuries ?? miss, injuries == null], ["Pulled", pulled ?? miss, pulled == null], ["Lock", lock ?? miss, lock == null]];
  if (slate?.proj_source) rows.push(["Projection", slate.proj_problem ? `${projWord(slate)} · problem: ${slate.proj_problem}` : projWord(slate), Boolean(slate.proj_problem)]);
  if (numbers) rows.push(["Numbers", numbers, false]);
  return rows;
}

/** The inside of the details element: a compact two-column list. */
export function sourcesHtml(rows, extra = []) {
  const li = ([k, v, bad]) => `<li><span>${esc(k)}</span><b${bad ? ' class="miss"' : ""}>${esc(v)}</b></li>`;
  return `<summary>Sources and pull times</summary><ul>${[...rows, ...extra].map(li).join("")}</ul>`;
}

/** The short problem badges that stay in the main view (at most about 60 characters each; the detail is the hover text). */
export function badgeHtml({ injuriesMissing = false, projProblem = "" } = {}) {
  const b = (text, title) => `<span class="pbadge" title="${esc(title)}">${esc(text)}</span>`;
  return [
    injuriesMissing ? b("Injuries: report time missing", "The TwoGun board row carries no injury report time") : "",
    projProblem ? b("Projections: problem", projProblem) : "",
  ].filter(Boolean).join("");
}
