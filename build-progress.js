// A build's progress on the panel (Adam, 11-02): while a build runs, the Build button reads "Building...", a message beside Stop counts the lineups done,
// and a Stop button sits beside the button, disabled once clicked. The count comes from polling the server; Stop asks the server to end the build, and the build's own request
// then answers with the finished lineups. Nothing here redraws the panel: a poll only changes the button's and message's text, so a click or
// a typed field is never disturbed. A quick build ends before the first poll and shows nothing new.
import { esc } from "./board-util.js";

export const FIRST_POLL_MS = 1000;
export const POLL_MS = 500;

const stopButton = (stopping) => `<button class="ol stop" data-op="stop" title="Keep the lineups built so far and stop this build"${stopping ? " disabled" : ""}>Stop</button>`;
const route = (name, what) => `/api/slate/${encodeURIComponent(name)}/optimize/${what}`;

/** The running button's words (Standard D15): "Building..." once the first poll has seen the build running, "Stopping..." after Stop; the count is in the message. */
export function buildLabel(b) {
  return b?.stopping ? "Stopping..." : "Building...";
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
  const go = `<button class="go" data-op="build"${P.running ? " disabled" : ""}>${bolt} <span class="golabel">${esc(b?.shown ? buildLabel(b) : label)}</span></button>`; // the normal label until the first poll has seen the build
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
