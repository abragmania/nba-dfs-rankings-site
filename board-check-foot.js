// The board self-check at the foot of the Player list page (G65, G64): never in the main view. All clear is one quiet line; a failure is one plain line each, a conflict between sources its own named line.
// What could not be checked or was left out (the note lines) stays in the API answer, never on the page (Adam 11-19). Pure strings (tested in node); board.js owns the element. The answer is slate.board_check (server/slate/board-check.js).
import { esc, isoToEastern } from "./board-util.js";

/** The foot's lines: [{ cls ("ok" | "head" | "info" | "bad" | "conflict" | "note"), text }]. Empty when the server gave no answer (the public site). */
export function checkFootLines(bc) {
  if (!bc || typeof bc !== "object") return [];
  // the minutes the board uses and the nightly scoreboard's average misses, one quiet line under the head (Adam 4:02 PM 11-18: "keep me in the loop on what we actually use")
  const minutes = typeof bc.minutes_line === "string" && bc.minutes_line ? [{ cls: "info", text: bc.minutes_line }] : [];
  if (bc.problem) return [{ cls: "bad", text: `Board self-check: ${bc.problem}` }, ...minutes];
  const time = isoToEastern(bc.checked_at ?? "") ?? "time unknown";
  const fails = bc.failure_lines ?? [], conflicts = bc.conflict_lines ?? [], notes = bc.unchecked_lines ?? [], exempt = bc.exempt_lines ?? [], depth = bc.depth_lines ?? [];
  const tail = [...fails.map((text) => ({ cls: "bad", text })), ...conflicts.map((text) => ({ cls: "conflict", text })), ...notes.map((text) => ({ cls: "note", text })), ...exempt.map((text) => ({ cls: "note", text })), ...depth.map((text) => ({ cls: "note", text }))]; // depth: the day's automatic depth-chart changes and notes (server/slate/depth-refresh.js)
  if (!fails.length && !conflicts.length && !notes.length) return [{ cls: "ok", text: `Board self-check: all ${bc.men} men pass (${time})` }, ...minutes, ...tail];
  const head = fails.length ? `Board self-check: ${fails.length} ${fails.length === 1 ? "figure does" : "figures do"} not follow from its inputs` : `Board self-check: no failures in ${bc.men} men`;
  return [{ cls: "head", text: `${head}${conflicts.length ? `; ${conflicts.length} for you to settle` : ""} (${time})` }, ...minutes, ...tail];
}

/** The lines on the page: the head or all-clear line, the minutes line, the failures and the conflicts (G65). */
export const checkActionLines = (bc) => checkFootLines(bc).filter((l) => l.cls !== "note");
/** The lines that only explain, in order: what was not checked, each exemption, the depth-chart notes. Never on the page (Adam 11-19, 12:45 PM: "none of this is helpful"); they stay in the API answer. */
export const checkNoteLines = (bc) => checkFootLines(bc).filter((l) => l.cls === "note");
const linesHtml = (lines) => lines.map((l) => `<div class="bc-${l.cls}">${esc(l.text)}</div>`).join("");

/** The foot's html: the action lines, one each; "" when there is nothing to say. */
export function checkFootHtml(bc) {
  return linesHtml(checkActionLines(bc));
}

/** The foot's lines for the Out men he put In (slate.his_in_pool, server/slate/out-pool.js): who was brought into the pool, and who could not be and why (G62: said, never a silent hide). Empty with nothing to say. */
export function hisPoolLines(pool) {
  if (!pool || typeof pool !== "object") return [];
  const lines = [];
  if (pool.added?.length) lines.push({ cls: "note", text: `Out men you put In or typed a number on, brought into the player pool from the board row: ${pool.added.map((m) => m.name).join(", ")}` });
  for (const m of pool.unbuildable ?? []) lines.push({ cls: "bad", text: m.typed ? `A number you typed on ${m.name ?? `a man (id ${m.dk_id})`} is kept but cannot be shown, because he is not in the player pool: ${m.why}` : `${m.name ?? `A man (id ${m.dk_id})`} is In by your call but cannot be built with: ${m.why}` });
  for (const t of pool.problems ?? []) lines.push({ cls: "bad", text: `Your In and Out calls were not all read: ${t}` });
  return lines;
}

/** The foot's html for its failure lines; "" when there are none. Its note line (who was brought into the pool) is not on the page. */
export function hisPoolHtml(pool) {
  return linesHtml(hisPoolLines(pool).filter((l) => l.cls !== "note"));
}

/** The foot's lines for TwoGun's Out-list men who could not join the player pool (slate.out_pool.unbuildable, out-pool.js joinOutList; Adam 11-19): one each with why (G62). Empty with none. */
export const outPoolLines = (pool) => (Array.isArray(pool?.unbuildable) ? pool.unbuildable.map((m) => ({ cls: "bad", text: `${m.name ?? "A man"}${m.team ? ` (${m.team})` : ""} is on TwoGun's Out list but not in the player pool: ${m.why}` })) : []);
/** Their html; "" when there are none. */
export const outPoolHtml = (pool) => linesHtml(outPoolLines(pool));
