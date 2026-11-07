// The applied-minutes check, pure: shared by the app's pull comparison (pull-moves.js) and the public site's stand-in for it
// (site-src/shim/pull-moves.js), so both warn on the same teams in the same words. There is no team total to reach (Adam, 11-06): the
// check asks only whether a pull newer than his Apply moved what TwoGun had under a man whose applied number is still on the board.
import { isNum } from "../board/figures.js";

/** Under this many minutes, a change in TwoGun's figure is rounding, not a move. A working value. */
export const BASE_MOVE = 0.05;

/**
 * A warning per team with an applied man whose figures the newest pull moved since the Apply: TwoGun's minutes are not the ones the
 * Apply was made over (`applied.base[id].min`), he is out now and was not then, back now and was out then, or not in the newest pull at
 * all. Only men whose applied number is still on the board count (applied minutes, or a typed projection). An applied record with no
 * base (one written before the base was kept) is not checked. `players`: the board's effective players; `rowMen`: [{ id, team, min, out }]
 * of the newest pull; `applied`: the scenarios file's applied record or null. Applied numbers are never changed here. Pure.
 */
export function appliedMinuteMisses(players, rowMen, applied) {
  if (!applied?.base) return [];
  const byId = new Map(rowMen.map((m) => [String(m.id), m]));
  const board = new Map(players.map((p) => [String(p.dk_id), p]));
  const moved = new Map();
  for (const [id, b] of Object.entries(applied.base)) {
    const p = board.get(id);
    if (!p || !("base_minutes" in p || p.ovr?.projection != null)) continue; // his applied number is no longer on the board
    const m = byId.get(id), name = p.name ?? id;
    let what = null;
    if (!m) what = `${name} (not in the newest pull)`;
    else if (m.out && !b.out) what = `${name} (now out)`;
    else if (!m.out && b.out) what = `${name} (now playing)`;
    else if (!m.out && isNum(m.min) && (!isNum(b.min) || Math.abs(m.min - b.min) > BASE_MOVE)) what = `${name} (TwoGun ${isNum(b.min) ? b.min.toFixed(1) : "none"} to ${m.min.toFixed(1)})`;
    if (what) moved.set(p.team, [...(moved.get(p.team) ?? []), what]);
  }
  return [...moved.keys()].sort().map((team) => `Applied numbers for ${team} sit on figures the newest pull moved since your Apply: ${moved.get(team).join(", ")}. Reopen the console and Apply again.`);
}
