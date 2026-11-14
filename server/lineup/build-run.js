// One optimizer build in a worker thread, so a heavy GPP search never blocks the server (Adam, 11-02: "extend the time
// limits so it doesn't cut it off while it's thinking"). The worker posts each finished lineup as it goes; the server keeps
// them on the job, so a Stop or the safety ceiling ends the thread and answers with the finished lineups only. A lineup still
// being searched at that moment never reached the job, so it is dropped, never returned partly built.
import { Worker } from "../../site/shim/worker-threads.js";
import { readExposure, limitMisses } from "./exposure.js";
import { DEFAULT_COUNT } from "../board/slots.js";
import { NO_STEP_LIMIT } from "./optimize.js";

/** The one hard limit on a build: a safety net for a search that would never end, not a limit a real build should meet. */
export const OPTIMIZE_CEILING_MS = 10 * 60 * 1000;
/** The step limit the app's server names on every build: none. A Cash build's only limit is then the clock above, so no lineup stops
 *  short while there is still time. A GPP build reads it as "no limit named" and runs its own fast budget (fast-search.js), so a
 *  GPP lineup can come back not proven best. A direct caller of optimize() naming no limit gets its default in Cash. */
export const APP_MAX_STEPS = NO_STEP_LIMIT;
// Browsers and Node's fetch can give up on a request whose answer has not started after about five minutes. A long build
// starts its 200 once the search is under way (every refusal has been sent by then) and keeps it alive with spaces, which
// JSON allows before the body. A quick build never reaches this and answers as one piece.
export const ANSWER_START_MS = 60_000;
export const ANSWER_KEEPALIVE_MS = 30_000;

const WORKER_SRC = `const { parentPort, workerData } = require("node:worker_threads");
const failed = (e) => parentPort.postMessage({ ok: false, message: String((e && e.message) || e) });
import(workerData.url).then((m) => parentPort.postMessage({ ok: true, result: m.optimize({ ...workerData.args, onProgress: (progress) => parentPort.postMessage({ progress }) }) }), failed).catch(failed);`;

/** A new build's job: what the progress and stop routes read while it runs. */
export const newJob = (slate) => ({ slate, done: 0, of: null, skipped: [], lineups: [], started: false, stop: null });

/** The sentence for a build that ended early; `reason` is "stopped", "failed" or "ceiling" (Standard D16: an amber notice, never red). */
export function partialNote(reason, done, of, ceilingMs = OPTIMIZE_CEILING_MS) {
  const finished = done === 0 ? `0 of ${of} lineups were finished.` : done === 1 ? `1 of ${of} lineups was finished and is here.` : `${done} of ${of} lineups were finished and are here.`;
  if (reason === "stopped") return `Stopped: ${finished}`;
  if (reason === "failed") return `Failed: ${done} of ${of} lineups built; ${of - done} missing because the optimizer failed.`;
  const minutes = Math.round(ceilingMs / 60000);
  const limit = minutes >= 1 ? `${minutes} minute` : `${Math.round(ceilingMs / 1000)} second`;
  return `This build reached its ${limit} limit. ${finished} Fewer lineups or looser settings take less time.`;
}

/** The answer for a build that ended early: an optimize() result holding the finished lineups, with the sentence, then what those
 *  lineups do to any Min % and Max % (B10). args: the build's { mode, settings, players }. A GPP build finishes its lineups in no
 *  order, so they come back best real projection first, with how many are not proven; under variance none is, by design. */
export function partialResult(reason, job, asked, ceilingMs, args = {}) {
  const of = job.of ?? asked, done = job.lineups.length, gpp = args.mode === "GPP";
  const lineups = gpp ? [...job.lineups].sort((a, b) => b.projection - a.projection) : job.lineups;
  const open = gpp && !(args.settings?.variancePct > 0) ? job.lineups.filter((l) => !l.proven).length : 0;
  const openNote = open ? `${open} of ${done} lineups are the best found, not proven best.` : "";
  const base = { lineups, skipped: job.skipped, note: openNote || null, error: null };
  if (done >= of) return base; // the last lineup had just come in: the batch is whole
  const exposure = readExposure(args.settings?.exposure).exposure ?? {};
  const name = (id) => (args.players ?? []).find((p) => p.dk_id === id)?.name ?? id;
  const note = [partialNote(reason, done, of, ceilingMs), openNote, limitMisses(exposure, of, job.lineups, name)].filter(Boolean).join(" ");
  return { ...base, note, partial: { reason, done, of, missing: of - done } };
}

/**
 * Runs optimize(args) from the module at `url` in a worker. Resolves { result } (a finished run, or the finished lineups after
 * job.stop() or the ceiling) or { cancelled: true } when the browser dropped the request; rejects when the search throws.
 * `onEnd` runs once the worker has been told to stop, whatever the outcome. `setTimer` is setTimeout unless a test replaces it.
 */
export function runOptimize({ url, args, job, timeoutMs, gone, onEnd, setTimer = setTimeout }) {
  return new Promise((resolve, reject) => {
    if (gone.aborted) { onEnd(); return resolve({ cancelled: true }); }
    let worker;
    try {
      worker = new Worker(WORKER_SRC, { eval: true, workerData: { url, args } });
    } catch (e) {
      onEnd(); // no thread ever ran, so the slot frees now
      return reject(e);
    }
    let settled = false;
    // A worker that answered has finished its search, so the slot frees at once; one stopped mid-search (dropped request,
    // crash) frees it only once the thread has actually ended.
    const finish = (fn, v, answered = false) => {
      if (settled) return;
      settled = true; clearTimeout(timer); gone.removeEventListener("abort", onGone);
      const ended = worker.terminate();
      if (answered) onEnd(); else ended.then(onEnd, onEnd);
      fn(v);
    };
    // Stop and the ceiling answer only after the thread has ended, so the next Build finds the slot free, never a 409.
    const endEarly = (reason) => {
      if (settled) return;
      settled = true; clearTimeout(timer); gone.removeEventListener("abort", onGone);
      const answer = () => { onEnd(); resolve({ result: partialResult(reason, job, args.settings?.count ?? DEFAULT_COUNT, timeoutMs, args) }); };
      worker.terminate().then(answer, answer);
    };
    job.stop = () => endEarly("stopped");
    const timer = setTimer(() => endEarly("ceiling"), timeoutMs);
    const onGone = () => finish(resolve, { cancelled: true });
    gone.addEventListener("abort", onGone);
    const onProgress = (p) => {
      if (settled) return; // arrived after the end: the answer is already fixed
      job.started = true; job.of = p.of; job.done = p.done;
      if (p.skipped) job.skipped = p.skipped;
      if (p.lineup) job.lineups.push(p.lineup);
    };
    worker.on("message", (m) => {
      if (m.progress) return onProgress(m.progress);
      return m.ok ? finish(resolve, { result: m.result }, true) : finish(reject, new Error(m.message), true);
    });
    worker.on("error", (e) => finish(reject, e));
    worker.on("exit", (code) => finish(reject, new Error(`The optimizer stopped without an answer (exit ${code}).`)));
  });
}

/** Starts a long build's 200 and keeps it alive (see ANSWER_START_MS); returns the function that ends the keepalive. */
export function keepAnswerOpen({ res, job, afterMs, everyMs, setTimer = setTimeout }) {
  let timer = null, ended = false;
  const tick = () => {
    if (ended) return;
    if (job.started) {
      if (!res.headersSent) res.writeHead(200, { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "no-store" });
      res.write(" ");
    }
    timer = setTimer(tick, everyMs);
  };
  timer = setTimer(tick, afterMs);
  return () => { ended = true; clearTimeout(timer); };
}
