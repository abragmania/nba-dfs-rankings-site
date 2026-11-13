// The board self-check at the foot of the Player list page (G65, G64): never in the main view. All clear is one quiet line; a failure is one plain line each, a conflict between sources its own named line,
// and what could not be checked or was left out is counted and named below. Pure strings (tested in node); board.js owns the element. The answer is slate.board_check (server/slate/board-check.js).
import { esc, isoToEastern } from "./board-util.js";

/** The foot's lines: [{ cls ("ok" | "head" | "bad" | "conflict" | "note"), text }]. Empty when the server gave no answer (the public site). */
export function checkFootLines(bc) {
  if (!bc || typeof bc !== "object") return [];
  if (bc.problem) return [{ cls: "bad", text: `Board self-check: ${bc.problem}` }];
  const time = isoToEastern(bc.checked_at ?? "") ?? "time unknown";
  const fails = bc.failure_lines ?? [], conflicts = bc.conflict_lines ?? [], notes = bc.unchecked_lines ?? [], exempt = bc.exempt_lines ?? [];
  const tail = [...fails.map((text) => ({ cls: "bad", text })), ...conflicts.map((text) => ({ cls: "conflict", text })), ...notes.map((text) => ({ cls: "note", text })), ...exempt.map((text) => ({ cls: "note", text }))];
  if (!fails.length && !conflicts.length && !notes.length) return [{ cls: "ok", text: `Board self-check: all ${bc.men} men pass (${time})` }, ...tail];
  const head = fails.length ? `Board self-check: ${fails.length} ${fails.length === 1 ? "figure does" : "figures do"} not follow from its inputs` : `Board self-check: no failures in ${bc.men} men`;
  return [{ cls: "head", text: `${head}${conflicts.length ? `; ${conflicts.length} for you to settle` : ""} (${time})` }, ...tail];
}

/** The foot's html: a block of one line each; "" when there is nothing to say. */
export function checkFootHtml(bc) {
  const lines = checkFootLines(bc);
  return lines.length ? lines.map((l) => `<div class="bc-${l.cls}">${esc(l.text)}</div>`).join("") : "";
}
