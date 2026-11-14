// What the public site answers where the app reads the box store and runs the board's self-check. Stands in for server/boxes/freshness.js and
// server/slate/board-check-route.js (tools/publish.mjs names which). The box score freshness answer is the one baked with the slate (site.json,
// as of the publish); the self-check is the app's own checkBoard, run here on the board as this visitor sees it (his overrides and the baked lineup read included).
// The foot also carries the lines the bake wrote about what it carried or could not make (site-src/site-doc.js footLines): they ride on the check's `exempt_lines`
// (the foot shows them in the note style, and no head line changes), or on its problem sentence when the check could not run.
import fs, { readRaw } from "./fs.js";
import { dataDir } from "./log.js";
import { footLines } from "../site-doc.js";
import { layerLines } from "../layers.js";
import { checkBoard } from "../../server/slate/board-check.js";
import { readOverrides } from "../../server/slate/overrides.js";
import { readNewsLineups } from "../../server/slate/news-lineups.js";

/** The slate's baked site.json, or null when this page holds none. */
export function siteDoc(slate) {
  const file = `${dataDir()}/slates/${slate}/site.json`;
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : null;
}

let latestBox = null; // the freshness answer of the slate read last: it is the store's, not a slate's
const unknown = (nowMs, why) => ({ checked_at: new Date(nowMs).toISOString(), state: "unknown", ok: false, stale: [], why, season: null });

export const withBoxFreshness = (data, { nowMs = Date.now() } = {}) => {
  const site = data?.slate ? siteDoc(data.slate) : null;
  const box = site?.box_freshness ?? unknown(nowMs, "the box scores were not checked when this slate was published");
  latestBox = box;
  return { ...data, box_freshness: box };
};
export const readBoxFreshness = ({ nowMs = Date.now() } = {}) => latestBox ?? unknown(nowMs, "the box scores were not checked when this site was published");

/** The self-check of a built slate, as server/slate/board-check-route.js runBoardCheck: never throws, a failure to run is itself an answer. */
export function runBoardCheck(slate, built, nowMs) {
  let overrides = null, overridesProblem = null;
  try { overrides = readOverrides(slate); } catch (e) {
    if (!e?.code?.startsWith?.("OVERRIDES_")) throw e;
    overridesProblem = e.message;
  }
  // The baked notes, then a line for each of his files that moved after this visitor's last change (layers.js).
  const lines = [...footLines(siteDoc(slate)), ...["overrides", "scenarios"].flatMap((k) => layerLines(slate, k, readRaw(`${dataDir()}/slates/${slate}/${k}.json`)))];
  try {
    const r = checkBoard({ slate: built, overrides, overridesProblem, lineups: readNewsLineups(slate), nowMs });
    return { ...r, exempt_lines: [...(r.exempt_lines ?? []), ...lines] };
  } catch (e) {
    console.error("board self-check could not run", e);
    return { slate, checked_at: new Date(nowMs).toISOString(), problem: `the board self-check could not run (${e.message})${lines.length ? `. ${lines.join(" ")}` : ""}`, failures: [], conflicts: [], unchecked: [], exempt: [], failure_lines: [], conflict_lines: [], unchecked_lines: [], exempt_lines: [], men: null, ok: false };
  }
}
export const runAndLogOnChange = (slate, built, nowMs) => runBoardCheck(slate, built, nowMs);

/** GET /api/board-check/<slate>: the check on the slate as shown now. */
export async function handleBoardCheck(req, res, slate, { send, fail, build, now }) {
  if (req.method !== "GET") return fail(res, 405, "METHOD", "GET only.");
  const built = await build(res, slate);
  if (!built) return;
  return send(res, 200, runBoardCheck(slate, built, now()));
}
