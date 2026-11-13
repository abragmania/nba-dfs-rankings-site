// Stands in on the public site for the app modules that read outside sites, raw pulls or standings files (tools/publish.mjs names which).
// server.js imports them, and never reaches them here: the stand-in answers the card routes from baked files, the app's watchers are
// never started, and buildInputs reads the console's inputs that were baked at publish.
import fs from "./fs.js";
import { dataDir } from "./log.js";

const never = (what) => () => { throw new Error(`${what} runs only in the app on the computer.`); };

export const startStandingsWatch = never("The standings watcher");
export const startUsageWarm = never("The usage warm-up");
export const checkLogQuery = never("The player log lookup");
export const getPlayerLog = never("The player log lookup");
export class PlayerLogError extends Error {}
export const withSeasonFigures = never("The season figures reader");
export const seasonUsageTable = never("The season usage reader");
export const handlePlayerUsage = never("The usage lookup");
export const handlePullStatus = never("The app's pull status (the site's status block reads GitHub and its own baked files, site-src/site-pull.js)");
/** Our minutes engine runs only in the app for now: on the site its routes are unknown paths (404) and the board keeps TwoGun's projections (makeServer is given no ourProjection). */
export const minutesHandler = () => null;
/** The console's Bench+ suggestions read the stored boxes: app only, so on the site the console shows none. */
export const consoleBenchPlus = () => {};
export const withOurProjection = never("Our minutes engine");
export const primeTotals = never("Our minutes engine's totals fetch");
export const startSnapshotRefresh = never("Our minutes engine's snapshot refresh");
/** The box score freshness check reads the stored boxes and the schedule, which the site does not carry: the slate passes through with no box_freshness (the board shows no line),
 *  and the route answers unknown with its reason. */
export const withBoxFreshness = (data) => data;
export const readBoxFreshness = ({ nowMs = Date.now() } = {}) => ({ checked_at: new Date(nowMs).toISOString(), state: "unknown", ok: false, stale: [], why: "the box scores are checked only in the app on the computer", season: null });
/** The board's self-check (G65) checks our engine's figures, which the site does not run: the slate carries no board_check and the route is an unknown path. */
export const runAndLogOnChange = () => undefined;
export const handleBoardCheck = (req, res, slate, { fail }) => fail(res, 404, "NOT_FOUND", "The board self-check runs only in the app on the computer.");
export const handlePullNow = never("The app's Pull now (the site's button asks GitHub's cloud job instead, site-src/site-pull.js)");

/**
 * The board's usual minutes read raw pulls in the app. Here the slate-level half (the pull read, and any line it adds to missing) comes from
 * the baked figures.json's `usual`, applied at the same step as the app's so the missing list keeps the app's order; each man's figure comes
 * with the season figures (static-api.js). With no figures file the slate passes through.
 */
export function withUsualMinutes(slate, slateData) {
  const file = `${dataDir()}/slates/${slate}/figures.json`;
  const usual = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file))?.usual : null;
  if (!usual) return slateData;
  return {
    ...slateData, ...(usual.min_usual_pull ? { min_usual_pull: usual.min_usual_pull } : {}),
    ...(usual.missing?.length ? { missing: [...(slateData.missing ?? []), ...usual.missing] } : {}),
  };
}

/** The console's inputs as baked at publish. A missing file throws, which the console route answers with its own sentence. */
export const buildInputs = (slate) => JSON.parse(fs.readFileSync(`${dataDir()}/slates/${slate}/console-inputs.json`));
