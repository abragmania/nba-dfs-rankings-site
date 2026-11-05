// server/slate/pull-moves.js for the public site. The app compares the two newest raw pulls, which are never published; site-src/bake.mjs runs
// that comparison at publish and bakes its answer as slates/<slate>/pull-moves.json, which the stand-in (static-api.js) puts in memory before
// the app's handler runs. Only the applied-minutes check is worked here, with the app's own helper, on this visitor's own effective players.
import fs from "./fs.js";
import { dataDir } from "./log.js";
import { appliedMinuteMisses } from "../../server/slate/minute-misses.js";

const bakedFile = (slate) => `${dataDir()}/slates/${slate}/pull-moves.json`;
const baked = (slate) => (fs.existsSync(bakedFile(slate)) ? JSON.parse(fs.readFileSync(bakedFile(slate))) : null);

/** The board's once-a-minute check: the stamp baked at publish (static-api.js reads the file afresh for this route). Null with no slate. */
export function pullStamp(slate) {
  const b = baked(slate);
  return b ? { stamp: b.stamp } : null;
}

/** The slate with the baked pull_changes and each moved man's pull_move, as the app's withPullMoves gives them. */
export function withPullMoves(slate, input) {
  const b = baked(slate);
  if (!b) return { ...input, pull_changes: { state: "none", why: "The pull comparison was not published with this slate.", unread_newer: [] } };
  const misses = Array.isArray(b.row_men) ? appliedMinuteMisses(input.players ?? [], b.row_men) : [];
  const slateData = misses.length ? { ...input, missing: [...(input.missing ?? []), ...misses] } : input;
  const moves = b.moves ?? {};
  return { ...slateData, pull_changes: b.pull_changes, players: (slateData.players ?? []).map((p) => (moves[String(p.dk_id)] ? { ...p, pull_move: moves[String(p.dk_id)] } : p)) };
}
