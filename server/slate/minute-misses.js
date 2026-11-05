// The applied-minutes check, pure: shared by the app's pull comparison (pull-moves.js) and the public site's stand-in for it
// (site-src/shim/pull-moves.js), so both warn on the same teams in the same words.
import { isNum } from "../board/figures.js";
import { TEAM_MINUTES, TOTAL_ROUNDING } from "../board/console-engine.js";

/**
 * A warning per team whose applied minutes no longer add to 240 against this pull: effective minutes on the board plus the row's men playing who are not on it, past the console's band.
 * A team with no applied minutes is TwoGun's own and not checked. Applied minutes are never re-fitted here: only his Apply changes them. Pure.
 */
export function appliedMinuteMisses(players, rowMen) {
  const onBoard = new Set(players.map((p) => String(p.dk_id)));
  const teams = [...new Set(players.filter((p) => "base_minutes" in p).map((p) => p.team))].sort();
  const out = [];
  for (const team of teams) {
    const board = players.filter((p) => p.team === team && isNum(p.minutes)).reduce((s, p) => s + p.minutes, 0);
    const off = rowMen.filter((m) => m.team === team && !m.out && !onBoard.has(m.id) && isNum(m.min)).reduce((s, m) => s + m.min, 0);
    const total = board + off;
    if (Math.abs(total - TEAM_MINUTES) > TOTAL_ROUNDING) out.push(`Applied minutes for ${team} now add to ${total.toFixed(1)}, not ${TEAM_MINUTES}, against the newest pull. Reopen the console and Apply again.`);
  }
  return out;
}
