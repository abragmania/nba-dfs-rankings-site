// The optimizer panel's saved lineups (panel.js draws them under its actions): each a card on the shared lineup row with its
// Cash or GPP mark (optimizer standard A5, A12), Load, Delete and a tick for Download DK CSV, and the read of a slate's saved
// list from the server. The panel's own render, POST helper and CSV step come in as `own`, so this file never imports panel.js back.
import { esc, isoToEastern } from "./board-util.js";
import { SLOTS } from "./slots.js";
import { cardRowHtml, capLine } from "./card-row.js";
import { CONFIRM } from "./confirm.js";
import { HINT } from "./cell-editor.js";

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

function nameRow(l, letter, P) {
  const name = P.svNames?.[l.id] ?? `Lineup ${letter}`;
  const tag = `<span class="svl" title="In the order saved">${letter}</span>`;
  if (P.svEdit?.id === l.id) return `<div class="svn">${tag}<input data-svname="${esc(l.id)}" maxlength="${NAME_MAX}" value="${esc(P.svEdit.text)}" placeholder="Lineup ${letter}" aria-label="Name this lineup" autocomplete="off"><span class="ed-hint">${HINT}</span></div>`;
  return `<div class="svn">${tag}<span>${esc(name)}</span><button data-op="svrename" data-id="${esc(l.id)}">Rename</button></div>`;
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

function savedCard(l, P, { byId, dash, seat, colourOf, knownName = null, tagOf = () => null }) {
  // Seated as the CSV writes them; a man off the slate leaves the lineup as stored, named when this page has held him. A saved card always shows the latest figures (Adam, 11-04).
  const men = seat(l.slots.map((id) => byId.get(id) ?? { dk_id: id, stale: true, name: knownName?.(id) ?? null })).men;
  const at = isoToEastern(l.saved_at);
  // From the server's id, never reused, so a delete moves no other card's letter.
  const letter = savedLetterOf(l, P.saved);
  return `<div class="lc svc">${nameRow(l, letter, P)}<div class="lch"><label class="svt" title="Tick for Download DK CSV"><input type="checkbox" data-op="svpick" data-id="${esc(l.id)}"${P.savedPick?.has(l.id) ? " checked" : ""}><span class="md${l.mode === "Cash" ? " cash" : ""}">${esc(l.mode)}</span><span class="t">${at ? esc(at) : dash("no time on this saved lineup")}</span></label>${illegalTag(l)}`
    + `<span class="lcb"><button class="sm${P.loaded?.id === l.id ? " on" : ""}" data-op="load" data-id="${esc(l.id)}">Load</button><button class="sm x" data-op="del" data-id="${esc(l.id)}">Delete</button></span></div>`
    + SLOTS.map((s, k) => { const tag = tagOf(men[k]); return cardRowHtml({ slot: s, p: men[k], dash, colourOf, cls: `lr${tag ? " gonetag" : ""}`, note: tag ?? "" }); }).join("")
    + capLine(men.map((p) => (p?.stale ? null : p)), { dash }) + `</div>`;
}

/** A saved lineup in a message, by what its card shows. */
export const savedName = (l) => `${l.mode} saved ${isoToEastern(l.saved_at) ?? "at an unknown time"}`;

/** The Saved section: until the list has been read it is not known, so a read out or failed is never "no saved lineups". */
export function savedHtml(P, byId, { dash, seat, colourOf = null, knownName = null, tagOf = () => null }) {
  if (P.savedError) return `<div class="sec">Saved</div><div class="saved"><span class="none">Could not read the saved lineups: ${esc(P.savedError)}. Click in the panel to try again.</span></div>`;
  if (!P.savedReady) return `<div class="sec">Saved</div><div class="saved"><span class="none">Reading the saved lineups</span></div>`;
  if (!P.saved.length) return `<div class="sec">Saved</div><div class="saved"><span class="none">No saved lineups for this slate yet.</span></div>`;
  const n = pickedSaved(P).length;
  const off = P.ls ? ` disabled title="Leave late swap mode to download saved lineups: a started man must keep his slot"` : n ? "" : ` disabled title="Tick the saved lineups to download"`;
  const head = `<div class="sec svh"><span>Saved</span><button class="ol sm" data-op="svcsv"${off}>Download DK CSV${n ? ` (${n})` : ""}</button></div>`;
  return `${head}<div class="lcs">${[...P.saved].reverse().map((l) => savedCard(l, P, { byId, dash, seat, colourOf, knownName, tagOf })).join("")}</div>`;
}

/** Sends a save or delete to the server and shows the saved list it answers with (for the slate still on show). `done` runs
 *  only when the server took it, so a failed delete changes nothing on the page. */
export async function savedCall(X, body, what, { render, post }, done = null) {
  const name = X.ctx().name;
  try {
    const out = await post(X, "lineups", body);
    if (name !== X.ctx().name) return;
    done?.();
    Object.assign(X.P, { saved: keepSwaps(X.P.saved, out.lineups), savedError: null, savedReady: true });
    pruneNames(X, out.lineups);
    render(X);
  } catch (e) { X.toast(`Could not ${what}: ${e.message}`, "err"); }
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
