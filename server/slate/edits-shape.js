// The one check of a slate's minutes-edits file (data/slates/<slate>/minutes-edits.json), shared by the Minutes page's store (minutes/store.js) and the reader of his In and Out calls
// (slate/out-pool.js, which is on the public site where server/minutes is not). Pure.
import { isNum, isPlain } from "../board/figures.js";

export const MIN_MAX = 48;
export const RATE_MAX = 3;
const TEAM = /^[A-Z]{2,4}$/, ID = /^\d{1,12}$/, ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;
const LOG_KINDS = ["min", "rate", "out", "in"];

/** Null when `t` is a well-formed team record of tonight's edits, else the reason. */
export function badTeamEdits(t) {
  if (!isPlain(t)) return "a team's edits must be an object";
  for (const [k, max] of [["min", MIN_MAX], ["rate", RATE_MAX]]) {
    if (!isPlain(t[k])) return `"${k}" must be an object keyed by DraftKings id`;
    for (const [id, v] of Object.entries(t[k])) if (!ID.test(id) || !isNum(v) || v < 0 || v > max) return `"${k}" for ${id.slice(0, 20)} must be a number from 0 to ${max}`;
  }
  for (const k of ["out", "in"]) if (!Array.isArray(t[k]) || !t[k].every((id) => ID.test(id)) || new Set(t[k]).size !== t[k].length) return `"${k}" must list DraftKings ids once each`;
  if (t.out.some((id) => t.in.includes(id))) return "a man is both Out and back in";
  if (!Array.isArray(t.log) || !t.log.every((e) => isPlain(e) && LOG_KINDS.includes(e.kind) && ID.test(e.id ?? "") && ISO.test(e.at ?? "") && (e.n === undefined || Number.isInteger(e.n)) && (e.prev === null || isNum(e.prev) || typeof e.prev === "boolean"))) return "the edit log is not well formed";
  return null;
}

/** Null when `d` is a well-formed edits file (schema 1, teams keyed by team code), else the reason. */
export function badEditsFile(d) {
  if (!isPlain(d) || d.schema !== 1 || !isPlain(d.teams)) return "it is not a schema 1 edits file";
  for (const [t, rec] of Object.entries(d.teams)) {
    const why = TEAM.test(t) ? badTeamEdits(rec) : "a bad team code";
    if (why) return `${t}: ${why}`;
  }
  return null;
}
