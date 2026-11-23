// Adam's saved console work for one slate: data/slates/<slate>/scenarios.json, written atomically, holding per team the saved
// scenarios, pins (role flips among them), hand-out edits and combination tables, and the record of what the last Apply set. A file that cannot be read,
// is not JSON or fails its check throws SCENARIOS_UNREADABLE and is never treated as empty; only no file at all is empty.
import fs from "../../site/shim/fs.js";
import path from "../../site/shim/path.js";
import { dataDir } from "../../site/shim/log.js";
import { writeFileAtomic } from "../../site/shim/atomic.js";
import { keepSlatePrelock } from "./prelock-copy.js";
import { PIN_MAX, SHARE_MAX, COMBO_MAX } from "../board/override-limits.js";
import { EMPTY_RECORD, isNum, isPlain } from "../board/figures.js";
import { FLIP_ROLES, STARTERS } from "../board/console-roles.js";
import { MINUTE_SOURCES } from "../board/depth-chart.js";
import { badTypedStamp } from "../board/typed-aside.js";

export const SCENARIOS_SCHEMA = 1;
const MAX_SAVED_SCENARIOS = 40;
const MAX_KEYS = 200;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const TEAM = /^[A-Z]{2,4}$/;
const PIN_KINDS = ["m", "u", "d", "p", "r"]; // r: his role flips (console-roles.js), the others numbers
const SHARE_KINDS = ["m", "u"];
const RECORD_KEYS = ["saved", "pins", "handouts", "combos", "source", "news", "tonight", "on", "mine", "his_at", "stamps", "whatif_used"]; // whatif_used: the saved what-if whose numbers the news pass put on this team (badWhatifUsed), kept with the pins it wrote so the two are written, put back and merged together (the money review of the Scenario tab, 11-20, finding 2) // his_at: when he last saved this team's work; only his clicks move it (writeScenarios), so a machine rewrite never makes a stale copy look newer // on: the scenario on show when last saved; mine: the men he or the news put Out and the men he put back in // tonight: the Tonight key his work was made on (console-model.js rebases on a newer one) // source: which minutes feed the optimizer (depth-chart.js MINUTE_SOURCES); absent is the default the console inputs name (source_default, from the projection setting). news: below
const NEWS_STATES = ["applied", "undone", "failed", "reverted", "reversed"]; // reverted: taken back with Ctrl+Z (never applied again; applied once more on Ctrl+Y). reversed: a news Out put back by a pressed pull when no source claimed it any more (news-reverse.js); it applies again if a source rules him Out again
const NEWS_KINDS = ["out", "r"];
const NEWS_FIELDS = ["sig", "state", "at", "text", "men", "why"];

/**
 * His stamps on a team (Adam 9:46 AM 11-20, typed-aside.js), kept per scenario as his pins are: { m: { scenario key: { id: { at, role } } } (when he typed a man's minutes there, and the man's role then),
 * r: { scenario key: { id: at } } (when a role flip there was made) }. A record carries them as `stamps`; on disk they sit in the file's top-level `stamps` block by team (writeScenarios), which a copy of
 * the app from before them passes over, so a newer file never fails an older reader; an older file has none and every typed number in it stands (counted). Null when good, else the reason.
 */
function badStamps(st) {
  if (!isPlain(st) || Object.keys(st).some((k) => k !== "m" && k !== "r")) return '"stamps" holds only m and r';
  for (const [k, byKey] of Object.entries(st)) {
    if (!isPlain(byKey) || Object.keys(byKey).length > MAX_SAVED_SCENARIOS * 2) return `The ${k} stamps must be an object keyed by scenario`;
    for (const [key, sec] of Object.entries(byKey)) {
      if (!validKey(key) || !isPlain(sec) || Object.keys(sec).length > MAX_KEYS) return `The ${k} stamps of a scenario must be an object keyed by player id`;
      for (const [id, v] of Object.entries(sec)) {
        if (!ID.test(id)) return `The ${k} stamps have a bad player id`;
        const why = k === "m" ? badTypedStamp(v) : typeof v === "string" && Number.isFinite(Date.parse(v)) ? null : "a flip's stamp is not a time";
        if (why) return `${id}: ${why}`;
      }
    }
  }
  return null;
}

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

/** { id: role } with every id well formed and every role one a flip can hold; null when good, else the reason. */
function badRoles(map) {
  if (!isPlain(map)) return "The role flips must be an object keyed by player id";
  const entries = Object.entries(map);
  if (entries.length > MAX_KEYS) return "The role flips name too many men";
  for (const [id, v] of entries) {
    if (!ID.test(id)) return "The role flips have a bad player id";
    if (!FLIP_ROLES.includes(v)) return `The role for ${id} must be one of ${FLIP_ROLES.join(", ")}`;
  }
  return null;
}

/**
 * The lineup news the console applied by itself (lineup-bar.js, Adam 11-07), keyed by proposal id: { sig (a hash of its news), state ("applied" | "undone" | "failed" | "reverted" | "reversed"), at,
 * text, men: [{ id, kind ("out" | "r") }] (what it moved, so its undo X takes back only that), why (a failure's reason) }. Null when good, else the reason.
 */
const SLATE_PART = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
/** Whether a news key is one the bar makes for this team: "<slate>|<TEAM>|out|<id>" or "<slate>|<TEAM>|starter|<hash>". */
const goodNewsKey = (key, team) => {
  const [slate, t, kind, rest, ...more] = key.split("|");
  if (!SLATE_PART.test(slate ?? "") || (team ? t !== team : !TEAM.test(t ?? "")) || more.length) return false;
  return kind === "out" ? ID.test(rest ?? "") : kind === "starter" && /^[0-9a-z]{1,16}$/.test(rest ?? "");
};
function badNews(news, team) {
  if (!isPlain(news) || Object.keys(news).length > MAX_KEYS) return '"news" must be an object keyed by proposal';
  const text = (v, max) => typeof v === "string" && v.length <= max;
  for (const [key, e] of Object.entries(news)) {
    if (!text(key, 300) || !goodNewsKey(key, team) || !isPlain(e)) return "A news entry's key is not one for this team";
    if (Object.keys(e).some((k) => !NEWS_FIELDS.includes(k))) return "A news entry has an unknown field";
    if (!text(e.sig, 64) || !NEWS_STATES.includes(e.state) || !text(e.text, 600)) return "A news entry has a bad field";
    if (!text(e.at, 40) || !ISO.test(e.at) || Number.isNaN(Date.parse(e.at))) return "A news entry's time is not an ISO time";
    if (e.state === "failed" ? !text(e.why, 600) : e.why !== undefined) return "A news entry has a reason only when it failed";
    // to: what the news set on him (a flip, or "out"); he is the news's only while he is still that (console-marks.js newsOwned).
    if (!Array.isArray(e.men) || e.men.length > 20 || !e.men.every((m) => isPlain(m) && ID.test(m.id ?? "") && NEWS_KINDS.includes(m.kind) && Object.keys(m).every((f) => ["id", "kind", "to", "was", "typed", "bump"].includes(f)) && (m.to === undefined || (m.kind === "out" ? m.to === "out" : FLIP_ROLES.includes(m.to))) && (m.was === undefined || (m.kind === "out" && FLIP_ROLES.includes(m.was))) && (m.typed === undefined || (m.kind === "out" && (m.typed === null || isNum(m.typed)))) && (m.bump === undefined || (m.kind === "out" && isNum(m.bump))))) return "A news entry's men are not well formed";
    if ((e.state === "applied" || e.state === "reverted") && !e.men.length) return "An applied news entry must name the men it moved";
  }
  return null;
}

/**
 * The what-if in use on a team (server/board/whatif-rule.js putOnPins): { id (the what-if's id), name, at (when it went on, ISO), key (the scenario its pins were last seen on), pins: { m, u, d } (each as
 * written) }, or null. Null when good, else the reason.
 */
function badWhatifUsed(u) {
  if (u === null) return null;
  if (!isPlain(u) || Object.keys(u).some((k) => !["id", "name", "at", "key", "pins"].includes(k))) return '"whatif_used" holds only id, name, at, key and pins';
  if (typeof u.id !== "string" || !u.id.length || u.id.length > 820 || typeof u.name !== "string" || u.name.length > 160) return '"whatif_used" needs its id and name';
  if (typeof u.at !== "string" || !ISO.test(u.at) || !validKey(u.key ?? null)) return '"whatif_used" needs a time and a scenario key';
  if (!isPlain(u.pins) || Object.keys(u.pins).some((k) => !["m", "u", "d"].includes(k))) return '"whatif_used" pins hold only m, u and d';
  for (const [k, sec] of Object.entries(u.pins)) { const why = badMap(sec, PIN_MAX[k], `The what-if's ${k} pin`); if (why) return why; }
  return null;
}

/** Null when `rec` is a well-formed team record (filed under `team`, when given), else the reason. Ids need not be on the team now: a pin outlives a new pull. */
export function badRecord(rec, team = null) {
  if (!isPlain(rec)) return "A team record must be an object.";
  const unknown = Object.keys(rec).filter((k) => !RECORD_KEYS.includes(k));
  if (unknown.length) return `Unknown field: ${unknown[0].slice(0, 20)}.`;
  if (rec.his_at !== undefined && !(typeof rec.his_at === "string" && Number.isFinite(Date.parse(rec.his_at)))) return '"his_at" must be a time.';
  if (rec.source !== undefined && !MINUTE_SOURCES.includes(rec.source)) return `"source" must be one of ${MINUTE_SOURCES.join(", ")}.`;
  if (rec.tonight !== undefined && !validKey(rec.tonight)) return '"tonight" must be a scenario key.';
  if (rec.on !== undefined && !validKey(rec.on)) return '"on" must be a scenario key.';
  if (rec.mine !== undefined && !(isPlain(rec.mine) && Object.keys(rec.mine).every((k) => k === "out" || k === "in") && ["out", "in"].every((k) => Array.isArray(rec.mine[k]) && rec.mine[k].length <= MAX_KEYS && rec.mine[k].every((id) => typeof id === "string" && ID.test(id))))) return '"mine" must list the men out and in by id.';
  if (rec.news !== undefined) { const why = badNews(rec.news, team); if (why) return `${why}.`; }
  if (rec.stamps !== undefined) { const why = badStamps(rec.stamps); if (why) return `${why}.`; }
  if (rec.whatif_used !== undefined) { const why = badWhatifUsed(rec.whatif_used); if (why) return `${why}.`; }
  const saved = rec.saved ?? [];
  if (!Array.isArray(saved) || saved.length > MAX_SAVED_SCENARIOS || !saved.every(validKey)) return `"saved" must be up to ${MAX_SAVED_SCENARIOS} scenario keys.`;
  const pins = rec.pins ?? {};
  if (!isPlain(pins) || Object.keys(pins).length > MAX_SAVED_SCENARIOS * 2) return '"pins" must be an object keyed by scenario.';
  for (const [key, p] of Object.entries(pins)) {
    if (!validKey(key)) return "A pin's scenario key is not well formed.";
    if (!isPlain(p)) return "A scenario's pins must be an object.";
    for (const k of Object.keys(p)) {
      if (!PIN_KINDS.includes(k)) return `Unknown pin kind: ${k.slice(0, 20)}.`;
      const why = k === "r" ? badRoles(p.r) : badMap(p[k], PIN_MAX[k], `The ${k} pin`);
      if (why) return `${why}.`;
    }
    const out = new Set(key ? key.split("+") : []);
    if (Object.entries(p.r ?? {}).filter(([id, role]) => role === "starter" && !out.has(id)).length > STARTERS) return `A scenario names more than ${STARTERS} starters.`;
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
  // Each applied key is { key, tonight } (the Tonight it was made on); a record written before 11-07 holds the key alone, still read.
  const goodKey = (k) => validKey(k) || (isPlain(k) && Object.keys(k).every((f) => f === "key" || f === "tonight") && validKey(k.key) && validKey(k.tonight));
  if (a.keys !== undefined && (!isPlain(a.keys) || !Object.entries(a.keys).every(([t, k]) => TEAM.test(t) && goodKey(k)))) return "the applied record's scenario keys are not well formed";
  for (const [id, e] of Object.entries(a.set)) {
    if (!ID.test(id) || !isPlain(e) || !isNum(e.to) || !(e.prev === null || isNum(e.prev))) return "the applied record has a bad entry";
  }
  // base: what TwoGun had under each applied man ({ min, out }); pull: the pull the console read. Records written before 11-06 have neither.
  if (a.base !== undefined) {
    if (!isPlain(a.base)) return "the applied record's base is not well formed";
    for (const [id, b] of Object.entries(a.base)) if (!ID.test(id) || !isPlain(b) || !(b.min === null || isNum(b.min)) || typeof b.out !== "boolean") return "the applied record's base has a bad entry";
  }
  if (a.pull !== undefined && a.pull !== null && typeof a.pull !== "string") return "the applied record's pull is not well formed";
  return null;
}

function badFile(obj) {
  if (!isPlain(obj)) return "it is not an object";
  if (obj.schema !== SCENARIOS_SCHEMA) return `its schema is ${JSON.stringify(obj.schema)}, not ${SCENARIOS_SCHEMA}`;
  if (!isPlain(obj.teams)) return "it has no teams object";
  for (const [t, rec] of Object.entries(obj.teams)) {
    if (!TEAM.test(t)) return "it has a bad team code";
    const why = badRecord(rec, t);
    if (why) return `team ${t}: ${why}`;
  }
  if (obj.stamps !== undefined) {
    if (!isPlain(obj.stamps)) return "its stamps block is not an object";
    for (const [t, st] of Object.entries(obj.stamps)) { const why = TEAM.test(t) ? badStamps(st) : "a bad team code"; if (why) return `team ${t}'s stamps: ${why}`; }
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
  const { stamps, ...rest } = parsed; // each team's stamps go back on its record (badStamps)
  const teams = Object.fromEntries(Object.entries(rest.teams).map(([t, rec]) => [t, isPlain(rec) && isPlain(stamps?.[t]) ? { ...rec, stamps: stamps[t] } : rec]));
  return { ...rest, teams, applied: parsed.applied ?? null };
}

/** The teams the board is held for (R4): those with an Apply recorded (applied.keys) or a lineup-news entry applied. Their stored send numbers come from the console's scenario maths, which only a resend can refresh; the one definition the resend, the board's stale guard and the self-check share. */
export const heldTeams = (file) => new Set([
  ...Object.keys(file?.applied?.keys ?? {}),
  ...Object.entries(file?.teams ?? {}).filter(([, rec]) => Object.values(rec?.news ?? {}).some((e) => e.state === "applied")).map(([t]) => t),
]);

/** The his_at stamps on disk now (the file's and each team's), tolerant of a missing or damaged file: a write that is not his carries them unchanged. */
function hisStampsOnDisk(slate) {
  try { const j = JSON.parse(fs.readFileSync(scenariosFile(slate), "utf8")); return { file: j?.his_at, teams: Object.fromEntries(Object.entries(j?.teams ?? {}).map(([t, r]) => [t, r?.his_at])) }; } catch { return { file: undefined, teams: {} }; }
}

/**
 * Writes the file atomically, stamped. Returns what was written. `his`: the time of his own click (ISO) when this write is his action: it stamps the file's his_at and, with `team`, that team's record; every other write
 * (the server's resend and news apply) carries the his_at stamps unchanged (the record's own, else the ones on disk), so only his clicks move them. The stamp is what the sync judges two computers' copies by (pullnow/resolve.js).
 */
export function writeScenarios(slate, doc, { his = null, team = null } = {}) {
  const was = hisStampsOnDisk(slate), teams = {}, stamps = {};
  for (const [t, rec0] of Object.entries(doc.teams)) {
    const { stamps: st, ...rest } = isPlain(rec0) ? rec0 : {}, base = isPlain(rec0) ? rest : rec0; // a record's stamps go to the top-level block (badStamps)
    if (isPlain(st) && Object.values(st).some((sec) => Object.keys(sec ?? {}).length)) stamps[t] = st;
    const at = his && t === team ? his : base?.his_at ?? was.teams[t];
    teams[t] = at && base && typeof base === "object" ? { ...base, his_at: at } : base;
  }
  const hisAt = his ?? doc.his_at ?? was.file;
  const out = { schema: SCENARIOS_SCHEMA, slate, teams, applied: doc.applied ?? null, ...(hisAt ? { his_at: hisAt } : {}), ...(Object.keys(stamps).length ? { stamps } : {}), updated_at: new Date().toISOString() };
  const why = badFile(out);
  if (why) throw new ScenariosError("SCENARIOS_INVALID", `The scenarios could not be saved: ${why}.`);
  keepSlatePrelock(slate, "scenarios.json"); // the Apply record as it stood at lock, for the back-tests (R5, Adam 11-18)
  writeFileAtomic(scenariosFile(slate), JSON.stringify(out, null, 1) + "\n");
  return out;
}

/** Checks a POST body { team, record } against the slate's teams: { ok, team, record } or { ok: false, message }. */
export function checkTeamBody(body, slateData) {
  if (!isPlain(body)) return { ok: false, message: "Body must be a JSON object." };
  const teams = new Set((slateData.games ?? []).flatMap((g) => [g.away, g.home]));
  if (typeof body.team !== "string" || !teams.has(body.team)) return { ok: false, message: '"team" must be a team on this slate.' };
  const why = badRecord(body.record, body.team);
  if (why) return { ok: false, message: why };
  return { ok: true, team: body.team, record: { ...EMPTY_RECORD(), ...body.record } };
}
