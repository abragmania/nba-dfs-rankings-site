// The NBA board server: static board page plus a small JSON API for slates, picks, the optimizer and saved lineups.
// Listens on 127.0.0.1 only; PORT from the environment, default 8693. Run: node server/server.js
import http from "../site/shim/http.js";
import { startStandingsWatch } from "../site/shim/app-only.js";
import { startUsageWarm } from "../site/shim/app-only.js";
import fs from "../site/shim/fs.js";
import path from "../site/shim/path.js";
import { fileURLToPath, pathToFileURL } from "../site/shim/url.js";
import { refuseNonJsonPost, refuseCrossSiteRead } from "./lib/origin.js";
import { info, error } from "../site/shim/log.js";
import { checkLogQuery, getPlayerLog, PlayerLogError } from "../site/shim/app-only.js";
import { withSeasonFigures, seasonUsageTable } from "../site/shim/app-only.js";
import { slateRefMs, startedSplit, leftOut } from "./board/lateswap.js";
import { DEFAULT_COUNT } from "./board/slots.js";
import { ONE_GAME_NOTE } from "./lineup/optimize.js";
import { OPTIMIZE_CEILING_MS, APP_MAX_STEPS, ANSWER_START_MS, ANSWER_KEEPALIVE_MS, newJob, runOptimize, keepAnswerOpen, partialResult } from "./lineup/build-run.js";

export const LATE_ONE_GAME_NOTE = "Only one game left unstarted; DraftKings needs players from at least two games, so pin or keep a started man.";
import {
  SLATE_NAME, MAX_SAVED, listSlates, readSlate, readPicks, checkPicks, savePicks, readLineups, checkLineupBody, addLineups, removeLineup, idsRemovedWith,
  checkWorking, readWorking, saveWorking,
} from "./slate/store.js";
import { readSpots, readSpotsShown, writeSpots, checkSpotsBody, applySpots, vacateSpots } from "./slate/spots.js";
import { readSaved } from "./slate/lateswap-store.js";
import { heldSpotNames } from "./lateswap/maps.js";
import { readBuilds, writeBuilds, checkBuildsBody, applyBuilds } from "./slate/builds.js";
import { readOverrides, writeOverrides, checkChanges, applyChanges, resetPlayer, resetAll, mergeOverrides, publicOverrides } from "./slate/overrides.js";
import { consoleHandler } from "./slate/console-route.js";
import { depthHandler } from "./slate/depth-store.js";
import { readNewsLineups } from "./slate/news-lineups.js";
import { withUsualMinutes } from "../site/shim/app-only.js";
import { withOurMinutes } from "./slate/our-minutes.js";
import { pullStamp, withPullMoves } from "../site/shim/pull-moves.js";
import { lateswapHandler } from "./slate/lateswap-route.js";

const BOARD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "board");
const MAX_BODY = 64 * 1024;
// A kept build of 150 lineups measured about 36 KB on the 2026-11-07 slate; a bigger slate's skipped list can pass 64 KB, so the
// builds route alone takes more. checkBuild (slate/builds.js) still bounds every part of it.
const MAX_BUILD_BODY = 256 * 1024;
const MAX_SPOTS_BODY = 128 * 1024; // 150 spots in a restore (spots plus expect) come to about 50 KB
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(res, status, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(text);
}
const fail = (res, status, code, message) => send(res, status, { error: { code, message } });

/** Serves a file from server/board. Refuses anything that decodes outside it. */
function serveStatic(res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return fail(res, 400, "BAD_PATH", "Bad path.");
  }
  if (rel === "/") rel = "/index.html";
  if (rel.includes("\0") || rel.includes("\\") || rel.split("/").includes("..")) return fail(res, 400, "BAD_PATH", "Bad path.");
  const file = path.resolve(BOARD_DIR, "." + rel);
  if (file !== BOARD_DIR && !file.startsWith(BOARD_DIR + path.sep)) return fail(res, 400, "BAD_PATH", "Bad path.");
  const type = TYPES[path.extname(file).toLowerCase()];
  let data;
  try {
    if (!type || !fs.statSync(file).isFile()) return fail(res, 404, "NOT_FOUND", "Not found.");
    data = fs.readFileSync(file);
  } catch {
    return fail(res, 404, "NOT_FOUND", "Not found.");
  }
  res.writeHead(200, { "content-type": type, "x-content-type-options": "nosniff", "cache-control": "no-cache" });
  res.end(data);
}

/** Reads the request body up to MAX_BODY bytes; resolves null when it is larger or the client closed before sending it all. */
function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (declared > max) return resolve(null);
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > max) {
        chunks.length = 0;
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(size > max ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("close", () => { if (!req.complete) resolve(null); }); // a dropped upload never leaves the handler waiting
    req.on("error", reject);
  });
}

/**
 * The shared start of a per-slate route: the name check (400), the method (405), a POST's origin and JSON-only guard
 * (403/415), and the slate read (404). Returns the slate data, or null when an answer has already been sent.
 */
function openSlate(req, res, slate, what, { getOk = true } = {}) {
  if (!SLATE_NAME.test(slate)) { fail(res, 400, "BAD_SLATE", "Slate names look like 2026-10-29-main."); return null; }
  if (req.method === "POST") {
    const refused = refuseNonJsonPost(req.headers, `${what} must be sent as application/json.`);
    if (refused) { fail(res, refused.status, refused.code, refused.message); return null; }
  } else if (!(getOk && req.method === "GET")) {
    fail(res, 405, "METHOD", getOk ? "GET or POST only." : "POST only.");
    return null;
  }
  const slateData = readSlate(slate);
  if (!slateData) { fail(res, 404, "NO_SLATE", "No such slate."); return null; }
  return slateData;
}

/** Reads a POST's JSON body (64 KB at most unless the route passes its own limit). Returns { body }, or null when a 413 or 400 has already been sent. */
async function readJson(req, res, max = MAX_BODY) {
  const text = await readBody(req, max);
  if (text === null) {
    if (!req.complete && (req.destroyed || res.destroyed)) return null; // the client is gone: nobody to answer
    res.shouldKeepAlive = false;
    fail(res, 413, "TOO_LARGE", `Body is over ${Math.round(max / 1024)} KB.`);
    return null;
  }
  try {
    return { body: JSON.parse(text) };
  } catch {
    fail(res, 400, "BAD_JSON", "Body is not valid JSON.");
    return null;
  }
}

async function handlePicks(req, res, slate) {
  const slateData = openSlate(req, res, slate, "Picks");
  if (!slateData) return;
  if (req.method === "GET") return send(res, 200, readPicks(slate, slateData));
  const read = await readJson(req, res);
  if (!read) return;
  const checked = checkPicks(read.body, slateData);
  if (!checked.ok) return fail(res, 400, "BAD_PICKS", checked.message);
  send(res, 200, savePicks(slate, checked.locked, checked.excluded));
}

/**
 * The slate's players with Adam's overrides applied (server/slate/overrides.js): the effective projection, value and
 * ownership every reader uses. Returns null after sending a 500 when the overrides file cannot be read (never the base
 * figures in its place: a build or a board on the wrong numbers would be worse than none).
 */
function effectivePlayers(res, slate, slateData) {
  try {
    return mergeOverrides(slateData.players ?? [], readOverrides(slate));
  } catch (e) {
    if (!e?.code?.startsWith?.("OVERRIDES_")) throw e;
    error("overrides unreadable", { slate, message: e.message });
    fail(res, 500, e.code, e.message);
    return null;
  }
}

/** GET { slate, overrides }; POST a change ({ proj, own, bump, stars }), { reset: dk_id } or { resetAll: true }.
 *  A POST answers { overrides, players } with the players' effective figures, so the page redraws from the saved file. */
async function handleOverrides(req, res, slate) {
  const slateData = openSlate(req, res, slate, "Overrides");
  if (!slateData) return;
  const readCurrent = () => {
    try {
      return readOverrides(slate);
    } catch (e) {
      if (!e?.code?.startsWith?.("OVERRIDES_")) throw e;
      error("overrides unreadable", { slate, message: e.message });
      fail(res, 500, e.code, e.message);
      return null;
    }
  };
  if (req.method === "GET") {
    const current = readCurrent();
    return current && send(res, 200, { slate, overrides: publicOverrides(current) });
  }
  const read = await readJson(req, res);
  if (!read) return;
  const checked = checkChanges(read.body, slateData);
  if (!checked.ok) return fail(res, 400, "BAD_OVERRIDE", checked.message);
  // Read the file only now, after the body has arrived: from here to the write nothing awaits, so two overlapping POSTs
  // each apply onto the other's saved result and neither change is lost.
  const current = readCurrent();
  if (!current) return;
  let next;
  try {
    next = checked.kind === "resetAll" ? resetAll(current) : checked.kind === "reset" ? resetPlayer(current, checked.id) : applyChanges(current, checked.changes, slateData.players ?? []);
  } catch (e) {
    if (e?.code !== "BUMP_NO_PROJECTION") throw e;
    return fail(res, 400, e.code, e.message);
  }
  const written = writeOverrides(slate, next);
  send(res, 200, { overrides: publicOverrides(written), players: mergeOverrides(slateData.players ?? [], written) });
}

/** GET the slate's saved lineups; POST { slots, mode } saves one, POST { batch: [{ slots, mode }] } saves many (Save all), each checked
 *  by the one validator and skipped when already saved; POST { remove: id } drops one. */
async function handleLineups(req, res, slate) {
  const slateData = openSlate(req, res, slate, "Lineups");
  if (!slateData) return;
  if (req.method === "GET") return send(res, 200, readLineups(slate, slateData));
  const read = await readJson(req, res);
  if (!read) return;
  const checked = checkLineupBody(read.body, slateData);
  if (!checked.ok) return send(res, 400, { error: { code: "BAD_LINEUP", message: checked.message, reasons: checked.reasons } });
  if (checked.remove !== undefined) {
    // A lineup that holds a spot empties it first (spots are written before the lineup goes), so a failed write leaves both as they were.
    // The lineups file is read and the id checked first, so a missing or unreadable file never costs a spot; if the removal then fails, the spots go back.
    let before;
    try {
      if (!readLineups(slate, slateData).lineups.some((l) => String(l.id) === String(checked.remove))) return fail(res, 404, "NO_LINEUP", "No saved lineup with that id.");
      before = readSpots(slate).spots;
      vacateSpots(slate, idsRemovedWith(slate, checked.remove)); // a hidden copy of the lineup goes with it, so its spot is emptied too, all in one write
    } catch (e) { error("spots could not be updated before a delete", { slate, message: e.message }); return fail(res, 500, "SPOTS_FAILED", "its spots could not be updated, so nothing was deleted."); }
    let out;
    try { out = removeLineup(slate, checked.remove, slateData); } catch (e) {
      error("a saved lineup could not be removed; its spots are put back", { slate, message: e.message });
      try { writeSpots(slate, before); } catch (e2) { error("spots could not be put back after a failed delete", { slate, message: e2.message }); }
      return fail(res, 500, "DELETE_FAILED", "the lineup could not be removed, so nothing was deleted.");
    }
    return out ? send(res, 200, out) : fail(res, 404, "NO_LINEUP", "No saved lineup with that id.");
  }
  // The file is read and written in one step with nothing awaited (store.js addLineups), so overlapping saves cannot both land.
  // The answer is the shown list plus { saved, already }: a lineup with the same mode and men as a saved one is skipped, not saved twice.
  const out = addLineups(slate, checked.items, slateData);
  if (out.over) return fail(res, 400, "TOO_MANY", `At most ${MAX_SAVED} lineups can be saved for one slate; ${out.room} more would fit${out.room === 0 ? " (delete some first)" : `, and this save has more than that`}.`);
  return send(res, 200, out);
}

/** GET the slate's lineup spots (slate/spots.js); POST { assign: { spot, lineup_id, confirmed? } } gives a spot a saved lineup (the
 *  spot's old lineup is simply replaced; a lineup whose only fault is a man off the board needs confirmed: true), POST
 *  { release: spot, lineup_id } empties it (409 when the spot holds another lineup now), POST { remove: spot } drops an empty
 *  spot's name, POST { bulk: { assignments, expect, confirmed } } is Assign in order (all or none; 409 when a spot is not as the
 *  page expected), POST { restore: { spots, expect } } is its Undo (409 when the spots are not as the page last saw them).
 *  Origin and JSON content type are checked by openSlate. */
async function handleSpots(req, res, slate) {
  const slateData = openSlate(req, res, slate, "Spots");
  if (!slateData) return;
  if (req.method === "GET") { // plus the spots the late swap screen holds a lineup for (the uploaded one): Assign in order treats them as held; null when that state cannot be read
    const kept = readSaved(slate);
    return send(res, 200, { ...readSpotsShown(slate), uploaded: !kept.ok ? null : kept.saved ? heldSpotNames(kept.saved.state) : [], entries: kept.ok && kept.saved ? kept.saved.state.entries.length : null });
  }
  const read = await readJson(req, res, MAX_SPOTS_BODY);
  if (!read) return;
  const checked = checkSpotsBody(read.body);
  if (!checked.ok) return fail(res, 400, "BAD_SPOT", checked.message);
  // Read only now, after the body has arrived, so two overlapping POSTs each apply onto the other's saved result.
  const next = applySpots(readSpotsShown(slate).spots, checked, readLineups(slate, slateData).lineups);
  if (!next.ok) return fail(res, next.status, next.code, next.message);
  send(res, 200, writeSpots(slate, next.spots));
}

/** GET the slate's latest build (slate/builds.js); POST { put: build } keeps a build (a new one replaces the last build; one with a
 *  held id is that build after a discard or a swap), POST { remove: id } drops it. Saved lineups are another file and are never
 *  touched. Origin and JSON content type are checked by openSlate. */
async function handleBuilds(req, res, slate) {
  const slateData = openSlate(req, res, slate, "Builds");
  if (!slateData) return;
  if (req.method === "GET") return send(res, 200, readBuilds(slate));
  const read = await readJson(req, res, MAX_BUILD_BODY);
  if (!read) return;
  const checked = checkBuildsBody(read.body);
  if (!checked.ok) return fail(res, 400, "BAD_BUILD", checked.message);
  // Read only now, after the body has arrived, so two overlapping POSTs each apply onto the other's saved result.
  const next = applyBuilds(readBuilds(slate).builds, checked);
  if (!next.ok) return fail(res, next.status, next.code, next.message);
  send(res, 200, writeBuilds(slate, next.builds));
}

// The worker, the limits and the partial answer are in lineup/build-run.js.
const OPTIMIZE_URL = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "lineup", "optimize.js")).href;

/**
 * Sorts an optimize() error: one about the slate file or the saved picks (it names "in this slate file", or the players,
 * locked or excluded lists the server itself passed) is the server's data, not the request; anything else is the mode or
 * the settings the request sent.
 */
export function optimizeErrorKind(message) {
  return /in this slate file\.?$/.test(message) || /^(Players|Locked|Excluded) /.test(message) ? "slate" : "settings";
}

/** GET the slate's working lineup; POST { slots: 8 entries, a player id or null each } saves it (server/slate/store.js). */
async function handleWorking(req, res, slate) {
  const slateData = openSlate(req, res, slate, "The working lineup");
  if (!slateData) return;
  if (req.method === "GET") return send(res, 200, readWorking(slate, slateData));
  const read = await readJson(req, res);
  if (!read) return;
  const checked = checkWorking(read.body, slateData);
  if (!checked.ok) return fail(res, 400, "BAD_WORKING", checked.message);
  send(res, 200, saveWorking(slate, checked.slots));
}

/** POST { mode, settings, handPicks? }: lineups for the slate's players; locked and excluded come from the saved picks, never the body.
 *  One search at a time per server (409 while one runs), so builds cannot pile up workers. A Stop or the ceiling answers 200
 *  with the finished lineups, a sentence in note and a partial field (lineup/build-run.js). */
async function handleOptimize(req, res, slate, opts) {
  const slateData = openSlate(req, res, slate, "Optimizer settings", { getOk: false });
  if (!slateData) return;
  const read = await readJson(req, res);
  if (!read) return;
  const { body } = read;
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail(res, 400, "BAD_SETTINGS", "Body must be a JSON object.");
  if (body.settings != null && (typeof body.settings !== "object" || Array.isArray(body.settings))) return fail(res, 400, "BAD_SETTINGS", '"settings" must be an object.');
  // The client left while the body was read. (req.destroyed is no sign: a fully read request is destroyed on its own.)
  if (res.destroyed || res.closed || !res.socket || res.socket.destroyed) return;
  // The app has no min salary setting (Adam's ruling, 2026-10-29), though the core still reads one: refused here.
  if (body.settings && "minSalary" in body.settings) return fail(res, 400, "BAD_SETTINGS", "There is no min salary setting.");
  // Late swap (Adam, 2026-10-29): pins are sent only in late swap mode; outside it the build is exactly as before.
  if (body.lateSwap != null && typeof body.lateSwap !== "boolean") return fail(res, 400, "BAD_SETTINGS", '"lateSwap" must be true or false.');
  const lateSwap = body.lateSwap === true;
  const pinned = body.settings?.pinned;
  if (!lateSwap && pinned !== undefined) return fail(res, 400, "BAD_SETTINGS", "Pins are used only in late swap mode.");
  if (lateSwap && pinned != null && (typeof pinned !== "object" || Array.isArray(pinned))) return fail(res, 400, "BAD_SETTINGS", "Pinned must map DraftKings ids to roster slots.");
  if (lateSwap && body.settings && "exposure" in body.settings) return fail(res, 400, "BAD_SETTINGS", "Min % and Max % do not apply in late swap.");
  // The working lineup's hand-picked men (Adam, 5:34 PM ET 2026-10-29): held in every lineup of this build only, outside
  // late swap (which has its own pins). They come from the body as the working lineup's 8 slots (each a player id or null),
  // checked here against the slate; each man is in the lineup and may take any slot his positions allow (Adam, 2:58 PM ET
  // 2026-10-29), so only the ids go to optimize. A saved exclude on a hand-picked man is refused by optimize itself (a 400 below).
  const hand = body.handPicks == null ? { ok: true, slots: [] } : checkWorking({ slots: body.handPicks }, slateData, "Hand-picked");
  if (!hand.ok) return fail(res, 400, "BAD_SETTINGS", hand.message);
  const handIdList = hand.slots.filter((id) => id != null);
  if (lateSwap && handIdList.length) return fail(res, 400, "BAD_SETTINGS", "Hand-picked men are not used in late swap mode; pin them instead.");
  if (opts.build) return fail(res, 409, "BUSY", "Lineups are already being made; try again when that finishes.");
  const picks = readPicks(slate, slateData);
  // Adam's overrides (typed numbers and bumps) are what the build scores, late swap included.
  const players = effectivePlayers(res, slate, slateData);
  if (!players) return;
  let { locked, excluded } = picks, lateOut = null;
  if (lateSwap) {
    // Every started man who is not pinned (so not in the working lineup) is left out, a saved lock among them too.
    const nowMs = opts.now();
    const { started } = startedSplit(players, { nowMs, refMs: slateRefMs(slate) });
    const lo = leftOut({ players, started, pinned: pinned ?? {}, locked });
    const out = new Set(lo.excluded);
    locked = locked.filter((id) => !out.has(id));
    // A pin wins over a saved exclude: the man is in the working lineup, so he stays out of the excluded list and is named.
    const pinIds = new Set(Object.keys(pinned ?? {}));
    const unexcluded = excluded.filter((id) => pinIds.has(id));
    excluded = [...new Set([...excluded, ...lo.excluded])].filter((id) => !pinIds.has(id));
    lateOut = { now_ms: nowMs, dropped_locks: lo.droppedLocks, pinned_not_excluded: unexcluded };
  }
  const settings = { ...body.settings, maxSteps: body.settings?.maxSteps ?? APP_MAX_STEPS };
  const args = { players, mode: body.mode, settings, locked, excluded, handPicked: handIdList };
  const gone = new AbortController();
  res.on("close", () => { if (!res.writableFinished) gone.abort(); });
  const job = newJob(slate);
  opts.build = job;
  const endKeepalive = keepAnswerOpen({ res, job, afterMs: opts.answerStartMs, everyMs: opts.answerKeepaliveMs, setTimer: opts.setTimer });
  let out;
  try {
    out = await runOptimize({ url: opts.optimizeUrl, args, job, timeoutMs: opts.optimizeTimeoutMs, gone: gone.signal, setTimer: opts.setTimer, onEnd: () => { opts.build = null; } });
  } catch (e) {
    error("optimizer failed", { slate, message: e.message, finished_lineups: job.lineups.length });
    // Lineups finished before the failure are whole and stay; only when there are none is the build a failure.
    if (job.lineups.length) return answerBuild(res, slate, { result: partialResult("failed", job, settings.count ?? DEFAULT_COUNT, undefined, args) }, lateOut);
    return answerBuildFail(res, 500, "OPTIMIZER_FAILED", "The optimizer failed on this slate and built nothing. The server log has the details.");
  } finally {
    endKeepalive();
  }
  return answerBuild(res, slate, out, lateOut);
}

/** A build's refusal. Once a long build's 200 has started the status cannot change, so the error goes in the body with its status. */
function answerBuildFail(res, status, code, message) {
  if (!res.headersSent) return fail(res, status, code, message);
  res.end(JSON.stringify({ error: { code, message, status } }));
}

/** A build's answer from runOptimize's outcome. */
function answerBuild(res, slate, out, lateOut) {
  if (out.cancelled) return res.destroy(); // nobody is waiting for this answer
  const err = out.result.error;
  if (err && optimizeErrorKind(err) === "slate") {
    error("optimizer refused the slate file", { slate, message: err });
    return answerBuildFail(res, 500, "BAD_SLATE_FILE", `This slate's file or saved picks cannot be used for a build: ${err}`);
  }
  if (err) return answerBuildFail(res, 400, "BAD_SETTINGS", err);
  if (out.result.partial) info("build ended early", { slate, ...out.result.partial });
  // In late swap the one-game case means the started games took the rest out: say so in those words.
  const body = !lateOut ? out.result : { ...out.result, note: out.result.note === ONE_GAME_NOTE ? LATE_ONE_GAME_NOTE : out.result.note, late_swap: lateOut };
  if (res.headersSent) return res.end(JSON.stringify(body)); // a long build's 200 has started (build-run.js)
  return send(res, 200, body);
}

/** GET: how far this slate's running build has come, { running, done, of } (of is null until the search has started). Polled
 *  by the page during a build. */
function handleBuildProgress(req, res, slate, opts) {
  if (req.method !== "GET") return fail(res, 405, "METHOD", "GET only.");
  const refused = refuseCrossSiteRead(req.headers);
  if (refused) return fail(res, refused.status, refused.code, refused.message);
  if (!SLATE_NAME.test(slate)) return fail(res, 400, "BAD_SLATE", "Slate names look like 2026-10-29-main.");
  const job = opts.build?.slate === slate ? opts.build : null;
  return send(res, 200, job ? { running: true, done: job.done, of: job.of } : { running: false, done: null, of: null });
}

/** POST {}: stops this slate's running build; the build's own request then answers with the lineups finished so far. Answers
 *  { stopped: false } when no build is running on the slate (it had just finished). */
async function handleBuildStop(req, res, slate, opts) {
  if (req.method !== "POST") return fail(res, 405, "METHOD", "POST only.");
  const refused = refuseNonJsonPost(req.headers, "A stop must be sent as application/json.");
  if (refused) return fail(res, refused.status, refused.code, refused.message);
  if (!SLATE_NAME.test(slate)) return fail(res, 400, "BAD_SLATE", "Slate names look like 2026-10-29-main.");
  if (!(await readJson(req, res))) return;
  const job = opts.build?.slate === slate ? opts.build : null;
  if (!job?.stop) return send(res, 200, { stopped: false });
  job.stop();
  return send(res, 200, { stopped: true });
}

/**
 * NBADFS_NOW, the test clock for late swap: unset means the real clock; set, it must be a whole number of milliseconds or an
 * ISO stamp with an offset, else the server refuses to start. Returns { ms } (null when unset) or { error }.
 */
export function readNowSetting(v) {
  if (v == null || v === "") return { ms: null };
  if (/^\d+$/.test(v)) return { ms: Number(v) };
  if (/T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(v) && !Number.isNaN(Date.parse(v))) return { ms: Date.parse(v) };
  return { error: `NBADFS_NOW is "${v}"; it must be milliseconds or an ISO time with an offset, like 2026-10-29T21:00:00-04:00.` };
}

/** GET /api/player-log?name=&team= : all the player's regular-season games this season, newest first, from ESPN (Basketball-Reference as the
 *  fallback). It makes the server fetch from outside sites, so another site's page is refused (403). When the browser
 *  drops the request (the card was closed or swapped), the lookup is told and its queued fetches are skipped. */
async function handlePlayerLog(req, res, url) {
  if (req.method !== "GET") return fail(res, 405, "METHOD", "GET only.");
  const refused = refuseCrossSiteRead(req.headers);
  if (refused) return fail(res, refused.status, refused.code, refused.message);
  const q = checkLogQuery(url.searchParams);
  if (!q.ok) return fail(res, 400, "BAD_QUERY", q.message);
  const gone = new AbortController();
  res.on("close", () => { if (!res.writableFinished) gone.abort(); });
  try {
    // taken: his DK teammates on the newest slate, so a near-name match never lands on a teammate's row (none readable: no near match).
    const { cardTeammates } = await import("../site/shim/app-only.js");
    return send(res, 200, await getPlayerLog(q.name, q.team, { signal: gone.signal, taken: cardTeammates(q.name, q.team) }));
  } catch (e) {
    if (!(e instanceof PlayerLogError)) throw e;
    if (e.cancelled) return res.destroy(); // nobody is waiting for this answer
    error("player log failed", { name: q.name, team: q.team, message: e.message });
    return fail(res, e.status, "NO_LOG", e.message);
  }
}

/** Decodes a path segment; a malformed escape (%E0) comes back as "" so the slate-name check refuses it with 400. */
function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return "";
  }
}

async function route(req, res, opts) {
  const url = new URL(req.url, "http://127.0.0.1");
  const p = url.pathname;
  if (p === "/api/slates") {
    if (req.method !== "GET") return fail(res, 405, "METHOD", "GET only.");
    return send(res, 200, { slates: listSlates() });
  }
  if (p === "/api/player-log") return handlePlayerLog(req, res, url);
  if (p === "/api/now") {
    // The time late swap reads as now: the test clock when one is set, else the real clock.
    if (req.method !== "GET") return fail(res, 405, "METHOD", "GET only.");
    return send(res, 200, { now_ms: opts.now(), injected: opts.injected });
  }
  if (p === "/api/player-usage") return (await import("../site/shim/app-only.js")).handlePlayerUsage(req, res, url, { send, fail, readJson }); // the card's usage data
  if (p === "/api/pull-now") return (await import("../site/shim/app-only.js")).handlePullNow(req, res, { send, fail, readJson, state: opts.pullNow, deps: opts.pullNowDeps }); // the header's Pull now button
  if (p === "/api/pull-status") return (await import("../site/shim/app-only.js")).handlePullStatus(req, res, { send, fail, state: opts.pullNow, deps: opts.pullNowDeps, url }); // the Pull now status block
  const depth = depthHandler(p); // the saved depth charts (slate/depth-store.js)
  if (depth) return depth.handler(req, res, depth.team, { send, fail, readJson, now: opts.now });
  const cons = consoleHandler(p); // the scenario console (slate/console-route.js)
  if (cons) return cons.handler(req, res, safeDecode(cons.encodedSlate), { send, fail, readJson, openSlate, usageTable: opts.usageTable, now: opts.now });
  const lsw = lateswapHandler(p); // the Late swap screen (slate/lateswap-route.js)
  if (lsw) return lsw.handler(req, res, safeDecode(lsw.encodedSlate), { send, fail, readJson, openSlate, effectivePlayers, now: opts.now, injected: opts.injected });
  let m = p.match(/^\/api\/slate\/([^/]+)\/picks$/);
  if (m) return handlePicks(req, res, safeDecode(m[1]));
  m = p.match(/^\/api\/slate\/([^/]+)\/lineups$/);
  if (m) return handleLineups(req, res, safeDecode(m[1]));
  m = p.match(/^\/api\/slate\/([^/]+)\/spots$/);
  if (m) return handleSpots(req, res, safeDecode(m[1]));
  m = p.match(/^\/api\/slate\/([^/]+)\/builds$/);
  if (m) return handleBuilds(req, res, safeDecode(m[1]));
  m = p.match(/^\/api\/slate\/([^/]+)\/working$/);
  if (m) return handleWorking(req, res, safeDecode(m[1]));
  m = p.match(/^\/api\/slate\/([^/]+)\/overrides$/);
  if (m) return handleOverrides(req, res, safeDecode(m[1]));
  m = p.match(/^\/api\/slate\/([^/]+)\/optimize$/);
  if (m) return handleOptimize(req, res, safeDecode(m[1]), opts);
  m = p.match(/^\/api\/slate\/([^/]+)\/optimize\/progress$/);
  if (m) return handleBuildProgress(req, res, safeDecode(m[1]), opts);
  m = p.match(/^\/api\/slate\/([^/]+)\/optimize\/stop$/);
  if (m) return handleBuildStop(req, res, safeDecode(m[1]), opts);
  m = p.match(/^\/api\/slate\/([^/]+)\/news-lineups$/);
  if (m) { // the Monster and RotoWire lineup read (the board's proposals bar); a read-only answer, { state: "ok" | "missing" | "unreadable" }
    if (req.method !== "GET") return fail(res, 405, "METHOD", "GET only.");
    const slate = safeDecode(m[1]);
    if (!SLATE_NAME.test(slate)) return fail(res, 400, "BAD_SLATE", "Slate names look like 2026-10-29-main.");
    const refused = refuseCrossSiteRead(req.headers);
    if (refused) return fail(res, refused.status, refused.code, refused.message);
    return send(res, 200, { ...readNewsLineups(slate), now_ms: opts.now() }); // the server's clock (the test clock when set), so the read's age is judged on the same clock as late swap
  }
  m = p.match(/^\/api\/slate\/([^/]+)\/pull-stamp$/);
  if (m) {
    if (req.method !== "GET") return fail(res, 405, "METHOD", "GET only.");
    const slate = safeDecode(m[1]);
    if (!SLATE_NAME.test(slate)) return fail(res, 400, "BAD_SLATE", "Slate names look like 2026-10-29-main.");
    const refused = refuseCrossSiteRead(req.headers);
    if (refused) return fail(res, refused.status, refused.code, refused.message);
    const stamp = pullStamp(slate, opts.now());
    return stamp ? send(res, 200, stamp) : fail(res, 404, "NO_SLATE", "No such slate.");
  }
  m = p.match(/^\/api\/slate\/([^/]+)$/);
  if (m) {
    if (req.method !== "GET") return fail(res, 405, "METHOD", "GET only.");
    const slate = safeDecode(m[1]);
    if (!SLATE_NAME.test(slate)) return fail(res, 400, "BAD_SLATE", "Slate names look like 2026-10-29-main.");
    const refused = refuseCrossSiteRead(req.headers);
    if (refused) return fail(res, refused.status, refused.code, refused.message);
    const data = readSlate(slate);
    if (!data) return fail(res, 404, "NO_SLATE", "No such slate.");
    const players = effectivePlayers(res, slate, data); // the board shows the effective figures, each with its base
    if (!players) return;
    const usual = withUsualMinutes(slate, { ...data, players }, { nowMs: opts.now() }); // each man's usual minutes, the console's figure
    const merged = withPullMoves(slate, withOurMinutes(slate, usual), { nowMs: opts.now() }); // who the newest pull moved against the one before it
    return send(res, 200, opts.seasonFigures ? await opts.seasonFigures(merged) : merged);
  }
  if (p.startsWith("/api/")) return fail(res, 404, "NOT_FOUND", "Not found.");
  if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "METHOD", "GET only.");
  return serveStatic(res, p);
}

/** optimizeTimeoutMs: the optimizer's safety ceiling (default OPTIMIZE_CEILING_MS). optimizeUrl: the module the worker loads
 *  (default server/lineup/optimize.js); the tests point it at a module that throws or never ends.
 *  answerStartMs, answerKeepaliveMs, setTimer: when a long build's answer starts and is kept alive, and the timer the build's
 *  limits run on (build-run.js); the tests change them so nothing has to wait for real.
 *  seasonFigures: slate -> slate with this season's DK/min and usage attached (usage/board_figures.js); off unless
 *  given, so the tests never reach Basketball-Reference. The app below turns it on.
 *  nowMs: a fixed "now" for late swap (the NBADFS_NOW test clock); null means the real clock.
 *  usageTable: () -> this season's usage table for the console (usage/board_figures.js); off unless given, as seasonFigures is.
 *  pullNowDeps: Pull now's child, git and slate reads (pullnow/route.js defaultDeps when null); the tests inject them. */
export function makeServer({ optimizeTimeoutMs = OPTIMIZE_CEILING_MS, optimizeUrl = OPTIMIZE_URL, seasonFigures = null, nowMs = null, answerStartMs = ANSWER_START_MS, answerKeepaliveMs = ANSWER_KEEPALIVE_MS, setTimer = setTimeout, usageTable = null, pullNowDeps = null } = {}) {
  const opts = { optimizeTimeoutMs, optimizeUrl, answerStartMs, answerKeepaliveMs, setTimer, build: null, seasonFigures, usageTable, now: () => nowMs ?? Date.now(), injected: nowMs != null, pullNow: { running: null }, pullNowDeps };
  return http.createServer((req, res) => {
    route(req, res, opts).catch((e) => {
      error("request failed", { url: req.url, message: e.message });
      // Once the answer has started its status cannot change: the cut connection is what tells the caller it failed.
      if (!res.headersSent) fail(res, 500, "SERVER_ERROR", "The server could not read its data.");
      else res.destroy();
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startStandingsWatch();
  const port = Number(process.env.PORT) || 8693;
  startUsageWarm({ port });
  const now = readNowSetting(process.env.NBADFS_NOW);
  if (now.error) { error(now.error); process.exit(1); }
  // A test clock is for a copy with its own data folder, never for the app on its own port: it would make real upload files from a fake now.
  if (now.ms != null && (!process.env.NBADFS_DATA_DIR || port === 8693)) { error("NBADFS_NOW needs NBADFS_DATA_DIR set and a port other than 8693; not starting."); process.exit(1); }
  if (now.ms != null) info(`Late swap test clock: now is ${new Date(now.ms).toISOString()} (NBADFS_NOW)`);
  makeServer({ seasonFigures: withSeasonFigures, usageTable: seasonUsageTable, nowMs: now.ms }).listen(port, "127.0.0.1", () => info(`NBA board on http://127.0.0.1:${port}`));
}
