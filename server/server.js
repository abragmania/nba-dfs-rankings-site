// The NBA board server: static board page plus a small JSON API for slates, picks, the optimizer and saved lineups.
// Listens on 127.0.0.1 only; PORT from the environment, default 8693. Run: node server/server.js
import http from "../site/shim/http.js";
import { startStandingsWatch } from "../site/shim/app-only.js";
import { startUsageWarm } from "../site/shim/app-only.js";
import fs from "../site/shim/fs.js";
import path from "../site/shim/path.js";
import { fileURLToPath, pathToFileURL } from "../site/shim/url.js";
import { routeModule, routeMods, loadRouteModules } from "./route-modules.js";
import { readNowSetting, optimizeErrorKind } from "./server-util.js";
export { readNowSetting, optimizeErrorKind };
import { refuseCrossSiteRead } from "./lib/origin.js";
import { info, warn, error, dataDir } from "../site/shim/log.js";
import { checkLogQuery, getPlayerLog, PlayerLogError } from "../site/shim/app-only.js";
import { logWithStarts } from "../site/shim/app-only.js";

const warnedStarts = new Set(); // box-reading problems already logged, each distinct message once
import { withSeasonFigures, seasonUsageTable } from "../site/shim/app-only.js";
import { OPTIMIZE_CEILING_MS, ANSWER_START_MS, ANSWER_KEEPALIVE_MS } from "./lineup/build-run.js";
import { handleOptimize, handleBuildProgress, handleBuildStop } from "./lineup/build-route.js";
import { handleNo } from "./lineup/no-list.js";
import { send, fail, readJson, openSlate } from "./slate/http-helpers.js";
import { mergedFor, effectivePlayers, withOurs, marksFoot } from "./slate/effective-players.js";

export { LATE_ONE_GAME_NOTE } from "./lineup/build-route.js";
export { mergedFor } from "./slate/effective-players.js";
import {
  SLATE_NAME, MAX_SAVED, listSlates, readSlate, readPicks, PICK_MODES, checkPicks, savePicks, readLineups, checkLineupBody, addLineups, removeLineup, idsRemovedWith,
  checkWorking, readWorking, saveWorking,
} from "./slate/store.js";
import { replacedWords } from "./slate/mode-file.js";
import { readSpots, readSpotsShown, writeSpots, checkSpotsBody, applySpots, vacateSpots } from "./slate/spots.js";
import { readSaved } from "./slate/lateswap-store.js";
import { heldSpotNames } from "./lateswap/maps.js";
import { readBuilds, writeBuilds, checkBuildsBody, applyBuilds } from "./slate/builds.js";
import { readOverrides, writeOverrides, checkChanges, applyChanges, resetPlayer, resetAll, minutesBase, publicOverrides, touchesMarks, NEEDS_MODE, overridesFile } from "./slate/overrides.js";
import { copyAside, replaceUnreadable, markReplaced, replacedMarksWords, marksTrouble } from "./slate/mode-marks.js";
import { consoleHandler } from "./slate/console-route.js";
import { whatifHandler } from "./slate/whatif-route.js";
import { handleResend } from "./slate/resend-route.js";
import { depthHandler } from "./slate/depth-store.js";
import { minutesHandler, consoleBenchPlus } from "../site/shim/app-only.js";
import { withOurProjection, primeTotals, startSnapshotRefresh } from "../site/shim/app-only.js";
import { readNewsLineups } from "./slate/news-lineups.js";
import { withUsualMinutes } from "../site/shim/app-only.js";
import { withOurMinutes } from "./slate/our-minutes.js";
import { pullStamp, withPullMoves } from "../site/shim/pull-moves.js";
import { withRest } from "../site/shim/back-to-back.js";
import { withAbsence } from "../site/shim/absence.js";
import { withBoxFreshness, readBoxFreshness } from "../site/shim/site-data.js";
import { lateswapHandler } from "./slate/lateswap-route.js";
import { runAndLogOnChange, handleBoardCheck } from "../site/shim/site-data.js";
import { handleChangeLog } from "./slate/change-log.js";
import { watchWrite, boardDoor } from "./slate/change-log-hook.js";

const BOARD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "board");
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

/** GET both modes' picks (store.js readPicks), or one mode's with ?mode=Cash|GPP; POST { mode, locked, excluded } sets that mode's lists
 *  only (Adam 11-14, 11-19, 11-20: Cash and GPP keep separate locks and excludes). The answer to a POST is both modes as saved. */
/** GET ?mode= for picks or the working lineup: that mode's, or 500 `code` naming the mode and why when it cannot be read (review 11-20). */
function sendMode(res, all, mode, code, noun) {
  if (!PICK_MODES.includes(mode)) return fail(res, 400, code === "PICKS_UNREADABLE" ? "BAD_PICKS" : "BAD_WORKING", '"mode" must be "Cash" or "GPP".');
  const one = all[mode];
  if (one.unreadable) return fail(res, 500, code, `The ${mode} ${noun} could not be read: ${one.unreadable}.`);
  return send(res, 200, { slate: all.slate, mode, ...one });
}
/** A per-mode save; a failed copy-aside of an unreadable file answers 500 with nothing written (slate/mode-file.js COPY_ASIDE_FAILED). Returns the save's result, or null after answering. */
function saveOr500(res, fn) {
  try { return fn(); } catch (e) {
    if (e?.code !== "COPY_ASIDE_FAILED") throw e;
    error("save refused: the unreadable file could not be copied aside", { message: e.message });
    fail(res, 500, "COPY_ASIDE_FAILED", e.message);
    return null;
  }
}

async function handlePicks(req, res, slate) {
  const slateData = openSlate(req, res, slate, "Picks");
  if (!slateData) return;
  if (req.method === "GET") {
    const mode = new URL(req.url, "http://127.0.0.1").searchParams.get("mode");
    return mode === null ? send(res, 200, readPicks(slate, slateData)) : sendMode(res, readPicks(slate, slateData), mode, "PICKS_UNREADABLE", "locks and excludes");
  }
  const read = await readJson(req, res);
  if (!read) return;
  const checked = checkPicks(read.body, slateData);
  if (!checked.ok) return fail(res, 400, "BAD_PICKS", checked.message);
  // Read only now, after the body has arrived, and written in the same step: only this mode's lists change (store.js savePicks).
  let saved;
  try { saved = saveOr500(res, () => savePicks(slate, checked.mode, checked.locked, checked.excluded, checked.base)); } catch (e) { // an unreadable mode: the old file copied aside, only that mode emptied (slate/mode-file.js)
    if (e?.code !== "CHANGED_ELSEWHERE") throw e;
    return fail(res, 409, "PICKS_CHANGED_ELSEWHERE", `Your ${checked.mode} locks and excludes were saved from another page since this one read them, so this change was not saved over them. The saved ones are shown.`); // base (11-13 audit, state 3): nothing written
  }
  if (!saved) return;
  const { replaced } = saved;
  if (replaced) error("picks file held an unreadable mode; copied aside and replaced by a save", { slate, mode: checked.mode, ...replaced });
  send(res, 200, { ...readPicks(slate, slateData), mode: checked.mode, ...(replaced ? { replaced_unreadable: replacedWords(replaced, "locks and excludes") } : {}) });
}

/** GET { slate, overrides }; POST a change ({ proj, own, bump, stars }), { reset: dk_id } or { resetAll: true }.
 *  A POST answers { overrides, players } with the players' effective figures, so the page redraws from the saved file. */
/** The 409 text while GitHub's data is being brought down, else null: opts.syncBusy is given by the app below (pullnow/sync-flag.js through the lazily loaded pullnow route module); the tests and the public site have none. */
const syncBusyNow = async (opts) => (await opts.syncBusy?.()) ?? null;

async function handleOverrides(req, res, slate, opts) {
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
  const mode = checked.mode, marks = touchesMarks(checked); // a thumb, a star or a reset changes the thumbs and stars of the mode he was on only (Adam 1:24 PM 11-20)
  if (marks && !mode) return fail(res, 400, "BAD_OVERRIDE", NEEDS_MODE);
  const busy = await syncBusyNow(opts); // GitHub's data is coming down: his write waits (409) so it never lands between the set-aside and the put-back; asked before the read, so nothing awaits between the read and the write
  if (busy) return fail(res, 409, "SYNC_RUNNING", busy);
  // Read the file only now, after the body has arrived: from here to the write nothing awaits, so two overlapping POSTs
  // each apply onto the other's saved result and neither change is lost.
  const current = readCurrent();
  if (!current) return;
  // His mode's thumbs and stars could not be read: a reset leaves them as stored; a thumb or star change starts the mode from this change (slate/mode-marks.js).
  // The change is worked out first on the mode started empty, so a change refused (a bad value, nothing to scale) copies nothing aside; only then is the old file copied, then written.
  const why = current.modes?.[mode]?.unreadable, replacing = Boolean(why) && checked.kind === "changes" && marks;
  const from = replacing ? replaceUnreadable(current, mode) : current;
  const base = withOurs(slate, slateData, opts); // the projections a bump scales and the answer shows: ours or TwoGun's, as the board reads them
  let next;
  try {
    next = checked.kind === "resetAll" ? resetAll(from, mode) : checked.kind === "reset" ? resetPlayer(from, checked.id, mode) : applyChanges(from, checked.changes, minutesBase(base.players ?? [], from), mode);
  } catch (e) {
    if (e?.code !== "BUMP_NO_PROJECTION" && e?.code !== "OVERRIDES_INVALID") throw e;
    return fail(res, 400, e.code, e.message);
  }
  const replaced = replacing ? saveOr500(res, () => copyAside(overridesFile(slate), slate, why)) : null; // a failed copy answers 500 and writes nothing
  if (replacing && !replaced) return;
  if (replaced) { error("overrides held an unreadable mode; copied aside and replaced by a change", { slate, mode, ...replaced }); next = markReplaced(next, mode, replaced); }
  // A write that fails after the copy aside leaves that copy in the history folder and answers 500 (the request's own error path): the file on disk is still the
  // old one, whole, so nothing is lost; the next change in that mode copies it aside again.
  const written = writeOverrides(slate, next, { his: new Date().toISOString() }); // his click: sets his_at
  send(res, 200, { overrides: publicOverrides(written), players: mergedFor(slate, base.players ?? [], written), marks: marksTrouble(written), ...(replaced ? { replaced_unreadable: replacedMarksWords(mode, replaced) } : {}) });
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

// The worker, the limits and the partial answer are in lineup/build-run.js; the routes are in lineup/build-route.js.
const OPTIMIZE_URL = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "lineup", "optimize.js")).href;

/** GET both modes' working lineups (?mode=Cash|GPP: one); POST { mode, slots: 8 entries, a player id or null each } saves that mode's only
 *  (server/slate/store.js; Adam 11-14, 11-19, 11-20: Cash and GPP keep separate lineups). The answer to a POST is both modes as saved. */
async function handleWorking(req, res, slate) {
  const slateData = openSlate(req, res, slate, "The working lineup");
  if (!slateData) return;
  if (req.method === "GET") {
    const mode = new URL(req.url, "http://127.0.0.1").searchParams.get("mode");
    return mode === null ? send(res, 200, readWorking(slate, slateData)) : sendMode(res, readWorking(slate, slateData), mode, "WORKING_UNREADABLE", "working lineup");
  }
  const read = await readJson(req, res);
  if (!read) return;
  if (!PICK_MODES.includes(read.body?.mode)) return fail(res, 400, "BAD_WORKING", '"mode" must be "Cash" or "GPP": the working lineup is kept per mode. Reload the page if it is older than that.');
  const checked = checkWorking(read.body, slateData);
  if (!checked.ok) return fail(res, 400, "BAD_WORKING", checked.message);
  let saved;
  try { saved = saveOr500(res, () => saveWorking(slate, read.body.mode, checked.slots, checked.base)); } catch (e) { // read and written in one step: only this mode's lineup changes
    if (e?.code !== "CHANGED_ELSEWHERE") throw e;
    return fail(res, 409, "WORKING_CHANGED_ELSEWHERE", `Your ${read.body.mode} working lineup was saved from another page since this one read it, so nothing was written; the page lays its change on the saved one and sends again.`); // base (11-13 audit, state 3)
  }
  if (!saved) return;
  const { replaced } = saved;
  if (replaced) error("working lineup file held an unreadable mode; copied aside and replaced by a save", { slate, mode: read.body.mode, ...replaced });
  send(res, 200, { ...readWorking(slate, slateData), mode: read.body.mode, ...(replaced ? { replaced_unreadable: replacedWords(replaced, "working lineup") } : {}) });
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
    const { cardTeammates } = await routeModule("usage");
    const taken = cardTeammates(q.name, q.team);
    const log = await getPlayerLog(q.name, q.team, { signal: gone.signal, taken });
    // Each game gets started (true, false, or null: no box score on file for it) from the saved box scores; the log's cache file is not changed.
    return send(res, 200, logWithStarts(log, q.name, q.team, { taken, note: (m) => { if (!warnedStarts.has(m)) { if (warnedStarts.size > 50) warnedStarts.clear(); warnedStarts.add(m); warn(`player log: ${m}`); } } }));
  } catch (e) {
    if (!(e instanceof PlayerLogError)) throw e;
    if (e.cancelled) return res.destroy(); // nobody is waiting for this answer
    error("player log failed", { name: q.name, team: q.team, message: e.message });
    return fail(res, e.status, "NO_LOG", e.message);
  }
}

/** The slate as the board shows it (before the season figures): our projections or TwoGun's, Adam's overrides on top, usual minutes, pull moves, rest, status and box freshness. Returns null after sending a 404 or 500. */
function builtSlate(res, slate, opts) {
  const data = readSlate(slate);
  if (!data) { fail(res, 404, "NO_SLATE", "No such slate."); return null; }
  const ours = withOurs(slate, data, opts); // our projections, or TwoGun's, per the minutes setting
  const players = effectivePlayers(res, slate, ours); // the board shows the effective figures, each with its base
  if (!players) return null;
  const usual = withUsualMinutes(slate, { ...ours, players, marks: marksFoot(slate) }, { nowMs: opts.now() }); // each man's usual minutes, the console's figure; marks: each mode's thumbs and stars carried, unreadable or replaced, for the page foot (slate/mode-marks.js)
  return withBoxFreshness(withAbsence(slate, withRest(slate, withPullMoves(slate, withOurMinutes(slate, usual), { nowMs: opts.now() })), { nowMs: opts.now() }), { nowMs: opts.now() }); /* TwoGun status-change times are never stamped (Adam 11-19) */ // who the newest pull moved against the one before it; absence: how many games each injured man has missed (server/boxes/absence.js); box_freshness: whether the stored box scores are behind the schedule
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
  if (opts.changeLog) watchWrite(req, res, p, boardDoor({ ourPlayers: (s, d) => (opts.ourProjection ? opts.ourProjection(s, d, { nowMs: opts.now(), readOnly: true }) : d), now: opts.now })); // the change log (slate/change-log.js): a writer's change is logged after its answer, the engine read only
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
  if (p === "/api/boxes/freshness") { // whether the stored box scores are behind the schedule (boxes/freshness.js); "unknown" with its reason when it cannot tell
    if (req.method !== "GET") return fail(res, 405, "METHOD", "GET only.");
    const refused = refuseCrossSiteRead(req.headers);
    if (refused) return fail(res, refused.status, refused.code, refused.message);
    return send(res, 200, readBoxFreshness({ nowMs: opts.now() }));
  }
  if (p === "/api/player-usage") return (await routeModule("usage")).handlePlayerUsage(req, res, url, { send, fail, readJson }); // the card's usage data
  if (p === "/api/pull-now") return (await routeModule("pullnow")).handlePullNow(req, res, { send, fail, readJson, state: opts.pullNow, deps: opts.pullNowDeps }); // the header's Pull now button
  if (p === "/api/pull-status") return (await routeModule("pullnow")).handlePullStatus(req, res, { send, fail, state: opts.pullNow, deps: opts.pullNowDeps, url }); // the Pull now status block
  // A machine with no league totals yet fetches them once (capped) before a board or minutes read, so a cold start is not a board of missing projections (minutes/inputs.js primeTotals).
  // Reads only: a write, a build or late swap never waits on Basketball-Reference.
  const primeFor = req.method === "GET" ? /^\/api\/(?:slate|minutes|board-check)\/([^/]+)(?:\/team\/[A-Z]{2,4})?$/.exec(p) : null;
  if (opts.primeTotals && primeFor && SLATE_NAME.test(safeDecode(primeFor[1]))) await opts.primeTotals(safeDecode(primeFor[1]), { nowMs: opts.now() });
  const mins = minutesHandler(p); // our minutes engine (minutes/route.js)
  if (mins) return mins.handler(req, res, mins, { send, fail, readJson, now: opts.now, decode: safeDecode });
  const depth = depthHandler(p); // the saved depth charts (slate/depth-store.js)
  if (depth) return depth.handler(req, res, depth.team, { send, fail, readJson, now: opts.now, syncBusy: () => syncBusyNow(opts) });
  const cons = consoleHandler(p); // the scenario console (slate/console-route.js)
  if (cons) return cons.handler(req, res, safeDecode(cons.encodedSlate), { send, fail, readJson, openSlate, syncBusy: () => syncBusyNow(opts), usageTable: opts.usageTable, benchPlus: consoleBenchPlus, now: opts.now, effectivePlayers: (res, slate, slateData) => effectivePlayers(res, slate, slateData, opts), ourPlayers: (slate, slateData) => withOurs(slate, slateData, opts) });
  const wif = whatifHandler(p); // the Scenario tab's saved what-ifs, and the send right after each of his writes (slate/whatif-route.js; Adam 11-19 and 1:37 PM 11-20)
  if (wif) return wif.handler(req, res, safeDecode(wif.encodedSlate), { send, fail, readJson, openSlate, syncBusy: () => syncBusyNow(opts), usageTable: opts.usageTable, ourPlayers: (slate, slateData) => withOurs(slate, slateData, opts), now: opts.now });
  const lsw = lateswapHandler(p); // the Late swap screen (slate/lateswap-route.js)
  if (lsw) return lsw.handler(req, res, safeDecode(lsw.encodedSlate), { send, fail, readJson, openSlate, effectivePlayers: (res, slate, slateData) => effectivePlayers(res, slate, slateData, opts), now: opts.now, injected: opts.injected });
  let m = p.match(/^\/api\/slate\/([^/]+)\/resend$/);
  if (m) return handleResend(req, res, safeDecode(m[1]), { send, fail, readJson, openSlate, usageTable: opts.usageTable, ourPlayers: (slate, slateData) => withOurs(slate, slateData, opts), now: opts.now }); // held teams' numbers re-sent on the new Tonight, inside the app (update_cycle.mjs)
  m = p.match(/^\/api\/slate\/([^/]+)\/change-log$/);
  if (m) return handleChangeLog(req, res, safeDecode(m[1]), { send, fail }); // the Log tab (slate/change-log.js)
  m = p.match(/^\/api\/slate\/([^/]+)\/picks$/);
  if (m) return handlePicks(req, res, safeDecode(m[1]));
  m = p.match(/^\/api\/slate\/([^/]+)\/no$/);
  if (m) return handleNo(req, res, safeDecode(m[1]), { openSlate, send, fail, readJson }); // the NO list (lineup/no-list.js), kept beside the picks
  m = p.match(/^\/api\/slate\/([^/]+)\/lineups$/);
  if (m) return handleLineups(req, res, safeDecode(m[1]));
  m = p.match(/^\/api\/slate\/([^/]+)\/spots$/);
  if (m) return handleSpots(req, res, safeDecode(m[1]));
  m = p.match(/^\/api\/slate\/([^/]+)\/builds$/);
  if (m) return handleBuilds(req, res, safeDecode(m[1]));
  m = p.match(/^\/api\/slate\/([^/]+)\/working$/);
  if (m) return handleWorking(req, res, safeDecode(m[1]));
  m = p.match(/^\/api\/slate\/([^/]+)\/overrides$/);
  if (m) return handleOverrides(req, res, safeDecode(m[1]), opts);
  m = p.match(/^\/api\/slate\/([^/]+)\/optimize$/);
  if (m) return handleOptimize(req, res, safeDecode(m[1]), opts);
  m = p.match(/^\/api\/slate\/([^/]+)\/optimize\/progress$/);
  if (m) return handleBuildProgress(req, res, safeDecode(m[1]), opts);
  m = p.match(/^\/api\/slate\/([^/]+)\/optimize\/stop$/);
  if (m) return handleBuildStop(req, res, safeDecode(m[1]), opts);
  m = p.match(/^\/api\/slate\/([^/]+)\/news-lineups$/);
  if (m) { // the Monster, RotoWire and RotoGrinders lineup read (the board's proposals bar); a read-only answer, { state: "ok" | "missing" | "unreadable" }
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
  m = p.match(/^\/api\/board-check\/([^/]+)$/);
  if (m) { // the board's self-check on the slate as it is shown now (slate/board-check-route.js); one call before lock
    const slate = safeDecode(m[1]);
    if (!SLATE_NAME.test(slate)) return fail(res, 400, "BAD_SLATE", "Slate names look like 2026-10-29-main.");
    const refused = refuseCrossSiteRead(req.headers);
    if (refused) return fail(res, refused.status, refused.code, refused.message);
    return handleBoardCheck(req, res, slate, { send, fail, build: (r, s) => builtSlate(r, s, opts), now: opts.now });
  }
  m = p.match(/^\/api\/slate\/([^/]+)$/);
  if (m) {
    if (req.method !== "GET") return fail(res, 405, "METHOD", "GET only.");
    const slate = safeDecode(m[1]);
    if (!SLATE_NAME.test(slate)) return fail(res, 400, "BAD_SLATE", "Slate names look like 2026-10-29-main.");
    const refused = refuseCrossSiteRead(req.headers);
    if (refused) return fail(res, refused.status, refused.code, refused.message);
    const merged = builtSlate(res, slate, opts);
    if (!merged) return;
    const check = runAndLogOnChange(slate, merged, opts.now()); // the board checks itself before Adam sees it (G65); its foot shows the answer (none on the public site)
    const out = check ? { ...merged, board_check: check } : merged;
    return send(res, 200, opts.seasonFigures ? await opts.seasonFigures(out) : out);
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
 *  pullNowDeps: Pull now's child, git and slate reads (pullnow/route.js defaultDeps when null); the tests inject them.
 *  pullNowState: the object Pull now keeps its lock and last run in, shared with the light check (the app below passes one).
 *  ourProjection: (slate, slateData, { nowMs }) -> slateData with our minutes engine's figures (minutes/board.js withOurProjection, which reads the projection setting); off unless given,
 *  so the tests and the public site keep the slate's own (TwoGun's) figures. The app below turns it on.
 *  primeTotals: (slate, { nowMs }) -> fetches missing league totals for the engine once (minutes/inputs.js); off unless given, so the tests never reach Basketball-Reference.
 *  changeLog: true logs each projection change a write makes (slate/change-log.js); off unless given, so the site and the tests that do not ask write no log. */
export function makeServer({ optimizeTimeoutMs = OPTIMIZE_CEILING_MS, optimizeUrl = OPTIMIZE_URL, seasonFigures = null, nowMs = null, answerStartMs = ANSWER_START_MS, answerKeepaliveMs = ANSWER_KEEPALIVE_MS, setTimer = setTimeout, usageTable = null, pullNowDeps = null, pullNowState = { running: null }, ourProjection = null, primeTotals: prime = null, syncBusy = null, changeLog = false } = {}) {
  const opts = { optimizeTimeoutMs, optimizeUrl, answerStartMs, answerKeepaliveMs, setTimer, build: null, seasonFigures, usageTable, ourProjection, primeTotals: prime, syncBusy, changeLog, now: () => nowMs ?? Date.now(), injected: nowMs != null, pullNow: pullNowState, pullNowDeps };
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
  const loaded = await loadRouteModules(); // refuse to start on a route file that will not load, before anything else starts
  if (!loaded.ok) { error(`${loaded.file} (or a file it imports) would not load; not starting.`, { file: loaded.file, message: loaded.message, stack: loaded.stack }); process.exit(1); }
  Object.assign(routeMods, loaded.mods);
  startStandingsWatch();
  const port = Number(process.env.PORT) || 8693;
  startUsageWarm({ port });
  const now = readNowSetting(process.env.NBADFS_NOW);
  if (now.error) { error(now.error); process.exit(1); }
  // A test clock is for a copy with its own data folder, never for the app on its own port: it would make real upload files from a fake now.
  if (now.ms != null && (!process.env.NBADFS_DATA_DIR || port === 8693)) { error("NBADFS_NOW needs NBADFS_DATA_DIR set and a port other than 8693; not starting."); process.exit(1); }
  if (now.ms != null) info(`Late swap test clock: now is ${new Date(now.ms).toISOString()} (NBADFS_NOW)`);
  const pullNowState = { running: null };
  makeServer({ seasonFigures: withSeasonFigures, usageTable: seasonUsageTable, nowMs: now.ms, pullNowState, ourProjection: withOurProjection, primeTotals, changeLog: true, syncBusy: async () => (await routeModule("pullnow")).syncBusy(dataDir()) }).listen(port, "127.0.0.1", () => {
    info(`NBA board on http://127.0.0.1:${port}`);
    startSnapshotRefresh({ now: () => now.ms ?? Date.now() }); // keeps each team's figures saved for its tip (minutes/refresh.js)
    routeModule("pullnow").then(({ startLightCheckIfAllowed }) => startLightCheckIfAllowed({ state: pullNowState, port })).catch((e) => error("the light check could not start", { error: e.message })); // only in the real app: port 8693, on the default data folder or the live copy's NBADFS_DATA_DIR (route.js startLightCheckIfAllowed decides)
    routeModule("pullnow").then(({ startAutoPullIfAllowed }) => startAutoPullIfAllowed({ state: pullNowState, port })).catch((e) => error("the automatic pulls could not start", { error: e.message })); // the same gate, plus a repo Pull now may write (route.js startAutoPullIfAllowed)
  });
}
