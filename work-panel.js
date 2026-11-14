// The optimizer panel's working lineup (Adam, 5:34 PM ET 2026-10-29): a click on a player row puts the man in or takes him
// out, a click on a filled slot empties it, and Build keeps the hand-picked men and fills the rest (the working lineup's 8
// slots go to the server as handPicks; each hand-picked man is held in every lineup of that build only, and any man may
// move to another slot his positions allow; his Lock state never changes). The placement rules are in worklineup.js (pure). The working lineup is
// kept per slate on the server (GET/POST /api/slate/<name>/working, the file cache/working/<slate>.json), the way the
// picks are, so it survives a reload. Outside late swap mode only: in the mode a row click does nothing new and the mode's
// own working lineup (lateswap-panel.js) is untouched.
//
// Until the server's copy has been read (P.workReady), nothing may change the working lineup: a click then would save
// over the copy not yet read. Clicks are refused with a toast, Build waits too, and the next panel click retries the read.
//
import { esc, isoToEastern, tipWhen } from "./board-util.js";
import { SLOTS, SALARY_CAP, checkLineup } from "./slots.js";
import { emptyWork, handIds, seatWork, toggleMan, emptySlot, removeMan, workFrom, cleanWork, lockedMsg } from "./worklineup.js";
import { rowBlocks } from "./row-block.js";
import { illegalTag } from "./saved-panel.js";
import { nameLinks, totals, totalValue } from "./card-row.js";
import { CONFIRM } from "./confirm.js";

const N = SLOTS.length;
export const NOT_LOADED = "The working lineup has not loaded yet";
/** Standard D17's words: a click on the lineup while a build runs would be lost, so it says why nothing happened. */
export const BUILD_RUNNING = "Lineups are already being made; try again when that finishes.";

/** The working lineup's view (worklineup.js seatWork) from the panel state and the board context. */
export const workView = (P, c) => seatWork(P.work, c.byId, c.picks.locked);

/** The dk_ids in the working lineup, for the table's in-lineup mark; null in late swap mode. */
export function shownIds(P, c) {
  if (P.ls) return null;
  return new Set(workView(P, c).men.filter(Boolean).map((p) => p.dk_id));
}

/** True (after the toast, and a retry of the read) while the server's copy has not been read. */
function notReady(X, own) {
  if (X.P.workReady) return false;
  X.toast(NOT_LOADED);
  retryWork(X, own);
  return true;
}

/** A new working lineup: the panel shows it, the table's marks follow, and it is saved for the slate. */
function setWork(X, slots, own, loaded = null) {
  Object.assign(X.P, { work: slots, loaded, workLeft: [] });
  own.render(X); X.onWork();
  saveWork(X, own);
}

/** A new pull took men off the slate: the working lineup without them, saved, and they are named. Build never reaches the server with an id it would refuse. */
export function workAfterRoster(X, slots, left, own) {
  if (!left.length) return;
  setWork(X, slots, own);
  X.P.workLeft = left;
  own.render(X);
  X.toast(`Left the working lineup, no longer on the slate: ${left.join(", ")}.`);
}

/** A row click: the man goes in, or out when he is in; a refusal (position, cap, excluded, a missing figure) is a toast. */
export function rowClick(X, id, own) {
  const c = X.ctx(), p = c.byId.get(id);
  if (!p || X.P.ls) return;
  if (X.P.running) return X.toast(BUILD_RUNNING);
  if (notReady(X, own)) return;
  if (c.picks.locked.includes(id) && shownIds(X.P, c).has(id)) return X.toast(lockedMsg(p));
  const out = toggleMan(X.P.work, p, { byId: c.byId, lockedIds: c.picks.locked, excludedIds: c.picks.excluded });
  if (!out.ok) return X.toast(out.msg);
  setWork(X, out.slots, own);
}

/** The men who cannot go into the working lineup now, dk_id -> why (row-block.js, standard A18), kept until something it reads
 *  changes, as the rows redraw far more often than the lineup does. Null when it is not known who fits: in late swap mode, and
 *  before the server's copy has been read, when nobody is greyed. */
export function blockedRows(X) {
  const { P } = X, c = X.ctx();
  if (P.ls || !P.workReady || !c.name) return null;
  const slots = P.work;
  const key = JSON.stringify([c.name, slots, c.picks.locked, c.picks.excluded, c.ovKey, c.refreshGen ?? 0]); // a new pull moves salaries and figures the override key no longer sees
  if (P.blocked?.key !== key) P.blocked = { key, rows: rowBlocks(slots, c.players, { byId: c.byId, lockedIds: c.picks.locked, excludedIds: c.picks.excluded }) };
  return P.blocked.rows;
}

/** A click on filled slot i of the working lineup: it empties (a locked man stays: his lock is his to undo). */
export function slotClick(X, i, own) {
  const c = X.ctx();
  if (X.P.ls) return;
  if (X.P.running) return X.toast(BUILD_RUNNING);
  if (notReady(X, own)) return;
  const id = workView(X.P, c).men[i]?.dk_id;
  if (id == null) return;
  if (c.picks.locked.includes(id)) return X.toast(lockedMsg(c.byId.get(id) ?? { name: id }));
  setWork(X, emptySlot(X.P.work, i), own);
}

/** True when the working lineup holds a man, hand-picked or locked (a locked man with no slot left included). */
export function holdsMan(P, c) {
  const v = workView(P, c);
  return v.men.some(Boolean) || v.unplaced.length > 0;
}

/** Clear lineup (B6): every slot and every lock go, after a yes; excludes, stars, typed numbers and the built cards stay. The
 *  answer can come much later, so what it may act on is read again then. */
export async function clearLineup(X, own) {
  const name = X.ctx().name;
  if (X.P.ls || X.P.running || notReady(X, own) || !holdsMan(X.P, X.ctx())) return;
  if (!(await X.confirm(CONFIRM.clearLineup, { ok: "Clear" }))) return;
  if (name !== X.ctx().name || X.P.ls || X.P.running || !X.P.workReady) return;
  setWork(X, emptyWork(), own);
  X.onClearLocks();
}

/** An exclude set on a hand-picked man takes him out of the working lineup (a build would refuse him). Before the read
 *  it changes nothing (the build refuses him by name if he is in the server's copy). */
export function dropMan(X, id, own) {
  if (!X.P.workReady || !X.P.work.includes(id)) return;
  setWork(X, removeMan(X.P.work, id), own);
}

/** A saved lineup loaded into the panel becomes the working lineup: every man hand-picked in his saved slot, except locked
 *  men (still held as locks) and excluded men (left out and named). True when it was loaded. */
export function loadSaved(X, l, own) {
  if (notReady(X, own)) return false;
  const c = X.ctx();
  const slots = cleanWork(workFrom(l.slots, c.byId, c.picks.locked), c.byId);
  const ex = slots.filter((id) => id && c.picks.excluded.includes(id));
  setWork(X, slots.map((id) => (ex.includes(id) ? null : id)), own, l);
  if (ex.length) X.toast(`Left out, excluded: ${ex.map((id) => c.byId.get(id)?.name ?? id).join(", ")}.`);
  return true;
}

/** The ids Save working lineup saves: a full legal working lineup put in late-swap order (`order`: panel.js lateSwapOrder, so
 *  every saved lineup is kept in one order); null when there is nothing to save. */
export function saveIds(P, c, order) {
  const v = workView(P, c);
  if (v.men.some((p) => p === undefined) || !checkLineup(v.men).ok) return null;
  return order(v.men).map((p) => p.dk_id);
}

// Saves go out one at a time, in order (the picks' rule in board.js): quick clicks never reach the server out of order.
// After a failed save the panel reads the server's copy back (the saved file is the truth).
function saveWork(X, own) {
  const name = X.ctx().name, body = JSON.stringify({ slots: X.P.work });
  X.P.workQueue = (X.P.workQueue ?? Promise.resolve()).then(async () => {
    try {
      await X.api(`/api/slate/${encodeURIComponent(name)}/working`, { method: "POST", headers: { "content-type": "application/json" }, body });
    } catch (e) {
      X.toast(`Could not save the working lineup: ${e.message}`, "err");
      if (name === X.ctx().name) await readWork(X, name, own);
    }
  });
}

/**
 * Reads a slate's saved working lineup into the panel (only while that slate is still on show). Success sets workReady;
 * a failure leaves it as it was (false at first: clicks stay refused) and says so. One read at a time (P.workReading).
 */
export function readWork(X, name, own) {
  const at = X.P.work; // a change made while a re-read is out (after a failed save) wins over the copy it brings back
  const read = X.api(`/api/slate/${encodeURIComponent(name)}/working`)
    .then((out) => {
      if (name !== X.ctx().name || X.P.work !== at) return;
      Object.assign(X.P, { work: cleanWork(out.slots, X.ctx().byId), workReady: true, workFailed: null });
      own.render(X); X.onWork();
    })
    .catch((e) => {
      if (name !== X.ctx().name) return;
      X.P.workFailed = e.message;
      X.toast(`Could not read the working lineup: ${e.message}`, "err");
      own.render(X);
    })
    .finally(() => { if (X.P.workReading === read) X.P.workReading = null; });
  X.P.workReading = read;
  return read;
}

/** Starts the read again when the server's copy has not been read and no read is out; returns the read in flight or null. */
export function retryWork(X, own) {
  const name = X.ctx().name;
  if (X.P.workReady || !name) return null;
  return X.P.workReading ?? readWork(X, name, own);
}

/** A fresh working lineup for a new slate: not loaded until the server answers. */
export const freshWork = () => ({ work: emptyWork(), workQueue: Promise.resolve(), workReady: false, workReading: null, workFailed: null });

/** Salary left over the open slots, whole dollars rounded down; null (nothing to show) when the lineup is unread, has no open slot,
 *  is over the cap, a man's salary is missing, or a locked man has no seat (`unplaced`: his salary would be missing from the sum). Pure. */
export function perOpenSlot(ready, men, unplaced = []) {
  const open = men.filter((p) => p === undefined).length, used = totals(men.filter(Boolean)).salary;
  return ready && !unplaced.length && open > 0 && used != null && used <= SALARY_CAP ? Math.floor((SALARY_CAP - used) / open) : null;
}

/** The lineup block for the working lineup: header (the loaded saved lineup, or "Working lineup"), the 8 slots (a filled one
 *  empties on a click), the cap line. Before the read, "not loaded" stands where the count would be, an open slot reads Not
 *  loaded and the totals are dashes. */
export function workLineupHtml(P, c, { slotRow, capLine, dash }) {
  const v = workView(P, c), res = P.results[P.mode], n = res?.lineups.length ?? 0;
  const filled = v.men.filter((p) => p !== undefined).length;
  const title = P.loaded ? `Saved · ${esc(P.loaded.mode)} · ${esc(isoToEastern(P.loaded.saved_at) ?? "time unknown")} ${illegalTag(P.loaded)}` : "Working lineup";
  const why = P.workFailed ? `Could not read it: ${P.workFailed}. Click in the panel to try again.` : "Reading it from the server";
  const right = !P.workReady ? `<span class="unp" title="${esc(why)}">not loaded</span>` : n ? "" : `<span>${filled} of ${N} slots</span>`;
  const canClear = P.workReady && !P.running && (filled > 0 || v.unplaced.length > 0);
  const clear = `<button class="clr" data-op="clearwork"${canClear ? "" : " disabled"}>Clear lineup</button>`;
  const when = tipWhen(c.name);
  const rows = SLOTS.map((s, i) => slotRow(s, v.men[i], v.kind[i] === "lock" || c.picks.locked.includes(v.men[i]?.dk_id), dash, { click: v.men[i] ? i : null, hand: v.kind[i] === "hand", colourOf: c.colourOf, emptyLabel: P.workReady ? "Empty" : "Not loaded", wk: true, when }));
  const heads = `<div class="wkh"><span>Slot</span><span class="wkhp">Player</span><span>Salary</span><span>Proj</span><span>Value</span><span>Own%</span><span></span></div>`;
  const perOpen = perOpenSlot(P.workReady, v.men, v.unplaced);
  const hint = filled || !P.workReady ? "" : `<div class="capt"><span class="none">Click a row to add him; Build keeps your picks and fills the rest.</span></div>`;
  return `<div class="luh"><span>${title}</span><span class="luhr">${right}${clear}</span></div>${heads}${rows.join("")}`
    + capLine(v.men.filter(Boolean), { dash, unknown: !P.workReady, perOpen, valueTot: totalValue(v.men.filter(Boolean)) }) // an unread lineup is unknown, never $0 or a partial sum
    + (v.unplaced.length ? `<div class="capt"><span class="none">No open slot for: ${nameLinks(v.unplaced)}</span></div>` : "")
    + (P.workLeft?.length ? `<div class="capt"><span class="none">Left, no longer on the slate: ${P.workLeft.map(esc).join(", ")}</span></div>` : "")
    + hint;
}

/** The working lineup a build sends as handPicks (8 entries, id or null: the 8 slots go as they are and are checked; only the ids reach the optimizer); null when nobody is
 *  hand-picked or in late swap mode. */
export const buildHand = (P) => (P.ls || !handIds(P.work).length ? null : [...P.work]);
