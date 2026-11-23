// Adam's saved what-ifs for one slate (the Scenario tab, Adam 11-19 4:51-5:15 PM ET; 1:37-1:38 PM 11-20): data/slates/<slate>/whatifs.json, written atomically, his fields only. Per team
// { his_at (his last click on that team's what-ifs), whatifs: [{ id (whatif-model.js whatifId: the men he picked to sit, and its starters after "^"), name, outs (every man he picked to sit: each is
// a condition), names, starts, edits: { m, u, d } (Console pin limits; none on its own sitters), stamps: { m: { id: { at, role } } }, armed, saved_at, base: { outs (the board's Outs it was built on),
// pull } }] }. Any number may be armed; a team keeps its record (empty list, stamp) when its last what-if goes, so the per-team merge of two computers' copies (pullnow/resolve.js mergeEdits) never
// brings a dropped one back. What the server did with them is not here: the one in use rides on the team's scenarios.json record beside its pins (scenarios.js whatif_used), and the server's last
// words per what-if are the derived whatif-status.json. A file that cannot be read, is not JSON or fails its check throws WHATIFS_UNREADABLE and is never treated as empty; only no file is empty.
import fs from "../../site/shim/fs.js";
import path from "../../site/shim/path.js";
import { dataDir, warn } from "../../site/shim/log.js";
import { writeFileAtomic } from "../../site/shim/atomic.js";
import { isNum, isPlain } from "../board/figures.js";
import { PIN_MAX } from "../board/override-limits.js";
import { badTypedStamp } from "../board/typed-aside.js";
import { EDIT_KINDS, MAX_SITTERS, whatifId } from "../board/whatif-model.js";
import { ARM_STATES } from "../board/whatif-rule.js";

export const WHATIFS_SCHEMA = 1;
const MAX_PER_TEAM = 20;
const MAX_EDITS = 40;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const TEAM = /^[A-Z]{2,4}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const FIELDS = ["id", "name", "outs", "names", "starts", "edits", "stamps", "armed", "saved_at", "base"];

export class WhatifsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export const whatifsFile = (slate) => path.join(dataDir(), "slates", slate, "whatifs.json");
export const statusFile = (slate) => path.join(dataDir(), "slates", slate, "whatif-status.json");
const EMPTY = (slate) => ({ schema: WHATIFS_SCHEMA, slate, teams: {}, updated_at: null });
const isTime = (v) => typeof v === "string" && ISO.test(v) && Number.isFinite(Date.parse(v));
const ids = (v, max) => Array.isArray(v) && v.length <= max && v.every((id) => typeof id === "string" && ID.test(id)) && new Set(v).size === v.length;

/** { m, u, d } of { id: number } inside the Console pin limits; null when good, else the reason. */
function badEdits(e, what) {
  if (!isPlain(e) || Object.keys(e).some((k) => !EDIT_KINDS.includes(k))) return `${what} holds only m, u and d`;
  if (EDIT_KINDS.reduce((n, k) => n + Object.keys(e[k] ?? {}).length, 0) > MAX_EDITS) return `${what} holds too many numbers`;
  for (const k of EDIT_KINDS) {
    if (e[k] === undefined) continue;
    if (!isPlain(e[k])) return `${what} ${k} must be an object keyed by player id`;
    for (const [id, v] of Object.entries(e[k])) if (!ID.test(id) || !isNum(v) || v < 0 || v > PIN_MAX[k]) return `${what} ${k} for ${id.slice(0, 20)} must be a number from 0 to ${PIN_MAX[k]}`;
  }
  return null;
}

/** Null when `w` is a well-formed what-if, else the reason. */
export function badWhatif(w) {
  if (!isPlain(w)) return "a what-if must be an object";
  const unknown = Object.keys(w).filter((k) => !FIELDS.includes(k));
  if (unknown.length) return `unknown field ${unknown[0].slice(0, 20)}`;
  if (!ids(w.outs, MAX_SITTERS) || !w.outs.length) return `its men must be 1 to ${MAX_SITTERS} player ids`;
  if (!ids(w.starts ?? [], 5) || (w.starts ?? []).some((id) => w.outs.includes(id))) return "its starters must be up to 5 player ids, none of them sitting";
  if (w.id !== whatifId(w.outs, w.starts ?? [])) return "its id must be the key of its men";
  if (typeof w.name !== "string" || !w.name.length || w.name.length > 160) return "its name must be text";
  if (!Array.isArray(w.names) || w.names.length !== w.outs.length || !w.names.every((n) => typeof n === "string" && n.length <= 80)) return "its names must name each of its men";
  const why = badEdits(w.edits, "its edits");
  if (why) return why;
  if (EDIT_KINDS.some((k) => Object.keys(w.edits[k] ?? {}).some((id) => w.outs.includes(id)))) return "an edit names one of its own sitters";
  if (w.stamps !== undefined) {
    if (!isPlain(w.stamps) || Object.keys(w.stamps).some((k) => k !== "m") || !isPlain(w.stamps.m ?? {})) return "its stamps hold only m";
    for (const [id, s] of Object.entries(w.stamps.m ?? {})) { const bad = ID.test(id) ? badTypedStamp(s) : "a bad player id"; if (bad) return `its stamp for ${id.slice(0, 20)}: ${bad}`; }
  }
  if (typeof w.armed !== "boolean") return "armed must be true or false";
  if (!isTime(w.saved_at)) return "saved_at must be a time";
  if (!isPlain(w.base) || !ids(w.base.outs, 30) || !(w.base.pull === null || (typeof w.base.pull === "string" && w.base.pull.length <= 80))) return "its base must name the board's Outs and pull";
  return null;
}

function badFile(obj) {
  if (!isPlain(obj)) return "it is not an object";
  if (obj.schema !== WHATIFS_SCHEMA) return `its schema is ${JSON.stringify(obj.schema)}, not ${WHATIFS_SCHEMA}`;
  if (!isPlain(obj.teams)) return "it has no teams object";
  if (obj.his_at !== undefined && !isTime(obj.his_at)) return "his_at is not a time";
  for (const [t, rec] of Object.entries(obj.teams)) {
    if (!TEAM.test(t)) return "it has a bad team code";
    if (!isPlain(rec) || Object.keys(rec).some((k) => k !== "his_at" && k !== "whatifs") || !Array.isArray(rec.whatifs) || rec.whatifs.length > MAX_PER_TEAM) return `team ${t}: { his_at, whatifs: up to ${MAX_PER_TEAM} } expected`;
    if (rec.his_at !== undefined && !isTime(rec.his_at)) return `team ${t}: his_at is not a time`;
    for (const w of rec.whatifs) { const why = badWhatif(w); if (why) return `team ${t}: ${why}`; }
    if (new Set(rec.whatifs.map((w) => w.id)).size !== rec.whatifs.length) return `team ${t}: two what-ifs on the same men`;
  }
  return null;
}

/** The slate's file, or the empty shape when there is none. Anything unreadable throws WHATIFS_UNREADABLE. */
export function readWhatifs(slate) {
  let raw;
  try { raw = fs.readFileSync(whatifsFile(slate), "utf8"); } catch (e) {
    if (e?.code === "ENOENT") return EMPTY(slate);
    throw new WhatifsError("WHATIFS_UNREADABLE", `This slate's what-ifs file could not be read (${e?.message ?? e}).`);
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { throw new WhatifsError("WHATIFS_UNREADABLE", `This slate's what-ifs file is not valid JSON (${e.message}).`); }
  const why = badFile(parsed);
  if (why) throw new WhatifsError("WHATIFS_UNREADABLE", `This slate's what-ifs file is not well formed: ${why}.`);
  return parsed;
}

/** A team's saved what-ifs from a read file ([] when none). Pure. */
export const teamWhatifs = (doc, team) => doc?.teams?.[team]?.whatifs ?? [];

/** Writes the file atomically, checked; only his clicks write it, so `his` (his click's time) stamps the file's his_at. Returns what was written. */
export function writeWhatifs(slate, doc, { his }) {
  const out = { schema: WHATIFS_SCHEMA, slate, teams: doc.teams, his_at: his, updated_at: new Date().toISOString() };
  const why = badFile(out);
  if (why) throw new WhatifsError("WHATIFS_INVALID", `The what-ifs could not be saved: ${why}.`);
  writeFileAtomic(whatifsFile(slate), `${JSON.stringify(out, null, 1)}\n`);
  return out;
}

/** The slate's team codes and each team's player ids, from slate.json: Map team -> Set of ids. */
const rosterOf = (slateData) => {
  const out = new Map();
  for (const g of slateData?.games ?? []) for (const t of [g.away, g.home]) out.set(t, new Set());
  for (const p of slateData?.players ?? []) out.get(p.team)?.add(String(p.dk_id));
  return out;
};

/**
 * His save of one what-if: { ok, team, whatif, stripped } or { ok: false, message }. body: { team, whatif: { outs, names, name, starts, edits, stamps, armed, base } }. Armed unless he turned it off (Adam
 * 1:38 PM 11-20). Every man he picked to sit is kept as a condition, even one Out on the board already (finding 4); its men and every edited man must be on that team in this slate; an edit on one of its
 * own sitters is taken off and counted in `stripped` (finding 6). The id is the key of its men; saved_at is his click's time.
 */
export function checkSave(body, slateData, hisIso) {
  if (!isPlain(body) || !isPlain(body.whatif)) return { ok: false, message: "Body must be { team, whatif }." };
  const roster = rosterOf(slateData), team = body.team, w0 = body.whatif;
  if (typeof team !== "string" || !roster.has(team)) return { ok: false, message: '"team" must be a team on this slate.' };
  const on = roster.get(team), outs = Array.isArray(w0.outs) ? w0.outs.map(String) : null;
  if (!outs || !outs.length || outs.some((id) => !on.has(id))) return { ok: false, message: "Every man the what-if sits must be on that team in this slate." };
  const starts = Array.isArray(w0.starts) ? w0.starts.map(String) : [];
  if (starts.some((id) => !on.has(id))) return { ok: false, message: "Every man the what-if has starting must be on that team in this slate." };
  let stripped = 0;
  const edits = Object.fromEntries(EDIT_KINDS.map((k) => [k, Object.fromEntries(Object.entries(isPlain(w0.edits?.[k]) ? w0.edits[k] : {}).filter(([id]) => { const sit = outs.includes(String(id)); if (sit) stripped++; return !sit; }))]));
  if (EDIT_KINDS.flatMap((k) => Object.keys(edits[k])).some((id) => !on.has(id))) return { ok: false, message: "Every man with an edit must be on that team in this slate." };
  const stamps = { m: Object.fromEntries(Object.entries(isPlain(w0.stamps?.m) ? w0.stamps.m : {}).filter(([id]) => Object.hasOwn(edits.m, id))) };
  const w = { id: whatifId(outs, starts), name: w0.name, outs, names: w0.names, starts, edits, stamps, armed: w0.armed !== false, saved_at: hisIso, base: w0.base };
  const why = badWhatif(w);
  return why ? { ok: false, message: `The what-if is not well formed: ${why}.` } : { ok: true, team, whatif: w, stripped };
}

const withTeam = (doc, team, list, his) => ({ ...doc, teams: { ...doc.teams, [team]: { his_at: his, whatifs: list } } });
/** The team's list with `w` saved in its place (the same men and starters replace it), the team stamped with his click. Pure. */
export function putWhatif(doc, team, w, his) {
  const list = [...teamWhatifs(doc, team)], at = list.findIndex((x) => x.id === w.id);
  if (at >= 0) list[at] = w; else list.push(w);
  return withTeam(doc, team, list, his);
}
/** The team's list with one what-if armed or not, or null when there is no such what-if. Pure. */
export function armWhatif(doc, team, id, armed, his) {
  const list = teamWhatifs(doc, team);
  return list.some((x) => x.id === id) ? withTeam(doc, team, list.map((x) => (x.id === id ? { ...x, armed } : x)), his) : null;
}
/** The team's list without one what-if, or null when there is no such what-if; the team keeps its record and stamp. One in use comes off the board in the send that follows (whatif-arm.js armAndSend). Pure. */
export function dropWhatif(doc, team, id, his) {
  const list = teamWhatifs(doc, team);
  return list.some((x) => x.id === id) ? withTeam(doc, team, list.filter((x) => x.id !== id), his) : null;
}

/** The server's last words per what-if (whatif-arm.js), derived: { updated_at, teams: { TEAM: { id: { at, state, text } } } }. None is empty; a damaged one is { problem }, never empty. */
export function readStatus(slate) {
  let raw;
  try { raw = fs.readFileSync(statusFile(slate), "utf8"); } catch (e) { return e?.code === "ENOENT" ? { updated_at: null, teams: {} } : { problem: `whatif-status.json could not be read (${e?.code ?? e?.message})`, teams: {} }; }
  try { const j = JSON.parse(raw); return isPlain(j) && isPlain(j.teams) ? j : { problem: "whatif-status.json is not well formed", teams: {} }; } catch (e) { return { problem: `whatif-status.json is not valid JSON (${e.message})`, teams: {} }; }
}
/** Saves the server's words; a failed write is a warning, never a stop (the board's numbers are already sent). True when written. */
export function writeStatus(slate, doc) {
  const bad = Object.values(doc.teams ?? {}).flatMap((t) => Object.values(t)).find((v) => !ARM_STATES.includes(v.state));
  if (bad) { warn("what-if status: a bad state was not saved", { slate, state: bad.state }); return false; }
  try { writeFileAtomic(statusFile(slate), `${JSON.stringify(doc, null, 1)}\n`); return true; } catch (e) { warn("what-if status could not be saved", { slate, error: e.message }); return false; }
}

/** The file for the public site's baseline (site-src/bake-site.mjs baselinePart): { state: "none" } | { state: "ok", value } | { state: "bad", why }. publicWhy: the bake's wording of a failure (no paths). */
export function whatifsPart(slate, publicWhy = (msg, e) => `${msg} (${e.message})`) {
  try { return fs.existsSync(whatifsFile(slate)) ? { state: "ok", value: readWhatifs(slate) } : { state: "none" }; } catch (e) { return { state: "bad", why: publicWhy("his saved what-ifs could not be published", e) }; }
}
