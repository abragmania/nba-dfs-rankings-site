// Our own minutes on the board: each man's figure from data/slates/<slate>/own-minutes.json (written at every pull by tools/own_minutes.mjs), for the Ours column
// beside Min. The board's Min stays TwoGun's (or Adam's typed or applied number); this figure is shown beside it and feeds nothing else, least of all the optimizer.
// Every player gets min_ours (a number) with min_ours_note saying where it came from, or min_ours: null and a min_ours_note saying why not (RULES R1: missing is shown
// missing with its reason, never zero or TwoGun's number). The slate gets min_source, the source in force for the Min column ("twogun": nothing switches it yet), and min_ours_problem when the record exists but cannot be read.
// Never throws: an unreadable record leaves every figure off and says why, logs a warning and leaves the board alone.
import fs from "../../site/shim/fs.js";
import path from "../../site/shim/path.js";
import { dataDir, warn } from "../../site/shim/log.js";
import { isNum } from "../board/figures.js";

export const OWN_MINUTES_FORMATS = ["nba-own-minutes/1", "nba-own-minutes/2"];
export const MIN_SOURCE_IN_FORCE = "twogun";
const NOT_RECORDED = "our own minutes were not recorded for this slate";

const stampOf = (doc) => String(doc?.inputs?.slate_json?.built_from ?? "").split("/").pop() || "an unnamed pull";

/** One man's { min_ours, min_ours_note } from the record's men list (a Map by dk_id); the note always says where the figure came from or why there is none. */
export function ourFigure(man, doc) {
  const at = stampOf(doc);
  if (!man) return { min_ours: null, min_ours_note: `not in our record of the ${at} pull (he was not on that board)` };
  if (!isNum(man.minutes)) return { min_ours: null, min_ours_note: `our record of the ${at} pull has no minutes for him (${man.basis ?? "no reason given"})` };
  const sources = `Basketball-Reference games${man.chart_role ? ", our depth chart" : ""}, TwoGun's starter flags and out list`;
  return { min_ours: man.minutes, min_ours_note: `Ours: ${man.role}, ${man.basis ?? "no basis recorded"}; recorded from the ${at} pull (${doc.mode ?? "mode not recorded"}). From ${sources}. TwoGun's minutes are not an input except the learned shape of how an Out's minutes are handed out` };
}

/** The slate with min_ours and min_ours_note on every player and min_source on the slate. */
export function withOurMinutes(slate, slateData) {
  const base = { ...slateData, min_source: MIN_SOURCE_IN_FORCE };
  const blank = (why) => ({ ...base, players: (slateData.players ?? []).map((p) => ({ ...p, min_ours: null, min_ours_note: why })) });
  const file = path.join(dataDir(), "slates", slate, "own-minutes.json");
  if (!fs.existsSync(file)) return blank(NOT_RECORDED);
  try {
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!OWN_MINUTES_FORMATS.includes(doc?.format) || !Array.isArray(doc.men)) throw new Error(`not a known own-minutes record (format ${String(doc?.format).slice(0, 30)})`);
    const by = new Map(doc.men.map((m) => [String(m.dk_id), m]));
    return { ...base, players: (slateData.players ?? []).map((p) => ({ ...p, ...ourFigure(by.get(String(p.dk_id)), doc) })) };
  } catch (e) {
    warn(`board our minutes: ${e.message}`, { slate });
    // A record that cannot be read is a problem (the board lists it under Data warnings); a record not made yet is only quiet.
    return { ...blank("our own minutes could not be read for this slate"), min_ours_problem: `Our own minutes (the Ours column) could not be read for this slate: ${e.message}` };
  }
}
