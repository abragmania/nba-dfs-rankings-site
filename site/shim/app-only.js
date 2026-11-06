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
