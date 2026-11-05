// The optimizer panel (build step 5): Cash/GPP switch, settings, team limits with per-team overrides, Build (the server's
// optimizer), the built lineups as cards, Save working lineup with the saved cards, and the DraftKings upload file.
// Every slot placement and lineup check goes through slots.js (the one matcher and validator). A missing figure is an em
// dash with a title, never zero (RULES R1). The pure helpers (totals, dkCsv, lateSwapOrder, pageWindow) are tested in node.
// The settings and low-owned rules are in settings-panel.js, the saved lineups in saved-panel.js, late swap mode in
// lateswap-panel.js, the working lineup (row and slot clicks, Build keeping the hand-picked men) in work-panel.js.
import { esc, ICON, keepFocus } from "./board-util.js";
import { SLOTS, arrangeForLateSwap, checkLineup } from "./slots.js";
import { totals, capLine, cardRowHtml, skippedList, lineupTag, lineupRefusals, isOutNow } from "./card-row.js";
import { KEPT_NOTE, lsView, startSlots, lsLineupHtml, lsNotesHtml, enterLateSwap, lsPin, lsUnpin, lsBuild, refresh, runClock, lsDownloadRefusal, lsClick } from "./lateswap-panel.js";
import { readSettings, loadRaw, pinRaw, saveRaw, addLowRule, loadOverrides, settingsHtml, countHtml, slateGames, liveOverrides } from "./settings-panel.js";
import { savedClick, readSaved, retrySaved, pickedSaved, savedName, loadSavedNames, savedNameKey, savedNameBlur, savedNameInput } from "./saved-panel.js";
import { workView, shownIds, rowClick, slotClick, dropMan, loadSaved, saveIds, readWork, retryWork, freshWork, workLineupHtml, buildHand, blockedRows, clearLineup, workAfterRoster, NOT_LOADED } from "./work-panel.js";
import { rememberSlots } from "./lateswap.js";
import { limitsMoved, oversMoved, picksMoved } from "./slate-refresh.js";
import { workKey } from "./worklineup.js";
import { limitOutcome, withLimit, loadLimits, saveLimits, sentLimits, limitCountHtml } from "./row-limits.js";
import { nextExposureSort, frozenMen } from "./lineups-list.js";
import { renderTab, tabClick, tabInput, readSpotsFor, retrySpots, readBuildsFor, retryBuilds, keepBuild, refit } from "./lineups-panel.js";
import { newBuild } from "./recent-builds.js";
import { freshLt, entriesOf } from "./lineups-tab.js";
import { DEFAULT_EXPOSURE_SORT } from "./view-memory.js";
import { watchBuild, endWatch, stopBuild, abandonBuild, buildButtonsHtml } from "./build-progress.js";
import { askConfirm } from "./confirm.js";
import { pressSettle } from "./press-settle.js";

const N = SLOTS.length;
const MODES = ["Cash", "GPP"];

export { totals };

/** The DraftKings upload file: header PG..UTIL, one row of dk_ids per lineup in slot order. Every lineup is checked first;
 *  { ok: true, text } or { ok: false, problems: ["Lineup 2: ..."] }. Entries of `lineups` are 8 men (or null) in SLOTS order.
 *  `pinned` (late swap, dk_id -> slot): a pinned man is written in his pinned slot, never re-seated; every other man is
 *  seated by the late-swap rule. */
export function dkCsv(lineups, { pinned = null } = {}) {
  const problems = [];
  lineups.forEach((men, i) => {
    const c = checkLineup(men);
    if (!c.ok) problems.push(`Lineup ${i + 1}: ${c.reasons.join(" ")}`);
    const off = pinned ? men.filter((p, k) => p && p.dk_id in pinned && pinned[p.dk_id] !== SLOTS[k]) : [];
    if (off.length) problems.push(`Lineup ${i + 1}: ${off.map((p) => `${p.name} is pinned at ${pinned[p.dk_id]}`).join(", ")} but sits elsewhere.`);
    const ids = new Set(men.map((p) => p?.dk_id));
    const gone = pinned ? Object.keys(pinned).filter((id) => !ids.has(id)) : [];
    if (gone.length) problems.push(`Lineup ${i + 1}: pinned DraftKings id ${gone.join(", ")} is missing from it.`);
  });
  if (!lineups.length) problems.push("No lineups to write.");
  if (problems.length) return { ok: false, problems };
  // Each checked lineup is written in late-swap order (the same men, re-seated), and that row is checked again.
  const rows = lineups.map((men) => lateSwapOrder(men, pinned));
  rows.forEach((row, i) => {
    const c = checkLineup(row);
    if (!c.ok) problems.push(`Lineup ${i + 1}: ${c.reasons.join(" ")}`);
  });
  if (problems.length) return { ok: false, problems };
  const cell = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return { ok: true, text: [SLOTS.join(","), ...rows.map((row) => row.map((p) => cell(String(p.dk_id))).join(","))].join("\r\n") + "\r\n" };
}

/**
 * A stored lineup (8 men in SLOTS order) re-seated for late swap from the men themselves; the men never change, so an
 * older saved lineup shows and exports arranged too. It is returned as stored when a man is missing or no longer on the
 * slate, when a man is not legal in his stored slot (so the page still shows what was saved), or when a tip is unreadable.
 * `pinned` (dk_id -> slot) keeps each pinned man in his slot; a pin the stored order breaks returns the lineup as stored.
 */
export function lateSwapOrder(men, pinned = null) {
  return lateSwapSeat(men, pinned).men;
}

/** lateSwapOrder's men plus `untimed`: the men whose missing or unreadable tip kept the lineup from being re-seated. */
export function lateSwapSeat(men, pinned = null) {
  if (men.length !== N || men.some((p, i) => p == null || p.stale || !(p.roster_positions ?? []).includes(SLOTS[i]))) return { men, untimed: [] };
  if (pinned && men.some((p, i) => p.dk_id in pinned && pinned[p.dk_id] !== SLOTS[i])) return { men, untimed: [] };
  const a = arrangeForLateSwap(men, { pinned });
  return a.arranged ? { men: a.slots, untimed: [] } : { men, untimed: a.untimed };
}

/** A saved lineup's working slots for late swap mode: seated by lateSwapSeat exactly as the page shows it and the CSV
 *  writes it, so the frozen slots are the ones the DraftKings entry holds; a man off the slate keeps his slot, for Adam to decide. */
export function loadSlots(saved, byId) {
  return startSlots(lateSwapSeat(saved.slots.map((id) => byId.get(id) ?? { dk_id: id, stale: true })).men);
}

/** The Player list's full-screen choice: the stored "1" or "0" wins; with nothing stored it is on under 900 px wide. */
export function fullScreenPref(stored, width) {
  if (stored === "1") return true;
  if (stored === "0") return false;
  return Number(width) < 900;
}
/** Which page numbers the switcher shows: all when n <= size, else a window of `size` around idx. */
export function pageWindow(n, idx, size = 7) {
  const start = Math.max(0, Math.min(idx - Math.floor(size / 2), n - size));
  return Array.from({ length: Math.min(n, size) }, (_, k) => start + k);
}

// ---------- rendering ----------
/** One slot row of the lineup block (card-row.js). `click` (the slot's index) makes a filled slot empty on a click
 *  (work-panel.js); `hand` marks a hand-picked man, whom Build keeps; `emptyLabel` is what an open slot reads. */
export function slotRow(slot, p, locked, dash, { click = null, hand = false, colourOf = null, emptyLabel = "Empty", wk = false, when = null } = {}) {
  if (p === undefined) return cardRowHtml({ slot, p, dash, cls: "slot", ctl: "", emptyLabel, wk, when });
  const attrs = click == null ? "" : ` data-op="wslot" data-i="${click}" title="${locked ? "Locked: unlock him to take him out" : "Click to empty this slot"}${hand && !locked ? " · hand-picked: Build keeps him" : ""}"`;
  const cls = `slot${click == null ? "" : " pick"}${hand && !locked ? " hand" : ""}`;
  if (p === null || p.stale) return cardRowHtml({ slot, p, dash, cls, attrs, ctl: "", wk, when });
  const lockBtn = locked
    ? `<button class="lkd" data-unpick="${esc(p.dk_id)}" title="Unlock ${esc(p.name)}">${ICON.lock}</button>`
    : `<button class="lkb" data-lock="${esc(p.dk_id)}" title="Lock ${esc(p.name)}">${ICON.lock}</button>`;
  return cardRowHtml({ slot, p, dash, colourOf, cls: `${cls}${locked ? " locked" : ""}`, attrs, ctl: lockBtn, wk, when });
}

/** Built lineup i of a result as 8 men seated for late swap (the order the CSV writes); null when there is no such lineup.
 *  Pure: tested in node. */
export function builtMen(res, byId, i) {
  const l = res?.lineups[i];
  if (!l) return null;
  return lateSwapSeat(l.ids.map((id) => byId.get(id) ?? { ...l.men?.find((m) => m.dk_id === id), dk_id: id, stale: true })).men; // a man off the slate carries his built row, so late swap can name him and read his tip
}

/** The men late swap starts from: the working lineup when any man is in it, else built lineup `idx` (default the one at
 *  res.idx, else the first), else the working lineup as it is. `idx` given means that built lineup, whatever the working one holds. */
export function lateSwapStartMen(P, c, idx = null) {
  const res = P.results[P.mode];
  const fromBuilt = (i) => builtMen(res, c.byId, i);
  if (idx != null && fromBuilt(idx)) return fromBuilt(idx);
  const work = workView(P, c).men;
  // A full working lineup is seated as the CSV seats it (a hand-picked man's clicked slot is not binding).
  if (work.every(Boolean)) return lateSwapSeat(work).men;
  if (work.some((p) => p)) return work;
  return fromBuilt(res?.idx ?? 0) ?? work;
}

/** "Built before your last projection or ownership change" once Adam's overrides (c.ovKey, board.js) differ from the ones
 *  the build was sent with (res.ovAt); "" otherwise. Plain and late swap builds alike (review round 2). */
const ovStaleHtml = (res, c) => (res?.ovAt != null && oversMoved(res.ovAt, c.ovKey, c.byId) ? `<div class="actnote">Built before your last projection or ownership change; build again.</div>` : "");

/** The one true sentence when the board has moved under a build: the pull it was built on, once the board holds another. */
const pullStaleHtml = (res, c) => (res?.lineups.length && res.pullAt?.key != null && c.pull?.key != null && res.pullAt.key !== c.pull.key ? `<div class="actnote">Built on the ${esc(res.pullAt.label)} pull; the board has moved since.</div>` : "");

const picksKeyOf = (c) => JSON.stringify([c.picks.locked, c.picks.excluded]);
/** "Built before your last lock change" once the saved picks differ from the ones the lineups on show were built with (res.picksAt). A man off the slate counts on neither side. */
const picksStaleHtml = (res, c) => (res?.lineups.length && res.picksAt != null && picksMoved(res.picksAt, picksKeyOf(c), c.byId) ? `<div class="actnote">Built before your last lock change; build again.</div>` : "");

/** The Min % and Max % a build would send, as one string: compared to say a result is out of date. */
const limitsKey = (P, c) => JSON.stringify(sentLimits(P.limits, c.byId));

function notesHtml(P, c) {
  const res = P.results[P.mode];
  if (!res) return "";
  const out = [];
  if (res.error) out.push(`<div class="actnote err">${esc(res.error)}</div>`);
  out.push(picksStaleHtml(res, c));
  if (res.lineups.length && res.workKey != null && res.workKey !== workKey(P.work)) out.push(`<div class="actnote">Built before your last working-lineup change; build again.</div>`);
  out.push(ovStaleHtml(res, c));
  out.push(pullStaleHtml(res, c));
  if (res.lineups.length && res.limAt != null && limitsMoved(res.limAt, limitsKey(P, c), c.byId)) out.push(`<div class="actnote">Built before your last Min % or Max % change; build again.</div>`);
  if (res.note) out.push(`<div class="actnote wrap${res.partial?.reason === "failed" ? " err" : ""}">${esc(res.note)}${res.kept ? ` ${KEPT_NOTE}` : ""}</div>`);
  if (res.skipped.length) {
    const n = res.skipped.length;
    out.push(`<div class="actnote"><button class="sk" data-op="skipped">${n} ${n === 1 ? "man" : "men"} skipped ${P.showSkipped ? "▾" : "▸"}</button></div>`);
    if (P.showSkipped) out.push(skippedList(res.skipped));
  }
  return out.join("");
}

// ---------- controller: module-level steps on X = { P (panel state), el, api, toast, tryStore, dash, ctx } ----------
const post = (X, what, body, signal) => X.api(`/api/slate/${encodeURIComponent(X.ctx().name)}/${what}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
/** The optimize call. A long build's 200 starts before the search ends, so a late failure or a cut-off answer shows only in the body. */
async function postBuild(X, body, watch) {
  const out = await post(X, "optimize", body, watch.request.signal);
  if (!Array.isArray(out.lineups)) throw Object.assign(new Error(out.error?.message ?? "the server's answer was cut off"), { code: out.error?.code });
  return out;
}

function render(X) {
  const { P, el, dash } = X, c = X.ctx();
  if (!c.name) return;
  const teams = [...new Set(c.players.map((p) => p.team).filter(Boolean))].sort();
  // Late swap mode (lateswap-panel.js) draws its own lineup block and notes; everything else is shared.
  const v = P.ls ? lsView(P, c) : null;
  const lsRes = P.ls?.res && P.ls.res.mode === P.mode ? P.ls.res : null;
  const n = v ? lsRes?.lineups.length ?? 0 : P.results[P.mode]?.lineups.length ?? 0;
  const canSave = v ? n > 0 : saveIds(P, c, workOrder) != null && !P.loaded; // a loaded lineup is saved already
  // The built and the saved lineups are on the Lineups tab (lineups-tab.js); this panel keeps Adam's working lineup, the mode,
  // the count and Build, with the other build settings one click away.
  const lineup = v ? lsLineupHtml(P, c, v, { dash, capLine, pageWindow }) : workLineupHtml(P, c, { slotRow, capLine, dash });
  const done = (P.builds ?? []).find((b) => b.mode === P.mode), built = done?.lineups.length ?? 0; // the last build of this mode, for the button that opens the tab
  const settings = `${countHtml(P, slateGames(c.players))}<button class="setop" data-op="setopen" aria-expanded="${P.setOpen === true}">Build settings ${P.setOpen ? "▾" : "▸"}</button>${P.setOpen ? settingsHtml(P, teams, slateGames(c.players), { count: false }) : ""}`;
  // The panel redraws on many events: a keyboard user keeps his place (a text box its caret) through every one.
  P.drawing = true; // a box the redraw lifts away is not being left (savedNameBlur)
  keepFocus(el, () => {
    el.innerHTML = `<div class="oh"><h3>Optimizer</h3><div class="seg">${MODES.map((m) => `<button data-op="mode" data-m="${m}" class="${m === P.mode ? "on" : ""}">${m}</button>`).join("")}</div></div>
${settings}<div class="lu${v ? "" : " wk"}">${lineup}</div>
<div class="act">${buildButtonsHtml(P, ICON.bolt, "Build")}${v || !built ? "" : `<button class="ol opentab" data-op="opentab">${built} lineup${built === 1 ? "" : "s"} built: open Lineups</button>`}${v ? "" : limitCountHtml(sentLimits(P.limits, c.byId))}
<div class="two"><button class="ol" data-op="save"${canSave ? "" : " disabled"}>Save working lineup</button>${v ? `<button class="ol" data-op="csv"${n ? "" : " disabled"}>Download DK CSV${n ? ` (${n})` : ""}</button>` : ""}</div></div>
${v ? lsNotesHtml(P, c, v) + ovStaleHtml(lsRes, c) + picksStaleHtml(lsRes, c) + pullStaleHtml(lsRes, c) : notesHtml(P, c)}`;
  });
  P.drawing = false;
  refit(el); // a name too wide for its row (late swap's; the working lineup sets its own, card-row.js) shows its first name as an initial
  renderTab(X, c, own);
  const count = entriesOf(P).build.length;
  if (X.tabCount !== count) { X.tabCount = count; X.onTabs?.(); }
}

// The panel's own steps, handed to the late swap and saved-lineup steps (lateswap-panel.js, saved-panel.js), which never
// import this file back.
// A full working lineup is saved in late-swap order, the rule a build's lineups follow, so every saved lineup is in one order.
const workOrder = (men) => lateSwapOrder(men);
const own = { render, post, loadSlots, showSlots, downloadSaved, loadSaved: (X, l) => { if (loadSaved(X, l, own)) { if (l.swapped) { X.P.loaded = null; render(X); } /* a swap not yet saved is not "saved already": the working lineup can be saved */ showSlots(X); X.onView("list"); } }, readSpots: (X) => readSpotsFor(X, X.ctx().name, own), notesHtml, savedRefusal, lateSwapSeat, dkCsv, saveFile, lateSwapFrom: (X, men) => toggleLateSwap(X, null, men), saveIds: (X) => saveIds(X.P, X.ctx(), workOrder) };

/** After a Load (A12): the page comes back to the slots, unless their sticky band is on screen already. */
function showSlots(X) {
  const lu = X.el.querySelector(".lu"), r = lu?.getBoundingClientRect?.();
  if (r && (r.top < 0 || r.bottom > window.innerHeight)) lu.scrollIntoView({ block: "start" });
}

/** The overrides a build reads: what is stored, without a game no longer on this slate. */
const liveOf = (X) => liveOverrides(X.P.overrides, slateGames(X.ctx().players));

function markBad(X) {
  const { P, el } = X;
  const { bad } = readSettings(P.raw[P.mode], P.mode, liveOf(X));
  el.querySelectorAll("[data-f]").forEach((i) => { i.classList.toggle("bad", Boolean(bad[i.dataset.f])); i.title = bad[i.dataset.f] ?? ""; });
  // The message sits under the settings when they are open, and under the count box when they are closed (never a missing element).
  const msg = Object.values(bad)[0] ?? "";
  el.querySelectorAll(".setmsg, .cntmsg").forEach((m) => { m.textContent = msg; m.title = msg; m.hidden = !msg || (m.classList.contains("cntmsg") && P.setOpen === true); });
}

/** Waits until the picks save queue stops changing: a lock clicked while an earlier save is out adds a new link. */
async function picksSettled(X) {
  let q;
  do { q = X.ctx().settled(); await q; } while (q !== X.ctx().settled());
}

async function build(X) {
  const { P } = X;
  const { settings, bad } = readSettings(P.raw[P.mode], P.mode, liveOf(X));
  if (Object.keys(bad).length) return markBad(X);
  const name = X.ctx().name, mode = P.mode;
  // Before the working lineup is read, a build would leave out hand-picked men it cannot see: it waits (fails closed).
  if (!P.ls && !P.workReady) { X.toast(`${NOT_LOADED}; build again once it has.`); retryWork(X, own); return; }
  P.running = true;
  const watch = watchBuild(X);
  render(X);
  if (P.ls) return buildLateSwap(X, settings, watch);
  try {
    await picksSettled(X);
    if (name !== X.ctx().name || P.build !== watch) return; // moved slate during the wait: nothing is sent, so no build runs unseen
    const picksAt = picksKeyOf(X.ctx()), ovAt = X.ctx().ovKey, pullAt = X.ctx().pull; // the locks and the overrides the server reads for this build, and the pull on the board
    // The working lineup's hand-picked men are held in every lineup of this build only, and may take any slot their
    // positions allow (work-panel.js; the server sends optimize only their ids).
    const hand = buildHand(P), wk = workKey(P.work);
    const exposure = sentLimits(P.limits, X.ctx().byId), limAt = JSON.stringify(exposure); // a man's Min % and Max % (B10); never sent in late swap, where they do not apply
    const out = await postBuild(X, { mode, settings: exposure ? { ...settings, exposure } : settings, ...(hand ? { handPicks: hand } : {}) }, watch);
    if (P.build !== watch) return; // an abandoned build's answer, even if the panel is back on its slate
    const prev = P.results[mode];
    if (!out.lineups.length && prev?.lineups.length) P.results[mode] = { ...prev, note: out.note ?? null, partial: out.partial ?? null, error: null, kept: true }; // nothing built (a stop, or a note saying why): the lineups on show stay, the note over them
    else P.results[mode] = { idx: 0, lineups: out.lineups.map((l) => ({ ...l, ids: l.slots.map((p) => p.dk_id), men: frozenMen(l.slots, X.ctx().byId) })), skipped: out.skipped ?? [], note: out.note ?? null, partial: out.partial ?? null, error: null, picksAt, ovAt, limAt, workKey: wk, pullAt, builtAt: Date.now() };
    // The lineups are kept as a build on the Lineups tab (Recently generated, ten newest per slate); the panel says "N lineups built:
    // open Lineups" and Build never moves Adam to another tab by itself.
    P.loaded = null;
    const done = P.results[mode];
    if (done?.lineups.length && !done.kept) keepBuild(X, newBuild(done, mode));
  } catch (e) {
    if (P.build !== watch) return;
    if (e.code === "BUSY") X.toast(e.message); // D17: a notice, not an error; the lineups on show stay as they were
    else {
      const error = `Could not build lineups: ${e.message}`, prev = P.results[mode];
      // A refusal of these settings built nothing and proves nothing wrong with the cards on show: they stay, with the reason over them.
      P.results[mode] = e.code === "BAD_SETTINGS" && prev?.lineups.length ? { ...prev, error } : { idx: 0, lineups: [], skipped: [], note: null, error };
      X.toast(error, "err");
    }
  } finally {
    const current = P.build === watch;
    if (current) P.swap = null; // the lineups on show are new; an open swap belonged to the old ones
    endWatch(X, watch);
    if (current) { P.running = false; render(X); X.onWork(); endNotice(X); } // the rows' in-lineup marks follow the built lineup
  }
}

/** A build that ends with its button off screen says so: nothing else near the man clicking down the table would show it. */
function endNotice(X) {
  const r = X.el.querySelector('[data-op="build"]')?.getBoundingClientRect?.();
  if (r && (r.bottom < 0 || r.top > window.innerHeight)) X.toast("Build finished.");
}

/** A late-swap build: the frozen and pinned men go to the server as pins and only the open slots are filled. */
async function buildLateSwap(X, settings, watch) {
  const name = X.ctx().name, mode = X.P.mode;
  X.onLateSwap(); // the table's pickers turn off while the build runs (P.running)
  try {
    await picksSettled(X);
    if (name !== X.ctx().name || X.P.build !== watch) return; // moved slate during the wait: nothing is sent, so no build runs unseen
    const ovAt = X.ctx().ovKey, picksAt = picksKeyOf(X.ctx()), pullAt = X.ctx().pull, res0 = X.P.ls?.res;
    await lsBuild(X, settings, (_X, _what, body) => postBuild(X, body, watch), () => X.P.build === watch);
    if (X.P.build === watch && X.P.ls?.res && X.P.ls.res.lineups !== res0?.lineups) Object.assign(X.P.ls.res, { ovAt, picksAt, pullAt }); // new lineups: stamp what they were built with (cards kept keep theirs)
  } catch (e) {
    if (X.P.build !== watch || !X.P.ls) return;
    if (e.code === "BUSY") X.toast(e.message); // D17
    else {
      const error = `Could not build lineups: ${e.message}`, prev = X.P.ls.res;
      // A refusal of these settings keeps the cards on show, as outside the mode (D9).
      X.P.ls.res = e.code === "BAD_SETTINGS" && prev?.lineups.length ? { ...prev, error } : { idx: 0, mode, pinned: {}, lineups: [], note: null, error, skipped: [], droppedLocks: [] };
      X.toast(error, "err");
    }
  } finally {
    const current = X.P.build === watch;
    endWatch(X, watch);
    if (current) { X.P.running = false; render(X); X.onLateSwap(); endNotice(X); }
  }
}

async function download(X) {
  if (X.P.ls) {
    const refusal = await lsDownloadRefusal(X); // late swap re-reads now first (lateswap-panel.js)
    if (refusal) return X.toast(refusal);
  }
  const c = X.ctx(), ls = X.P.ls, res = ls ? ls.res : X.P.results[X.P.mode];
  // A man a new pull took off the slate, or newly Out, is named before anything else is checked.
  const refused = res.lineups.map((l, i) => { const words = lineupRefusals(l.men ?? l.slots ?? [], c.byId, c.outNames); return words.length ? `Lineup ${i + 1}: ${words.join(", ")}.` : null; }).find(Boolean);
  if (refused) return X.toast(`DK file not written. ${refused}`, "err");
  // In late swap mode a pinned man is written in his pinned slot, never re-seated; every other man is seated by the
  // late-swap rule.
  const out = dkCsv(res.lineups.map((l) => l.ids.map((id) => c.byId.get(id) ?? null)), { pinned: ls ? res.pinned : null });
  if (!out.ok) return X.toast(`DK file not written. ${out.problems[0]}`, "err");
  saveFile(out.text, `${c.name}-${X.P.mode}${ls ? "-lateswap" : ""}-${res.lineups.length}lineups.csv`);
}

function saveFile(text, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Why a saved lineup cannot go in the DK file, naming its card and any man off the slate (a saved lineup keeps only his id); null when it can. */
export function savedRefusal(l, byId, nameOf = null) {
  const gone = l.slots.filter((id) => !byId.has(id));
  if (gone.length) return `${savedName(l)}: ${gone.map((id) => nameOf?.(id) ?? `DraftKings id ${id}`).join(", ")} ${gone.length === 1 ? "is" : "are"} no longer on this slate.`;
  const outNow = l.slots.map((id) => byId.get(id)).filter((p) => isOutNow(p));
  if (outNow.length) return `${savedName(l)}: ${outNow.map((p) => p.name).join(", ")} ${outNow.length === 1 ? "is" : "are"} Out now.`;
  const out = dkCsv([l.slots.map((id) => byId.get(id))]);
  return out.ok ? null : `${savedName(l)}: ${out.problems[0].replace(/^Lineup 1: /, "")}`;
}

/** The DK file for the ticked saved lineups (A12), checked and seated as a build's are; one that is not legal now stops the file. */
function downloadSaved(X) {
  const c = X.ctx(), picked = pickedSaved(X.P);
  const refused = picked.map((l) => savedRefusal(l, c.byId, c.knownName)).find(Boolean);
  if (refused) return X.toast(`DK file not written. ${refused}`, "err");
  const out = dkCsv(picked.map((l) => l.slots.map((id) => c.byId.get(id))));
  if (!out.ok) return X.toast(`DK file not written. ${out.problems[0]}`, "err");
  saveFile(out.text, `${c.name}-saved-${picked.length}lineups.csv`);
}

// Browser storage holds per-viewer conveniences only (the viewer's own typed settings and team limits), the one use
// the storage rule allows; it never holds a figure or shared state, and a failed write only loses the convenience.
const saveOverrides = (X) => X.tryStore(() => localStorage.setItem(`nbaboard.opt.teams.${X.ctx().name}`, JSON.stringify(X.P.overrides)));

function addOverride(X) {
  const { P, el } = X;
  const team = el.querySelector('[data-ov="team"]').value;
  const read = (k) => { const t = el.querySelector(`[data-ov="${k}"]`).value.trim(); return t === "" ? null : /^\d+$/.test(t) && +t <= N ? +t : NaN; };
  const min = read("min"), max = read("max");
  let msg = null;
  if (Number.isNaN(min) || Number.isNaN(max)) msg = `Min and max are whole numbers from 0 to ${N}.`;
  else if (min == null && max == null) msg = "Give a min, a max or both.";
  else if (min != null && max != null && min > max) msg = "The min is more than the max.";
  if (msg) { P.ovMsg = msg; const m = el.querySelector(".ovmsg"); if (m) m.textContent = msg; return; }
  const o = { ...(P.overrides[team] ?? {}) };
  if (min != null) o.min = min;
  if (max != null) o.max = max;
  P.overrides = { ...P.overrides, [team]: o };
  P.ovOpen = false; P.ovMsg = null; P.ovForm = {};
  saveOverrides(X); render(X);
}

function removeOverride(X, team, bound) {
  const o = { ...X.P.overrides[team] };
  delete o[bound];
  const next = { ...X.P.overrides };
  if (o.min == null && o.max == null) delete next[team]; else next[team] = o;
  X.P.overrides = next;
  saveOverrides(X); render(X);
}

function onClick(X, e) {
  if (!X.P.ls) retryWork(X, own); // any panel click retries a working-lineup read that has not succeeded (work-panel.js)
  retrySaved(X, own); // and a saved-list read that failed
  retrySpots(X, own); // and a spots read that failed
  retryBuilds(X, own); // and a read of the recently generated builds
  const t = e.target.closest("[data-op]");
  if (!t || t.disabled) return;
  const { P } = X, d = t.dataset, res = P.results[P.mode];
  const set =(patch) => { Object.assign(P, patch); render(X); };
  // Late swap mode: its own switcher, unpin, save and load (lateswap-panel.js); build, CSV and the settings are shared below.
  if (P.ls && lsClick(X, d, own)) return;
  if (savedClick(X, d, own)) return; // save, load and delete (saved-panel.js)
  if (tabClick(X, d, own)) return; // the Lineups tab's own clicks (lineups-panel.js)
  switch (d.op) {
    case "setopen": return set({ setOpen: !P.setOpen });
    // Each mode has its own built lineups; the working lineup is shared by both.
    case "mode": set({ mode: d.m, showSkipped: false, swap: null }); return X.onWork();
    case "build": return build(X);
    case "stop": return stopBuild(X);
    case "clearwork": return clearLineup(X, own);
    // A filled slot empties on a click; its lock button (board.js) is a control of its own.
    case "wslot": if (!e.target.closest("button, select, input")) slotClick(X, +d.i, own); return;
    // A card's own Save, Discard and Late swap are on the Lineups tab (lineups-panel.js tabClick).
    case "expsort": set({ expSort: nextExposureSort(P.expSort, d.key) }); return X.onMemory();
    case "exppos": set({ expPos: d.pos }); return X.onMemory();
    // Kept on the Build's own result, so each mode has its own and a new Build starts with every card on show.
    case "skipped": return set({ showSkipped: !P.showSkipped });
    case "csv": return download(X);
    // One small form open at a time (team override or low-owned rule), so each form's message has one place to go.
    case "ovopen": return set({ ovOpen: true, ovMsg: null, ovForm: {}, lrOpen: false, lrMsg: null, lrForm: {} });
    case "ovcancel": return set({ ovOpen: false, ovMsg: null, ovForm: {}, lrOpen: false, lrMsg: null, lrForm: {} });
    case "ovadd": return addOverride(X);
    case "ovdel": return removeOverride(X, d.team, d.b);
    case "lropen": return set({ lrOpen: true, lrMsg: null, lrForm: {}, ovOpen: false, ovMsg: null, ovForm: {} });
    case "lradd": return addLowRuleFromForm(X);
    case "lrdel": return setLowRules(X, P.raw.GPP.lowRules.filter((_, i) => i !== +d.i));
    case "varsw": P.raw.GPP.varOn = d.v; saveRaw(X.tryStore, "GPP", P.raw.GPP, X.ctx().name); return render(X);
  }
}

function setLowRules(X, rules) {
  X.P.raw.GPP.lowRules = rules;
  saveRaw(X.tryStore, "GPP", X.P.raw.GPP, X.ctx().name);
  render(X);
}

function addLowRuleFromForm(X) {
  const { P, el } = X;
  const val = (k) => el.querySelector(`[data-lr="${k}"]`).value;
  const out = addLowRule(P.raw.GPP.lowRules, val("count"), val("pct"));
  if (out.msg) { P.lrMsg = out.msg; const m = el.querySelector(".ovmsg"); if (m) m.textContent = out.msg; return; }
  P.lrOpen = false; P.lrMsg = null; P.lrForm = {};
  setLowRules(X, out.rules);
}

function onInput(X, e) {
  if (savedNameInput(X, e.target)) return;
  const { ov, lr } = e.target.dataset ?? {};
  if (ov) { X.P.ovForm = { ...X.P.ovForm, [ov]: e.target.value }; return; }
  if (lr) { X.P.lrForm = { ...X.P.lrForm, [lr]: e.target.value }; return; }
  const f = e.target.dataset?.f;
  if (!f) return;
  const { P } = X;
  P.raw[P.mode][f] = e.target.value;
  saveRaw(X.tryStore, P.mode, P.raw[P.mode], X.ctx().name); // a per-viewer convenience (see saveOverrides)
  markBad(X);
}

/** A new slate: nothing built, its own settings and team overrides (standard A9), its saved lineups read from the server. Late
 *  swap mode stays on, with every slot of the new slate open. `view`: what the page remembers for this slate (view-memory.js). */
function setSlate(X, name, view = null) {
  abandonBuild(X);
  if (X.P.ls) { X.P.ls = { ...X.P.ls, slots: new Array(N).fill(null), userPins: [], res: null, msg: null }; refresh(X); }
  if (view) Object.assign(X.P, { mode: view.mode ?? X.P.mode, expSort: view.expSort, expPos: view.expPos });
  Object.assign(X.P, { raw: Object.fromEntries(MODES.map((m) => [m, pinRaw(X.tryStore, m, name)])), svNames: loadSavedNames(X.tryStore, name), svEdit: null, overrides: loadOverrides(X.tryStore, name), limits: loadLimits(X.tryStore, name), results: {}, swap: null, lt: freshLt(), spots: {}, spotsReady: false, spotsError: null, spotsReading: null, spotQueue: null, spotPending: 0, spotGen: (X.P.spotGen ?? 0) + 1, spotMenu: null, spotWarn: null, spotMove: null, spotUndo: null, orderWarn: null, builds: [], buildsReady: false, buildsError: null, buildsReading: null, buildQueue: null, buildGen: (X.P.buildGen ?? 0) + 1, cmp: null, loaded: null, saved: [], savedPick: new Set(), savedError: null, savedReady: false, savedReading: null, running: false, showSkipped: false, ovOpen: false, ovMsg: null, lrOpen: false, lrMsg: null, ...freshWork() });
  render(X);
  readSaved(X, name, own);
  readSpotsFor(X, name, own); // the slate's spots (lineups-panel.js)
  readBuildsFor(X, name, own); // and its recently generated builds
  readWork(X, name, own); // the slate's saved working lineup (work-panel.js)
}

/** Late swap switch: on reads now from the server and starts from the lineup on show; off drops the mode's state. */
async function toggleLateSwap(X, idx = null, from = null) {
  // Not while a build runs: switching off and on would declare a new entry that the old build's result could overwrite.
  if (X.P.running) { X.toast("A build is running; switch late swap after it finishes."); return; }
  X.P.swap = null; // Late swap has its own lineup block; an open swap would come back stale
  if (X.P.ls) X.P.ls = null;
  else {
    const men = from ?? lateSwapStartMen(X.P, X.ctx(), idx);
    try {
      await enterLateSwap(X, men ?? null);
    } catch (e) {
      X.toast(`Late swap needs the server's time and could not read it: ${e.message}`, "err");
    }
  }
  // The clock keeps the mode current (started rows dim, frozen slots appear) without a click; runClock stops when it is off.
  runClock(X, () => { render(X); X.onLateSwap(); });
  render(X); X.onLateSwap();
  if (X.P.ls && (idx != null || from)) X.onView("list"); // late swap from a card: its lineup block is on the player list tab
}

/**
 * The panel's wiring. deps: el, api, toast, tryStore, dash, ctx() → { name, byId, players, picks, settled() }, and
 * onLateSwap() (redraws the header and table after the mode or its working lineup changes).
 * settled() returns one promise for the picks and overrides save queues (the server reads locks and overrides from disk).
 * lateSwap() is null outside late swap mode, else what the board table needs (lsView); pin(id, idx) is a slot picker's choice.
 * onWork() redraws the table's rows after the lineup on show changes (their in-lineup mark); inLineup() is the set of
 * dk_ids on show (null in late swap mode); rowClick(id) is a click on a player row; dropMan(id) follows an exclude.
 * onMode(mode) follows a Cash/GPP switch (the table's remembered columns); mode() is the mode now.
 * blocked() is the men who cannot go into the working lineup now, dk_id -> why, or null when that is not known (A18).
 * confirm(text, { ok }) answers true or false (confirm.js unless a test gives its own). onClearLocks() takes every lock off
 * (Clear lineup; the locks are the board's). limits() is each man's Min % and Max %, limitOutcome and setLimit their boxes' answers.
 * memory() is what the panel adds to the page's remembered view, and onMemory() says it has changed (view-memory.js).
 */
export function createPanel({ el, lineupsEl = null, onView = () => {}, onTabs = () => {}, isLineupsView = () => false, api, toast, tryStore, dash, ctx, onLateSwap = () => {}, onWork = () => {}, onMode = () => {}, onClearLocks = () => {}, onMemory = () => {}, confirm = askConfirm }) {
  const P = { mode: "GPP", raw: Object.fromEntries(MODES.map((m) => [m, loadRaw(tryStore, m)])), overrides: {}, limits: {}, results: {}, swap: null, lt: freshLt(), spots: {}, spotsReady: false, spotsError: null, spotsReading: null, spotQueue: null, spotPending: 0, spotGen: 0, spotMenu: null, spotWarn: null, spotMove: null, builds: [], buildsReady: false, buildsError: null, buildsReading: null, buildQueue: null, buildGen: 0, setOpen: false, loaded: null, saved: [], savedPick: new Set(), savedError: null, savedReady: false, savedReading: null, running: false, showSkipped: false, ovOpen: false, ovMsg: null, lrOpen: false, lrMsg: null, ls: null, expSort: { ...DEFAULT_EXPOSURE_SORT }, expPos: "All", svNames: {}, svEdit: null, ...freshWork() };
  const X = { P, el, lel: lineupsEl, onView, onTabs, isLineupsView, onMode, api, toast, tryStore, dash, ctx, onLateSwap, onWork, onClearLocks, onMemory, confirm, settle: pressSettle() };
  X.redraw = () => render(X);
  el.addEventListener("click", (e) => { const was = P.mode; onClick(X, e); if (P.mode !== was) { onMode(P.mode); onMemory(); } });
  el.addEventListener("input", (e) => onInput(X, e));
  if (lineupsEl) { // the Lineups tab: the same click handler, its own filter box
    lineupsEl.addEventListener("click", (e) => onClick(X, e));
    lineupsEl.addEventListener("input", (e) => tabInput(X, e.target, own));
    lineupsEl.addEventListener("keydown", (e) => { savedNameKey(X, e, own); if (e.key === "Enter" && e.target.dataset?.spotname) tabClick(X, { op: "spotadd", id: e.target.dataset.spotname }, own); });
    lineupsEl.addEventListener("focusout", (e) => savedNameBlur(X, e, own));
  }
  el.addEventListener("keydown", (e) => savedNameKey(X, e, own));
  el.addEventListener("focusout", (e) => savedNameBlur(X, e, own));
  return {
    render: () => render(X),
    setSlate: (name, view = null) => { const was = P.mode; setSlate(X, name, view); if (P.mode !== was) onMode(P.mode); },
    memory: () => ({ mode: P.mode, expSort: P.expSort, expPos: P.expPos }),
    mode: () => P.mode,
    builtCount: () => entriesOf(P).build.length,
    inLineup: () => (ctx().name ? shownIds(P, ctx()) : null),
    blocked: () => blockedRows(X),
    rowClick: (id) => rowClick(X, id, own),
    dropMan: (id) => dropMan(X, id, own),
    toggleLateSwap: () => toggleLateSwap(X),
    lateSwap: () => (P.ls && ctx().name ? lsView(P, ctx()) : null),
    running: () => P.running, // the header's Late swap switch is off while a build runs
    // Before a new pull replaces the rows: each late swap slot man's last row, so a man it drops is still known by name.
    beforeRoster: () => { if (P.ls) P.ls.last = rememberSlots(P.ls.slots, ctx().byId, lsView(P, ctx()).started, P.ls.last); },
    rosterInput: () => ({ work: P.work, workReady: P.workReady, ls: P.ls }),
    // After one: the working lineup without the men who left (slate-refresh.js rosterCleanup), and the saved list read again on every refresh, so its legal verdicts are the new slate's.
    afterRoster: (out) => {
      workAfterRoster(X, out.work, out.workLeft, own);
      readSaved(X, ctx().name, own);
    },
    limits: () => P.limits,
    limitOutcome: (kind, id, text) => {
      const c = ctx(), p = c.byId.get(id), row = P.limits[id] ?? {};
      return limitOutcome(kind, text, { name: p?.name ?? id, cur: row[kind] ?? null, other: row[kind === "min" ? "max" : "min"] ?? null, held: c.picks.locked.includes(id) || P.work.includes(id), excluded: c.picks.excluded.includes(id) });
    },
    // settle(fn) runs the redraw: a box closed by a press waits for the press to end, as a redraw now would swallow its click.
    setLimit: (kind, id, value, settle = (fn) => fn()) => {
      P.limits = withLimit(P.limits, id, kind, value);
      saveLimits(tryStore, ctx().name, P.limits);
      settle(() => { render(X); onWork(); });
    },
    // idx null unpins the man (the picker's "—").
    pin: async (id, idx) => {
      if (!P.ls || P.running) return; // the pickers are off during a build; a pin then would be lost
      if (idx == null) { const at = P.ls.slots.indexOf(id); if (at >= 0) lsUnpin(X, at); }
      else {
        try { await lsPin(X, id, idx); } catch (e) { toast(`Could not pin: the server's time could not be read (${e.message})`, "err"); }
      }
      render(X); onLateSwap();
    },
  };
}
