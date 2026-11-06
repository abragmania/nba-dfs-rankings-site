// The Pull now button in the board's header and its one line beside it. The words are pure and tested in node; the app's run (POST /api/pull-now,
// server/pullnow/route.js) and the public site's run (site-src/site-pull.js, through GitHub) both end in pullLine's sentence. After a run that
// brought new numbers, `reload` is the board's own in-page refresh (slate-refresh.js createRefresher().tick): never a page reload, his typed
// numbers, picks, tab, console work and scroll stay. The header is redrawn whole (board.js renderTop), so the button and the line are drawn from
// this module's state each time; the line's box is always there, its width fixed, so nothing moves when its words change.
import { esc, shortTime } from "./board-util.js";

/** TwoGun's board stamp as the page shows every time: Eastern ("Fri, Nov 6, 2:37 PM CT" -> "3:37 PM ET"). Null when missing. Pure. */
export function boardShort(text, refMs = Date.now()) {
  if (typeof text !== "string" || !text.trim()) return null;
  return shortTime(text.trim(), refMs);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const bare = (why) => (typeof why === "string" && why.trim() ? why.trim().replace(/\.+$/, "") : null); // a reason without its own full stop, so the line ends with one
const listed = (a, n = 3) => `${a.slice(0, n).join(", ")}${a.length > n ? ` and ${a.length - n} more` : ""}`;

/** What the saving said, as clauses after the main sentence: not pushed and why, files carried along or left, the publish hook's own words. Pure. */
function savedClauses(saved) {
  if (!saved || saved.state === "none") return "";
  const out = [];
  if (saved.state === "local") out.push(`saved on this computer, not pushed: ${bare(saved.why)}`);
  if (saved.state === "unknown") out.push(`push outcome unknown: ${bare(saved.why)}`);
  if (saved.carried?.length) out.push(`also committed earlier changes: ${listed(saved.carried)}`);
  if (saved.left?.length) out.push(`left uncommitted: ${listed(saved.left)}`);
  if (saved.missing?.length) out.push(`not found to commit: ${listed(saved.missing)}`);
  if (saved.hook?.length) out.push(`publish hook: ${saved.hook.map(bare).join("; ")}`);
  if (saved.note) out.push(bare(saved.note));
  return out.length ? `; ${out.join("; ")}` : "";
}

/**
 * The one line a finished run shows. r: { state: "pulled" | "unchanged" | "older" | "no_board" | "failed" | "unknown" | "busy" | "missing",
 * at (Eastern clock words of the run's end), board (TwoGun's stamp text), players, minutesMoved, why, saved ({ state: "pushed" | "local" | "none" |
 * "unknown", why, carried, left, missing, hook, note }), others ([{ slate, board }]: another night's new pull), alsoFailed (step names) }.
 * Minute moves are named only when this pull moved someone; a missing figure is said missing, never a zero. Every time is Eastern. Pure.
 */
export function pullLine(r) {
  const board = boardShort(r?.board);
  const tail = r?.alsoFailed?.length ? ` Also failed: ${r.alsoFailed.join(", ")}.` : "";
  const others = r?.others?.length ? `; also saved ${r.others.map((o) => `${o.slate}${o.board ? ` (board ${boardShort(o.board)})` : ""}`).join(", ")}` : "";
  const saved = savedClauses(r?.saved);
  switch (r?.state) {
    case "pulled": {
      const players = Number.isInteger(r.players) ? plural(r.players, "player", "players") : "player count missing";
      const moved = Number.isInteger(r.minutesMoved) ? (r.minutesMoved > 0 ? `, minutes moved for ${plural(r.minutesMoved, "man", "men")}` : "") : ", minutes comparison missing";
      return `Pulled ${r.at ?? "(time missing)"} — board ${board ?? "time missing"}, ${players}${moved}${others}${saved}.${tail}`;
    }
    case "unchanged": return `Checked ${r.at ?? "(time missing)"}, no new board${board ? ` (TwoGun still ${board})` : ""}${others}${saved}.${tail}`;
    case "older": return `Checked ${r.at ?? "(time missing)"}, no new board (TwoGun's ${board ?? ""} board is older than the newest saved pull)${others}${saved}.${tail}`.replace("TwoGun's  board", "TwoGun's board");
    case "no_board": return `Checked ${r.at ?? "(time missing)"}: TwoGun has no board for today yet${others}${saved}.${tail}`;
    case "busy": return `Already pulling${r.why ? ` (${bare(r.why)})` : ""}.`;
    case "missing": return `Not pulled: ${bare(r.why) ?? "the TwoGun sign-in is missing on this computer"}.`;
    case "unknown": return `Pull outcome unknown: ${bare(r.why) ?? "the run did not report back"}. Check the board's Pulled time.`;
    default: return `Pull failed${r?.at ? ` at ${r.at}` : ""}: ${bare(r?.why) ?? "no reason was given"}${others}${saved}.${tail}`;
  }
}

/** The button's own words: idle, or running with the seconds so far. Pure. */
export function buttonText({ running, startedMs, nowMs, label = "Pulling…" }) {
  if (!running) return "Pull now";
  const s = Math.max(0, Math.floor((nowMs - startedMs) / 1000));
  return `${label} ${s} s`;
}

/** The button and its line for the header, from the module's state, so a header redraw keeps both. Pure. */
export function pullNowHtml(s) {
  const title = s.running ? "A pull is running" : s.siteTitle ?? "Pull TwoGun's board now, rebuild the slate and save it";
  return `<span class="pngroup"><button id="pullNowBtn" class="lsw pullnow" title="${esc(title)}"${s.running ? " disabled" : ""}>${esc(buttonText(s))}</button>${lineHtml(s)}</span>`;
}

/** The line's box alone: always present, empty until a run ends; the site's key controls sit at its end. Pure. */
export function lineHtml(s) {
  const actions = (s.actions ?? []).map((a, i) => `<button type="button" class="pnact" data-pn-action="${i}">${esc(a.label)}</button>`).join("");
  return `<span id="pullNowLine" class="pnline${s.lineCls ? ` ${s.lineCls}` : ""}" role="status" aria-live="polite"${s.line ? ` title="${esc(s.line)}"` : ""}><span class="pntext">${esc(s.line ?? "")}</span>${actions}</span>`;
}

/** Whether the board should take the new numbers in place: only when the run says new numbers landed. Pure. */
export const shouldReload = (r) => r?.state === "pulled";
const CALM = new Set(["pulled", "unchanged", "older", "no_board", "saved"]); // the line's plain colour; anything else is red

/**
 * Wires the button. deps: { doc, now, every, stop, reload() (the board's in-page refresh), runner (the site's, when set: site-src/site-pull.js;
 * else the app's POST /api/pull-now), fetchImpl }. Clicks are taken at the document, since the header is redrawn whole.
 */
export function createPullNow({ doc = globalThis.document, now = Date.now, every = globalThis.setInterval?.bind(globalThis), stop = globalThis.clearInterval?.bind(globalThis), reload, runner = null, fetchImpl = (...a) => fetch(...a) } = {}) {
  const s = { running: false, startedMs: 0, nowMs: 0, label: "Pulling…", siteTitle: runner?.title ?? null, line: "", lineCls: "", actions: [] };
  let timer = null;
  const draw = () => {
    s.nowMs = now();
    const btn = doc?.getElementById("pullNowBtn");
    if (btn) { btn.textContent = buttonText(s); btn.disabled = s.running; }
  };
  const show = (text, cls = "", actions = []) => {
    s.line = text ?? ""; s.lineCls = cls; s.actions = actions;
    const el = doc?.getElementById("pullNowLine");
    if (!el) return;
    if (el.parentNode) el.outerHTML = lineHtml(s); // the page: the line's box is drawn afresh in place
    else { el.textContent = s.line; el.className = `pnline${cls ? ` ${cls}` : ""}`; } // a stand-in element (the tests)
  };
  const appRun = async () => {
    try {
      const r = await fetchImpl("/api/pull-now", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const body = await r.json().catch(() => null);
      if (body?.line) return body;
      return { state: "failed", line: `Pull failed: the app answered ${r.status}${body?.error?.message ? ` (${body.error.message})` : ""}.` };
    } catch (e) {
      return { state: "unknown", line: pullLine({ state: "unknown", why: `the app did not answer (${e.message})` }) };
    }
  };
  async function press() {
    if (s.running) return;
    s.running = true; s.startedMs = now(); s.label = runner?.label ?? "Pulling…";
    draw();
    timer = every?.(draw, 1000) ?? null;
    let result;
    try {
      result = runner ? await runner.run({ progress: (text, label) => { if (label) s.label = label; show(text); draw(); } }) : await appRun();
    } catch (e) {
      result = { state: "failed", line: pullLine({ state: "failed", why: e.message }) };
    } finally {
      s.running = false;
      if (timer !== null) stop?.(timer);
      timer = null;
      draw();
    }
    show(result.line, CALM.has(result.state) ? "" : "bad", runner?.actions?.(result) ?? []);
    if (shouldReload(result)) await reload?.();
    return result;
  }
  doc?.addEventListener?.("click", (e) => {
    if (e.target?.closest?.("#pullNowBtn")) { press(); return; }
    const act = e.target?.closest?.("[data-pn-action]");
    if (act) { const a = s.actions[Number(act.dataset.pnAction)]; if (a) show(a.run() ?? "", "", []); }
  });
  return { html: () => pullNowHtml({ ...s, nowMs: now() }), press, state: () => ({ ...s }), show };
}
