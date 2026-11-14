// The browser's stand-in for server/slate/status-since.js: the raw pulls are never published, so each man's "TwoGun status last changed" time was worked out at publish time (site-src/bake.mjs) and is laid on the slate
// by shim/pull-moves.js. withStatusSince therefore returns the slate as it is; readStatusSince gives the same baked times (slates/<slate>/pull-moves.json, status_since) to the lineup read's card-status step.
import fs from "./fs.js";
import { dataDir } from "./log.js";

export const withStatusSince = (slate, input) => input;

/** { since, problem }: { dk_id: ms } as baked with the pull comparison, and why it is empty when it could not be read (null when the file is simply not there or holds none). */
export function readStatusSinceChecked(slate) {
  const file = `${dataDir()}/slates/${slate}/pull-moves.json`;
  try {
    if (!fs.existsSync(file)) return { since: {}, problem: null };
    return { since: JSON.parse(fs.readFileSync(file)).status_since ?? {}, problem: null };
  } catch (e) { return { since: {}, problem: `the baked status times could not be read (${String(e?.message ?? e).slice(0, 100)})` }; }
}
export const readStatusSince = (slate) => readStatusSinceChecked(slate).since;
