// Our own minutes on the board: each man's figure from data/slates/<slate>/own-minutes.json (written at every pull by tools/own_minutes.mjs from the minutes engine's three-tier model, Adam 11-12:
// one model for every reader), for the Ours column beside Min on the TwoGun-source board and on the public site. The board's Min stays TwoGun's (or Adam's typed or applied number); this figure is
// shown beside it and feeds nothing else, least of all the optimizer.
// Every player gets min_ours (a number) with min_ours_note saying where it came from, or min_ours: null and a min_ours_note saying why not (RULES R1: missing is shown
// missing with its reason, never zero or TwoGun's number). The slate gets min_source, the source in force for the Min column ("twogun": nothing switches it yet), and min_ours_problem when the record exists but cannot be read.
// A record made by the retired slot/ladder model (format 1 or 2) is not read: every figure is off and the note says why (G62).
// Never throws: an unreadable record leaves every figure off and says why, logs a warning and leaves the board alone.
import fs from "../../site/shim/fs.js";
import path from "../../site/shim/path.js";
import { dataDir, warn } from "../../site/shim/log.js";
import { isNum } from "../board/figures.js";

export const OWN_MINUTES_FORMAT = "nba-own-minutes/3";
export const MIN_SOURCE_IN_FORCE = "twogun";
const NOT_RECORDED = "our own minutes were not recorded for this slate";
const RETIRED = "our record for this slate was made by the retired slot model, so its figures are not shown";
const retiredLine = (slate) => `Our own minutes (the Ours column) for this slate were made by the retired slot model, not shown; record again with node tools/own_minutes.mjs --slate ${slate}`;

/** The slate-level line for a record with gaps (the Data warnings section lists it): the teams whose engine run failed and the men with no figure, counted. null when the record is whole. */
export function recordGaps(doc) {
  const failed = (doc.failed ?? []).map((f) => f.team), noFigure = doc.men.filter((m) => !isNum(m.minutes)).length;
  if (!failed.length && !noFigure) return null;
  const parts = [...(failed.length ? [`the minutes engine failed for ${failed.length} team${failed.length === 1 ? "" : "s"} (${failed.join(", ")}), so their men have no figure`] : []), ...(noFigure ? [`${noFigure} ${noFigure === 1 ? "man has" : "men have"} no minutes figure`] : [])];
  return `Our own minutes (the Ours column) are incomplete for this slate: ${parts.join("; ")}`;
}

const stampOf = (doc) => String(doc?.inputs?.slate_json?.built_from ?? "").split("/").pop() || "an unnamed pull";

/** One man's { min_ours, min_ours_note } from the record's men list (a Map by dk_id); the note always says where the figure came from or why there is none. `team`: his team, to name a team whose engine run failed. */
export function ourFigure(man, doc, team = null) {
  const at = stampOf(doc), failed = (doc.failed ?? []).find((f) => f.team === team);
  if (failed) return { min_ours: null, min_ours_note: `our record of the ${at} pull has no figures for ${team}: the minutes engine failed for it (${failed.why})` };
  if (!man) return { min_ours: null, min_ours_note: `not in our record of the ${at} pull (he was not on that board)` };
  if (!isNum(man.minutes)) return { min_ours: null, min_ours_note: `our record of the ${at} pull has no minutes for him (${man.basis ?? "no reason given"})` };
  return { min_ours: man.minutes, min_ours_note: `Ours: ${man.role ?? "no role"}; ${man.basis ?? "no basis recorded"}. Recorded from the ${at} pull (${doc.mode ?? "mode not recorded"}) by our minutes engine's three-tier model, from box scores, the lineup pages' or TwoGun's five and the depth chart${man.flag ? `. Flag: ${man.flag}` : ""}${doc.machine === "cloud" || /^committed files only/.test(doc.inputs?.engine_inputs ?? "") ? ". Recorded on the cloud runner from committed files only: a man not on the standing chart is placed without season minutes a game" : ""}` };
}

/** The slate with min_ours and min_ours_note on every player and min_source on the slate. */
export function withOurMinutes(slate, slateData) {
  const base = { ...slateData, min_source: slateData.proj_source === "ours" ? "ours" : MIN_SOURCE_IN_FORCE }; // our minutes engine in force: Min is ours and the beside column shows TwoGun's
  const blank = (why) => ({ ...base, players: (slateData.players ?? []).map((p) => ({ ...p, min_ours: null, min_ours_note: why })) });
  const file = path.join(dataDir(), "slates", slate, "own-minutes.json");
  if (!fs.existsSync(file)) return blank(NOT_RECORDED);
  try {
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    if (doc?.format === "nba-own-minutes/1" || doc?.format === "nba-own-minutes/2") return { ...blank(RETIRED), min_ours_problem: retiredLine(slate) };
    if (doc?.format !== OWN_MINUTES_FORMAT || !Array.isArray(doc.men)) throw new Error(`not a known own-minutes record (format ${String(doc?.format).slice(0, 30)})`);
    const by = new Map(doc.men.map((m) => [String(m.dk_id), m]));
    const gaps = recordGaps(doc);
    return { ...base, ...(gaps ? { min_ours_problem: gaps } : {}), players: (slateData.players ?? []).map((p) => ({ ...p, ...ourFigure(by.get(String(p.dk_id)), doc, p.team) })) };
  } catch (e) {
    warn(`board our minutes: ${e.message}`, { slate });
    // A record that cannot be read is a problem (the board lists it under Data warnings); a record not made yet is only quiet.
    return { ...blank("our own minutes could not be read for this slate"), min_ours_problem: `Our own minutes (the Ours column) could not be read for this slate: ${e.message}` };
  }
}
