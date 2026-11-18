// The team's standing role marks at the foot of its Console tab (the review of 11-18; G64: foot text, no new element in the main view): each mark's man, role and date with a Clear button that
// returns him to the rule (console-moves.js clearStanding, through Undo), and a count of tonight's per-night role marks in the scenario on show that override a standing one. Pure; tests in
// tests/depth_chart_minutes.test.mjs.
import { esc } from "./board-util.js";
import { keyOf } from "./console-engine.js";

const WORD = { starter: "Starter", bench_plus: "Bench+", bench: "Bench" };
const dateOf = (at) => new Date(at).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric" });

/** The foot block for team `code` (T its model team, S his work on it), or "" when there is nothing to say. ro: the public site's read-only copy (no buttons). */
export function roleMarksFootHtml(T, S, code, ro = false) {
  const marks = S?.role_marks ?? {}, ids = Object.keys(marks).filter((id) => T?.byId?.[id]), name = (id) => T.byId[id]?.name ?? id;
  const saved = T?.tier?.role_marks ?? {}, at = T?.tier?.role_marks_at ?? {};
  const when = (id) => (saved[id] === marks[id] && at[id] ? `since ${dateOf(at[id])}` : "not saved yet");
  const flips = Object.entries(S?.pins?.[keyOf(S?.outs ?? [])]?.r ?? {}).filter(([id, r]) => marks[id] && marks[id] !== r && T.byId[id]);
  if (!ids.length && !flips.length) return "";
  const lines = [];
  if (ids.length) lines.push(`Your standing role marks: ${ids.map((id) => `${esc(name(id))} ${WORD[marks[id]]} (${when(id)})${ro ? "" : ` <button class="rv" type="button" data-clear-mark="${esc(id)}" data-team="${esc(code)}" title="Back to the Bench+ rule and tonight's five">Clear</button>`}`).join("; ")}`);
  if (flips.length) lines.push(`${flips.length} of tonight's role marks in this scenario override${flips.length === 1 ? "s" : ""} a standing one: ${flips.map(([id, r]) => `${esc(name(id))} ${WORD[r] ?? esc(r)} over ${WORD[marks[id]]}`).join("; ")}`);
  return `<div class="cfoot">${lines.map((l) => `<div>${l}</div>`).join("")}</div>`;
}
