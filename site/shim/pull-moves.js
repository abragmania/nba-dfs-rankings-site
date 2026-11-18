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
  return b ? { stamp: b.stamp, news: b.news ?? null } : null;
}

/** The app's check on this visitor's own applied record (his scenarios file in this browser), with the app's helper. An unreadable file is said. */
function appliedMisses(slate, players, men) {
  const file = `${dataDir()}/slates/${slate}/scenarios.json`;
  try {
    const applied = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)).applied ?? null : null;
    return appliedMinuteMisses(players, men, applied);
  } catch (e) {
    return [`Applied numbers could not be checked against the newest pull: ${String(e?.message ?? e).slice(0, 160)}`];
  }
}

/** The slate with the baked pull_changes and each moved man's pull_move, as the app's withPullMoves gives them. */
export function withPullMoves(slate, input) {
  const b = baked(slate);
  if (!b) return { ...input, absence_state: { state: "unknown", why: "the missed-games count was not published with this slate" }, pull_changes: { state: "none", why: "The pull comparison was not published with this slate.", unread_newer: [] } };
  const misses = Array.isArray(b.row_men) ? appliedMisses(slate, input.players ?? [], b.row_men) : [];
  const slateData = misses.length ? { ...input, missing: [...(input.missing ?? []), ...misses] } : input;
  const moves = b.moves ?? {};
  const men = b.rest?.men ?? {}; // the back-to-back marks baked with the pull comparison (back-to-back.js)
  const since = b.status_since ?? {}; // when TwoGun's status for each man last changed (status-since.js), baked
  const mark = (p0) => {
    const p = since[String(p0.dk_id)] != null ? { ...p0, status_since: since[String(p0.dk_id)] } : p0;
    return men[String(p.dk_id)] ? { ...p, rest_b2b2nd: men[String(p.dk_id)][0], rest_plays_tomorrow: men[String(p.dk_id)][1] } : p;
  };
  const ab = b.absence ?? null; // the injured men's missed games baked with the pull comparison (server/boxes/absence.js); a file baked before it holds none
  const absence_state = ab ? { state: ab.state, ...(ab.why ? { why: ab.why } : {}), ...(ab.boxes_through ? { boxes_through: ab.boxes_through } : {}), ...(ab.unread_boxes ? { unread_boxes: ab.unread_boxes } : {}), ...(ab.duplicate_rows ? { duplicate_rows: ab.duplicate_rows } : {}), uncounted: ab.uncounted ?? [] } : { state: "unknown", why: "the missed-games count was not published with this slate" };
  const withAb = (p) => (ab?.men?.[String(p.dk_id)] ? { ...p, absence: ab.men[String(p.dk_id)] } : p);
  const outs = Array.isArray(slateData.out) ? { out: slateData.out.map((o) => (ab?.out?.[`${o.team}|${o.name}`] ? { ...o, absence: ab.out[`${o.team}|${o.name}`] } : o)) } : {};
  return { ...slateData, ...outs, absence_state, rest: { state: b.rest?.state ?? "unknown", ...(b.rest?.why ? { why: b.rest.why } : {}) }, pull_changes: b.pull_changes, players: (slateData.players ?? []).map((p) => withAb(mark(moves[String(p.dk_id)] ? { ...p, pull_move: moves[String(p.dk_id)] } : p))) };
}
