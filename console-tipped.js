// A team whose game has started (Adam's ruling of 11-21: no refusal boxes): its Console and player-card controls that would edit it are drawn disabled with a hover saying why, so no save is refused.
// The one tip rule (server/slate/slate-times.js teamCut, which the server applies whole to the inputs' locked and open) on the inputs the page holds: the inputs' own word (whatif-rule.js teamTipped:
// locked and not open when they were read), or the team's own game tip (teamCut's "tip", read the same way, board-util.js tipMs) passed by the page's clock since. Pure; runs in the browser, which is
// served server/board/ only, so slate-times.js is not imported here.
import { teamTipped } from "./whatif-rule.js";
import { slateRefMs, tipMs } from "./board-util.js";

/** The hover on a control of a team whose game has started. */
export const startedWhy = (code) => `${code}'s game has started, so its roles, minutes and depth chart can no longer be changed`;

/** Whether team `code`'s game has started at nowMs: the inputs' word, else its own tip passed (teamCut "tip"), else with no readable tip the slate's lock passed. False with no inputs. inputs: the console
 *  inputs ({ slate, locked, open, games }) or the board's slate.json read ({ slate: its name, games, lock }). Pure. */
export function teamStarted(inputs, code, nowMs = Date.now()) {
  if (!inputs || !code) return false;
  if (teamTipped(inputs, code)) return true;
  const ref = slateRefMs(String(inputs.slate ?? ""));
  if (ref === null) return false;
  const at = (s) => (typeof s === "string" ? tipMs(s, ref + 6 * 3600e3) : NaN), g = (Array.isArray(inputs.games) ? inputs.games : []).find((x) => x?.away === code || x?.home === code);
  const own = at(g?.tip), ms = Number.isFinite(own) ? own : at(inputs.lock); // as slate-times.js teamCut: his game row's tip, else the slate's lock (the board passes slate.json's)
  return Number.isFinite(ms) && nowMs >= ms;
}

/**
 * A chart save the server refused because the team's game has started (MINUTES_LOCKED; a change made before the page knew of the tip): said in one line at the team's foot (c.lockNotes, console.js pageHtml),
 * never a toast or a banner over the work (Adam 11-21). True when it was that refusal and is said; false for any other error, which the caller handles as before. what: "role mark", "depth chart".
 */
export function lockedSay(c, code, what, e) {
  if (e?.code !== "MINUTES_LOCKED") return false;
  (c.lockNotes ??= {})[code] = [`${code}: your ${what} change was not saved: ${e.message}`];
  c.drawBar?.();
  return true;
}

/** The hover text for team `code`'s edit controls now, or null while its game has not started. */
export const offWhy = (inputs, code, nowMs = Date.now()) => (teamStarted(inputs, code, nowMs) ? startedWhy(code) : null);
