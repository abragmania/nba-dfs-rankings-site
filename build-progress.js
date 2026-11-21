// A build's progress on the panel (Adam, 11-02): while a build runs, the Build button reads "Building...", a message beside Stop counts the lineups done,
// and a Stop button sits beside the button, disabled once clicked. The count comes from polling the server; Stop asks the server to end the build, and the build's own request
// then answers with the finished lineups. Nothing here redraws the panel: a poll only changes the button's and message's text, so a click or
// a typed field is never disturbed. A quick build ends before the first poll and shows nothing new.
import { esc } from "./board-util.js";

export const FIRST_POLL_MS = 1000;
export const POLL_MS = 500;

const stopButton = (stopping) => `<button class="ol stop" data-op="stop" title="Keep the lineups built so far and stop this build"${stopping ? " disabled" : ""}>Stop</button>`;
const route = (name, what) => `/api/slate/${encodeURIComponent(name)}/optimize/${what}`;

/** The running button's words (Standard D15): "Building..." once the first poll has seen the build running, "Stopping..." after Stop; the count is in the message.
 *  "Saving your changes..." while the build waits for his saves and typed numbers to land (review 11-21 F3). */
export const WAIT_LABEL = "Saving your changes...";
export function buildLabel(b) {
  return b?.stopping ? "Stopping..." : b?.waiting ? WAIT_LABEL : "Building...";
}
/** The build is waiting (on) or done waiting for his saves: the button says so, without a redraw. Safe on a page with no button. */
export function showWait(X, b, on) {
  b.waiting = on;
  if (X.P.build !== b) return;
  const label = X.el?.querySelector?.(".golabel");
  if (label) label.textContent = buildLabel(b);
}

// ---------- the wait before a build (review 11-21 round 2, items 1 and 5) ----------
/** The longest a build waits for his saves and the console's send before it refuses or asks. */
export const WAIT_CAP_MS = 30_000;
/** How long a wait runs before the Build button says it is saving. */
export const WAIT_SHOW_MS = 150;
/** How often a send that is waiting (a sync running, the usage table loading) is looked at again. */
export const HOLD_POLL_MS = 250;

/**
 * Where the console's send stands for a build, from its send state (console-card.js syncState: { state, msg, pending: [teams] }): { state: "ok" } when
 * nothing of his is off the board; { state: "wait", teams, why } while a send with his teams is under way or waiting (a sync running, the usage
 * table loading); { state: "error", teams, why } when it failed with his teams still to go. A state with no team of his pending is "ok". Pure.
 */
export function sendHold(sync) {
  const s = sync ?? { state: "ok" }, teams = Array.isArray(s.pending) ? [...s.pending] : [];
  if (!teams.length) return { state: "ok" };
  const why = String(s.msg ?? "").replace(/^Your last change has not reached the board: /, "");
  if (s.state === "sending" || s.state === "waiting") return { state: "wait", teams, why: why || (s.state === "sending" ? "the send is still under way" : "the send is waiting") };
  if (s.state === "error") return { state: "error", teams, why: why || "the send failed" };
  return { state: "ok" };
}
/** The question a build asks before it goes without his change (Cancel is the default). Pure. */
export const holdQuestion = (h) => `Your change on ${h.teams.join(", ")} has not reached the board (${h.why}). Build without it?`;

/** Whether `p` settles within `ms`; the timer is cleared either way. */
function within(p, ms, timers) {
  return new Promise((resolve) => {
    const t = timers.setTimeout(() => resolve(false), Math.max(0, ms));
    Promise.resolve(p).then(() => { timers.clearTimeout(t); resolve(true); }, () => { timers.clearTimeout(t); resolve(true); });
  });
}
/** Until settled() stops changing: a save clicked while an earlier one is out adds a new link. */
async function untilSettled(settled) {
  let q;
  do { q = settled(); await q; } while (q !== settled());
}
/**
 * The wait before a build or a re-optimize: his saves and typed numbers land, then the console's send is looked at (sendHold), all within `cap`.
 * deps: { settled() (one promise for every save queue, board.js), open() -> the names of the queues not landed, hold() -> sendHold's answer,
 * onWait(on) (the button's words), cap, pollMs, timers, now }. Resolves null when the build may go; { refuse } (the words) when a save has not landed
 * within the cap: nothing is built; { ask, words } when his change has not reached the board (the send failed, or still waits at the cap): the caller asks.
 */
export async function waitToBuild({ settled, open = () => [], hold = () => ({ state: "ok" }), onWait = () => {}, cap = WAIT_CAP_MS, pollMs = HOLD_POLL_MS, timers = globalThis, now = () => Date.now() }) {
  const until = now() + cap;
  let shown = false;
  const say = (on) => { if (on !== shown) { shown = on; onWait(on); } };
  const showT = timers.setTimeout(() => say(true), WAIT_SHOW_MS);
  try {
    for (;;) {
      if (!(await within(untilSettled(settled), until - now(), timers))) {
        const names = open();
        return { refuse: `Nothing was built: ${names.length ? names.join(", ") : "a save"} had not landed after ${Math.round(cap / 1000)} seconds. Build again once the page shows it saved.` };
      }
      const h = hold();
      if (h.state === "ok") return null;
      if (h.state === "error" || now() >= until) return { ask: h, words: holdQuestion(h) };
      say(true); // a send that waits: the button keeps saying so, and the state is looked at again
      await new Promise((r) => timers.setTimeout(r, Math.min(pollMs, Math.max(0, until - now()))));
    }
  } finally { timers.clearTimeout(showT); say(false); }
}

/**
 * The parts a build waits on, by name (board.js): [[name, () => promise]]. settled() is one promise for all of them, the same object until a part gains
 * a link; open() names the parts whose newest promise has not settled, so a wait that runs out says what has not landed.
 */
export function createWaitParts(parts) {
  const done = new WeakSet(), seen = new WeakSet();
  let of = [], all = Promise.resolve();
  const watch = (q) => { if (q && typeof q.then === "function" && !seen.has(q)) { seen.add(q); q.then(() => done.add(q), () => done.add(q)); } return q; };
  return {
    settled() {
      const qs = parts.map(([, f]) => watch(f()));
      if (qs.length !== of.length || qs.some((q, i) => q !== of[i])) { of = qs; all = Promise.all(qs); }
      return all;
    },
    open: () => parts.filter((_, i) => of[i] && typeof of[i].then === "function" && !done.has(of[i])).map(([name]) => name),
  };
}

/** The short line beside Stop: the count while the build runs (D15), or the refused-stop line (D18, an error). */
export function buildMessage(b) {
  if (b?.stopError) return { text: STOP_ERROR, err: true };
  return { text: b?.of != null ? `Finding the best lineups (${b.done} of ${b.of})` : "Finding the best lineups", err: false };
}
const STOP_ERROR = "Could not reach the server to stop. The build is still running.";
const msgHtml = (b) => { const m = buildMessage(b); return `<span class="gomsg${m.err ? " err" : ""}">${esc(m.text)}</span>`; };

/** The Build button, plus Stop and the message once a poll has seen the build running. */
export function buildButtonsHtml(P, bolt, label) {
  const b = P.running ? P.build : null;
  const go = `<button class="go" data-op="build"${P.running ? " disabled" : ""}>${bolt} <span class="golabel">${esc(b?.shown || b?.waiting ? buildLabel(b) : label)}</span></button>`; // the normal label until the first poll has seen the build
  return `<div class="gorun">${go}${b?.shown ? stopButton(b.stopping) + msgHtml(b) : ""}</div>`;
}

/** Puts the current label, message and the Stop button on the page without a redraw. */
function paint(X, b) {
  if (X.P.build !== b) return;
  const label = X.el.querySelector(".golabel");
  if (label) label.textContent = buildLabel(b);
  const row = X.el.querySelector(".gorun"), stop = X.el.querySelector('[data-op="stop"]'), msg = X.el.querySelector(".gomsg");
  if (stop) stop.disabled = b.stopping; // Stop stays in place while stopping, so nothing moves under the cursor
  else if (b.shown) row?.insertAdjacentHTML("beforeend", stopButton(b.stopping) + msgHtml(b));
  if (stop && msg && b.shown) { const m = buildMessage(b); msg.textContent = m.text; msg.className = `gomsg${m.err ? " err" : ""}`; }
  // The Lineups tab's own build line (lineups-tab.js) is painted the same way: the count, and Stop once the build is seen running.
  const tab = X.lel?.querySelector?.(".lt-build");
  if (!tab || !b.shown) return;
  const tm = tab.querySelector(".gomsg"), ts = tab.querySelector('[data-op="stop"]'), m = buildMessage(b);
  if (tm) { tm.textContent = m.text; tm.className = `gomsg${m.err ? " err" : ""}`; }
  if (ts) ts.disabled = b.stopping; else tab.insertAdjacentHTML("beforeend", stopButton(b.stopping));
}

/** Starts polling for the build just begun on this slate; returns its watch, which endWatch ends. */
export function watchBuild(X) {
  const b = { name: X.ctx().name, done: 0, of: null, shown: false, stopping: false, ended: false, timer: null, request: new AbortController() };
  X.P.build = b;
  const tick = async () => {
    try {
      const g = await X.api(route(b.name, "progress"));
      if (b.ended) return;
      if (g.running) { Object.assign(b, { done: g.done, of: g.of, shown: true }); paint(X, b); }
    } catch (e) {
      console.warn("Could not read the build's progress:", e.message); // the count stays as it was; the next poll tries again
    }
    if (!b.ended) b.timer = setTimeout(tick, POLL_MS);
  };
  b.timer = setTimeout(tick, FIRST_POLL_MS);
  return b;
}

/** Ends a watch when its build has answered. */
export function endWatch(X, b) {
  b.ended = true;
  clearTimeout(b.timer);
  if (X.P.build === b) X.P.build = null;
}

const askStop = (X, name) => X.api(route(name, "stop"), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });

/** The Stop button: the build's own request brings the lineups back and ends the watch. */
export async function stopBuild(X) {
  const b = X.P.build;
  if (!b || b.stopping) return;
  b.stopping = true;
  b.stopError = false;
  paint(X, b);
  try {
    await askStop(X, b.name);
  } catch (e) {
    b.stopping = false;
    b.stopError = true; // D18: a line beside Stop, until the build answers or Stop is tried again
    console.warn("Could not stop the build:", e.message);
    paint(X, b);
  }
}

/** The panel moved to another slate during a build: nobody will see its lineups, so it ends now and leaves the server free.
 *  The request is cut as well as stopped: a stop reaching the server before it has registered the build finds nothing to stop. */
export function abandonBuild(X) {
  const b = X.P.build;
  if (!b) return;
  endWatch(X, b);
  b.request.abort();
  askStop(X, b.name).catch((e) => X.toast(`Could not stop the earlier build: ${e.message}`, "err"));
}
