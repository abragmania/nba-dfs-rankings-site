// The public site's Pull now: the board's button (server/board/pull-now.js) runs this instead of the app's POST /api/pull-now. It starts the
// cloud job (.github/workflows/cloud-pull.yml, quick: pull, slate, news, save, publish) through GitHub's API with a fine-grained key Adam
// pastes once (Actions read and write on abragmania/NBADFSRankings only), kept in this browser's localStorage and sent only to api.github.com
// in a header, never in an address and never logged. It follows the run every 5 seconds for up to 15 minutes. Whether the run published is read
// from the site repo's baked/meta.json (published after the run started, from a new commit), never from a step's conclusion; then the slate on
// show is read from the site repo's freshly pushed baked files through GitHub's contents API (no wait for Pages) and the board takes them in
// place through its own refresh. Once a dispatch is sent, no GitHub error is called a failure: the job may be running. Pure parts tested in node.
import { adoptFresh } from "./static-api.js";
import { pullLine } from "../server/board/pull-now.js";

export const DATA_REPO = "abragmania/NBADFSRankings";
export const SITE_REPO = "abragmania/nba-dfs-rankings-site";
export const WORKFLOW = "cloud-pull.yml";
export const POLL_MS = 5_000, MAX_MS = 15 * 60_000;
export const FIND_AFTER_ERROR_MS = 60_000; // after a dispatch error that may still have started a run, how long the runs list is watched for it
export const POLL_ERRORS = 3;              // GitHub errors in a row while following a run before the answer is "unknown"
export const STORE_KEY = "nbadfs.githubKey";
const API = "https://api.github.com";
const CHECK_ACTIONS = "check Actions on GitHub before pressing again";

// ---------- the key, in this browser only ----------
export function keyStore(storage = globalThis.localStorage) {
  return {
    get() { try { return storage?.getItem(STORE_KEY) || null; } catch { return null; } },
    set(v) { try { storage?.setItem(STORE_KEY, v); return true; } catch { return false; } },
    forget() { try { storage?.removeItem(STORE_KEY); } catch { /* nothing kept to remove: this browser keeps nothing */ } },
  };
}

/** The headers every GitHub call carries; the key goes only here. Pure. */
export const ghHeaders = (key, accept = "application/vnd.github+json") => ({ Accept: accept, Authorization: `Bearer ${key}`, "X-GitHub-Api-Version": "2022-11-28" });

/** The dispatch call: quick run on main. Pure. */
export const dispatchRequest = (key) => ({
  url: `${API}/repos/${DATA_REPO}/actions/workflows/${WORKFLOW}/dispatches`,
  init: { method: "POST", headers: { ...ghHeaders(key), "Content-Type": "application/json" }, body: JSON.stringify({ ref: "main", inputs: { quick: "true" } }) },
});

/** What a refused GitHub answer means, as a sentence; `key` true when the key itself is the problem. Pure. */
export function refusal(status, message = "") {
  if (status === 401) return { key: true, why: "GitHub refused the key (401): it is wrong or expired" };
  if (status === 403) return { key: true, why: `GitHub refused the key (403${message ? `: ${message}` : ""}): it needs Actions read and write on ${DATA_REPO}, or it has expired` };
  if (status === 404) return { key: true, why: `GitHub could not find the cloud job with this key (404): it needs Actions read and write on ${DATA_REPO}` };
  return { key: false, why: `GitHub answered ${status}${message ? ` (${message})` : ""}` };
}

/** The run this press started: the newest workflow_dispatch run that was not there before the press. Null until it shows. Pure. */
export function pickRun(runs, knownIds) {
  const known = new Set(knownIds);
  return (runs ?? []).filter((r) => r?.event === "workflow_dispatch" && !known.has(r.id)).sort((a, b) => b.id - a.id)[0] ?? null;
}

/** Where a finished run ended. run: GitHub's run; jobs: its jobs list (only to name a failed step). { done, ok, why }. Pure. */
export function runVerdict(run, jobs) {
  if (!run || run.status !== "completed") return { done: false, ok: false, why: null };
  if (run.conclusion === "success") return { done: true, ok: true, why: null };
  const bad = (jobs ?? []).flatMap((j) => j?.steps ?? []).find((s) => s?.conclusion === "failure");
  const why = run.conclusion === "cancelled" ? "the run was cancelled (a newer run may have replaced it while it waited)" : bad ? `the step "${bad.name}" failed` : `the run ended ${run.conclusion ?? "without a result"}`;
  return { done: true, ok: false, why };
}

/**
 * Whether this run published the site, from the site repo's baked/meta.json before the press and after the run: published only when the new
 * meta was published after the run started and from another commit. "unknown" when the meta could not be read. Pure.
 */
export function siteVerdict({ before, after, runStartedAt }) {
  const t = Date.parse(after?.publishedAt ?? ""), start = Date.parse(runStartedAt ?? "");
  if (!after || Number.isNaN(t)) return "unknown";
  if (!Number.isNaN(start) && t > start && after.sourceCommit && after.sourceCommit !== before?.sourceCommit) return "published";
  return "not_seen";
}

/** The line's figures from the new baked slate and pull-moves files. Pure. */
export function figuresOf(slateText, movesText) {
  let slate = null, moves = null;
  try { slate = JSON.parse(slateText); } catch { slate = null; }
  try { moves = JSON.parse(movesText); } catch { moves = null; }
  const ready = moves?.pull_changes?.state === "ready";
  return {
    board: slate?.as_of?.board_updated ?? null,
    players: Array.isArray(slate?.players) ? slate.players.length : null,
    minutesMoved: ready ? Object.values(moves.moves ?? {}).filter((m) => m?.min).length : null,
  };
}

/** The four baked files of a slate the board reads, by their site path. Pure. */
export const slateFiles = (slate) => ["slate.json", "figures.json", "console-inputs.json", "pull-moves.json"].map((f) => `slates/${slate}/${f}`);

const etNow = (ms) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(ms).replace(/[  ]/g, " ") + " ET";

/**
 * The site's runner for createPullNow. deps: { fetchImpl, store, now, sleep, slateOnShow() (the ?slate= the board is showing), ask(promptText)
 * (resolves the pasted key or null), adopt(files) (static-api.js adoptFresh) }.
 */
export function createSitePull({ fetchImpl = (...a) => fetch(...a), store = keyStore(), now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), slateOnShow, ask, adopt = adoptFresh } = {}) {
  const gh = async (key, url, init = {}) => {
    const r = await fetchImpl(url, { cache: "no-store", ...init, headers: { ...ghHeaders(key), ...(init.headers ?? {}) } });
    if (!r.ok && r.status !== 204) {
      let message = "";
      try { message = (await r.json())?.message ?? ""; } catch { message = ""; }
      const said = refusal(r.status, message);
      const e = new Error(said.why);
      e.keyProblem = said.key;
      e.status = r.status;
      throw e;
    }
    return r;
  };
  const siteFile = async (key, rel) => {
    const r = await gh(key, `${API}/repos/${SITE_REPO}/contents/baked/${rel}?ref=main`, { headers: { Accept: "application/vnd.github.raw+json" } }).catch((e) => { if (e.status === 404) return null; throw e; });
    return r ? r.text() : null;
  };
  const siteMeta = async (key) => { const t = await siteFile(key, "meta.json"); try { return t ? JSON.parse(t) : null; } catch { return null; } };
  const runsUrl = `${API}/repos/${DATA_REPO}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=10`;
  const listRuns = async (key) => (await (await gh(key, runsUrl)).json())?.workflow_runs ?? [];
  let lastKeyProblem = false;
  const unknown = (why) => ({ state: "unknown", line: pullLine({ state: "unknown", why }) });

  async function run({ progress } = {}) {
    let key = store.get();
    if (!key) {
      key = await ask?.("Paste a GitHub key with Actions read and write on abragmania/NBADFSRankings; it stays in this browser only.");
      if (!key) return { state: "failed", line: "Not pulled: no GitHub key was given." };
      key = key.trim();
      if (!store.set(key)) progress?.("This browser will not keep the key; it is used for this press only.");
    }
    lastKeyProblem = false;
    const started = now();
    // ---- before the dispatch: any error here means nothing was started ----
    let before, known;
    try {
      before = await siteMeta(key).catch(() => null);
      known = (await listRuns(key)).map((r) => r.id);
    } catch (e) {
      lastKeyProblem = Boolean(e.keyProblem);
      return { state: "failed", line: pullLine({ state: "failed", why: e.message }) };
    }
    const d = dispatchRequest(key);
    let runId = null;
    try {
      await gh(key, d.url, d.init);
    } catch (e) {
      if (e.keyProblem) { lastKeyProblem = true; return { state: "failed", line: pullLine({ state: "failed", why: e.message }) }; } // refused: nothing started
      // Any other error: the run may have started all the same, so the runs list is watched for it before anything is said.
      const until = now() + FIND_AFTER_ERROR_MS;
      while (now() < until && runId === null) {
        await sleep(POLL_MS);
        progress?.(`GitHub's answer to the start was unclear (${e.message}); looking for the run…`, "Starting…");
        try { runId = pickRun(await listRuns(key), known)?.id ?? null; } catch { runId = null; }
      }
      if (runId === null) return unknown(`the cloud job may have started (${e.message}); ${CHECK_ACTIONS}`);
    }
    progress?.("Cloud pull asked for; waiting for GitHub to start it…", "Starting…");
    // ---- following the run: a few GitHub errors in a row are tolerated, then the answer is "unknown" ----
    let verdict = { done: false }, theRun = null, errors = 0;
    while (now() - started < MAX_MS) {
      await sleep(POLL_MS);
      const secs = Math.round((now() - started) / 1000);
      try {
        if (runId === null) {
          runId = pickRun(await listRuns(key), known)?.id ?? null;
          if (runId === null) { progress?.(`Cloud pull asked for ${secs} s ago; GitHub has not started it yet…`, "Starting…"); errors = 0; continue; }
        }
        theRun = await (await gh(key, `${API}/repos/${DATA_REPO}/actions/runs/${runId}`)).json();
        errors = 0;
        if (theRun.status !== "completed") { progress?.(`Cloud pull ${["queued", "waiting", "pending", "requested"].includes(theRun.status) ? "waiting in GitHub's queue" : "running"}… ${secs} s`, "Cloud pull…"); continue; }
        const jobs = theRun.conclusion === "success" ? [] : (await (await gh(key, `${API}/repos/${DATA_REPO}/actions/runs/${runId}/jobs`)).json().catch(() => null))?.jobs ?? [];
        verdict = runVerdict(theRun, jobs);
        break;
      } catch (e) {
        errors += 1;
        if (errors >= POLL_ERRORS) return unknown(`GitHub stopped answering while the cloud pull was followed (${e.message}); it may still finish, and the site then updates by itself; ${CHECK_ACTIONS}`);
      }
    }
    if (!verdict.done) return unknown(`the cloud pull had not finished after ${MAX_MS / 60_000} minutes; it may still finish, and the site then updates by itself`);
    if (!verdict.ok) return { state: "failed", line: pullLine({ state: "failed", at: etNow(now()), why: `cloud pull: ${verdict.why}` }) };
    // ---- the run succeeded: did it publish? judged by the site repo's meta, never a step's conclusion ----
    let after = null;
    try { after = await siteMeta(key); } catch { after = null; }
    const site = siteVerdict({ before, after, runStartedAt: theRun?.run_started_at ?? theRun?.created_at });
    if (site !== "published") {
      return { state: "saved", line: `Cloud pull done at ${etNow(now())}: saved; whether the site published is unknown (no new board, no site key and a publish that did not go through all look the same from here).` };
    }
    const slate = slateOnShow?.();
    const rels = slate ? [...slateFiles(slate), "slates.json"] : [];
    try {
      if (!slate) throw new Error("no slate is on show");
      const texts = await Promise.all(rels.map((rel) => siteFile(key, rel)));
      const files = Object.fromEntries(rels.map((rel, i) => [rel, texts[i]]).filter(([, t]) => t !== null));
      if (!files[`slates/${slate}/slate.json`]) throw new Error(`the site has no slate.json for ${slate}`);
      adopt(files);
      const f = figuresOf(files[`slates/${slate}/slate.json`], files[`slates/${slate}/pull-moves.json`]);
      return { state: "pulled", line: pullLine({ state: "pulled", at: etNow(now()), ...f, saved: { state: "pushed" } }) };
    } catch (e) {
      return { state: "saved", line: `Pulled and published at ${etNow(now())}; the new numbers could not be read here (${e.message}); they arrive within minutes.` };
    }
  }

  /** The line's controls after a run: replace the key after a refusal, and forget it. Each returns the line's new words. */
  function actions() {
    if (!store.get()) return [];
    const forget = { label: "Forget key", run: () => { store.forget(); return "The GitHub key was removed from this browser."; } };
    return lastKeyProblem ? [{ label: "Replace key", run: () => { store.forget(); return "Key removed; press Pull now to paste a new one."; } }, forget] : [forget];
  }

  return { run, actions, label: "Cloud pull…", title: "Start the cloud pull on GitHub (quick run), then show the new numbers here" };
}

/**
 * The key prompt: a small panel fixed under the header's top right (outside the header, which is redrawn whole), a password box with Save and
 * Cancel. Resolves the key, or null.
 */
export function askPanel(doc = globalThis.document) {
  return (text) => new Promise((resolve) => {
    doc.getElementById("pnAsk")?.remove();
    const box = doc.createElement("div");
    box.id = "pnAsk";
    box.className = "pnask";
    const p = doc.createElement("div");
    p.textContent = text;
    const input = doc.createElement("input");
    input.type = "password"; input.autocomplete = "off"; input.placeholder = "github_pat_…"; input.setAttribute("aria-label", "GitHub key");
    const save = doc.createElement("button"), cancel = doc.createElement("button");
    save.type = cancel.type = "button"; save.textContent = "Save"; cancel.textContent = "Cancel";
    const end = (v) => { box.remove(); resolve(v); };
    save.addEventListener("click", () => end(input.value.trim() || null));
    cancel.addEventListener("click", () => end(null));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") end(input.value.trim() || null); if (e.key === "Escape") end(null); });
    box.append(p, input, save, cancel);
    doc.body.append(box);
    input.focus();
  });
}
