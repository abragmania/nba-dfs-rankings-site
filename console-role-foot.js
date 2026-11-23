// The team's standing role marks at the foot of its Console tab (the review of 11-18; G64: foot text, no new element in the main view): each mark's man, role and date with a Clear button that
// returns him to the rule (console-moves.js clearStanding, through Undo), and a count of tonight's per-night role marks in the scenario on show that override a standing one. Pure; tests in
// tests/depth_chart_minutes_*.test.mjs.
import { esc } from "./board-util.js";
import { keyOf } from "./console-engine.js";
import { pickChoices } from "./console-picks.js";

const WORD = { starter: "Starter", bench_plus: "Bench+", bench: "Bench" };
const dateOf = (at) => new Date(at).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric" });

/** The foot block for team `code` (T its model team, S his work on it), or "" when there is nothing to say. ro: the public site's read-only copy (no buttons). */
export function roleMarksFootHtml(T, S, code, ro = false) {
  const marks = S?.role_marks ?? {}, ids = Object.keys(marks).filter((id) => T?.byId?.[id]), name = (id) => T.byId[id]?.name ?? id;
  const saved = T?.tier?.role_marks ?? {}, at = T?.tier?.role_marks_at ?? {}, picks = S?.role_picks ?? {}, savedPicks = T?.tier?.role_picks ?? {};
  const pickOf = (id) => (marks[id] === "starter" && picks[id] != null ? picks[id] : null), when = (id) => (saved[id] === marks[id] && (savedPicks[id] ?? null) === pickOf(id) && at[id] ? `since ${dateOf(at[id])}` : "not saved yet");
  const claims = Object.values(marks).includes("starter") ? pickChoices(T, S) : {}, nm = (x) => esc(T.byId[x]?.name ?? T.tier?.men?.[x]?.name ?? T.tier?.depth?.names?.[x] ?? x);
  const inPlace = (id) => (pickOf(id) === null ? "" : claims[id]?.picked && claims[id].gone === pickOf(id) ? ` in place of ${nm(pickOf(id))}` : `, pick of ${nm(pickOf(id))} not in use`); // his pick of whom the Starter mark replaces, as the five now has it (console-picks.js; the review of 11-21)
  const flips = Object.entries(S?.pins?.[keyOf(S?.outs ?? [])]?.r ?? {}).filter(([id, r]) => marks[id] && marks[id] !== r && T.byId[id]);
  if (!ids.length && !flips.length) return "";
  const lines = [];
  if (ids.length) lines.push(`Your role marks for tonight's slate: ${ids.map((id) => `${esc(name(id))} ${WORD[marks[id]]}${inPlace(id)} (${when(id)})${ro ? "" : ` <button class="rv" type="button" data-clear-mark="${esc(id)}" data-team="${esc(code)}" title="Back to the Bench+ rule and tonight's five">Clear</button>`}`).join("; ")}`);
  if (flips.length) lines.push(`${flips.length} of tonight's role marks in this scenario override${flips.length === 1 ? "s" : ""} your mark for tonight's slate: ${flips.map(([id, r]) => `${esc(name(id))} ${WORD[r] ?? esc(r)} over ${WORD[marks[id]]}`).join("; ")}`);
  return `<div class="cfoot">${lines.map((l) => `<div>${l}</div>`).join("")}</div>`;
}
