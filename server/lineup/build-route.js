// The optimizer's routes: a build, its progress and its stop. Moved out of server/server.js unchanged (file split, 11-17); the route
// order stays in server.js route(); handleOptimize's origin and JSON guards come from openSlate and readJson in slate/http-helpers.js,
// while handleBuildStop and handleBuildProgress check origin themselves.
import crypto from "../../site/shim/crypto.js"; // default only: the public site's shim (site-src/shim/crypto.js) gives createHash (sha256, hex) alone
import { info, error } from "../../site/shim/log.js";
import { refuseNonJsonPost, refuseCrossSiteRead } from "../lib/origin.js";
import { optimizeErrorKind } from "../server-util.js";
import { SLATE_NAME, modePicks, PICK_MODES, checkWorking } from "../slate/store.js";
import { hisProblem } from "../slate/out-pool.js";
import { send, fail, readJson, openSlate } from "../slate/http-helpers.js";
import { effectivePlayers } from "../slate/effective-players.js";
import { slateRefMs, startedSplit, leftOut } from "../board/lateswap.js";
import { DEFAULT_COUNT } from "../board/slots.js";
import { ONE_GAME_NOTE, MAX_SEED, isSeed } from "./optimize.js";
import { APP_MAX_STEPS, newJob, runOptimize, keepAnswerOpen, partialResult } from "./build-run.js";
import { noForBuild } from "./no-list.js";

export const LATE_ONE_GAME_NOTE = "Only one game left unstarted; DraftKings needs players from at least two games, so pin or keep a started man.";

/** POST { mode, settings, handPicks?, seed? }: lineups for the slate's players; locked and excluded come from the mode's saved picks, never the body.
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
  if (body.seed != null && !isSeed(body.seed)) return fail(res, 400, "BAD_SETTINGS", `"seed" must be a whole number from 0 to ${MAX_SEED}.`);
  // A build reads its own mode's locks and excludes only (Adam 11-14, 11-19, 11-20): a GPP lock never reaches a Cash build, nor the reverse.
  // Late swap in the optimizer panel is a build of one mode too, so it reads that mode's.
  if (!PICK_MODES.includes(body.mode)) return fail(res, 400, "BAD_SETTINGS", 'Mode must be "Cash" or "GPP".');
  if (opts.build) return fail(res, 409, "BUSY", "Lineups are already being made; try again when that finishes.");
  const picks = picksForBuild(res, slate, slateData, body.mode);
  if (!picks) return;
  // Adam's overrides (typed numbers and bumps) are what the build scores, late swap included: the shared numbers and the BUILD's mode's own
  // thumbs and stars (Adam 1:24 PM 11-20); a mode whose thumbs and stars cannot be read builds nothing (500, slate/mode-marks.js).
  const unknownMarks = hisProblem(slateData); // his In and Out calls unreadable: who is Out is unknown, so nothing is built (fail closed)
  if (unknownMarks) return fail(res, 409, "HIS_MARKS_UNREADABLE", unknownMarks);
  const players = effectivePlayers(res, slate, slateData, opts, body.mode);
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
  // His NO list (lineup/no-list.js noForBuild, Adam 11-19): a build reads its mode's list, late swap its own late swap list (never the
  // build's); out of every lineup of this run only. An unreadable list builds nothing (fail closed). Late swap names what it did in late_swap.no.
  const nb = noForBuild({ slate, slateData, players, mode: body.mode, lateSwap, locked, excluded, handPicked: handIdList, exposure: body.settings?.exposure ?? null, pinned: pinned ?? {}, count: Number.isInteger(body.settings?.count) ? body.settings.count : DEFAULT_COUNT });
  if (nb.error) { if (nb.error.status === 500) error("NO list unreadable", { slate, message: nb.error.message }); return fail(res, nb.error.status, nb.error.code, nb.error.message); }
  excluded = nb.excluded;
  if (lateOut) lateOut.no = nb.late;
  const settings = { ...body.settings, ...(nb.exposure !== (body.settings?.exposure ?? null) ? { exposure: nb.exposure } : {}), maxSteps: body.settings?.maxSteps ?? APP_MAX_STEPS };
  // A rerun names the seed it was given back; a new variance build (GPP, variancePct above 0: the only draw optimize makes) draws one, any other build needs none (null),
  // so a build without variance answers the same record every time (the site's build matches the app's digit for digit). No secret: Math.random, which the site has too.
  const varied = body.mode === "GPP" && typeof settings.variancePct === "number" && settings.variancePct > 0;
  const seed = body.seed ?? (varied ? Math.floor(Math.random() * (MAX_SEED + 1)) : null);
  const args = { players, mode: body.mode, settings, locked, excluded, handPicked: handIdList, seed }, rerun = rerunOf(args, lateSwap);
  info("build rerun record", { slate, ...rerun }); // once per build, so a build is reproducible from the server log until the saved build carries it
  const noOut = nb.noOut;
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
    if (job.lineups.length) return answerBuild(res, slate, { result: partialResult("failed", job, settings.count ?? DEFAULT_COUNT, undefined, args) }, lateOut, noOut, rerun);
    return answerBuildFail(res, 500, "OPTIMIZER_FAILED", "The optimizer failed on this slate and built nothing. The server log has the details.");
  } finally {
    endKeepalive();
  }
  return answerBuild(res, slate, out, lateOut, noOut, rerun);
}

/** What a build needs to be made again (the 11-13 audit: a variance build could not be reproduced): its seed (null for a build with no variance, which draws
 *  nothing), mode and full settings as the search read them, the locks, excludes and hand-picked men it ran with, and the sha256 of the players it scored.
 *  A POST of this mode, settings and seed gives the same lineups only while the effective players, the saved picks, the NO list and late swap's started set
 *  are unchanged (optimize.js seed): players_sha256 confirms the players were the same, it cannot restore them. */
export function rerunOf(args, lateSwap) {
  return {
    seed: args.seed, mode: args.mode, settings: args.settings, locked: args.locked, excluded: args.excluded, hand_picked: args.handPicked, late_swap: lateSwap,
    players: args.players.length, players_sha256: crypto.createHash("sha256").update(JSON.stringify(args.players)).digest("hex"),
  };
}

/** The mode's saved picks, or null after a named 500: an unreadable file means who is locked or excluded is unknown, so nothing is built
 *  (review 11-20, money: fail closed, never "nobody"). */
function picksForBuild(res, slate, slateData, mode) {
  try { return modePicks(slate, slateData, mode); } catch (e) {
    error("picks unreadable; nothing built", { slate, mode, message: e.message });
    fail(res, 500, "PICKS_UNREADABLE", `The saved locks and excludes (cache/picks/${slate}.json) could not be read, so nothing was built: ${e.message}. A lock or exclude change on the Player list replaces the file.`);
    return null;
  }
}

/** A build's refusal. Once a long build's 200 has started the status cannot change, so the error goes in the body with its status. */
export function answerBuildFail(res, status, code, message) {
  if (!res.headersSent) return fail(res, status, code, message);
  res.end(JSON.stringify({ error: { code, message, status } }));
}

/** A build's answer from runOptimize's outcome. `noOut` ({ applied: { ids, names } | null, note }) is the NO list this build left
 *  out: the answer carries it as `no` (each lineup's heading line, stored with the build), and its note joins the build's note. `rerun` (rerunOf) goes on the
 *  answer as it is, so the build can be made again. */
export function answerBuild(res, slate, out, lateOut, noOut = null, rerun = null) {
  if (out.cancelled) return res.destroy(); // nobody is waiting for this answer
  const err = out.result.error;
  if (err && optimizeErrorKind(err) === "slate") {
    error("optimizer refused the slate file", { slate, message: err });
    return answerBuildFail(res, 500, "BAD_SLATE_FILE", `This slate's file or saved picks cannot be used for a build: ${err}`);
  }
  if (err) return answerBuildFail(res, 400, "BAD_SETTINGS", err);
  if (out.result.partial) info("build ended early", { slate, ...out.result.partial });
  // In late swap the one-game case means the started games took the rest out: say so in those words.
  const result = !noOut?.applied && !noOut?.note ? out.result : { ...out.result, ...(noOut.applied ? { no: noOut.applied } : {}), note: [out.result.note, noOut.note].filter(Boolean).join(" ") || null };
  const answered = !lateOut ? result : { ...result, note: result.note === ONE_GAME_NOTE ? LATE_ONE_GAME_NOTE : result.note, late_swap: lateOut };
  const body = rerun ? { ...answered, rerun } : answered;
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
