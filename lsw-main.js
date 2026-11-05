// The Late swap screen (entries late swap): a top-level tab beside the others. This file mounts it, holds its state, talks to the server's
// /lateswap route and draws the always-visible top bar; the five screens are lsw-upload/maps/all/spot/export.js. Nothing is decided
// here: every action is a request to the engine through the route, and the screen draws what comes back. The server reads the slate fresh on
// every request, so a refreshed board shows here on the next one (the screen asks again every 20 seconds while it is open). A reply that
// belongs to another slate, or is older than one already drawn, is thrown away.
import { esc, money, outcomeLine, chipTime, replyVerdict, tidyReasons } from "./lsw-common.js";
import { uploadHtml } from "./lsw-upload.js";
import { allHtml, backupLabels, scopeFor } from "./lsw-all.js";
import { spotHtml } from "./lsw-spot.js";
import { entriesHtml, lineupsHtml, tabStatus, rangeBetween, numberInOrder, screenOrder, emptyRowIds, contestGroups } from "./lsw-maps.js";
import { exportHtml } from "./lsw-export.js";
import { logo, shortTime, slateRefMs, topStamps, centralToMs, keepFocus } from "./board-util.js";

const POLL_MS = 20000;
const $ = (id) => document.getElementById(id);
const fresh = () => ({ slate: null, loaded: false, has: false, M: null, uploads: [], screen: "upload", spot: null, sel: new Set(), newIds: new Set(), moved: new Set(), bulkSpot: null, allUnSpot: null,
  assignFor: null, saved: [], savedErr: null, filter: "All", blunt: { man: "", scope: "holding", spot: "", backup: "" }, backupText: "", outcomes: [], msg: null, busy: false, swapSlot: null, swapSort: "proj",
  exportPick: new Set(), upMsg: null, upName: null, boardMs: null, boardLabel: null, clockOffset: 0, injected: false, lastMs: null, lastFile: null, banner: null, ask: null, exportAsk: null, dirty: false });
let L = fresh();
let root = null, fileInput = null, open = false, poll = null, tick = null;
let epoch = 0, appliedRev = 0; // epoch changes with the slate; appliedRev is the newest server revision drawn

const slateName = () => $("slateSel")?.value ?? new URLSearchParams(location.search).get("slate");
const fmtClock = (ms) => `${new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET`;
const url = (slate) => `/api/slate/${encodeURIComponent(slate)}/lateswap`;
/** Only a box being typed in holds a redraw back (a menu is let go of as soon as it is used), and so does a press in progress: a redraw between
 *  the press and the release would take the button out from under the click. */
const focusedInput = () => { const a = document.activeElement; return Boolean(a && root?.contains(a) && a.tagName === "INPUT") || L.pressing === true; };

/** Sends one request for the slate on show. Returns the reply, or { stale: true, discarded: true } when the slate changed or a newer reply is drawn. */
async function request(body) {
  const slate = L.slate, mine = epoch, t = performance.now();
  const r = await fetch(url(slate), body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({}));
  j.roundTrip = Math.round(performance.now() - t);
  if (mine !== epoch) return { discarded: true }; // the slate changed while this was away: its answer, a failure too, is no business of the slate on show now
  if (!r.ok) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
  if (j.has === false && j.slate && j.slate !== L.slate) return { discarded: true };
  // The server numbers its answers in the order it made them. A read older than one already drawn is dropped; an action's answer never is
  // (a poll that lands during an action must not swallow the action's own result, which is what put no message on screen once).
  const v = replyVerdict(appliedRev, j.rev, body != null);
  if (!v.use) return { discarded: true };
  appliedRev = v.applied;
  if (!v.takeModel) j.olderModel = true;
  return j;
}

function take(j) {
  L.lastMs = { server: j.ms, trip: j.roundTrip };
  if (j.has === false) { L.has = false; L.M = null; L.uploads = j.uploads ?? []; if (j.nowMs) L.clockOffset = j.nowMs - Date.now(); L.loaded = true; return; }
  if (!j.model) return;
  L.has = true; L.M = j.model; L.uploads = j.model.file.uploads ?? []; L.loaded = true; L.injected = j.injected === true;
  L.clockOffset = j.model.nowMs - Date.now();
  if (!L.blunt.spot || !j.model.spots.some((s) => s.name === L.blunt.spot)) L.blunt.spot = j.model.spots[0]?.name ?? "";
  if (L.spot && !j.model.spots.some((s) => s.name === L.spot)) L.spot = null;
}

/** A poll or a reload: the model is always taken in; only the redraw waits while a box or menu has the keyboard. */
async function load(quiet = false) {
  if (!L.slate) return;
  const mine = epoch;
  try {
    const j = await request();
    if (j.discarded) return;
    take(j);
    if (!quiet) L.msg = null;
  } catch (e) { if (mine !== epoch) return; L.msg = { kind: "err", text: e.message }; }
  if (quiet && focusedInput()) { L.dirty = true; return; }
  render();
}

/** The one sentence over an action's answer, built from what the engine said spot by spot. */
function titleOf(label, outcomes) {
  const n = (s) => outcomes.filter((o) => o.status === s).length;
  const parts = [`${n("changed")} changed`, `${n("unchanged")} already right`, `${n("flagged")} left as they were`];
  if (n("confirm")) parts.push(`${n("confirm")} waiting for your go-ahead`);
  return `${label}: ${parts.join(", ")}`;
}

/** One action: sends it, draws what comes back, and reports how long it took. A refusal in words (j.refused) shows on every screen. */
async function act(body, { label = null } = {}) {
  if (L.busy) return null;
  const mine = epoch;
  L.busy = true; render();
  try {
    const j = await request(body);
    if (mine !== epoch) return null; // another slate is on show now: nothing here is its business, and its busy flag is not ours to touch
    if (j.discarded) { L.busy = false; render(); return null; }
    if (!j.olderModel) take(j); // a model older than the one already drawn is not drawn again, but what the action said still is
    L.outcomes = j.outcomes ?? [];
    L.busy = false;
    L.ask = j.confirms?.length && body.op !== "syncConfirm" ? { body, confirms: j.confirms, armedAt: Date.now() } : null;
    if (L.ask) setTimeout(render, 520); // the go-ahead button wakes up half a second later, so a double click cannot reach it
    L.msg = j.refused ? { kind: "err", text: tidyReasons(j.refused) } : null;
    const lines = (j.overMax ?? []).map((m) => `${m.name} is in ${m.entries} entries, past his Max of ${m.most}: ${m.spots.join(", ")}.`);
    L.banner = label && (L.outcomes.length || lines.length) ? { title: titleOf(label, L.outcomes), lines, outcomes: L.outcomes } : null;
    render();
    return j;
  } catch (e) {
    if (mine !== epoch) return null;
    L.busy = false; L.msg = { kind: "err", text: e.message }; render();
    return null;
  }
}

// ---------- the top bar ----------
function barHtml() {
  const M = L.M;
  if (!M) return "";
  const nAssigned = M.entries.filter((e) => !e.noSpot).length;
  const chg = M.exports.changed;
  const nSpotsChanged = M.spots.filter((s) => s.changed).length;
  const nHeld = chg.heldBack.length;
  const board = shortTime(M.boardStamp, M.refMs);
  const st = tabStatus(M), cur = L.screen === "entries" ? "entries" : L.screen === "lineups" ? "lineups" : L.screen === "upload" ? "" : "swap";
  const tab = (k, n, title, to) => `<button class="tab3${cur === k ? " on" : ""}${st[k].bad ? " bad" : ""}" data-lsw="go" data-s="${to}"><b>${n}</b><span class="tt">${title}</span><small>${esc(st[k].text)}</small></button>`;
  return `<nav class="tabs3">${tab("entries", 1, "Entries", "entries")}${tab("lineups", 2, "Lineups", "lineups")}${tab("swap", 3, "Swap &amp; export", "all")}</nav>
<div class="bar" id="lswBar"><div class="barl"><div class="barr">
<div class="bst"><small>CLOCK</small><b id="lswClock" class="am">${fmtClock(Date.now() + L.clockOffset)}</b>${L.injected ? '<i class="tc" title="This copy runs on a fixed test clock">TEST CLOCK</i>' : ""}</div>
<div class="bst"><small>BOARD AS OF</small><b>${esc(board ?? "—")}</b></div>
<div class="bst"><small>TIPPED</small><b>${M.clock.tipped}</b> <span>games</span></div><div class="bst"><small>LEFT</small><b class="gr">${M.clock.left}</b> <span>games</span></div>
<div class="bst"><small>ENTRIES</small><b>${M.entries.length}</b> <span>${nAssigned} in ${M.spots.length} spots</span></div>
<div class="bst"><small>CHANGED</small><b class="${chg.changed.length ? "pk" : ""}">${nSpotsChanged ? `${nSpotsChanged} spot${nSpotsChanged === 1 ? "" : "s"}` : "0"}</b> <span>${chg.changed.length} ${chg.changed.length === 1 ? "entry" : "entries"}${nHeld ? `, ${nHeld} left out` : ""}</span></div></div>
<div class="gms"><span class="gl">TIPS, ET</span>${M.games.map((g) => `<span class="gc${g.started ? " stl" : ""}" title="${esc(g.game)} ${esc(shortTime(g.tip, M.refMs) ?? "")}">${logo(g.away, "xs")}<i>@</i>${logo(g.home, "xs")}<small>${esc(chipTime(g.tip, M.refMs))}</small></span>`).join("")}</div></div>
<div class="barx"><button class="ol" data-lsw="chooseFile" title="Drop a fresh DraftKings file anywhere on this screen, or choose one here">New DK file</button><button class="ol" data-lsw="go" data-s="upload" title="Recent uploads and the last file">Files</button><button class="go" data-lsw="exportChanged"${chg.written ? "" : " disabled"}>Export changed (${chg.written})</button><button class="go ol2" data-lsw="exportAll"${M.exports.all.written ? "" : " disabled"}>Export all (${M.exports.all.written})</button></div></div>`;
}

const idsOfAlert = (c) => [...(c.alert?.men ?? []).map((m) => m.dk_id), ...(c.back ?? []).map((m) => m.dk_id)];

function bannerHtml() {
  const parts = [];
  if (L.msg) parts.push(`<div class="msg ${L.msg.kind}">${esc(L.msg.text)}<button data-lsw="dismissMsg">✕</button></div>`);
  const M = L.M;
  for (const n of M?.syncNotes ?? []) parts.push(`<div class="msg warn">${esc(n)}</div>`);
  if (M?.syncNotes?.length) parts.push('<div class="msg warn"><button data-lsw="dismissNotes">Dismiss these notes about the Lineups tab</button></div>');
  for (const p of M?.pendingSpots ?? []) {
    const why = [p.alert?.text, p.back?.length ? `It holds ${p.back.map((b) => b.name).join(", ")}, taken out of ${p.spot} earlier.` : "", p.held ? "It waited for your go-ahead before and still does, so it is never applied behind your back." : ""].filter(Boolean).join(" ");
    if (p.incomplete) { parts.push(`<div class="alert"><b>${esc(p.spot)}:</b> the Lineups tab gave it saved lineup ${esc(p.lineupId)}, which does not hold 8 men, so it cannot be used. Pick another on the Lineups tab.</div>`); continue; }
    parts.push(`<div class="alert"><b>${esc(p.spot)}:</b> the Lineups tab gave it saved lineup ${esc(p.lineupId)}, which is not applied yet. ${esc(why)} <button class="go red2" data-lsw="syncGo" data-spot="${esc(p.spot)}">Use anyway</button></div>`);
  }
  if (L.ask && L.ask.body.op !== "setLineup") {
    const armed = Date.now() - L.ask.armedAt >= 500;
    parts.push(`<div class="alert">${L.ask.confirms.map((c) => `<div><b>${esc(c.spot)}:</b> ${esc(c.alert?.text ?? "")}</div>`).join("")}<button class="go red2" data-lsw="askGo"${armed ? "" : " disabled"}>Use anyway</button> <button class="ol" data-lsw="askCancel">Cancel</button></div>`);
  }
  if (L.exportAsk) {
    const bad = M.spots.filter((s) => s.alert);
    const armedX = Date.now() - L.exportAsk.armedAt >= 500;
    parts.push(`<div class="outban"><b>Before you download:</b> ${bad.map((s) => `${esc(s.name)} holds ${s.alert.men.map((m) => `<b>${esc(m.name)}</b> (${esc(m.why)})`).join(", ")}`).join("; ")}. <button class="go red2" data-lsw="exportGo"${armedX ? "" : " disabled"}>Download anyway</button> <button class="ol" data-lsw="exportCancel">Cancel</button></div>`);
  }
  if (L.banner) parts.push(`<div class="result"><div class="rh"><b>${esc(L.banner.title)}</b>${L.banner.summary ? `<span class="sum">${esc(L.banner.summary)}</span>` : ""}<span class="muted">${L.lastMs ? `took ${L.lastMs.server} ms on the server, ${L.lastMs.trip} ms in all` : ""}</span><button data-lsw="dismissBanner">✕</button></div><ul>${(L.banner.lines ?? []).map((l) => `<li>${esc(l)}</li>`).join("")}${L.banner.outcomes.map(outcomeLine).join("")}</ul></div>`);
  return parts.join("");
}

function render() {
  if (!root || !open) return;
  L.dirty = false;
  L.drawnNotes = [...(L.M?.syncNotes ?? [])];
  L.drawnFp = L.M?.fp ?? null; // what the page is about to show: an export names this fingerprint, not a newer model that was never drawn
  if (L.M && L.sel.size) { const ids = new Set(L.M.entries.map((e) => e.entryId)); L.sel = new Set([...L.sel].filter((id) => ids.has(id))); } // a selection survives a refresh, minus rows no longer in the file
  const body = !L.loaded ? '<div class="rs">Loading…</div>'
    : L.screen === "upload" || !L.has ? uploadHtml({ ...L, uploads: L.uploads, boardAge: boardAgeNow() })
      : L.screen === "entries" ? entriesHtml(L.M, L)
        : L.screen === "lineups" ? lineupsHtml(L.M, L)
        : L.screen === "spot" ? spotHtml(L.M, L)
          : L.screen === "export" ? exportHtml(L.M, L) : allHtml(L.M, L);
  const y = window.scrollY;
  const sub = L.has && ["all", "spot", "export"].includes(L.screen) ? `<div class="subtabs"><button class="${L.screen === "export" ? "" : "on"}" data-lsw="go" data-s="all">Swap</button><button class="${L.screen === "export" ? "on" : ""}" data-lsw="go" data-s="export">Export</button></div>` : "";
  keepFocus(root, () => { root.innerHTML = `${barHtml()}<div class="body${L.busy ? " busy" : ""}">${bannerHtml()}${sub}${body}</div>`; });
  window.scrollTo(0, y);
}

/** Where a slate lands: the first tab with something empty, else the swap tab. */
function landing(M) {
  if (M.entries.some((e) => e.noSpot)) return "entries";
  if (M.spots.some((s) => s.blank)) return "lineups";
  return "all";
}

// ---------- tab and visibility ----------
function decorate() {
  const top = $("top");
  if (!top) return;
  let v = top.querySelector(".vtabs");
  if (!v) { v = document.createElement("span"); v.className = "vtabs own"; v.innerHTML = '<button data-lsw-list="1">Player list</button>'; top.append(v); }
  let b = v.querySelector("[data-lswtab]");
  if (!b) { b = document.createElement("button"); b.dataset.lswtab = "1"; b.textContent = "Late swap"; v.append(b); }
  b.classList.toggle("on", open);
  if (!open && v.classList.contains("own")) v.querySelector("[data-lsw-list]")?.classList.add("on");
  const name = slateName();
  if (name && name !== L.slate) { epoch++; L = { ...fresh(), slate: name, screen: "upload" }; if (open) { render(); load(); boardAge(); } }
}

function setOpen(on) {
  if (on === open) return;
  if (on && document.body.classList.contains("console-on")) $("csBtn")?.click(); // the console is another view of the page: close it first
  open = on;
  document.body.classList.toggle("lsw-on", on);
  root.hidden = !on;
  decorate();
  clearInterval(poll); clearInterval(tick);
  if (!on) return;
  L.slate = slateName();
  L.loaded = false; render();
  load().then(() => { if (L.has && L.screen === "upload" && L.firstOpen !== true) { L.firstOpen = true; L.screen = landing(L.M); render(); } });
  loadSaved().then(render); // the saved lineups are there when the Lineups tab is opened
  boardAge();
  poll = setInterval(() => { if (!L.busy && L.has) { load(true); boardAge(); } }, POLL_MS); // always fetch; only the redraw waits for a free keyboard
  tick = setInterval(() => { const c = $("lswClock"); if (c && !L.injected) c.textContent = fmtClock(Date.now() + L.clockOffset); }, 1000);
}

async function boardAge() {
  if (!L.slate) return;
  const mine = epoch;
  try {
    const s = await (await fetch(`/api/slate/${encodeURIComponent(L.slate)}`)).json();
    if (mine !== epoch) return;
    const ref = slateRefMs(L.slate) ?? Date.now();
    const stamp = topStamps(s).board, ms = centralToMs(stamp, ref);
    if (ms != null) { L.boardMs = ms; L.boardLabel = shortTime(stamp, ref); if (!focusedInput()) render(); }
  } catch (e) { console.warn("Board age unavailable:", e.message); }
}

/** The board's age at the clock the screen runs on (the server's now, injected or real), worked out at draw time. The slate and the
 *  server's clock arrive in either order, so the age is never fixed before both are known. */
function boardAgeNow() {
  if (L.boardMs == null || !L.loaded) return null;
  return { label: L.boardLabel, minutes: Math.max(0, Math.round((Date.now() + L.clockOffset - L.boardMs) / 60000)) };
}

// ---------- actions ----------
const nameOk = (n) => typeof n === "string" && n.trim().length > 0 && n.trim().length <= 40;
function askSpot() { const n = window.prompt("Name the new spot (for example GPP #3)"); return nameOk(n) ? n.trim() : null; }
const download = (text, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
const namesOf = (list) => list.map((x) => `${x.contestName} ${x.entryId}`).join("; ");

/** An export. The page sends the fingerprint of what it drew; a screen that is behind is redrawn and nothing is downloaded. */
async function doExport(kind, spots = null, { confirmed = false } = {}) {
  if (L.busy || !L.M) return;
  if (!confirmed && L.M.spots.some((s) => s.alert)) { L.exportAsk = { kind, spots, armedAt: Date.now() }; setTimeout(render, 520); return render(); } // a spot holds an Out man: said first, on every path
  L.exportAsk = null;
  const mine = epoch;
  L.busy = true;
  try {
    const j = await request({ op: "export", kind, fp: L.drawnFp ?? L.M.fp, ...(spots ? { spots } : {}) }); // the fingerprint of what the page last drew
    if (mine !== epoch) return; // another slate is on show: no file, and its flags are not ours
    if (j.discarded) { L.busy = false; return render(); }
    if (j.stale) { take(j); L.msg = { kind: "warn", text: "The screen was behind (a pull or a change came in). It has been redrawn: look it over and click Export again." }; L.busy = false; return render(); }
    const x = j.export;
    if (!x.text) L.msg = { kind: "warn", text: `Nothing to export: ${x.heldBack.length ? `${x.heldBack.length} changed ${x.heldBack.length === 1 ? "entry" : "entries"} failed a check.` : "no entry differs from the upload."}` };
    else {
      L.lastFile = x.fileName; download(x.text, x.fileName);
      const parts = [`${x.written} ${x.written === 1 ? "entry" : "entries"} written to ${x.fileName}`];
      if (x.heldBack.length) parts.push(`${x.heldBack.length} left out for failing a check: ${namesOf(x.heldBackNames)}`);
      if (x.leftOut.length) parts.push(`${x.leftOut.length} left out for having no lineup: ${namesOf(x.leftOutNames)}`);
      if (x.alerts?.length) parts.push(`${x.alerts.map((a) => `${a.spot}: ${a.alert.text}`).join(" ")}`);
      L.msg = { kind: x.alerts?.length ? "warn" : "ok", text: `${parts.join("; ")}.` };
    }
    L.lastMs = { server: j.ms, trip: j.roundTrip };
  } catch (e) { if (mine !== epoch) return; L.msg = { kind: "err", text: e.message }; }
  L.busy = false;
  await load(true);
}

/** A file chosen or dropped, on any screen. */
function readFile(file) {
  if (!file) return;
  if (L.busy) { L.msg = { kind: "warn", text: "Another action is still running; drop the file again when it has finished." }; return render(); }
  const r = new FileReader();
  r.onload = async () => {
    L.upMsg = null; L.upName = file.name;
    const before = beforeMap();
    const j = await act({ op: "upload", text: String(r.result), fileName: file.name });
    if (!j) return;
    if (j.refused) { L.upMsg = j.refused; return render(); } // act has put the same words on every screen
    afterUpload(j, before);
  };
  r.onerror = () => { L.msg = { kind: "err", text: `The file could not be read: ${r.error?.message ?? "unknown error"}` }; render(); };
  r.readAsText(file);
}
/** Which entries were changed from their upload before a fresh file came in: Map entryId -> changed. Empty on a first upload. */
const beforeMap = () => new Map((L.M?.entries ?? []).map((e) => [e.entryId, e.changed]));

/**
 * A fresh DraftKings file came in (dropped on any screen, or chosen). Spots are kept by the engine; the screen stays where it is (a first
 * upload goes to Maps) and says plainly what changed: entries new, gone, and now matching their spot (they were edited here and the
 * file now holds the edit).
 */
function afterUpload(j, before) {
  const first = !before.size, rep = j.report;
  L.sel = new Set(); L.fillUndo = null; L.lastPick = null; // a new file clears the selection and the one-step undo
  const fresh = (rep?.added ?? []).filter((a) => !a.returned), back = (rep?.added ?? []).filter((a) => a.returned); // an entry that was missing from one file and is back keeps its spot: it is not new
  L.newIds = first ? new Set() : new Set(fresh.map((a) => a.entryId));
  L.backIn = new Map(back.filter((a) => a.returnedTo).map((a) => [a.entryId, a.returnedTo]));
  if (first) L.screen = "entries"; // a first upload of a slate starts at tab 1
  else if (L.screen === "upload") L.screen = landing(L.M);
  L.msg = null;
  if (first || !rep) { L.msg = { kind: "ok", text: `${L.M.entries.length} entries read.` }; return render(); }
  const matching = L.M.entries.filter((e) => before.get(e.entryId) === true && !e.changed && !e.noSpot);
  // One line of counts; a count above zero adds a line naming the entries.
  const summary = `${fresh.length} new, ${back.length} back, ${rep.gone.length} gone, ${matching.length} now match their spot, ${rep.kept.length} kept`;
  const lines = [
    fresh.length && `New: ${fresh.map((a) => `${a.contestName}${a.proposedSpot ? ` (matches ${a.proposedSpot})` : " (no lineup assigned)"}`).join("; ")}`,
    back.length && `Back, with the spot they had: ${back.map((a) => `${a.contestName} ${a.entryId} in ${a.returnedTo ?? "no spot"}`).join("; ")}`,
    rep.gone.length && `Gone from the file: ${rep.gone.map((g) => `${g.contestName} ${g.entryId}${g.spot ? ` (was in ${g.spot})` : ""}`).join("; ")}`,
    matching.length && `Now match their spot: ${matching.map((e) => `${e.contestName} ${e.entryId}`).join("; ")}`,
    (rep.atUploadUnknown ?? []).length && `What these spots held at upload is not known: ${rep.atUploadUnknown.map((u) => `${u.spot} (${u.reason})`).join("; ")}`,
    (rep.oddIds ?? []).length && `Rows with an Entry ID that is not a number were skipped: ${rep.oddIds.join(", ")}`,
  ].filter(Boolean);
  L.banner = { title: "Fresh DraftKings file read", summary, lines, outcomes: [] };
  render();
}

async function loadSaved() {
  const mine = epoch, slate = L.slate; // an answer for another slate is thrown away: a wrong lineup id must never reach a spot
  let saved = [], err = null;
  try {
    const r = await fetch(`/api/slate/${encodeURIComponent(slate)}/lineups`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
    saved = j.lineups ?? [];
  } catch (e) { err = `The saved lineups could not be read: ${e.message}`; }
  if (mine !== epoch) return;
  L.saved = saved; L.savedErr = err; L.savedLoaded = true;
}

const scopeOf = (b, M) => scopeFor(M, b);
function manName(id) {
  for (const s of L.M.spots) for (const x of s.slots) if (x.dk_id === id && x.man) return x.man.name;
  return L.M.pool.find((p) => p.dk_id === id)?.name ?? L.M.removals.find((r) => r.id === id)?.name ?? id;
}
/** A change of the map in one call (Fill, Number in order, Auto-fill): the answer says what it did and keeps what was there for Undo. */
async function mapAction(body, label) {
  const j = await act({ ...body, mapFp: L.M.mapFp });
  if (!j || j.refused || !j.mapResult) return j;
  const r = j.mapResult, over = r.overwritten ? `; ${r.overwritten} ${r.overwritten === 1 ? "row" : "rows"} already had a spot and got the new one` : "";
  const made = r.created?.length ? `. New spots: ${r.created.join(", ")}` : "";
  const what = body.op === "autoFill" ? `${label} ${r.count} empty rows: ${r.summary}${made}` : `${label}${over}`;
  L.fillUndo = { prior: r.prior, priorProposals: r.priorProposals ?? {}, madeRows: r.madeRows ?? [], text: what };
  L.sel = new Set();
  for (const [id] of body.op === "mapSet" ? body.pairs : []) L.moved.add(id);
  L.msg = null;
  render();
  return j;
}

const askGo = () => {
  const a = L.ask;
  if (!a || Date.now() - a.armedAt < 500) return Promise.resolve(null); // a double click on the armed button does nothing
  const ids = [...new Set(a.confirms.flatMap(idsOfAlert))];
  L.ask = null;
  return act({ ...a.body, confirmOut: true, confirmMen: ids }, { label: "Go-ahead" });
};

async function onClick(e) {
  const t = e.target.closest("[data-lsw]");
  if (!t || !open) return;
  const d = t.dataset, M = L.M, a = d.lsw;
  const go = (s) => { L.screen = s; L.msg = null; L.banner = null; L.ask = null; L.exportAsk = null; render(); window.scrollTo(0, 0); if (s === "lineups") loadSaved().then(render); };
  switch (a) {
    case "go": return go(d.s);
    case "goMaps": return go("entries");
    case "goAll": return go("all");
    case "chooseFile": return fileInput.click();
    case "useUpload": { const before = beforeMap(); const j = await act({ op: "useUpload", file: d.file }); if (j && !j.refused) afterUpload(j, before); return; }
    case "dismissMsg": L.msg = null; return render();
    case "dismissBanner": L.banner = null; return render();
    case "dismissNotes": return void (await act({ op: "dismissNotes", notes: L.drawnNotes ?? [] })); // the notes on the screen, not any that came after
    case "askGo": return void (await askGo());
    case "askCancel": L.ask = null; return render();
    case "syncGo": { const p = M.pendingSpots.find((x) => x.spot === d.spot); if (!p) return; return void (await act({ op: "syncConfirm", spot: d.spot, confirmOut: true, confirmMen: idsOfAlert(p) }, { label: `Lineups tab lineup for ${d.spot}` })); }
    case "confirmMan": return void (await act({ op: "confirmMan", spot: d.spot, man: d.man }));
    case "reload": return load();
    case "pick": {
      if (e.shiftKey && L.lastPick != null) for (const id of rangeBetween(screenOrder(M), L.lastPick, d.id)) L.sel.add(id); // a range in the order the rows are drawn, from the last row clicked
      else L.sel.has(d.id) ? L.sel.delete(d.id) : L.sel.add(d.id);
      L.lastPick = d.id; return render();
    }
    case "pickAll": { const all = M.entries.every((x) => L.sel.has(x.entryId)); L.sel = all ? new Set() : new Set(M.entries.map((x) => x.entryId)); return render(); }
    case "pickGroup": {
      const g = contestGroups(M).find((x) => x.key === d.key); if (!g) return;
      const all = g.entries.every((x) => L.sel.has(x.entryId)); for (const x of g.entries) all ? L.sel.delete(x.entryId) : L.sel.add(x.entryId);
      return render();
    }
    case "selectUnmapped": L.sel = new Set(emptyRowIds(M)); return render();
    case "fill": case "numberInOrder": {
      const byId = new Map(M.entries.map((x) => [x.entryId, x]));
      const rows = screenOrder(M).filter((id) => L.sel.has(id)).map((id) => byId.get(id)); // the order the rows are drawn, not the file's
      if (!rows.length) return;
      let spot = $("lswFill").value, newSpots = [];
      if (!spot) { L.msg = { kind: "warn", text: "Choose a spot first." }; return render(); }
      if (spot === "__new") { spot = askSpot(); if (!spot) return; if (!M.spots.some((s) => s.name === spot)) newSpots = [spot]; }
      L.fillSpot = spot;
      let pairs;
      if (a === "fill") pairs = rows.map((x) => [x.entryId, spot]);
      else { // consecutive spots in row order, from the spot picked: only spots that exist, and none are made
        const n = numberInOrder(rows.map((x) => x.entryId), M.spots.map((s) => s.name), spot);
        if (n.unknown) { L.msg = { kind: "warn", text: `${spot} is a new name; Number in order uses spots that already exist.` }; return render(); }
        if (n.short) { L.msg = { kind: "warn", text: `There ${n.short === 1 ? "is 1 spot" : `are ${n.short} spots`} too few: ${rows.length} rows from ${spot} need ${rows.length} spots and only ${n.have} exist. Nothing was changed.` }; return render(); }
        pairs = n.pairs;
      }
      return void (await mapAction({ op: "mapSet", pairs, newSpots }, a === "fill" ? `Filled ${rows.length} into ${spot}` : `Numbered ${rows.length} rows from ${spot}`));
    }
    case "autoFill": return void (await mapAction({ op: "autoFill" }, "Auto-filled"));
    case "undoFill": {
      const u = L.fillUndo; if (!u) return;
      const j = await act({ op: "mapSet", pairs: u.prior, restoreProposals: u.priorProposals, dropRows: u.madeRows, mapFp: L.M.mapFp, newSpots: [...new Set(u.prior.map((p) => p[1]).filter(Boolean))] }); // the exact earlier map, even a spot that has since emptied
      if (j && !j.refused) { L.fillUndo = null; L.msg = { kind: "ok", text: "Undone: every row has the spot it had before the fill." }; render(); }
      return;
    }
    case "acceptProposals": return void (await act({ op: "acceptProposals" }));
    case "newSpot": { const n = askSpot(); if (n) { L.ask = null; L.assignFor = n; await loadSaved(); L.msg = { kind: "ok", text: `${n} is new: pick a lineup for it below, then assign entries to it on the left.` }; render(); } return; }
    case "changeLineup": L.ask = null; L.assignFor = L.assignFor === d.spot ? null : d.spot; if (L.assignFor) await loadSaved(); return render();
    case "useLineup": {
      if (L.ask?.body.op === "setLineup" && String(L.ask.body.lineupId) === d.id) return void (await askGo()); // the same lineup again is the go-ahead
      L.ask = null;
      const spot = L.assignFor;
      if (!spot) return;
      await act({ op: "setLineup", spot, lineupId: d.id }, { label: `${spot} and saved lineup ${d.id}` });
      return render();
    }
    case "scope": L.blunt.scope = d.scope; return render();
    case "filter": L.filter = d.f; return render();
    case "remove": case "removeBackup": {
      const scope = scopeOf(L.blunt, M);
      if (!scope) { L.msg = { kind: "warn", text: "No spot on the screen holds that man now; pick him again." }; return render(); }
      const lab = a === "removeBackup" ? backupLabels(M).find((x) => x.label === L.backupText) : null;
      if (a === "removeBackup" && !lab) { L.msg = { kind: "warn", text: "Pick the backup from the list." }; return render(); }
      return void (await act({ op: "remove", man: L.blunt.man, ...(lab ? { backup: lab.id } : {}), scope }, { label: lab ? `Remove ${manName(L.blunt.man)}, lock ${lab.label}` : `Remove ${manName(L.blunt.man)}` }));
    }
    case "undoAll": return void (await act({ op: "undoAll" }, { label: "Undo all" }));
    case "undoSpot": return void (await act({ op: "undoSpot", spot: d.spot }, { label: `Undo ${d.spot}` }));
    case "allow": return void (await act({ op: "allow", spot: d.spot, man: d.man }));
    case "openSpot": L.spot = d.spot; L.swapSlot = null; return go("spot");
    case "swapOpen": L.swapSlot = d.slot; return render();
    case "swapClose": L.swapSlot = null; return render();
    case "swapSort": L.swapSort = d.k; return render();
    case "swapUse": { const slot = L.swapSlot, spot = d.spot; const j = await act({ op: "swap", spot, slot, inId: d.id }, { label: `Swap ${slot} in ${spot}` }); if (j && !j.refused && !j.confirms?.length && j.outcomes?.[0]?.status !== "flagged") L.swapSlot = null; return render(); }
    case "slotReset": { const s = M.spots.find((x) => x.name === d.spot)?.slots.find((x) => x.slot === d.slot); if (s?.at_upload_id == null) return; return void (await act({ op: "swap", spot: d.spot, slot: d.slot, inId: s.at_upload_id }, { label: `Reset ${d.slot} in ${d.spot}` })); }
    case "resetSpot": return void (await act({ op: "undoSpot", spot: d.spot }, { label: `Reset ${d.spot} to its upload` }));
    case "exportChanged": return doExport("changed");
    case "exportAll": return doExport("all");
    case "pickSpot": L.exportPick.has(d.spot) ? L.exportPick.delete(d.spot) : L.exportPick.add(d.spot); return render();
    case "exportSpots": return doExport("changed", [...L.exportPick]);
    case "exportGo": { const x = L.exportAsk; if (x && Date.now() - x.armedAt >= 500) return doExport(x.kind, x.spots, { confirmed: true }); return; } // armed half a second, like the other go-aheads
    case "exportCancel": L.exportAsk = null; return render();
    default:
  }
}

async function onChange(e) {
  const t = e.target;
  if (t.tagName === "SELECT") t.blur(); // a menu is let go of when it has been used, so polls and redraws are not held back by it
  if (t.dataset.lswSel === "entrySpot") {
    let spot = t.value;
    if (spot === "__new" && !(spot = askSpot())) return render();
    L.moved.add(t.dataset.id);
    return void (await act({ op: "assign", entryIds: [t.dataset.id], spot: spot || null }));
  }
  if (t.id === "lswMan") { L.blunt.man = t.value; const m = L.M.spots.filter((s) => s.slots.some((x) => x.dk_id === t.value)); L.blunt.spot = m[0]?.name ?? L.blunt.spot; return render(); }
  if (t.id === "lswScopeSpot") { L.blunt.spot = t.value; return render(); }
  if (t.id === "lswFill") L.fillSpot = t.value;
  if (t.dataset.lswSel === "lineupPick") { // a saved lineup picked for a spot: the engine decides, and asks first about an Out man
    if (!t.value) return;
    L.ask = null; L.assignFor = t.dataset.spot;
    return void (await act({ op: "setLineup", spot: t.dataset.spot, lineupId: t.value }, { label: `${t.dataset.spot} and saved lineup ${t.value}` }));
  }
}

function onInput(e) {
  if (e.target.id !== "lswBackup") return;
  L.backupText = e.target.value;
  const lab = backupLabels(L.M).find((x) => x.label === L.backupText);
  L.blunt.backup = lab?.id ?? "";
  const b = root.querySelector('[data-lsw="removeBackup"]'); // the button's state follows the box without a redraw, which would lose the caret
  if (b) b.disabled = !(lab && L.blunt.man && !L.busy);
}

export function mountLateSwap() {
  if (root) return;
  const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "lsw.css"; document.head.append(css);
  root = document.createElement("section"); root.id = "lsw"; root.hidden = true;
  const after = document.querySelector("#console");
  if (after) after.after(root); else document.body.append(root);
  // One file box for the page's life, outside the screen the polls redraw: a chosen file cannot be lost to a redraw, and the first click works.
  fileInput = document.createElement("input"); fileInput.type = "file"; fileInput.id = "lswFile"; fileInput.accept = ".csv,text/csv"; fileInput.hidden = true;
  document.body.append(fileInput);
  fileInput.addEventListener("change", () => { const f = fileInput.files?.[0]; fileInput.value = ""; readFile(f); });
  root.addEventListener("click", onClick); root.addEventListener("change", onChange); root.addEventListener("input", onInput);
  root.addEventListener("focusout", () => setTimeout(() => { if (L.dirty && !focusedInput()) render(); }, 0)); // a redraw that waited for the keyboard happens now
  // A press holds redraws back until its click is done, so a poll cannot take a button away between the press and the release.
  // A press on a menu is not counted (its native popup can take the release, and a menu acts on change, not on click), and any other press
  // lets go by itself after 3 seconds, so a release that never arrives cannot hold redraws back for good.
  root.addEventListener("pointerdown", (e) => {
    if (e.target.closest?.("select")) return;
    L.pressing = true;
    clearTimeout(L.pressTimer);
    L.pressTimer = setTimeout(() => { if (L.pressing) { L.pressing = false; if (L.dirty && !focusedInput()) render(); } }, 3000);
  });
  const released = () => { if (!L.pressing) return; setTimeout(() => { L.pressing = false; if (L.dirty && !focusedInput()) render(); }, 0); };
  document.addEventListener("pointerup", released); document.addEventListener("pointercancel", released);
  root.addEventListener("dragover", (e) => { e.preventDefault(); root.querySelector("#lswDrop")?.classList.add("over"); });
  root.addEventListener("dragleave", () => root.querySelector("#lswDrop")?.classList.remove("over"));
  root.addEventListener("drop", (e) => { e.preventDefault(); readFile(e.dataTransfer?.files?.[0]); });
  for (const ev of ["dragover", "drop"]) document.addEventListener(ev, (e) => { if (open && e.dataTransfer?.types?.includes("Files") && !root.contains(e.target)) { e.preventDefault(); if (ev === "drop") readFile(e.dataTransfer.files?.[0]); } });
  // The tab lives in the page's header, which the board redraws; it is put back each time, and any other view's own buttons close this one.
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-lswtab]")) return setOpen(!open);
    if (open && e.target.closest("[data-view],[data-lsw-list],#csBtn,#lsBtn")) setOpen(false);
  });
  const top = $("top");
  if (top) new MutationObserver(decorate).observe(top, { childList: true, subtree: true }); // decorate changes nothing when the tab is already there, so it cannot loop
  decorate();
  if (new URLSearchParams(location.search).get("view") === "lateswap") setOpen(true);
}
export { money, titleOf };
