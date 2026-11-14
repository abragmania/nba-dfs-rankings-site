// The Pull now button in the board's header and its one line beside it. The words are pure and tested in node; the app's run (POST /api/pull-now,
// server/pullnow/route.js) and the public site's run (site-src/site-pull.js, through GitHub) both end in pullLine's sentence. After a run that
// brought new numbers, `reload` is the board's own in-page refresh (slate-refresh.js createRefresher().tick): never a page reload, his typed
// numbers, picks, tab, console work and scroll stay. The header is redrawn whole (board.js renderTop), so the button and the line are drawn from
// this module's state each time; the line's box is always there, its width fixed, so nothing moves when its words change.
import { esc, shortTime, tipMs } from "./board-util.js";
import { lastName } from "./console-model.js";
import { staleOf, withFreshness, claimsFor, outVsFive, keptWords, LINEUP_KEYS } from "./lineup-proposals.js";

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
  const newsWords = r?.news?.status === "failed" ? ` Lineup news not applied: ${bare(r.news.note) ?? "no reason given"}; the board stays on TwoGun's numbers.` : r?.news?.status === "skipped" && !r.news.locked ? ` Lineup news not applied: ${bare(r.news.note) ?? "no reason given"}.` : r?.news?.applied?.length ? ` Lineup news applied: ${plural(r.news.applied.length, "change", "changes")}.` : "";
  const backWords = `${r?.news?.reversed?.length ? ` Put back in, no source has him Out: ${r.news.reversed.join(", ")}.` : ""}${r?.news?.heldBack?.length ? ` Not put back in: ${r.news.heldBack.map((h) => `${h.name} (${bare(h.why)})`).join("; ")}.` : ""}`;
  const tail = `${r?.alsoFailed?.length ? ` Also failed: ${r.alsoFailed.join(", ")}.` : ""}${newsWords}${backWords}`;
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

// ---------- the pull status: the most recent pull, each source's newest update, and whether a pull is running anywhere ----------
// The raw status both sides produce (the app: server/pullnow/status.js through GET /api/pull-status; the site: site-src/site-pull.js):
// { readAtMs, slate, last: { atMs, where: "desktop" | "laptop" | "cloud" | "this computer" | null, result } | null,
//   running: { local: { startedMs } | null, cloud: "idle" | "running" | "unknown", cloudDetail, cloudWhy, cloudStartedMs },
//   sources: [{ label, text (Eastern words, null when not known), note }] }. A missing figure is shown as missing, never a zero or a blank.
const ET_FULL = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
/** An instant as Eastern words with its day: "Fri, Nov 6, 2:45 PM ET". Null when it is not a number. Pure. */
export function etStamp(ms) {
  if (!Number.isFinite(ms)) return null;
  const p = Object.fromEntries(ET_FULL.formatToParts(ms).map((x) => [x.type, x.value]));
  return `${p.weekday}, ${p.month} ${p.day}, ${p.hour}:${p.minute} ${p.dayPeriod} ET`;
}
/** An instant as an Eastern clock time alone: "2:45 PM ET". Null when it is not a number. Pure. */
export const etClock = (ms) => { const t = etStamp(ms); return t ? t.replace(/^[^,]+, [^,]+, /, "") : null; };

/** TwoGun's stamp ("Fri, Nov 6, 1:37 PM CT", maybe with a parenthesis after) as "Fri, Nov 6, 2:37 PM ET"; the clock alone when the conversion crosses midnight. Null when missing. Pure. */
export function twogunStamp(text, refMs = Date.now()) {
  if (typeof text !== "string" || !text.trim()) return null;
  const clean = text.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const t = boardShort(clean, refMs);
  if (!t) return null;
  const m = clean.match(/^([A-Za-z]{3},\s+[A-Za-z]{3}\s+\d{1,2}),\s*(\d{1,2}):\d{2}\s*([AP]M)\s+CT$/i), et = t.match(/^(\d{1,2}):\d{2} ([AP]M) ET$/);
  if (!m || !et) return t;
  const h24 = (h, ap) => (Number(h) % 12) + (/p/i.test(ap) ? 12 : 0);
  return h24(et[1], et[2]) < h24(m[2], m[3]) ? t : `${m[1]}, ${t}`;
}

/** The instant in a saved file's name ("2026-11-06T144543-0500"). Null when the name has none. Pure. */
export function fileStampMs(name) {
  const m = String(name ?? "").match(/(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})([+-]\d{2})(\d{2})/);
  const ms = m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}${m[5]}:${m[6]}`) : NaN;
  return Number.isNaN(ms) ? null : ms;
}

/** The newest NBA injury report edition in a news timing file (jsonl): { label ("1:30 PM"), publishedMs, seenMs } or null. Pure. */
export function latestEdition(text) {
  let best = null;
  for (const line of String(text ?? "").split("\n")) {
    if (!line.includes('"edition"')) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r?.kind !== "edition") continue;
    const published = Date.parse(r.publishedAt), seen = Date.parse(r.seenAt);
    const label = String(r.edition ?? "").match(/_(\d{2})_(\d{2})(AM|PM)/);
    if (Number.isNaN(published) || (best && published < best.publishedMs)) continue;
    best = { label: label ? `${Number(label[1])}:${label[2]} ${label[3]}` : null, publishedMs: published, seenMs: Number.isNaN(seen) ? null : seen };
  }
  return best;
}

/** The newest time named by `field` in a jsonl change log's text, or null. Pure. */
export function newestTime(text, field) {
  let best = null;
  for (const line of String(text ?? "").split("\n")) {
    if (!line.includes(field)) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    const ms = Date.parse(r?.[field]);
    if (!Number.isNaN(ms) && (best === null || ms > best)) best = ms;
  }
  return best;
}

const GOOD_RESULT = new Set(["pulled", "unchanged", "older", "no_board"]);
export const resultWords = (r) => ({ pulled: "new board", unchanged: "no new board", older: "no new board", no_board: "no new board", failed: "failed", missing: "failed", finished: "finished, board unknown", busy: "unknown", unknown: "unknown" })[r] ?? "unknown";
export const whereWords = (w) => (["desktop", "laptop", "cloud", "this computer"].includes(w) ? w : "where unknown");

export const STALE_RUN_MS = 60 * 60_000; // a run still open after an hour is not counted: the job's own cap is far shorter
const OPEN_RUN = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);
/**
 * The cloud job's state from its recent runs; each caller (gh on the computer, GitHub's REST on the site) maps its own shape to
 * [{ status, createdMs, startedMs, conclusion, doneMs }] first. { cloud: "idle" | "running" | "unknown", cloudDetail, cloudStartedMs, cloudWhy }.
 * An open run whose time cannot be read counts as running (never idle); one open past STALE_RUN_MS is ignored. Pure.
 */
export function cloudState(runs, nowMs) {
  if (!Array.isArray(runs)) return { cloud: "unknown", cloudWhy: "GitHub gave no run list" };
  const key = (r) => (Number.isFinite(r.createdMs) ? r.createdMs : Infinity);
  const open = runs.filter((r) => OPEN_RUN.has(r?.status) && !(Number.isFinite(r.createdMs) && nowMs - r.createdMs >= STALE_RUN_MS)).sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  if (!open.length) return { cloud: "idle" };
  const r = open[0], started = Number.isFinite(r.startedMs) ? r.startedMs : Number.isFinite(r.createdMs) ? r.createdMs : null;
  return { cloud: "running", cloudDetail: r.status === "in_progress" ? "running" : "queued", cloudStartedMs: started };
}

/** The newest completed run of the cloud job as the lastRun input of cloudLast: { doneMs, createdMs, conclusion } or null. Callers map their shape first. Pure. */
export function newestDone(runs) {
  const done = (runs ?? []).filter((r) => r?.status === "completed" && Number.isFinite(r.doneMs)).sort((a, b) => b.doneMs - a.doneMs)[0];
  return done ? { doneMs: done.doneMs, createdMs: done.createdMs, conclusion: done.conclusion ?? null } : null;
}

/**
 * The cloud's most recent pull entry: the newest finished run's end, with its result: a failed run is "failed"; otherwise the last-read record's status
 * when that read happened during the run, else "unknown". A read outside every run (a later run still going, or no run list) is its own entry; the newest
 * entry wins. Null when neither is known. Pure.
 */
export function cloudLast({ run = null, read = null }) {
  const readOk = Boolean(read) && Number.isFinite(read.readMs);
  const entries = [];
  const within = run && readOk && Number.isFinite(run.createdMs) && Number.isFinite(run.doneMs) && read.readMs >= run.createdMs && read.readMs <= run.doneMs;
  if (run && Number.isFinite(run.doneMs)) entries.push({ atMs: run.doneMs, where: "cloud", result: run.conclusion === "failure" ? "failed" : within ? read.status ?? "unknown" : "unknown" });
  if (readOk && !within) entries.push({ atMs: read.readMs, where: "cloud", result: read.status ?? "unknown" }); // a read outside any listed run (one still running, or older)
  return entries.sort((a, b) => b.atMs - a.atMs)[0] ?? null;
}

/**
 * The per-source rows from what is saved. in: { slateName, slate (slate.json or null), entry (the slate's manifest entry or null), bbm ({ checkedMs, changedMs,
 * changedWhy } or null), nba ({ edition (latestEdition), checkedMs } or null), noNews (why the news is not readable here, or null), refMs }.
 * Each row { label, text, note }: text null when no time is known, with the note saying why. Never a stand-in time. Pure.
 */
export function buildSources({ slateName = null, slate = null, entry = null, bbm = null, nba = null, noNews = null, refMs = Date.now() } = {}) {
  const none = slate ? "unknown (not in the slate file)" : "not pulled yet";
  const row = (label, text, note = null) => ({ label, text: text ?? null, note: text ? note : note ?? none });
  const a = slate?.as_of ?? {};
  const hasOwn = Array.isArray(slate?.players) && slate.players.some((p) => typeof p?.proj_own === "number");
  // The ownership has its own saved time only in the board row's stamp; the board's time stands for it only when the slate says ownership came from the board read.
  const ownRaw = slate?.as_of_by_source?.twogun_row?.updated ?? (String(slate?.sources?.proj_own ?? "").startsWith("board_row.json") ? a.board_updated : null);
  const rows = [
    row("TwoGun board", twogunStamp(a.board_updated, refMs)),
    row("TwoGun injuries", twogunStamp(a.injury_report, refMs)),
    row("Projected ownership", hasOwn ? twogunStamp(ownRaw, refMs) : null, null),
    row("Newest saved pull", etStamp(Date.parse(a.pull_started))),
  ];
  if (slate && !hasOwn) rows[2].note = "not pulled yet (TwoGun has not posted it)";
  else if (hasOwn && !rows[2].text) rows[2].note = "unknown (no time saved for the ownership)";
  const news = (label, text, miss) => row(label, text, text ? null : noNews ?? miss);
  const ed = nba?.edition;
  rows.push(
    news("Basketball Monster checked", bbm?.checkedMs ? etStamp(bbm.checkedMs) : null, "unknown (no saved check for this slate)"),
    news("Basketball Monster last change", bbm?.changedMs ? etStamp(bbm.changedMs) : null, bbm?.changedWhy ?? "unknown (no change log)"),
    news("NBA injury report", ed ? `${ed.label ? `${ed.label} edition` : `edition published ${etClock(ed.publishedMs)}`}` : null, "unknown (no saved report edition for this slate)"),
    news("NBA report checked", nba?.checkedMs ? etStamp(nba.checkedMs) : null, "unknown (no saved report check for this slate)"),
  );
  if (entry) {
    const covered = new Set(["TwoGun database row", "projected ownership (database row)"]);
    for (const item of entry.captured ?? []) if (!covered.has(item)) rows.push({ label: item, text: "saved", note: null });
    if (Array.isArray(entry.pulls)) rows.push({ label: "Pulls saved for this slate", text: String(entry.pulls.length), note: null });
    for (const item of entry.missing ?? []) rows.push({ label: item, text: null, note: "not pulled yet", group: "later" });
  }
  return rows.map((r) => ({ label: r.label, text: r.text, note: r.text ? r.note : r.note ?? none, ...(r.group ? { group: r.group } : {}) }));
}

/** Whether a pull is running anywhere we can see, and why, from the module's state. { busy, why }. Pure. */
export function busyOf(s) {
  const why = [], st = s.status;
  if (s.running) why.push("a pull you started is running");
  if (st?.running?.local && !s.running) why.push(`a pull is running on this computer since ${etClock(st.running.local.startedMs) ?? "an unknown time"}`);
  if (st?.running?.cloud === "running") why.push(`the cloud job is ${st.running.cloudDetail ?? "running"}${st.running.cloudStartedMs ? ` since ${etClock(st.running.cloudStartedMs)}` : ""}`);
  return { busy: why.length > 0, why: why.join("; ") };
}

/** The summary line's words and class: { summary, title, cls }. Pure. */
export function statusView(s) {
  const st = s.status, b = busyOf(s);
  const cloudUnknown = st?.running?.cloud === "unknown";
  const tail = cloudUnknown ? " · cloud status unknown" : "";
  const title = [b.busy ? `Don't press: ${b.why}` : null, cloudUnknown ? `Cloud status unknown: ${st.running.cloudWhy ?? "GitHub could not be read"}` : null, st?.last?.why ? `Last pull: ${st.last.why}` : null, st?.last?.hook?.length ? `Publish hook: ${st.last.hook.join("; ")}` : null].filter(Boolean).join(". ");
  if (b.busy) return { summary: `Pulling… don't press (${b.why})`, title, cls: "busy" };
  if (!st) return s.statusErr ? { summary: `Pull status unknown (${s.statusErr})`, title: s.statusErr, cls: "unk" } : { summary: "Checking pull status…", title: "", cls: "" };
  if (!st.last) return { summary: `Last pull unknown${tail}`, title: title || "No pull time is saved on this computer", cls: "unk" };
  return { summary: `Last pull ${etStamp(st.last.atMs) ?? "at an unknown time"} · ${whereWords(st.last.where)} · ${resultWords(st.last.result)}${tail}`, title, cls: s.statusErr || !GOOD_RESULT.has(st.last.result) ? "unk" : "" }; // the dim dot: the read failed, or the last pull failed or its outcome is unknown
}

// ---------- the freshness tag: one coloured word for "am I current?" (green / amber / red), beside the Pull now button ----------
export const FRESH_WINDOW_MS = 2 * 3_600_000; // the age limits bite only in the 2 hours before the first tip (and after it)
export const FRESH_AMBER_MS = 30 * 60_000;
export const FRESH_RED_MS = 60 * 60_000;
const FRESH_REASON_MAX = 60;

/** The earliest tip among the board's rows as an instant, or null when none can be read (then the age limits do not apply). Pure. */
export function firstTipOf(players, refMs = Date.now()) {
  const t = (players ?? []).map((p) => tipMs(p?.tip, refMs)).filter(Number.isFinite);
  return t.length ? Math.min(...t) : null;
}

/** An age as words: "just now", "3 min ago", "1 h 20 min ago". Pure. */
export function ageWords(ms) {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60), r = m % 60;
  return `${h} h${r ? ` ${r} min` : ""} ago`;
}

const shortReason = (t) => { const x = String(t ?? "").replace(/\s+/g, " ").trim().replace(/\.+$/, ""); const c = x.charAt(0).toUpperCase() + x.slice(1); return c.length > FRESH_REASON_MAX ? `${c.slice(0, FRESH_REASON_MAX - 1).trimEnd()}…` : c; };

/**
 * The freshness tag from the pull status: { level: "green" | "amber" | "red" | "busy" | "unk", text, title, cls }. Red: any step failed (the last pull's result or note,
 * or this page's own failed press), or the last pull is over 60 min old inside the 2 hours before the first tip (firstTipMs, null = no age limit). Amber: the light
 * check names a change since the pull, or the pull is 30 to 60 min old in that window. Green otherwise. A pull running, a missing status or no known last pull keep
 * the plain words of statusView. s.nowMs is the clock. Pure.
 */
export function freshnessOf(s) {
  const base = statusView(s), st = s.status;
  if (base.cls === "busy" || !st?.last) return { level: base.cls === "busy" ? "busy" : "unk", text: base.summary, title: base.title, cls: base.cls };
  const nowMs = Number.isFinite(s.nowMs) && s.nowMs > 0 ? s.nowMs : Date.now(), last = st.last, age = Math.max(0, nowMs - last.atMs);
  const when = (age >= 24 * 3_600_000 ? etStamp(last.atMs) : etClock(last.atMs))?.replace(/ ET$/, "") ?? "an unknown time", ageW = ageWords(age);
  const tip = Number.isFinite(s.firstTipMs) ? s.firstTipMs : null, inWindow = tip !== null && nowMs >= tip - FRESH_WINDOW_MS;
  const detail = `Last pull ${etStamp(last.atMs) ?? "at an unknown time"} (${ageW}) · ${whereWords(last.where)} · ${resultWords(last.result)}`;
  const mk = (level, text, extra) => ({ level, text, title: [extra, detail, base.title].filter(Boolean).join(". "), cls: `f${level}` });
  const noteWhy = last.why && !/^not put back in/i.test(last.why) ? last.why : null; // men held back is information, not a failure
  const pressWhy = s.lineCls === "bad" && s.line ? String(s.line).replace(/^Pull failed(?: at .*? ET)?: /, "") : null;
  const badResult = !GOOD_RESULT.has(last.result) && last.result !== "finished";
  const why = noteWhy ?? pressWhy ?? (badResult ? (last.result === "failed" || last.result === "missing" ? "the pull failed" : "the outcome is unknown") : null);
  if (why) return mk("red", `Pull had a problem: ${shortReason(why)}`, `Pull had a problem: ${String(why).replace(/\s+/g, " ").trim()}`);
  if (inWindow && age > FRESH_RED_MS) return mk("red", `Stale: last pull ${ageW}`, "More than 60 minutes since the last pull, and the first tip is within 2 hours");
  const badge = badgeView(st.light);
  if (badge) return mk("amber", st.light.site ? "Lineup read has men Out the board plays: press Pull now" : "TwoGun updated since your pull: press Pull now", badge.text);
  if (inWindow && age >= FRESH_AMBER_MS) return mk("amber", `Pulled ${ageW}: press Pull now`, "30 to 60 minutes since the last pull, and the first tip is within 2 hours");
  return mk("green", `Up to date · pulled ${when} (${ageW})`, st.light ? "The light check sees no change since" : null);
}

/** Escaped text with a leading weekday ("Fri, Nov 6, ...") wrapped so a phone can hide it. Pure. */
const dayHtml = (text) => esc(text).replace(/\b((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), )(?=[A-Z][a-z]{2} \d)/g, '<span class="pnwd">$1</span>');

function panelHtml(s) {
  const st = s.status;
  const kv = (k, v, cls = "") => `<div class="pnrow"><span>${esc(k)}</span><b${cls ? ` class="${cls}"` : ""}>${v}</b></div>`;
  const out = [];
  if (!st) return `<div class="pnpanel" role="region" aria-label="Pull status">${kv("Status", esc(s.statusErr ? `unknown (${s.statusErr})` : "checking…"), s.statusErr ? "pnmiss" : "")}</div>`;
  const run = st.running ?? {};
  out.push("<h5>Most recent pull</h5>");
  out.push(st.last ? kv("When", dayHtml(etStamp(st.last.atMs) ?? "unknown")) + kv("Where", esc(whereWords(st.last.where))) + kv("Result", esc(resultWords(st.last.result))) + (st.last.why ? kv("Note", esc(st.last.why), "pnmiss") : "") : kv("When", "unknown", "pnmiss"));
  out.push("<h5>Running now</h5>");
  out.push(kv("This computer", run.local ? esc(`yes, since ${etClock(run.local.startedMs)}`) : s.running ? "yes, started here" : "no"));
  out.push(kv("Cloud job", run.cloud === "running" ? esc(`${run.cloudDetail ?? "running"}${run.cloudStartedMs ? `, started ${etClock(run.cloudStartedMs)}` : ""}`) : run.cloud === "idle" ? "no" : esc(`unknown (${run.cloudWhy ?? "GitHub could not be read"})`), run.cloud === "unknown" ? "pnmiss" : ""));
  const rowOf = (r) => kv(r.label, r.text ? `${dayHtml(r.text)}${r.note ? ` <small>${esc(r.note)}</small>` : ""}` : esc(r.note ?? "unknown"), r.text || r.group === "later" ? "" : "pnmiss");
  out.push("<h5>Newest update per source</h5>");
  for (const r of (st.sources ?? []).filter((x) => x.group !== "later")) out.push(rowOf(r));
  const later = (st.sources ?? []).filter((x) => x.group === "later");
  if (later.length) { out.push("<h5>Later tonight</h5>"); for (const r of later) out.push(rowOf(r)); }
  if (st.light) {
    out.push("<h5>Light check</h5>", kv("Checked", dayHtml(etStamp(st.light.atMs) ?? "unknown")));
    for (const u of st.light.unknown ?? []) out.push(kv(u.source, esc(`not read (${u.why})`), "pnmiss"));
    for (const n of st.light.notes ?? []) out.push(kv(n.source, esc(n.text))); // read but left off the badge, counted with why (G62)
    if (st.light.note) out.push(`<div class="pnread">${esc(st.light.note)}</div>`);
  }
  if (s.line) out.push(`<h5>This page's last press</h5><div class="pnlast">${esc(s.line)}</div>`);
  out.push(`<div class="pnread">Status read ${esc(etClock(st.readAtMs) ?? "at an unknown time")}${s.statusErr ? esc(`; the latest read failed (${s.statusErr}), so this is the earlier one`) : ""}</div>`);
  return `<div class="pnpanel" role="region" aria-label="Pull status">${out.join("")}</div>`;
}

/** The status summary line and, when open, its panel. Always drawn (its box is reserved), so a header redraw keeps it. Pure. */
export function statHtml(s) {
  const f = freshnessOf(s), v = { summary: f.text, title: f.title, cls: f.cls };
  return `<span id="pullNowStat" class="pnstat${v.cls ? ` ${v.cls}` : ""}"><button type="button" class="pnsum" data-pn-toggle aria-expanded="${s.open ? "true" : "false"}"${v.title ? ` title="${esc(v.title)}"` : ""}><i class="pndot"></i><span class="pnsumtext">${dayHtml(v.summary)}</span><span class="pncaret"></span></button>${s.open ? panelHtml(s) : ""}</span>`;
}

/** The Pull now button's extra class from the tag: " fa" (amber outline) or " fr" (red outline), else "". Pure. */
const btnTone = (s) => { const l = freshnessOf(s).level; return l === "amber" ? " fa" : l === "red" ? " fr" : ""; };

/** The button and its status and line for the header, from the module's state, so a header redraw keeps all three. Pure. */
export function pullNowHtml(s) {
  const b = busyOf(s);
  const title = s.running ? "A pull is running" : b.busy ? `Don't press: ${b.why}` : s.siteTitle ?? "Pull TwoGun's board now, rebuild the slate and save it";
  const text = s.running ? buttonText(s) : b.busy ? "Pulling…" : "Pull now";
  return `<span class="pngroup"><button id="pullNowBtn" class="lsw pullnow${btnTone(s)}" title="${esc(title)}"${b.busy ? " disabled" : ""}>${esc(text)}</button><span class="pnbox">${statHtml(s)}${lineHtml(s)}</span></span>`;
}

/** The badge's words from a light-check answer, or null with nothing to say: { text, title }. Only a difference is ever said; what could not be read goes in the title and the panel, never as "no changes". Pure. */
export function badgeView(light) {
  const changes = light?.changes ?? [];
  if (!changes.length) return null;
  const n = changes.length, words = changes.map((c) => c.text).join(", ");
  const text = light.site ? `The lineup read has ${n} ${n === 1 ? "man" : "men"} Out that the board still plays: ${words}` : `${n} change${n === 1 ? "" : "s"} since your pull: ${words}`;
  const unread = (light.unknown ?? []).map((u) => u.source);
  const kept = changes.filter((c) => c.kept).map((c) => `${c.text}: ${c.kept}`); // an Out kept from a source no longer fresh says so
  return { text, title: [`${text}. Press to pull.`, kept.length ? `Kept Outs: ${kept.join("; ")}.` : null, light.note ?? null, unread.length ? `Not read: ${unread.join(", ")}` : null].filter(Boolean).join(" ") };
}

/**
 * The public site's light check, from what it can read with no server: men its published lineup read has Out whom the published board still plays. Nothing else can be read from a browser, so nothing else is claimed. A near-name match is left out.
 * in: { latest (the baked lineup read, or null), readWhy (why it could not be read, when that is so), players (the board's rows), nowMs }. atMs is the read's own time, null when it has none. Returns { atMs, changes, unknown, site, note }. Pure.
 */
export function publishedChanges({ latest, readWhy = null, players, nowMs }) {
  const gen = Date.parse(latest?.generated_at ?? "");
  const base = { atMs: Number.isNaN(gen) ? null : gen, changes: [], site: true, note: "From the published lineup read only; TwoGun, the NBA report and Monster's news page cannot be read from this site." };
  if (!latest) return { ...base, unknown: [{ source: "Published lineup read", why: readWhy ?? "the site has none for this slate" }] }; // a read with every source stale still gives its kept Outs (Adam 11-13)
  const playing = new Map((players ?? []).filter((p) => p.minutes > 0).map((p) => [String(p.dk_id), p]));
  const out = new Map(), wf = withFreshness(latest, nowMs); // the engine's own claims: kept Outs stand, one a fresh five cancels or two fresh feeds dispute does not count (Adam 11-13)
  for (const team of Object.keys(latest.teams ?? {})) {
    const claims = claimsFor(wf, team), contested = new Set(outVsFive(claims).map((c) => c.id));
    for (const [id, cl] of claims.out) {
      const p = !contested.has(id) && cl.some((c) => !c.near) ? playing.get(String(id)) : null; // a near-name match is left out
      const keptBy = cl.every((c) => c.held) ? [...new Set(cl.map((c) => keptWords(wf, c.key, wf.teams?.[team]?.[c.key])).filter(Boolean))] : [];
      if (p) out.set(p.dk_id, { key: `man:${p.dk_id}:OUT`, text: lastName(p.name), source: "lineups", ...(keptBy.length ? { kept: keptBy.join("; ") } : {}) });
    }
  }
  return { ...base, changes: [...out.values()], unknown: [] };
}

/** Which published read a light answer is from: the slate and the read's time. Pure. */
const lightKey = (s) => `${s.status?.slate ?? ""}|${s.status?.light?.atMs ?? ""}`;

/** The line's box alone: always present, empty until a run ends; the site's key controls sit at its end. The light check's badge takes the same place, so nothing else moves, except that a failed press keeps its words and the badge is hidden while a pull runs. Pure. */
export function lineHtml(s) {
  const actions = (s.actions ?? []).map((a, i) => `<button type="button" class="pnact" data-pn-action="${i}">${esc(a.label)}</button>`).join("");
  const badge = s.running || s.lineCls === "bad" || (s.heldLight != null && s.heldLight === lightKey(s)) ? null : badgeView(s.status?.light); // heldLight: the site's press keeps its result line until the next slate or publish
  if (badge) return `<span id="pullNowLine" class="pnline pnhasbadge" role="status" aria-live="polite"><button type="button" id="pullNowBadge" class="pnbadge" title="${esc(badge.title)}"${busyOf(s).busy ? " disabled" : ""}>${esc(badge.text)}</button>${actions}</span>`;
  return `<span id="pullNowLine" class="pnline${s.lineCls ? ` ${s.lineCls}` : ""}" role="status" aria-live="polite"${s.line ? ` title="${esc(s.line)}"` : ""}><span class="pntext">${esc(s.line ?? "")}</span>${actions}</span>`;
}

/** Whether the board should take the new numbers in place: only when the run says new numbers landed. Pure. */
export const shouldReload = (r) => r?.state === "pulled" || Boolean(r?.news?.applied?.length || r?.news?.reversed?.length); // news that moved a number on an unchanged board reaches the page too
const CALM = new Set(["pulled", "unchanged", "older", "no_board", "saved"]); // the line's plain colour; anything else is red

/**
 * Wires the button. deps: { doc, now, every, stop, reload() (the board's in-page refresh), runner (the site's, when set: site-src/site-pull.js;
 * else the app's POST /api/pull-now), fetchImpl }. Clicks are taken at the document, since the header is redrawn whole.
 */
export const STATUS_POLL_MS = 15_000; // the status is read at most this often, and only while the page is visible
export function createPullNow({ doc = globalThis.document, now = Date.now, every = globalThis.setInterval?.bind(globalThis), stop = globalThis.clearInterval?.bind(globalThis), reload, runner = null, fetchImpl = (...a) => fetch(...a), pollMs = doc === globalThis.document ? STATUS_POLL_MS : 0, firstTipMs = null } = {}) {
  const s = { running: false, startedMs: 0, nowMs: 0, label: "Pulling…", siteTitle: runner?.title ?? null, line: "", lineCls: "", actions: [], status: null, statusErr: null, open: false };
  let timer = null, polling = null, lastPollMs = -Infinity, lastLineHtml = null;
  const tick = () => { s.nowMs = now(); s.firstTipMs = firstTipMs?.() ?? null; }; // the clock and the first tip the tag's ages are read against (redrawn at every status read, so the ages move with it)
  const draw = () => {
    tick();
    const btn = doc?.getElementById("pullNowBtn");
    if (!btn) return;
    const b = busyOf(s), level = freshnessOf(s).level;
    btn.classList?.toggle("fa", level === "amber");
    btn.classList?.toggle("fr", level === "red");
    btn.textContent = s.running ? buttonText(s) : b.busy ? "Pulling…" : "Pull now";
    btn.disabled = b.busy;
    btn.title = s.running ? "A pull is running" : b.busy ? `Don't press: ${b.why}` : s.siteTitle ?? "Pull TwoGun's board now, rebuild the slate and save it";
  };
  const drawStat = () => {
    tick();
    const el = doc?.getElementById("pullNowStat");
    if (el?.parentNode) el.outerHTML = statHtml(s); // a stand-in element (the tests) has no parent: nothing to redraw
    const line = doc?.getElementById("pullNowLine"), lineNow = lineHtml(s);
    if (line?.parentNode && lineNow !== lastLineHtml) { line.outerHTML = lineNow; lastLineHtml = lineNow; } // the badge lives in the line's box
    draw();
  };
  const appStatus = async () => {
    const slate = new URLSearchParams(globalThis.location?.search ?? "").get("slate");
    const r = await fetchImpl(`/api/pull-status${slate ? `?slate=${encodeURIComponent(slate)}` : ""}`, { cache: "no-store" });
    const body = await r.json().catch(() => null);
    if (!r.ok || !body || typeof body !== "object") throw new Error(`the app answered ${r.status}`);
    return body;
  };
  /** One status read: paced by pollMs unless forced, skipped while the page is hidden. A failed read keeps the earlier answer and says so. */
  function poll(force = false) {
    if (polling) return polling; // a read in flight answers every caller
    if (doc?.visibilityState === "hidden") return Promise.resolve();
    if (!force && now() - lastPollMs < Math.max(0, pollMs - 500)) return Promise.resolve();
    lastPollMs = now();
    polling = (async () => {
      await null; // so the assignment below always lands before this ends
      try {
        s.status = await (runner?.status ? runner.status() : appStatus());
        s.statusErr = null;
      } catch (e) {
        s.statusErr = e?.message ?? "no answer";
      } finally {
        polling = null;
      }
      drawStat();
    })();
    return polling;
  }
  const show = (text, cls = "", actions = []) => {
    s.line = text ?? ""; s.lineCls = cls; s.actions = actions;
    const el = doc?.getElementById("pullNowLine");
    if (!el) return;
    if (el.parentNode) { lastLineHtml = lineHtml(s); el.outerHTML = lastLineHtml; } // the page: the line's box is drawn afresh in place
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
    if (s.running || busyOf(s).busy) return;
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
      if (s.status?.running) s.status = { ...s.status, running: { ...s.status.running, local: null, cloud: s.status.running.cloud === "running" ? "idle" : s.status.running.cloud } }; // this run is over; the read below says what else runs
      draw();
    }
    show(result.line, CALM.has(result.state) ? "" : "bad", runner?.actions?.(result) ?? []);
    if (shouldReload(result)) await reload?.();
    if (pollMs) await poll(true);
    if (runner) { s.heldLight = lightKey(s); drawStat(); } // the site's badge cannot clear by itself, so the press's result stays until the published read moves
    return result;
  }
  doc?.addEventListener?.("click", (e) => {
    if (e.target?.closest?.("#pullNowBtn, #pullNowBadge")) { press(); return; } // the badge is Pull now: the same function and the same lock
    if (e.target?.closest?.("[data-pn-toggle]")) { s.open = !s.open; drawStat(); return; }
    if (s.open && !e.target?.closest?.(".pnpanel")) { s.open = false; drawStat(); }
    const act = e.target?.closest?.("[data-pn-action]");
    if (act) { const a = s.actions[Number(act.dataset.pnAction)]; if (a) show(a.run() ?? "", "", []); }
  });
  doc?.addEventListener?.("keydown", (e) => { if (e.key === "Escape" && s.open) { s.open = false; drawStat(); } });
  if (pollMs && doc) {
    doc.addEventListener?.("visibilitychange", () => { if (doc.visibilityState !== "hidden") poll(); });
    every?.(() => poll(), pollMs);
    poll(true);
  }
  return { html: () => pullNowHtml({ ...s, nowMs: now(), firstTipMs: firstTipMs?.() ?? null }), press, state: () => ({ ...s }), show, poll };
}
