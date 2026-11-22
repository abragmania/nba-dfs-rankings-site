// The change log (Adam 6:05 PM 11-21: "a 'Log' tab ... that simply logs every (projection-related) change made"): one append-only file per slate, data/slates/<slate>/change-log.jsonl,
// one JSON line per change { at, team, dk_id, name, kind, mode?, from, to, by, why }. Every writer that moves a man's projection inputs records after its write: the board's effective per-man figures
// (what the Player list shows: minutes, Cash and GPP projection, In or Out, tonight's role) are diffed against the last logged state (change-log-state.json) and every man that moved is logged.
// The writer's own men go under its `by`; a teammate the engine moved after them is "engine" with the cause named; a man on a team the writer could not touch moved between logged steps and is
// "engine" with that said. A man our engine could not judge (it failed, or a tipped team has no saved figures) is never diffed: his state is kept and the tab's foot says why (the review of 11-21).
// A failed write warns and never fails the save (G62: kept and said at the foot). The GET route serves the newest lines first, a bad line skipped and counted, a repeat shown once and counted.
import fs from "../../site/shim/fs.js";
import path from "../../site/shim/path.js";
import { dataDir, warn } from "../../site/shim/log.js";
import { writeFileAtomic } from "../../site/shim/atomic.js";
import { refuseCrossSiteRead } from "../lib/origin.js";
import { SLATE_NAME, readSlate } from "./store.js";
import { readOverrides } from "./overrides.js";
import { mergedFor } from "./effective-players.js";

export const LOG_FILE = "change-log.jsonl";
export const STATE_FILE = "change-log-state.json";
export const BY = Object.freeze(["you", "news", "lineup check", "pull", "engine", "console"]);
export const KINDS = Object.freeze(["out_in", "role", "minutes", "projection", "thumb", "start", "roster"]); // start and roster lines are the foot's, never a table row
export const MOVE_MIN = 0.1; // minutes and DK points: a smaller move is not a change (the board shows one decimal)
export const ROWS_MAX = 2000; // the GET answer's newest lines; the older ones are counted at the foot
export const DRIFT_WHY = "moved between logged steps (a feed re-read, a pull from the other computer or the cloud, or the clock)";
const WHY_MAX = 400;
const ENGINE_FAILED = /^our minutes engine failed for [A-Z]{2,4}: /;

const fileOf = (slate, name, root = dataDir()) => path.join(root, "slates", slate, name);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const cut = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, WHY_MAX);
const problems = new Map(); // slate -> { at, why }: the last write that failed, or the men the engine could not judge, said at the Log tab's foot (G62)
/** Keeps a problem for the slate's Log foot (a failed record, a step that threw). */
export const noteProblem = (slate, why, nowMs = Date.now()) => problems.set(slate, { at: new Date(nowMs).toISOString(), why: cut(why).slice(0, 300) });

/** A row's status: "Out" (our feeds, or his own Out, which stands even on a team no feed can judge), "In", "unknown" (no feed can judge him), or null when the row says nothing. Pure. */
const statusOf = (p) => (p.his === "out" ? "Out" : p.play_unknown === true ? "unknown" : p.ours?.playing === false ? "Out" : p.ours?.playing === true || p.his === "in" ? "In" : null);

/** Why our engine could not judge this row (an engine-wide problem, or his team's engine failure, a tipped team with no saved figures included), or null. Pure. */
const unjudged = (p, wide) => wide ?? (ENGINE_FAILED.test(p.ours?.missing ?? "") ? p.ours.missing : null);

/**
 * The figures logged per man from the board's effective rows (effective-players.js mergedFor): { id: { t, n, min, cash, gpp, play, role, w, x? } }; w is his status words, never compared; x is why
 * the engine could not judge him (his figures are then not diffed). wide: an engine-wide problem (boardRows), or null. Pure.
 */
export function figuresOf(rows, wide = null) {
  const out = {};
  for (const p of rows ?? []) {
    if (p?.dk_id == null) continue;
    const proj = num(p.projection), x = unjudged(p, wide);
    out[String(p.dk_id)] = { t: p.team ?? null, n: p.name ?? null, min: num(p.minutes), cash: p.modes?.Cash ? num(p.modes.Cash.projection) : proj, gpp: p.modes?.GPP ? num(p.modes.GPP.projection) : proj, play: statusOf(p), role: p.role_tonight ?? null, w: p.ours?.marks?.status?.text ?? null, ...(x ? { x } : {}) };
  }
  return out;
}

/** A number moved: both are numbers at least MOVE_MIN apart. A move to or from a missing figure is not a change (the board blanks a figure it cannot make; G62 says so where it shows). Pure. */
const moved = (a, b) => a !== null && b !== null && Math.abs(a - b) >= MOVE_MIN - 1e-9;

/** What moved for one man from `a` to `b` (two figuresOf entries): [{ kind, mode?, from, to, field }]. Pure. */
export function movesOf(a, b) {
  const out = [];
  if (a.play !== b.play && a.play !== null && b.play !== null) out.push({ kind: "out_in", from: a.play, to: b.play, field: "play" });
  if (a.role !== b.role && a.role !== null && b.role !== null) out.push({ kind: "role", from: a.role, to: b.role, field: "role" });
  if (moved(a.min, b.min)) out.push({ kind: "minutes", from: a.min, to: b.min, field: "min" });
  const c = moved(a.cash, b.cash), g = moved(a.gpp, b.gpp);
  if (c && g && a.cash === a.gpp && b.cash === b.gpp) out.push({ kind: "projection", from: a.gpp, to: b.gpp, field: "both" });
  else {
    if (c) out.push({ kind: "projection", mode: "Cash", from: a.cash, to: b.cash, field: "cash" });
    if (g) out.push({ kind: "projection", mode: "GPP", from: a.gpp, to: b.gpp, field: "gpp" });
  }
  return out;
}

/** A man's change in a few words, for the cause his teammates' lines name: "Karl-Anthony Towns Out". Pure. */
const causeWords = (n, mv) => mv.map((m) => (m.kind === "out_in" ? `${n} ${m.to}` : m.kind === "role" ? `${n} to ${m.to}` : m.kind === "minutes" ? `${n} minutes ${m.from} to ${m.to}` : `${n} projection ${m.from} to ${m.to}`))[0];
/** A name or chart key reduced to its letters and digits ("Karl-Anthony Towns", "karl-anthony-towns", "karlanthonytowns" -> "karlanthonytowns"), to match a writer that names men by chart key. Pure. */
export const keyOfName = (n) => String(n ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** The state a man keeps after one record: a field that moved takes the new value; one that did not keeps the logged one, unless the logged one is missing. Pure. */
function keptState(a, b, mv) {
  const kept = { t: b.t, n: b.n, w: b.w };
  for (const f of ["play", "role", "min", "cash", "gpp"]) kept[f] = a[f] === null || a[f] === undefined ? b[f] : a[f];
  for (const m of mv) { if (m.field === "both") { kept.cash = b.cash; kept.gpp = b.gpp; } else kept[m.field] = b[m.field]; }
  return kept;
}

/** The writer's own men: those it named (by id, or by chart key matched to a name). Pure. */
function namedMen(w, next) {
  const subjects = new Map(w.subjects ?? []);
  for (const [k, v] of w.keys ?? []) for (const [id, f] of Object.entries(next)) if (keyOfName(f.n) === keyOfName(k) && !subjects.has(id)) subjects.set(id, v);
  return subjects;
}

/**
 * The lines one record makes, and the state after it. Pure.
 * prev, next: figuresOf answers. w: { at, by, why, subjects (Map id -> { why?, kind? }), keys (Map chart key -> the same), teams (the teams the writer can move; null: every team, undefined: the named men's
 * teams, else every team), allBy (every moved man in scope is the writer's) }. A writer that named its men owns only them; one that named none owns every man in scope whose In/Out or role moved.
 * The other movers in scope are "engine" with the cause named; a man outside scope is "engine" with DRIFT_WHY. A man the engine could not judge (x) keeps his state and is counted in `unjudged`.
 * Returns { lines, men, unjudged: [x], added: [names], gone: [names] }: added, men new to the state (their own base); gone, men the rows no longer hold (their state kept, marked gone, counted once).
 */
export function diffFigures(prev, next, w) {
  const subjects = namedMen(w, next), named = subjects.size > 0;
  const namedTeams = [...subjects.keys()].map((id) => next[id]?.t ?? prev[id]?.t).filter(Boolean);
  const teams = w.teams === null ? null : Array.isArray(w.teams) ? new Set(w.teams) : namedTeams.length ? new Set(namedTeams) : null;
  const inScope = (t) => !teams || teams.has(t);
  const men = {}, all = [], unjudgedWhy = new Set(), added = [], gone = [];
  for (const [id, b] of Object.entries(next)) {
    const a = prev?.[id];
    if (b.x) { unjudgedWhy.add(b.x); if (a) men[id] = { ...a, gone: undefined }; continue; } // not diffed: what the board shows for him is not a judgement
    if (!a) { const { x, ...base } = b; men[id] = base; added.push(b.n ?? id); continue; } // a man new to the state is his own base
    const mv = movesOf(a, b);
    men[id] = keptState(a, b, mv);
    if (mv.length) all.push({ id, b, mv });
  }
  for (const [id, a] of Object.entries(prev ?? {})) if (!next[id]) { men[id] = { ...a, gone: true }; if (!a.gone) gone.push(a.n ?? id); }
  for (const id of Object.keys(men)) if (men[id].gone === undefined) delete men[id].gone;
  if (!w.allBy && !named) for (const x of all) if (inScope(x.b.t) && x.mv.some((m) => m.kind === "out_in" || m.kind === "role")) subjects.set(x.id, {});
  const causeOf = new Map(); // team -> words of the writer's own men on it
  for (const x of all) if (subjects.has(x.id)) causeOf.set(x.b.t, [...(causeOf.get(x.b.t) ?? []), causeWords(x.b.n, x.mv)]);
  const lines = [];
  for (const { id, b, mv } of all) {
    const own = inScope(b.t) && (w.allBy || subjects.has(id)), s = subjects.get(id) ?? {};
    const cause = causeOf.get(b.t)?.slice(0, 3).join(", ");
    const why = !inScope(b.t) ? DRIFT_WHY : own ? cut(`${s.why ?? w.why}`) : cut(`engine re-plan after ${cause ? `${cause} (${w.by}: ${w.why})` : `${w.by}: ${w.why}`}`);
    for (const m of mv) {
      const words = own && m.kind === "out_in" && m.to === "Out" && b.w && !String(why).includes(b.w) ? cut(`${why}: ${b.w}`) : why;
      lines.push({ at: w.at, team: b.t, dk_id: id, name: b.n, kind: own && s.kind && m.kind === "projection" ? s.kind : m.kind, ...(m.mode ? { mode: m.mode } : {}), from: m.from, to: m.to, by: own ? w.by : "engine", why: words });
    }
  }
  return { lines, men, unjudged: [...unjudgedWhy], added, gone };
}

/** The foot's line for men new to the state or gone from the rows, or none. Pure. */
function rosterLine(at, by, added, gone) {
  const list = (a) => `${a.slice(0, 6).join(", ")}${a.length > 6 ? ` and ${a.length - 6} more` : ""}`;
  const parts = [added.length ? `${added.length} ${added.length === 1 ? "man" : "men"} new to the log taken as their own base (${list(added)})` : "", gone.length ? `${gone.length} ${gone.length === 1 ? "man" : "men"} no longer on the board's rows, last figures kept (${list(gone)})` : ""].filter(Boolean);
  return parts.length ? [{ at, team: null, dk_id: null, name: null, kind: "roster", from: added.length, to: gone.length, by, why: cut(parts.join("; ")) }] : [];
}

/** The state file: { since, updated_at, men }, or null when there is none. Throws when it cannot be read. */
export function readState(slate, root = dataDir()) {
  let text;
  try { text = fs.readFileSync(fileOf(slate, STATE_FILE, root), "utf8"); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
  const doc = JSON.parse(text);
  if (!doc || typeof doc !== "object" || !doc.men || typeof doc.men !== "object") throw new Error(`${STATE_FILE} has no men`);
  return doc;
}
/** Whether the slate has a logged state yet (the door's first-record snapshot asks it). */
export const hasState = (slate, root = dataDir()) => fs.existsSync(fileOf(slate, STATE_FILE, root));
const writeState = (slate, doc, root) => writeFileAtomic(fileOf(slate, STATE_FILE, root), `${JSON.stringify(doc)}\n`);
/** Appends lines to the slate's log (only ever appended). */
export function appendLines(slate, lines, root = dataDir()) {
  if (!lines.length) return;
  const file = fileOf(slate, LOG_FILE, root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}
const startLine = (at, by, why) => ({ at, team: null, dk_id: null, name: null, kind: "start", from: null, to: null, by, why: cut(why) });

/**
 * One record after a writer's write. board: { rows, wide } (boardRows: the board's effective rows now, and an engine-wide problem or null). w: as diffFigures. opts.before: figuresOf the board just
 * before the write, for a slate with no state yet (the door snapshots it), so his first change is logged; with neither, only the base is set (a "start" line). An engine-wide problem logs nothing,
 * keeps the state and says why at the foot. Never throws: a failure warns, is kept for the foot, and answers { lines: [], failed }. Lines are appended before the state is written.
 */
export function recordChanges(slate, board, w, { nowMs = Date.now(), root = dataDir(), before = null } = {}) {
  const at = new Date(nowMs).toISOString(), { rows, wide = null } = Array.isArray(board) ? { rows: board } : board;
  try {
    if (!BY.includes(w.by)) throw new Error(`"${w.by}" is not a writer the log knows`);
    if (wide) { noteProblem(slate, `nothing was logged for ${w.by} (${w.why}): our minutes engine could not judge the board (${wide})`, nowMs); return { lines: [], unjudged: [wide] }; }
    const next = figuresOf(rows);
    let st = null, unread = null;
    try { st = readState(slate, root); } catch (e) { unread = e.message; }
    const base = st?.men ?? before;
    if (!base) {
      const { men } = diffFigures({}, next, { ...w, at });
      appendLines(slate, [startLine(at, w.by, unread ? `the logged state could not be read (${unread}); figures as they stood here are the new base` : "logging began: figures as they stood here are the base")], root);
      writeState(slate, { since: at, updated_at: at, men }, root);
      problems.delete(slate);
      return { lines: [], base: true };
    }
    const { lines, men, unjudged: un, added, gone } = diffFigures(base, next, { ...w, at });
    const head = st ? [] : [startLine(at, w.by, unread ? `the logged state could not be read (${unread}); the board as it stood just before this change is the new base` : "logging began: the board as it stood just before this change is the base")];
    appendLines(slate, [...head, ...lines, ...(st ? rosterLine(at, w.by, added, gone) : [])], root);
    if (!st || JSON.stringify(men) !== JSON.stringify(st.men)) writeState(slate, { since: st?.since ?? at, updated_at: at, men }, root);
    if (un.length) noteProblem(slate, `men our minutes engine could not judge were not logged and keep their last logged figures: ${un.slice(0, 3).join("; ")}`, nowMs);
    else problems.delete(slate);
    return { lines, ...(un.length ? { unjudged: un } : {}) };
  } catch (e) {
    warn("change log: a change could not be logged (the save itself stands)", { slate, by: w?.by, error: e.message });
    noteProblem(slate, `${w?.by ?? "a writer"}: ${e.message}`, nowMs);
    return { lines: [], failed: e.message };
  }
}

/**
 * The board's effective rows as the Player list builds them: { rows, wide } with `ourPlayers` (the engine's figures, or none: the slate's own) and Adam's overrides merged; wide: an engine-wide
 * problem (the projection setting unreadable, or the engine not running), else null. Null when there is no slate. Throws on an unreadable overrides file.
 */
export function boardRows(slate, ourPlayers = null) {
  const data = readSlate(slate);
  if (!data) return null;
  const ours = ourPlayers ? ourPlayers(slate, data) : data;
  const wide = ours.proj_source === "unknown" || /^Our minutes engine could not run/.test(ours.proj_problem ?? "") ? ours.proj_problem ?? "the projection source is unknown" : null;
  return { rows: mergedFor(slate, ours.players ?? [], readOverrides(slate)), wide };
}

/** recordChanges on the board as it is now (boardRows). opts.before: the door's snapshot for a slate with no state. Never throws. */
export function recordBoard(slate, w, { ourPlayers = null, nowMs = Date.now(), root = dataDir(), before = null } = {}) {
  let board;
  try { board = boardRows(slate, ourPlayers); } catch (e) {
    warn("change log: the board could not be read to log a change", { slate, by: w?.by, error: e.message });
    noteProblem(slate, `${w?.by ?? "a writer"}: the board could not be read (${e.message})`, nowMs);
    return { lines: [], failed: e.message };
  }
  if (!board) return { lines: [] };
  return recordChanges(slate, board, w, { nowMs, root, before });
}

/** The door's snapshot before a write on a slate with no state yet: figuresOf the board, or null (a state exists, no slate, or the board cannot be read now: the first record then only sets the base). Never throws. */
export function snapshotIfNew(slate, ourPlayers = null, root = dataDir()) {
  try {
    if (hasState(slate, root)) return null;
    const board = boardRows(slate, ourPlayers);
    return board && !board.wide ? figuresOf(board.rows) : null;
  } catch (e) { warn("change log: the board before a first change could not be read; that change sets the base", { slate, error: e.message }); return null; }
}

/** Whether a parsed line is one the tab can show: an object with a readable time, a known kind and writer. Pure. */
const goodLine = (l) => l && typeof l === "object" && !Array.isArray(l) && Number.isFinite(Date.parse(l.at ?? "")) && KINDS.includes(l.kind) && BY.includes(l.by);
const sameKey = (l) => JSON.stringify([l.at, l.dk_id, l.kind, l.mode ?? null, l.from, l.to]);

/**
 * The log's lines from its text, newest first (by time, a later line first on a tie): { rows, bad, repeats }. bad: lines that are not JSON or not a log line; repeats: a line the same as an earlier one
 * (time, man, kind, mode, from and to: a copy brought down from the other computer), shown once. Both counted (G62). Pure.
 */
export function parseLog(text) {
  const rows = [], seen = new Set();
  let bad = 0, repeats = 0;
  String(text ?? "").split("\n").forEach((raw, i) => {
    if (!raw.trim()) return;
    let l;
    try { l = JSON.parse(raw); } catch { bad++; return; }
    if (!goodLine(l)) { bad++; return; }
    const k = sameKey(l);
    if (seen.has(k)) { repeats++; return; }
    seen.add(k);
    rows.push({ ...l, i });
  });
  rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.i - a.i);
  return { rows: rows.map(({ i, ...l }) => l), bad, repeats };
}

/** GET /api/slate/<slate>/change-log: { slate, state: "ok" | "none", rows (the newest ROWS_MAX, newest first), total, older, bad, repeats, write_problem? }. */
export function handleChangeLog(req, res, slate, { send, fail }) {
  if (req.method !== "GET") return fail(res, 405, "METHOD", "GET only.");
  if (!SLATE_NAME.test(slate)) return fail(res, 400, "BAD_SLATE", "Slate names look like 2026-10-29-main.");
  const refused = refuseCrossSiteRead(req.headers);
  if (refused) return fail(res, refused.status, refused.code, refused.message);
  if (!fs.existsSync(fileOf(slate, "slate.json"))) return fail(res, 404, "NO_SLATE", "No such slate.");
  let text;
  try { text = fs.readFileSync(fileOf(slate, LOG_FILE), "utf8"); } catch (e) {
    if (e.code !== "ENOENT") return fail(res, 500, "CHANGE_LOG_UNREADABLE", `The change log could not be read: ${e.message}`);
    text = null;
  }
  const { rows, bad, repeats } = parseLog(text);
  const marks = rows.filter((r) => r.kind === "start" || r.kind === "roster"), lines = rows.filter((r) => r.kind !== "start" && r.kind !== "roster"); // the foot's lines always go, whatever the cap
  const problem = problems.get(slate);
  return send(res, 200, { slate, state: text === null ? "none" : "ok", rows: [...lines.slice(0, ROWS_MAX), ...marks], total: lines.length, older: Math.max(0, lines.length - ROWS_MAX), bad, repeats, ...(problem ? { write_problem: problem } : {}) });
}
