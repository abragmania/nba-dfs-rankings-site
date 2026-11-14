// The player card's send (applyDirect), with its refusal rule. The console itself has no Apply step: each change sends itself (console-auto.js).
// applyDirect runs in that same line, its check and its send as one step, so a refusal means nothing was sent.
import { planNotesList, previewAndSend, sendTeams } from "./console-auto.js";

export { planNotesList };

/** Refuses, with the reasons, when the preview holds anything back on `team` (the card's own team), since the card cannot show a preview. */
const refuseOn = (team) => (plan) => {
  const notes = planNotesList(plan), mine = notes.filter((n) => n.team === team && !n.note_only);
  if (mine.length) throw Object.assign(new Error(`nothing sent, because on ${team}: ${mine.map((n) => n.text).join("; ")}. Open the console to see it all.`), { notes });
};

/**
 * A send for the player card: the teams the console would send plus the card's own, one preview and its send. Refused before anything is sent when the
 * preview holds anything back on `team`. Otherwise { changed, min_changed, teams (the teams sent), notes (what was held back on other teams) }.
 */
export async function applyDirect(c, team) {
  const res = c.auto ? await c.auto.direct(team, refuseOn(team)) : await previewAndSend(c, sendTeams(c, [team]), refuseOn(team));
  if (!res) return { changed: 0, min_changed: 0, teams: [], notes: [] };
  const notes = planNotesList(res.plan), teams = (res.plan.teams ?? []).filter((t) => t.moves > 0 || t.min_moves > 0).map((t) => t.team);
  if (!res.out) return { changed: 0, min_changed: 0, teams: [], notes };
  return { changed: res.out.changed, min_changed: res.out.min_changed, teams, notes };
}
