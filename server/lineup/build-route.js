// The optimizer's routes: a build, its progress and its stop. Moved out of server/server.js unchanged (file split, 11-17); the route
// order stays in server.js route(); handleOptimize's origin and JSON guards come from openSlate and readJson in slate/http-helpers.js,
// while handleBuildStop and handleBuildProgress check origin themselves.
import { info, error } from "../../site/shim/log.js";
import { refuseNonJsonPost, refuseCrossSiteRead } from "../lib/origin.js";
import { optimizeErrorKind } from "../server-util.js";
import { SLATE_NAME, readPicks, checkWorking } from "../slate/store.js";
import { hisProblem } from "../slate/out-pool.js";
import { send, fail, readJson, openSlate } from "../slate/http-helpers.js";
import { effectivePlayers } from "../slate/effective-players.js";
import { slateRefMs, startedSplit, leftOut } from "../board/lateswap.js";
import { DEFAULT_COUNT } from "../board/slots.js";
import { ONE_GAME_NOTE } from "./optimize.js";
import { APP_MAX_STEPS, newJob, runOptimize, keepAnswerOpen, partialResult } from "./build-run.js";

export const LATE_ONE_GAME_NOTE = "Only one game left unstarted; DraftKings needs players from at least two games, so pin or keep a started man.";

/** POST { mode, settings, handPicks? }: lineups for the slate's players; locked and excluded come from the saved picks, never the body.
 *  One search at a time per server (409 while one runs), so builds cannot pile up workers. A Stop or the ceiling answers 200
 *  with the finished lineups, a sentence in note and a partial field (lineup/build-run.js). */
export async function handleOptimize(req, res, slate, opts) {
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
  const unknownMarks = hisProblem(slateData); // his In and Out calls unreadable: who is Out is unknown, so nothing is built (fail closed)
  if (unknownMarks) return fail(res, 409, "HIS_MARKS_UNREADABLE", unknownMarks);
  const players = effectivePlayers(res, slate, slateData, opts);
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
export function answerBuildFail(res, status, code, message) {
  if (!res.headersSent) return fail(res, status, code, message);
  res.end(JSON.stringify({ error: { code, message, status } }));
}

/** A build's answer from runOptimize's outcome. */
export function answerBuild(res, slate, out, lateOut) {
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
export function handleBuildProgress(req, res, slate, opts) {
  if (req.method !== "GET") return fail(res, 405, "METHOD", "GET only.");
  const refused = refuseCrossSiteRead(req.headers);
  if (refused) return fail(res, refused.status, refused.code, refused.message);
  if (!SLATE_NAME.test(slate)) return fail(res, 400, "BAD_SLATE", "Slate names look like 2026-10-29-main.");
  const job = opts.build?.slate === slate ? opts.build : null;
  return send(res, 200, job ? { running: true, done: job.done, of: job.of } : { running: false, done: null, of: null });
}

/** POST {}: stops this slate's running build; the build's own request then answers with the lineups finished so far. Answers
 *  { stopped: false } when no build is running on the slate (it had just finished). */
export async function handleBuildStop(req, res, slate, opts) {
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
