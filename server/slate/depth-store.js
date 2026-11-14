// The saved depth charts, one file per team: data/depth/<TEAM>.json, written atomically; the version a save replaces is kept under
// data/depth/history/<TEAM>-<stamp>.json. Routes:
//   GET  /api/depth/<TEAM>   the chart (404 when the team has none)
//   POST /api/depth/<TEAM>   { chart } saves an edited chart: origin and JSON content type checked, the chart checked by badChart
// There is no screen yet; edits come through the POST route and saveChart. On the published site the charts are read-only data.
import fs from "../../site/shim/fs.js";
import path from "../../site/shim/path.js";
import { dataDir } from "../../site/shim/log.js";
import { writeFileAtomic } from "../../site/shim/atomic.js";
import { refuseCrossSiteRead, refuseNonJsonPost } from "../lib/origin.js";
import { badChart } from "../board/depth-chart.js";
import { slateRefMs, tipMs } from "../board/board-util.js";

const TEAM = /^[A-Z]{2,4}$/;
export class DepthError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export const depthDir = (root = dataDir()) => path.join(root, "depth");
export const chartFile = (team, root = dataDir()) => path.join(depthDir(root), `${team}.json`);

/** The team's chart, or null when it has none. A file that cannot be read or fails its check throws DEPTH_UNREADABLE, never reads as empty. */
export const readChart = (team, root = dataDir()) => readChartFile(team, chartFile(team, root));

/** The same for any chart file of `team` (the live one, or a slate's own copy). */
function readChartFile(team, file) {
  if (!TEAM.test(team)) throw new DepthError("DEPTH_BAD_TEAM", "A team code looks like ATL.");
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return null;
    throw new DepthError("DEPTH_UNREADABLE", `${team}'s depth chart could not be read (${e?.message ?? e}).`);
  }
  let chart;
  try {
    chart = JSON.parse(text);
  } catch (e) {
    throw new DepthError("DEPTH_UNREADABLE", `${team}'s depth chart is not valid JSON (${e.message}).`);
  }
  const why = badChart(chart) ?? (chart.team === team ? null : `it is the ${chart.team} chart`);
  if (why) throw new DepthError("DEPTH_UNREADABLE", `${team}'s depth chart is not well formed: ${why}`);
  return chart;
}

export const slateChartFile = (slate, team, root = dataDir()) => path.join(root, "slates", slate, "depth", `${team}.json`);
export const NO_COPY = "no chart was saved for this slate";
const SLATE_DIR = /^\d{4}-\d{2}-\d{2}-/;

/**
 * Whether the slate is locked at `nowMs`: { locked, problem }. The lock is the slate file's own text ("Fri, Nov 6, 6:00 PM CT"), read by the project's one
 * parser (board-util.js tipMs, as the board page and the cycle schedule do) against the slate key's date at Central noon, which settles the year. It fails
 * closed: a lock that is missing, unreadable, or a slate key with no date reads as locked, with `problem` saying so, so only a saved copy is ever read and nothing is written.
 */
export function lockState(lock, slate, nowMs) {
  const ref = slateRefMs(slate);
  const at = ref === null || typeof lock !== "string" ? null : tipMs(lock, ref + 6 * 3600e3);
  if (!Number.isFinite(at) || !Number.isFinite(nowMs)) return { locked: true, problem: `the lock time of ${slate} is missing or unreadable, so it counts as locked and only a saved chart copy is used` };
  return { locked: nowMs >= at, problem: null };
}

/**
 * The charts a slate uses: { charts: { TEAM: chart }, problems: { TEAM: text }, lock_problem }. Nothing is written here, so a console read, an Apply or a bake
 * never changes a chart copy. While the slate is unlocked the live chart (data/depth/<TEAM>.json) is read. Once it is locked (or its lock cannot be read) the
 * slate's own copy (data/slates/<slate>/depth/<TEAM>.json, frozen by freezeSlateCharts before the lock) is read, and a slate with no copy has no chart:
 * problems[TEAM] is NO_COPY, never today's chart. A bad file is a problem named for its team, never a silent gap; a team with no live chart on an unlocked
 * slate is simply absent (the console shows its Ours column as missing).
 */
export function readSlateCharts(slate, teams, { lock = null, nowMs = Date.now(), root = dataDir() } = {}) {
  const charts = {}, problems = {}, state = lockState(lock, slate, nowMs);
  for (const t of teams) {
    try {
      if (!state.locked) {
        const live = readChart(t, root);
        if (live) charts[t] = live;
        continue;
      }
      const own = readChartFile(t, slateChartFile(slate, t, root));
      if (own) charts[t] = own; else problems[t] = NO_COPY;
    } catch (e) {
      problems[t] = e.message;
    }
  }
  return { charts, problems, lock_problem: state.problem };
}

/**
 * The slate's chart copies, written while it is unlocked and never once it is locked or its lock cannot be read. `mode`: "refresh" (the desktop: the copy
 * becomes today's live chart, and a team whose live chart is gone loses its copy, so a deleted chart is no chart and the old copy is never revived) or
 * "create" (the cloud runner: only a missing copy is made, an existing one is never overwritten or removed, so the desktop's copy stays authoritative).
 * Never throws: a chart that cannot be read or a copy that cannot be written is returned as a problem and the live chart is untouched.
 * Returns { written: [TEAM], removed: [TEAM], problems: { TEAM: text }, locked, lock_problem }.
 */
export function freezeSlateCharts(slate, teams, { lock, nowMs = Date.now(), root = dataDir(), mode = "refresh" } = {}) {
  const written = [], removed = [], problems = {}, state = lockState(lock, slate, nowMs);
  if (state.locked) return { written, removed, problems, locked: true, lock_problem: state.problem };
  for (const t of teams) {
    try {
      const copy = slateChartFile(slate, t, root);
      if (mode === "create" && fs.existsSync(copy)) continue;
      const live = readChart(t, root);
      if (live) {
        writeFileAtomic(copy, JSON.stringify(live, null, 1) + "\n");
        written.push(t);
      } else if (mode === "refresh" && fs.existsSync(copy)) {
        fs.rmSync(copy);
        removed.push(t);
      }
    } catch (e) {
      problems[t] = e.message;
    }
  }
  return { written, removed, problems, locked: false, lock_problem: null };
}

/** A slate's own frozen copy of `team`'s chart, read-only: the chart, or null when the slate has no copy. A bad file throws DEPTH_UNREADABLE. */
export const readSlateChartCopy = (slate, team, root = dataDir()) => readChartFile(team, slateChartFile(slate, team, root));

/** The teams a built slate.json carries. */
export const teamsOfSlate = (slateJson) => [...new Set((Array.isArray(slateJson?.games) ? slateJson.games : []).flatMap((g) => [g?.away, g?.home]).filter((t) => typeof t === "string"))];

/** Refreshes `team`'s copy in every unlocked slate that carries the team (a chart saved before the lock reaches the slate it will be played on). Never throws: { refreshed: [slate], problems: [text] }. */
function refreshOpenSlates(team, chart, nowMs, root) {
  const refreshed = [], problems = [];
  let names = [];
  try {
    names = fs.readdirSync(path.join(root, "slates")).filter((n) => SLATE_DIR.test(n));
  } catch (e) {
    if (e?.code !== "ENOENT") problems.push(`the slates folder could not be listed: ${e.message}`); // no slates folder at all is simply no slate to refresh
    return { refreshed, problems };
  }
  for (const slate of names) {
    let json;
    try {
      json = JSON.parse(fs.readFileSync(path.join(root, "slates", slate, "slate.json"), "utf8"));
    } catch (e) {
      if (e?.code !== "ENOENT") problems.push(`${slate}: slate.json could not be read: ${e.message}`); // a folder with no slate.json yet is not a slate
      continue;
    }
    try {
      if (!teamsOfSlate(json).includes(team) || lockState(json.lock, slate, nowMs).locked) continue;
      writeFileAtomic(slateChartFile(slate, team, root), JSON.stringify(chart, null, 1) + "\n");
      refreshed.push(slate);
    } catch (e) {
      problems.push(`${slate}: ${e.message}`); // a failed copy write is always named, whatever its code
    }
  }
  return { refreshed, problems };
}

/** Saves an edited chart for `team`, the old version going to history/, and refreshes its copy in every unlocked slate that carries the team. `at`: the save's ISO time. Returns { saved, kept, copies, copy_problems } (kept: the history file, or null for a first save). */
export function saveChart(team, chart, at, root = dataDir()) {
  if (!TEAM.test(team)) throw new DepthError("DEPTH_BAD_TEAM", "A team code looks like ATL.");
  const why = badChart(chart) ?? (chart.team === team ? null : `the chart is for ${chart.team}, not ${team}`);
  if (why) throw new DepthError("DEPTH_INVALID", why);
  const out = { ...chart, updated_at: at };
  const file = chartFile(team, root);
  let kept = null;
  if (fs.existsSync(file)) {
    kept = path.join(depthDir(root), "history", `${team}-${at.replace(/[:.]/g, "-")}.json`);
    if (fs.existsSync(kept)) throw new DepthError("DEPTH_HISTORY_EXISTS", `A version of ${team} was already kept at ${at}; try again.`);
    writeFileAtomic(kept, fs.readFileSync(file, "utf8"));
  }
  writeFileAtomic(file, JSON.stringify(out, null, 1) + "\n");
  const open = refreshOpenSlates(team, out, Date.parse(at), root);
  return { saved: team, kept, copies: open.refreshed, copy_problems: open.problems };
}

/** The route for a path, or null: { team, handler }. ctx: { send, fail, readJson, now }. */
export function depthHandler(pathname) {
  const m = /^\/api\/depth\/([A-Z]{2,4})$/.exec(pathname);
  if (!m) return null;
  return { team: m[1], handler: handle };
}

async function handle(req, res, team, ctx) {
  if (req.method === "GET") {
    const refused = refuseCrossSiteRead(req.headers);
    if (refused) return ctx.fail(res, refused.status, refused.code, refused.message);
    try {
      const chart = readChart(team);
      return chart ? ctx.send(res, 200, chart) : ctx.fail(res, 404, "NO_DEPTH_CHART", `${team} has no depth chart.`);
    } catch (e) {
      return ctx.fail(res, 500, e.code ?? "DEPTH_UNREADABLE", e.message);
    }
  }
  if (req.method !== "POST") return ctx.fail(res, 405, "METHOD", "GET or POST only.");
  const refused = refuseNonJsonPost(req.headers, "A depth chart must be sent as application/json.");
  if (refused) return ctx.fail(res, refused.status, refused.code, refused.message);
  const read = await ctx.readJson(req, res);
  if (!read) return;
  try {
    ctx.send(res, 200, saveChart(team, read.body?.chart, new Date(ctx.now()).toISOString()));
  } catch (e) {
    if (e instanceof DepthError) return ctx.fail(res, e.code === "DEPTH_INVALID" || e.code === "DEPTH_BAD_TEAM" ? 400 : 500, e.code, e.message);
    throw e;
  }
}
