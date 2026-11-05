// Adam's saved console work for one slate: data/slates/<slate>/scenarios.json, written atomically, holding per team the saved
// scenarios, pins, hand-out edits and combination tables, and the record of what the last Apply set. A file that cannot be read,
// is not JSON or fails its check throws SCENARIOS_UNREADABLE and is never treated as empty; only no file at all is empty.
import fs from "../../site/shim/fs.js";
import path from "../../site/shim/path.js";
import { dataDir } from "../../site/shim/log.js";
import { writeFileAtomic } from "../../site/shim/atomic.js";
import { PIN_MAX, SHARE_MAX, COMBO_MAX } from "../board/override-limits.js";
import { EMPTY_RECORD, isNum, isPlain } from "../board/figures.js";

export const SCENARIOS_SCHEMA = 1;
const MAX_SAVED_SCENARIOS = 40;
const MAX_KEYS = 200;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const TEAM = /^[A-Z]{2,4}$/;
const PIN_KINDS = ["m", "u", "d", "p"];
const SHARE_KINDS = ["m", "u"];
const RECORD_KEYS = ["saved", "pins", "handouts", "combos"];

export class ScenariosError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export const validKey = (k) => k === "" || (typeof k === "string" && k.length <= 400 && k.split("+").every((id) => ID.test(id)));

export const scenariosFile = (slate) => path.join(dataDir(), "slates", slate, "scenarios.json");
const EMPTY = () => ({ schema: SCENARIOS_SCHEMA, teams: {}, applied: null, updated_at: null });

/** { id: number } with every id well formed and every number from 0 to `max`; null when good, else the reason. */
function badMap(map, max, what, min = 0) {
  if (!isPlain(map)) return `${what} must be an object keyed by player id`;
  const entries = Object.entries(map);
  if (entries.length > MAX_KEYS) return `${what} names too many men`;
  for (const [id, v] of entries) {
    if (!ID.test(id)) return `${what} has a bad player id`;
    if (!isNum(v) || v < min || v > max) return `${what} for ${id} must be a number from ${min} to ${max}`;
  }
  return null;
}

/** Null when `rec` is a well-formed team record, else the reason. Ids need not be on the team now: a pin outlives a new pull. */
export function badRecord(rec) {
  if (!isPlain(rec)) return "A team record must be an object.";
  const unknown = Object.keys(rec).filter((k) => !RECORD_KEYS.includes(k));
  if (unknown.length) return `Unknown field: ${unknown[0].slice(0, 20)}.`;
  const saved = rec.saved ?? [];
  if (!Array.isArray(saved) || saved.length > MAX_SAVED_SCENARIOS || !saved.every(validKey)) return `"saved" must be up to ${MAX_SAVED_SCENARIOS} scenario keys.`;
  const pins = rec.pins ?? {};
  if (!isPlain(pins) || Object.keys(pins).length > MAX_SAVED_SCENARIOS * 2) return '"pins" must be an object keyed by scenario.';
  for (const [key, p] of Object.entries(pins)) {
    if (!validKey(key)) return "A pin's scenario key is not well formed.";
    if (!isPlain(p)) return "A scenario's pins must be an object.";
    for (const k of Object.keys(p)) {
      if (!PIN_KINDS.includes(k)) return `Unknown pin kind: ${k.slice(0, 20)}.`;
      const why = badMap(p[k], PIN_MAX[k], `The ${k} pin`);
      if (why) return `${why}.`;
    }
  }
  for (const [section, max] of [["handouts", SHARE_MAX], ["combos", COMBO_MAX]]) {
    const sec = rec[section] ?? {};
    if (!isPlain(sec) || Object.keys(sec).length > MAX_KEYS) return `"${section}" must be an object.`;
    for (const [key, v] of Object.entries(sec)) {
      if (!validKey(key) || key === "") return `A ${section} key is not well formed.`;
      if (!isPlain(v)) return `A ${section} entry must be an object.`;
      for (const k of Object.keys(v)) {
        if (!SHARE_KINDS.includes(k)) return `Unknown ${section} kind: ${k.slice(0, 20)}.`;
        const why = badMap(v[k], max, `The ${section} ${k} entry`, section === "combos" ? -max : 0); // a combination's usage may be a loss
        if (why) return `${why}.`;
      }
    }
  }
  return null;
}

function badApplied(a) {
  if (a === null || a === undefined) return null;
  if (!isPlain(a) || typeof a.at !== "string" || !isPlain(a.set)) return "the applied record is not well formed";
  if (a.keys !== undefined && (!isPlain(a.keys) || !Object.entries(a.keys).every(([t, k]) => TEAM.test(t) && validKey(k)))) return "the applied record's scenario keys are not well formed";
  for (const [id, e] of Object.entries(a.set)) {
    if (!ID.test(id) || !isPlain(e) || !isNum(e.to) || !(e.prev === null || isNum(e.prev))) return "the applied record has a bad entry";
  }
  return null;
}

function badFile(obj) {
  if (!isPlain(obj)) return "it is not an object";
  if (obj.schema !== SCENARIOS_SCHEMA) return `its schema is ${JSON.stringify(obj.schema)}, not ${SCENARIOS_SCHEMA}`;
  if (!isPlain(obj.teams)) return "it has no teams object";
  for (const [t, rec] of Object.entries(obj.teams)) {
    if (!TEAM.test(t)) return "it has a bad team code";
    const why = badRecord(rec);
    if (why) return `team ${t}: ${why}`;
  }
  return badApplied(obj.applied);
}

/** The slate's file, or the empty shape when there is none. Anything unreadable throws SCENARIOS_UNREADABLE. */
export function readScenarios(slate) {
  let raw;
  try {
    raw = fs.readFileSync(scenariosFile(slate), "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return EMPTY();
    throw new ScenariosError("SCENARIOS_UNREADABLE", `This slate's scenarios file could not be read (${e?.message ?? e}).`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new ScenariosError("SCENARIOS_UNREADABLE", `This slate's scenarios file is not valid JSON (${e.message}).`);
  }
  const why = badFile(parsed);
  if (why) throw new ScenariosError("SCENARIOS_UNREADABLE", `This slate's scenarios file is not well formed: ${why}.`);
  return { ...parsed, applied: parsed.applied ?? null };
}

/** Writes the file atomically, stamped. Returns what was written. */
export function writeScenarios(slate, doc) {
  const out = { schema: SCENARIOS_SCHEMA, slate, teams: doc.teams, applied: doc.applied ?? null, updated_at: new Date().toISOString() };
  const why = badFile(out);
  if (why) throw new ScenariosError("SCENARIOS_INVALID", `The scenarios could not be saved: ${why}.`);
  writeFileAtomic(scenariosFile(slate), JSON.stringify(out, null, 1) + "\n");
  return out;
}

/** Checks a POST body { team, record } against the slate's teams: { ok, team, record } or { ok: false, message }. */
export function checkTeamBody(body, slateData) {
  if (!isPlain(body)) return { ok: false, message: "Body must be a JSON object." };
  const teams = new Set((slateData.games ?? []).flatMap((g) => [g.away, g.home]));
  if (typeof body.team !== "string" || !teams.has(body.team)) return { ok: false, message: '"team" must be a team on this slate.' };
  const why = badRecord(body.record);
  if (why) return { ok: false, message: why };
  return { ok: true, team: body.team, record: { ...EMPTY_RECORD(), ...body.record } };
}
