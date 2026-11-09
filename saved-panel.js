// The saved lineups' page side (the cards are drawn by lineups-tab.js): the not-legal tag, Load, Delete and the tick for Download DK
// CSV, a card's name and letter, and the read of a slate's saved list from the server. The panel's own render, POST helper and CSV step come in as `own`, so this file never imports panel.js back.
import { esc, isoToEastern } from "./board-util.js";
import { CONFIRM } from "./confirm.js";

/** A saved lineup the server judged not legal against tonight's slate file (its `legal` and `reasons`); "" when legal. */
export function illegalTag(l) {
  if (l?.legal !== false) return "";
  return `<em class="unp ill" title="${esc((l.reasons ?? []).join(" "))}">${l.stale ? "off this slate" : "not legal now"}</em>`;
}

/** The saved lineups ticked for the DK file, as they are listed; a tick on a lineup no longer saved counts for nothing. */
export const pickedSaved = (P) => [...P.saved].reverse().filter((l) => P.savedPick?.has(l.id));

// A saved card's name and letter (standard D8). The saved lineups' file is the server's, so a name is kept in the browser per
// slate, the viewer's own words; the letter follows the order saved. An unnamed card reads Lineup and its letter.
export const NAME_MAX = 40;
const namesKey = (slate) => `nbaboard.saved.names.${slate}`;
/** The stored names made safe: only short text under an id. */
export function cleanSavedNames(saved) {
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
  return Object.fromEntries(Object.entries(saved).filter(([, n]) => typeof n === "string" && n.trim() && n.length <= NAME_MAX));
}
export const loadSavedNames = (tryStore, slate) => cleanSavedNames(tryStore(() => JSON.parse(localStorage.getItem(namesKey(slate)) ?? "null")));

/** The tag for the card at place i in the order saved: A to Z, then AA, AB. */
export function savedLetter(i) {
  const first = Math.floor(i / 26);
  return (first ? String.fromCharCode(64 + first) : "") + String.fromCharCode(65 + (i % 26));
}

/** A saved lineup's letter: from the server's id, never reused, so a delete moves no other card's letter; an id that is not a
 *  number falls back to its place in the list. */
export const savedLetterOf = (l, saved) => savedLetter(/^[1-9]\d*$/.test(String(l.id)) ? Number(l.id) - 1 : saved.indexOf(l));

/** The saved list as the server answered it, with the page-only swaps kept (by id): a swap made on a saved card stays until it is
 *  saved or the page is left, however often the list is read again. A lineup the server no longer has is gone. */
export function keepSwaps(prev, next) {
  const swapped = new Map((prev ?? []).filter((l) => l.swapped).map((l) => [String(l.id), l]));
  return next.map((l) => (swapped.has(String(l.id)) ? { ...l, slots: swapped.get(String(l.id)).slots, orig: swapped.get(String(l.id)).orig, swapped: true } : l));
}

/** Closes the name box: "save" keeps what was typed (an empty box goes back to the plain name), anything else drops it. */
function endName(X, how) {
  const { P } = X, e = P.svEdit;
  if (!e) return;
  P.svEdit = null;
  if (how !== "save") return;
  const text = e.text.trim().slice(0, NAME_MAX), next = { ...P.svNames };
  if (text) next[e.id] = text; else delete next[e.id];
  P.svNames = next;
  X.tryStore(() => localStorage.setItem(namesKey(X.ctx().name), JSON.stringify(next)));
}

/** What is typed in a name box is kept on the panel, so a redraw never loses it. True when `el` is one. */
export function savedNameInput(X, el) {
  if (!el.dataset?.svname || !X.P.svEdit) return false;
  X.P.svEdit.text = el.value;
  return true;
}

/** A name box's keys (standard A3): Enter saves, Esc cancels. */
export function savedNameKey(X, e, { render }) {
  if (!e.target.dataset?.svname || (e.key !== "Enter" && e.key !== "Escape")) return;
  e.preventDefault();
  e.stopPropagation();
  const id = e.target.dataset.svname;
  endName(X, e.key === "Enter" ? "save" : "drop");
  render(X);
  (X.lel ?? X.el).querySelector?.(`[data-op="svrename"][data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
}

/** A click away saves (standard A3). A redraw lifting the box away is no click away: it is put back with what was typed. The
 *  redraw this causes waits for the press to end, as one now would take away what is being clicked. */
export function savedNameBlur(X, e, { render }) {
  if (!e.target.dataset?.svname || !X.P.svEdit || X.P.drawing) return;
  endName(X, "save");
  (X.settle ?? ((fn) => fn()))(() => render(X));
}

/** After the server's answer: the names of lineups no longer saved go. Only from a list that was read, never a failed read. */
function pruneNames(X, lineups) {
  const { P } = X;
  if (!P.svNames) return;
  const keep = new Set(lineups.map((l) => l.id));
  const next = Object.fromEntries(Object.entries(P.svNames).filter(([id]) => keep.has(id)));
  if (Object.keys(next).length === Object.keys(P.svNames).length) return;
  P.svNames = next;
  X.tryStore(() => localStorage.setItem(namesKey(X.ctx().name), JSON.stringify(next)));
}

/** A saved lineup in a message, by what its card shows. */
export const savedName = (l) => `${l.mode} saved ${isoToEastern(l.saved_at) ?? "at an unknown time"}`;

/** Sends a save or delete to the server and shows the saved list it answers with (for the slate still on show). `done` runs
 *  only when the server took it, so a failed delete changes nothing on the page. Answers true when the server took it. */
export async function savedCall(X, body, what, { render, post }, done = null) {
  const name = X.ctx().name;
  try {
    const out = await post(X, "lineups", body);
    if (name !== X.ctx().name) return false;
    done?.();
    Object.assign(X.P, { saved: keepSwaps(X.P.saved, out.lineups), savedError: null, savedReady: true });
    pruneNames(X, out.lineups);
    render(X);
    if (out.already > 0) X.toast(`${out.saved} saved, ${out.already} already saved`); // the default toast is the amber one
    return true;
  } catch (e) { X.toast(`Could not ${what}: ${e.message}`, "err"); return false; }
}

export const SAVE_BATCH = 150; // the server's most lineups in one batch (store.js MAX_BATCH)

/** Save all: `items` [{ slots, mode }] sent in batches of SAVE_BATCH, then one message: how many saved and how many were already
 *  saved. A batch the server refuses stops the rest and says what had been saved before it. True when every batch was taken. */
export async function saveBatch(X, items, { render, post }) {
  const name = X.ctx().name;
  let saved = 0, already = 0;
  try {
    for (let i = 0; i < items.length; i += SAVE_BATCH) {
      const out = await post(X, "lineups", { batch: items.slice(i, i + SAVE_BATCH) });
      if (name !== X.ctx().name) return false;
      saved += out.saved;
      already += out.already;
      Object.assign(X.P, { saved: keepSwaps(X.P.saved, out.lineups), savedError: null, savedReady: true });
      pruneNames(X, out.lineups);
    }
    render(X);
    X.toast(already > 0 ? `${saved} saved, ${already} already saved` : `${saved} saved`);
    return true;
  } catch (e) {
    render(X);
    X.toast(`Could not save all the lineups: ${e.message}${saved || already ? ` (${saved} saved, ${already} already saved before that)` : ""}`, "err");
    return false;
  }
}

/** A delete, once Adam has said yes. */
async function deleteSaved(X, id, own) {
  const { P } = X;
  // A lineup that holds a spot (Adam's contest entry) asks first and names it; the server empties the spot before the lineup goes
  // (the spot file keeps what it held under `last`), and the page reads the spots again after.
  const held = Object.entries(P.spots ?? {}).filter(([, s]) => s?.lineup_id === String(id)).map(([n]) => n);
  const text = held.length ? `${CONFIRM.deleteSaved} It holds ${held.join(" and ")}; ${held.length === 1 ? "that spot" : "those spots"} will be left empty.` : CONFIRM.deleteSaved;
  if (!(await X.confirm(text, { ok: "Delete" }))) return;
  await savedCall(X, { remove: id }, "delete the lineup", own, () => {
    if (P.loaded?.id === id) P.loaded = null;
    P.savedPick?.delete(id);
  });
  await own.readSpots?.(X);
}

/** Outside late swap mode: save the lineup on show (built, or a full working lineup: own.saveIds), load a saved one (it
 *  becomes the working lineup: own.loadSaved), delete one, tick one for the DK file, write that file. True when the click
 *  was one of these (late swap mode has its own save and load, lateswap-panel.js; the others are shared). */
export function savedClick(X, d, own) {
  const { P } = X;
  switch (d.op) {
    case "save": { const ids = own.saveIds(X); if (ids) savedCall(X, { slots: ids, mode: own.saveMode?.(X) ?? P.mode }, "save the lineup", own); return true; }
    case "load": { const l = P.saved.find((x) => x.id === d.id); if (l) own.loadSaved(X, l); return true; }
    case "del": deleteSaved(X, d.id, own); return true;
    case "svrename": P.svEdit = { id: d.id, text: P.svNames?.[d.id] ?? "" }; own.render(X); (X.lel ?? X.el).querySelector?.(`[data-svname="${CSS.escape(d.id)}"]`)?.focus({ preventScroll: true }); return true;
    case "svpick": P.savedPick ??= new Set(); if (P.savedPick.has(d.id)) P.savedPick.delete(d.id); else P.savedPick.add(d.id); own.render(X); return true;
    case "svcsv": own.downloadSaved(X); return true;
  }
  return false;
}

/** Reads a slate's saved lineups from the server into the panel (only while that slate is still on show). One read at a time. */
export function readSaved(X, name, { render }) {
  const read = X.api(`/api/slate/${encodeURIComponent(name)}/lineups`)
    .then((out) => { if (name === X.ctx().name) { Object.assign(X.P, { saved: keepSwaps(X.P.saved, out.lineups), savedError: null, savedReady: true }); pruneNames(X, out.lineups); render(X); } })
    .catch((e) => { if (name === X.ctx().name) { X.P.savedError = e.message; render(X); } })
    .finally(() => { if (X.P.savedReading === read) X.P.savedReading = null; });
  X.P.savedReading = read;
  return read;
}

/** A panel click after a failed read of the saved list tries it again. */
export function retrySaved(X, own) {
  if (X.P.savedError && !X.P.savedReading && X.ctx().name) readSaved(X, X.ctx().name, own);
}
