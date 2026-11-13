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

/** The foot's lines for the Out men he put In (slate.his_in_pool, server/slate/out-pool.js): who was brought into the pool, and who could not be and why (G62: said, never a silent hide). Empty with nothing to say. */
export function hisPoolLines(pool) {
  if (!pool || typeof pool !== "object") return [];
  const lines = [];
  if (pool.added?.length) lines.push({ cls: "note", text: `Out men you put In or typed a number on, brought into the player pool from the board row: ${pool.added.map((m) => m.name).join(", ")}` });
  for (const m of pool.unbuildable ?? []) lines.push({ cls: "bad", text: m.typed ? `A number you typed on ${m.name ?? `a man (id ${m.dk_id})`} is kept but cannot be shown, because he is not in the player pool: ${m.why}` : `${m.name ?? `A man (id ${m.dk_id})`} is In by your call but cannot be built with: ${m.why}` });
  for (const t of pool.problems ?? []) lines.push({ cls: "bad", text: `Your In and Out calls were not all read: ${t}` });
  return lines;
}

/** The foot's html for those lines; "" when there are none. */
export function hisPoolHtml(pool) {
  return hisPoolLines(pool).map((l) => `<div class="bc-${l.cls}">${esc(l.text)}</div>`).join("");
}
