// The optimizer panel in late swap mode (Adam, 2026-10-29, layout A: a switch in the page header). The panel shows the
// working lineup's 8 slots: a man whose game has started is frozen in his slot, a man Adam pins holds the slot he picked,
// and every other slot is open; Build fills only the open slots. Started men outside the lineup cannot be added. "Now"
// comes from the server (GET /api/now), so a test clock there reaches the page too. Outside the mode none of this runs.
import { esc, isoToEastern, ICON } from "./board-util.js";
import { SLOTS } from "./slots.js";
import { cardRowHtml, nameLink, nameLinks, skippedList } from "./card-row.js";
import { slateRefMs, startedSplit, pinsOf, pinTo, unpin, clockNow, nextTipDelay, snapshot, carryForward, lateEntries, startedSince, rememberSlots, goneSlots, goneRefusal } from "./lateswap.js";
import { savedCall } from "./saved-panel.js";

const N = SLOTS.length;
/** Beside the note of a build that built nothing, whose earlier cards stay on show. */
export const KEPT_NOTE = "These cards are from the earlier build.";
const etOf = (ms) => (Number.isFinite(ms) ? isoToEastern(new Date(ms).toISOString()) : null) ?? "time unknown";
const REDRAW_MS = 30_000; // the page redraws at least this often in the mode, and at each tip
const names = (ids, byId) => ids.map((id) => byId.get(id)?.name ?? id).join(", ");
/** A note's entries as men: a dk_id on the slate becomes the man; anything else (an older note that kept his name, a man off
 *  the slate) stays plain text. */
const menOf = (list, byId) => list.map((x) => byId.get(x) ?? { dk_id: null, name: x });

/** The mode's message: its names (ls.msgMen, the dk_ids it speaks of) are card links; a message with no list stays plain. */
export function lsMsgHtml(ls, byId) {
  const joined = names(ls.msgMen ?? [], byId), at = joined ? ls.msg.indexOf(joined) : -1;
  if (at < 0) return esc(ls.msg);
  return esc(ls.msg.slice(0, at)) + nameLinks(menOf(ls.msgMen, byId)) + esc(ls.msg.slice(at + joined.length));
}

/** Everything the page draws in the mode, from the panel state P and the board context c (name, byId, players). The clock
 *  keeps moving: now is the server's last reading plus the time the page has counted since (pageNowMs, the page's clock). */
export function lsView(P, c, pageNowMs = performance.now()) {
  const ls = P.ls;
  const nowMs = clockNow(ls.clock, pageNowMs);
  const { started, untimed } = startedSplit(c.players, { nowMs, refMs: slateRefMs(c.name) });
  // A man a new pull dropped keeps his slot, drawn by name from his last row; if he had started, he stays frozen. Never an open slot for a build to fill.
  const gone = goneSlots(ls.slots, c.byId, ls.last, { nowMs, refMs: slateRefMs(c.name) });
  for (const g of gone) if (g.started) started.add(g.id);
  const { pinned, frozen } = pinsOf({ slots: ls.slots, userPins: ls.userPins, started });
  const men = ls.slots.map((id) => (id == null ? undefined : c.byId.get(id) ?? { ...(ls.last?.[id]?.row ?? { dk_id: id, stale: true }), gone: true }));
  // busy: a build is running, so the pickers and unpin buttons are off (a pin made now would be lost).
  return { nowMs, started, untimed, pinned, frozen, men, gone, busy: P.running === true, inLineup: new Map(ls.slots.map((id, i) => [id, i]).filter(([id]) => id != null)) };
}

/** Reads the server's now into the mode's clock (the page clock keeps it moving between reads). The page clock is
 *  performance.now(), which never steps backwards when the computer's clock is reset, so the page's now cannot freeze. */
async function readNow(X) {
  const now = await X.api("/api/now");
  if (!X.P.ls) return;
  X.P.ls.clock = { serverMs: now.now_ms, pageMs: performance.now() };
  X.P.ls.injected = now.injected === true;
}

/** A refresh: records who is in the slots and who has started, for the late-entry check at Build. It only carries
 *  forward (carryForward); declare: true is Adam declaring his entry (switching the mode on, loading a saved lineup in
 *  it), which takes every slot as it is. */
export function refresh(X, { declare = false } = {}) {
  if (!X.P.ls) return;
  const v = lsView(X.P, X.ctx());
  X.P.ls.snap = declare ? snapshot(X.P.ls.slots, v.started) : carryForward(X.P.ls.slots, v.started, X.P.ls.snap);
  X.P.ls.last = rememberSlots(X.P.ls.slots, X.ctx().byId, v.started, X.P.ls.last, X.ctx().knownRow);
}

/** A row by id from men on hand (a lineup's built men), else one this page has held. */
const rowFrom = (men, c) => (id) => men?.find((p) => p?.dk_id === id && p.name) ?? c.knownRow?.(id) ?? null;

/** Takes a gone man out of slot i, Adam's decision. A started man's slot does not change here. */
export function lsTakeOut(X, i) {
  const ls = X.P.ls, g = lsView(X.P, X.ctx()).gone.find((x) => x.i === i);
  if (!g || g.started) return;
  X.P.ls = { ...ls, slots: ls.slots.map((id, k) => (k === i ? null : id)), userPins: ls.userPins.filter((k) => k !== i), res: null, msg: null };
  touched(X.P.ls);
  refresh(X);
}

/** A change to the working lineup (pin, unpin, page, load): a build that started before it discards its result. */
export const touched = (ls) => { ls.rev = (ls.rev ?? 0) + 1; };

/** True while one of the mode's slot pickers has focus: a redraw then would close an open picker. */
const pickerOpen = () => typeof document !== "undefined" && Boolean(document.activeElement?.matches?.("select[data-lspin], .psel, .rpin"));

/** Keeps the mode current: a refresh and redraw every 30 seconds and just after each tip. Stops when the mode is off.
 *  While a picker has focus the redraw waits (the refresh still runs) and is tried again in 2 seconds. */
export function runClock(X, redraw) {
  clearTimeout(X.lsTimer);
  if (!X.P.ls) return;
  const c = X.ctx();
  const v = lsView(X.P, c);
  const tip = nextTipDelay(c.players, { nowMs: v.nowMs, refMs: slateRefMs(c.name) });
  const wait = tip == null ? REDRAW_MS : Math.min(REDRAW_MS, tip + 100);
  const tick = () => {
    if (!X.P.ls) return;
    refresh(X);
    if (pickerOpen()) { X.lsTimer = setTimeout(tick, 2000); X.lsTimer.unref?.(); return; }
    redraw(); runClock(X, redraw);
  };
  X.lsTimer = setTimeout(tick, wait);
  X.lsTimer.unref?.(); // in node (the tests) the clock never keeps the process alive; a browser timer has no unref
}

/** The working lineup a switch-on starts from: the lineup the panel shows (its seating as shown), else 8 open slots. A man no longer on the
 *  slate keeps his id in his slot, so his slot never opens silently; lsView draws him and Build refuses until Adam decides. */
export function startSlots(men) {
  if (!men) return new Array(N).fill(null);
  return men.map((p) => p?.dk_id ?? null);
}

/** The slot picker for a man: his legal slots that are not frozen; `cls` and `attr` place it in a panel row or a table row. */
function picker(p, v, cls) {
  const at = v.inLineup.get(p.dk_id);
  if (v.started.has(p.dk_id)) {
    const why = at == null ? "Game started: he can no longer be added" : `Game started: frozen at ${SLOTS[at]}`;
    return `<select class="${cls}" disabled title="${esc(why)}"><option>${at == null ? "—" : SLOTS[at]}</option></select>`;
  }
  const pinnedAt = at != null && v.pinned[p.dk_id] ? at : null;
  const opts = SLOTS.map((s, i) => ((p.roster_positions ?? []).includes(s) && !v.frozen.has(i) ? `<option value="${i}"${pinnedAt === i ? " selected" : ""}>${s}</option>` : "")).join("");
  if (v.busy) return `<select class="${cls}" disabled title="A build is running"><option>${pinnedAt == null ? "pin" : SLOTS[pinnedAt]}</option></select>`;
  return `<select class="${cls}" data-lspin="${esc(p.dk_id)}" title="Pin ${esc(p.name)} to a slot"><option value="">${pinnedAt == null ? "pin" : "—"}</option>${opts}</select>`;
}

/** The table row's pin picker in the mode (board.js puts it in the row's control cell). */
export function rowPin(p, v) {
  return picker(p, v, "rpin");
}

function slotRow(i, p, v, dash, colourOf) {
  const slot = SLOTS[i];
  if (p === undefined) return cardRowHtml({ slot, p, dash, cls: "lslot open", ctl: "" });
  if (p.gone) {
    const started = v.frozen.has(i);
    const ctl = started ? `<span class="frzm" title="Game started: this slot cannot change here">${ICON.lock}</span>` : `<button class="unpin" data-op="lsgone" data-i="${i}"${v.busy ? ` disabled title="A build is running"` : ` title="Take ${esc(p.name ?? "him")} out of ${slot}"`}>×</button>`;
    return cardRowHtml({ slot, p, dash, colourOf, cls: "lslot gonetag", note: "off the slate", ctl });
  }
  const fz = v.frozen.has(i), pin = !fz && v.pinned[p.dk_id] != null;
  const ctl = fz
    ? `<span class="frzm" title="Game started: frozen at ${slot}">${ICON.lock}</span>`
    : pin
      ? `<button class="unpin" data-op="lsunpin" data-i="${i}"${v.busy ? ` disabled title="A build is running"` : ` title="Unpin ${esc(p.name)} from ${slot}"`}>${ICON.lock}<i>×</i></button>`
      : picker(p, v, "psel");
  return cardRowHtml({ slot, p, dash, colourOf, cls: `lslot${fz ? " frz" : pin ? " pnd" : ""}`, attrs: fz ? ` title="Game started: frozen"` : pin ? ` title="Pinned here"` : "", ctl });
}

/** The mode's lineup block: header with the as-of time and the switcher, the 8 slots, the totals (capLine, card-row.js). */
export function lsLineupHtml(P, c, v, { dash, capLine, pageWindow }) {
  const res = P.ls.res, n = res?.lineups.length ?? 0;
  const head = n ? `Late swap · lineup ${res.idx + 1} of ${n}${res.kept ? " · from an earlier Build" : ""}` : "Late swap · working lineup";
  const pages = n > 1 ? `<span class="sw"><button data-op="lsprev"${res.idx === 0 ? " disabled" : ""}>‹</button>${pageWindow(n, res.idx).map((i) => `<button data-op="lspage" data-i="${i}" class="${i === res.idx ? "on" : ""}">${i + 1}</button>`).join("")}<button data-op="lsnext"${res.idx === n - 1 ? " disabled" : ""}>›</button></span>` : `<span title="The time late swap reads as now${P.ls.injected ? " (a test clock set on the server)" : ""}">as of ${esc(etOf(v.nowMs))}${P.ls.injected ? " (test clock)" : ""}</span>`;
  const filled = v.men.filter((p) => p !== undefined);
  return `<div class="luh"><span>${head}</span>${pages}</div>${SLOTS.map((_, i) => slotRow(i, v.men[i], v, dash, c.colourOf)).join("")}`
    + capLine(filled, { dash })
    + savedLocksHtml(c);
}

/** The saved locks, which the table no longer shows in the mode but a build still applies; × removes one through the
 *  page's own unlock path (data-unpick). Empty when there are none. */
export function savedLocksHtml(c) {
  const men = (c.picks?.locked ?? []).map((id) => c.byId.get(id)).filter(Boolean);
  if (!men.length) return "";
  return `<div class="lslocks"><span>Saved locks also apply:</span>${men.map((p) => `<span class="ovc">${nameLink(p, "il")}<button data-unpick="${esc(p.dk_id)}" title="Remove the lock on ${esc(p.name)}">×</button></span>`).join("")}</div>`;
}

/** The mode's notes: what has started, men with no tip, locks a started game took out, and the last build's notes. */
export function lsNotesHtml(P, c, v) {
  const out = [];
  const games = [...new Set(c.players.filter((p) => v.started.has(p.dk_id)).map((p) => p.game))].sort();
  const rule = "Frozen men keep their slot; started men outside the lineup cannot be added.\nThe lineup shown is treated as your DraftKings entry: once a man in it tips, he freezes in that slot.\nPaging changes which lineup is your entry; a man who tips while he is off the page is treated as not in your entry.";
  out.push(`<div class="actnote" title="${rule}">${games.length ? `Started: ${esc(games.join(", "))} · their men stay frozen or out` : "No game has started yet: pin men to slots, or build as usual"}</div>`);
  if (v.untimed.length) {
    const names = v.untimed.map((p) => p.name ?? p.dk_id).join(", ");
    out.push(`<div class="actnote" title="${esc(names)}">No tip time for ${v.untimed.length} ${v.untimed.length === 1 ? "man" : "men"} (${nameLinks(v.untimed)}): treated as not started</div>`);
  }
  const res = P.ls.res?.mode === P.mode ? P.ls.res : null; // a build's notes show under the mode it built
  if (P.ls.msg) out.push(`<div class="actnote">${lsMsgHtml(P.ls, c.byId)}</div>`);
  if (res?.error) out.push(`<div class="actnote err">${esc(res.error)}</div>`);
  if (res?.droppedLocks?.length) out.push(`<div class="actnote">Locked but started, so left out: ${nameLinks(menOf(res.droppedLocks, c.byId))}</div>`);
  if (res?.unexcluded?.length) out.push(`<div class="actnote">Pinned, so not excluded this build: ${nameLinks(menOf(res.unexcluded, c.byId))}</div>`);
  if (res?.note) out.push(`<div class="actnote wrap${res.partial?.reason === "failed" ? " err" : ""}">${esc(res.note)}${res.kept ? ` ${KEPT_NOTE}` : ""}</div>`);
  if (res?.skipped?.length) {
    const n = res.skipped.length;
    out.push(`<div class="actnote"><button class="sk" data-op="skipped">${n} ${n === 1 ? "man" : "men"} skipped ${P.showSkipped ? "▾" : "▸"}</button></div>`);
    if (P.showSkipped) out.push(skippedList(res.skipped));
  }
  return out.join("");
}

/** Switches the mode on: reads now from the server, starts from the shown lineup's men (startSlots). */
export async function enterLateSwap(X, men) {
  const name = X.ctx().name;
  const now = await X.api("/api/now");
  if (name !== X.ctx().name) return;
  const c = X.ctx(), slots = startSlots(men);
  X.P.ls = { clock: { serverMs: now.now_ms, pageMs: performance.now() }, injected: now.injected === true, slots, last: rememberSlots(slots, c.byId, new Set(), null, rowFrom(men, c)), userPins: [], res: null, msg: null, snap: null, rev: 0 };
  refresh(X, { declare: true }); // the lineup Adam brings in is his entry: its started men were in before their tips
}

/** Pins man `id` to slot index idx from a picker, after re-reading the server's now (his game may have just started);
 *  a refusal shows as the panel's message. */
export async function lsPin(X, id, idx) {
  const name = X.ctx().name;
  await readNow(X);
  if (name !== X.ctx().name || !X.P.ls) return;
  const c = X.ctx(), p = c.byId.get(id), v = lsView(X.P, c);
  if (!p) return;
  const out = pinTo(X.P.ls, p, idx, { started: v.started, byId: c.byId });
  if (out.msg) { X.P.ls.msg = out.msg; X.P.ls.msgMen = null; return; }
  X.P.ls = { ...X.P.ls, ...out.ls, res: null, msg: null }; // a pin change makes the built lineups out of date
  touched(X.P.ls);
  refresh(X);
}

export function lsUnpin(X, idx) {
  const v = lsView(X.P, X.ctx());
  X.P.ls = { ...X.P.ls, ...unpin(X.P.ls, idx, { started: v.started }), res: null, msg: null };
  touched(X.P.ls);
}

/** Shows built lineup i: it becomes the working lineup (every built lineup keeps the same pins). A lineup holding a man
 *  whose game started after the build is flagged; Build takes him out. */
export function lsPage(X, i) {
  const res = X.P.ls.res;
  res.idx = Math.max(0, Math.min(res.lineups.length - 1, i));
  X.P.ls.slots = [...res.lineups[res.idx].ids];
  X.P.ls.last = rememberSlots(X.P.ls.slots, X.ctx().byId, new Set(), X.P.ls.last, rowFrom(res.lineups[res.idx].slots, X.ctx())); // a man off the slate on this page is known by name
  touched(X.P.ls);
  const fresh = startedSince(res.started ?? [], lsView(X.P, X.ctx()).started).filter((id) => X.P.ls.slots.includes(id));
  X.P.ls.msg = fresh.length ? `This lineup holds ${names(fresh, X.ctx().byId)}, whose game started after the build; Build will take him out.` : null;
  X.P.ls.msgMen = fresh;
}

/**
 * Builds in the mode: re-reads now (a game may have started since), pins every frozen and pinned man, and asks the server
 * to fill the open slots. `post` is the panel's POST helper; the server leaves out every started man who is not pinned.
 * `current` is false once the panel has abandoned this build (a move to another slate, even if it has moved back).
 */
export async function lsBuild(X, settings, post, current = () => true) {
  const name = X.ctx().name, mode = X.P.mode;
  const ls0 = X.P.ls; // the state this build started from; a mode switched off and on again replaces it
  await readNow(X);
  if (name !== X.ctx().name || X.P.ls !== ls0 || !current()) return;
  const byId = X.ctx().byId;
  const v = lsView(X.P, X.ctx());
  const refusal = goneRefusal(v.gone, SLOTS);
  if (refusal) { X.P.ls.msg = refusal; X.P.ls.msgMen = null; return; } // fails closed: nothing is sent, and his slot is never filled for him
  // A man whose game started before the last refresh saw him in the slots came in after his tip: DraftKings would refuse
  // that entry, so he is taken out and named, and nothing is built.
  const late = lateEntries({ slots: X.P.ls.slots, started: v.started, snap: X.P.ls.snap });
  if (late.length) {
    X.P.ls.slots = X.P.ls.slots.map((id) => (late.includes(id) ? null : id));
    X.P.ls.userPins = X.P.ls.userPins.filter((i) => X.P.ls.slots[i] != null);
    X.P.ls.res = null;
    X.P.ls.msg = `Taken out, his game started before he was in the lineup: ${names(late, byId)}. Build again.`;
    X.P.ls.msgMen = late;
    refresh(X);
    return;
  }
  const rev = X.P.ls.rev;
  const out = await post(X, "optimize", { mode, settings: { ...settings, pinned: v.pinned }, lateSwap: true });
  if (name !== X.ctx().name || !X.P.ls || !current()) return;
  // A pin, unpin, page, load or Cash/GPP switch (the counter), or a new entry (a replaced state object): the result is stale.
  if (X.P.ls !== ls0 || X.P.ls.rev !== rev) { X.P.ls.msg = "The working lineup changed during the build; build again."; X.P.ls.msgMen = null; return; }
  const prev = X.P.ls.res;
  if (!out.lineups.length && prev?.lineups.length) { X.P.ls.res = { ...prev, note: out.note ?? null, partial: out.partial ?? null, error: null, kept: true }; X.P.ls.msg = null; refresh(X); return; } // nothing built (a stop, or a note saying why): the lineups on show stay, the note over them
  X.P.ls.res = {
    idx: 0, mode, pinned: v.pinned, started: [...v.started], lineups: out.lineups.map((l) => ({ ...l, ids: l.slots.map((p) => p.dk_id) })), note: out.note ?? null, partial: out.partial ?? null, error: null, skipped: out.skipped ?? [],
    droppedLocks: out.late_swap?.dropped_locks ?? [],
    unexcluded: out.late_swap?.pinned_not_excluded ?? [],
  };
  if (X.P.ls.res.lineups.length) X.P.ls.slots = [...X.P.ls.res.lineups[0].ids];
  X.P.ls.msg = null;
  refresh(X);
}

/** Before the DK file is written: re-reads now; when a game has started since the build, returns the refusal (the built
 *  lineups may hold men DraftKings no longer lets in), else null. */
export async function lsDownloadProblem(X) {
  await readNow(X);
  const res = X.P.ls?.res;
  if (!res) return "Nothing built in late swap mode yet.";
  const fresh = startedSince(res.started ?? [], lsView(X.P, X.ctx()).started);
  if (!fresh.length) return null;
  const games = [...new Set(fresh.map((id) => X.ctx().byId.get(id)?.game ?? id))].sort();
  return `${games.join(", ")} started after these lineups were built; build again before downloading.`;
}

/** The DK file in the mode: re-read now first; a game that started since the build refuses the file (build again).
 *  Returns the refusal to show, or null when the file may be written. */
export async function lsDownloadRefusal(X) {
  let problem;
  try { problem = await lsDownloadProblem(X); } catch (e) { problem = `could not read the server's time (${e.message})`; }
  return problem ? `DK file not written. ${problem}` : null;
}

/**
 * The panel's clicks in the mode: its own switcher, unpin, save and load. True when the click was one of these; build,
 * CSV, delete and the settings are shared (panel.js). `own` is the panel's { render, post, loadSlots } (panel.js), passed
 * in so this file never imports panel.js back.
 */
export function lsClick(X, d, own) {
  const { P } = X, ls = P.ls;
  const redraw = () => { own.render(X); X.onLateSwap(); }; // the table's pickers follow the working lineup
  switch (d.op) {
    // A Cash/GPP switch counts as a change: a build still running for the other mode is discarded, not shown.
    case "mode": ls.res = null; touched(ls); Object.assign(P, { mode: d.m, showSkipped: false }); own.render(X); return true;
    case "lsunpin": if (!P.running) lsUnpin(X, +d.i); redraw(); return true;
    case "lsgone": if (!P.running) lsTakeOut(X, +d.i); redraw(); return true;
    case "lspage": lsPage(X, +d.i); redraw(); return true;
    case "lsprev": lsPage(X, ls.res.idx - 1); redraw(); return true;
    case "lsnext": lsPage(X, ls.res.idx + 1); redraw(); return true;
    case "save": savedCall(X, { slots: ls.slots, mode: ls.res.mode }, "save the lineup", own); return true;
    case "load": {
      // Seated for late swap first, as on the way in, so the frozen slots match the DraftKings entry the CSV wrote.
      const l = P.saved.find((x) => x.id === d.id);
      // Loading is Adam declaring his entry, so every slot is taken as it is (declare); a build in flight is discarded.
      if (l) { P.ls = { ...ls, slots: own.loadSlots(l, X.ctx().byId), userPins: [], res: null, msg: null }; touched(P.ls); refresh(X, { declare: true }); }
      redraw(); if (l) own.showSlots?.(X); return true;
    }
  }
  return false;
}
