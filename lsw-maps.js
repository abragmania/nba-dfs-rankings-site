// Tab 1 Entries ("Which spot does each entry play?") and tab 2 Lineups ("Which lineup plays each spot?") of the Late swap screen. Entries:
// rows grouped by contest, Auto-fill empty rows, check boxes (shift-click for a range, one per contest, Select unmapped), one spot picker
// with Fill and Number in order, one-step undo, and the single-row picker for single changes. Lineups: one row per spot with its lineup, its
// eight men on one line, a picker of saved lineups and the Out alert. An entry with no spot is red: "No lineup assigned"; it is never edited
// or exported.
import { esc, money, f1, spotColour, outFlag, outChip } from "./lsw-common.js";
import { logo } from "./board-util.js";
import { savedLabel } from "./lineups-tab.js";

/** A saved lineup by the name the Lineups tab gives it (the name Adam typed, else Lineup A, B, C by its place saved); L.svNames are read in lsw-main.js. */
export const lineupName = (l, L) => savedLabel(l, L.svNames, L.saved);

/** The entries grouped by contest, in file order: [{ key, name, entries: [row] }]. */
export function contestGroups(M) {
  const by = new Map();
  for (const e of M.entries) {
    const key = e.contestId ? `id:${e.contestId}` : `name:${e.contestName}`;
    if (!by.has(key)) by.set(key, { key, name: e.contestName, entries: [] });
    by.get(key).entries.push(e);
  }
  return [...by.values()];
}

/** The rows' ids in the order the Entries tab draws them (by contest), which is the order a range and Number in order follow. */
export const screenOrder = (M) => contestGroups(M).flatMap((g) => g.entries.map((e) => e.entryId));

/** The rows with no spot, in drawn order: what "Select empty rows" selects. */
export const emptyRowIds = (M) => contestGroups(M).flatMap((g) => g.entries.filter((e) => e.noSpot).map((e) => e.entryId));

/** The ids from `from` to `to` inclusive, in row order, whichever is first; just `to` when `from` is not a row (shift-click). */
export function rangeBetween(rowIds, from, to) {
  const a = rowIds.indexOf(from), b = rowIds.indexOf(to);
  if (b < 0) return [];
  if (a < 0) return [to];
  return rowIds.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/**
 * Number in order: the selected rows in row order get consecutive spots from `start`, in the order the spots are listed. Only spots that
 * exist are used and none is made. { pairs } or { short, have } when there are too few spots from there; nothing changes then.
 */
export function numberInOrder(rowIds, spotNames, start) {
  const at = spotNames.indexOf(start);
  if (at < 0) return { unknown: start };
  const have = spotNames.length - at;
  if (rowIds.length > have) return { short: rowIds.length - have, have };
  return { pairs: rowIds.map((id, i) => [id, spotNames[at + i]]) };
}

/** The one-line status of each tab, { text, bad }: red when something is empty. */
export function tabStatus(M) {
  const nEnt = M.entries.filter((e) => !e.noSpot).length, nSpot = M.spots.filter((s) => !s.blank).length, nUp = M.spots.filter((s) => !s.blank && s.source?.kind === "upload").length;
  const chg = M.exports.changed;
  return {
    entries: { text: `${nEnt} of ${M.entries.length} entries have a spot`, bad: nEnt < M.entries.length },
    lineups: { text: nUp ? `${nSpot - nUp} of ${M.spots.length} spots have a lineup from the Lineups tab; ${nUp} still hold the uploaded DraftKings lineup` : `${nSpot} of ${M.spots.length} spots have a lineup`, bad: nSpot < M.spots.length },
    swap: { text: chg.changed.length || chg.heldBack.length ? `${chg.changed.length} changed${chg.heldBack.length ? `, ${chg.heldBack.length} left out` : ""}` : "nothing changed yet", bad: chg.heldBack.length > 0 },
  };
}

const spotOptions = (M, sel) => `<option value="">Choose a spot</option>${M.spots.map((s) => `<option${s.name === sel ? " selected" : ""}>${esc(s.name)}</option>`).join("")}<option value="__new">+ New spot…</option>`;

/** The options of one entry's spot menu. `all` false: only what the entry holds now (the menu fills in the rest when it is opened,
 *  lsw-main.js fillChoices: 150 entries by 150 spots is 22,500 options, which took the browser about half a second to draw). */
export function entrySpotOptions(M, e, all = true) {
  const head = e.noSpot ? '<option value="">No lineup assigned</option>' : '<option value="">Unassign</option>';
  const names = all ? M.spots.map((s) => s.name) : e.spot ? [e.spot] : [];
  return `${head}${names.map((name) => `<option${name === e.spot ? " selected" : ""}>${esc(name)}</option>`).join("")}<option value="__new">+ New spot…</option>`;
}

function entryRow(e, k, n, M, L) {
  const c = e.spot ? spotColour(e.spot, M.spots) : null;
  const isNew = L.newIds?.has(e.entryId), on = L.sel.has(e.entryId);
  const back = L.backIn?.get(e.entryId);
  const note = e.noSpot || e.noLineup ? '<span class="noteR">No lineup assigned</span>' : back ? `<span class="noteA">Back in ${esc(back)}</span>` : e.proposedSpot ? `<span class="noteA">matches ${esc(e.proposedSpot)}</span>` : isNew ? '<span class="noteA">new in this upload</span>' : L.moved?.has(e.entryId) ? '<span class="muted">changed by you</span>' : `<span class="muted">${(L.uploads ?? []).length > 1 ? "from last time" : "set by Auto-fill"}</span>`; // on a first upload there is no last time
  return `<div class="er${e.noSpot ? " nolu" : ""}${on ? " sel" : ""}" data-entry="${esc(e.entryId)}">
<span class="cb${on ? " on" : ""}" data-lsw="pick" data-id="${esc(e.entryId)}" role="checkbox" aria-checked="${on}" tabindex="0"></span>
<span class="cn">Entry ${k} of ${n}${isNew ? ' <i class="newb">NEW</i>' : ""}${e.flags.length ? ` <i class="flb" title="${esc(e.flags.join(" "))}">CHECK</i>` : ""}</span>
<span class="fe">${esc(e.entryFee)}</span><span class="id">${esc(e.entryId)}</span>
<select class="spsel${e.noSpot ? " un" : ""}" data-lsw-sel="entrySpot" data-id="${esc(e.entryId)}" ${c ? `style="--sc:${c}"` : ""} data-lazy="entry">${entrySpotOptions(M, e, false)}</select>
${note}</div>`;
}

/** Tab 1. */
export function entriesHtml(M, L) {
  const un = M.entries.filter((e) => e.noSpot);
  const props = M.entries.filter((e) => e.noSpot && e.proposedSpot);
  const groups = contestGroups(M);
  const nSel = M.entries.filter((e) => L.sel.has(e.entryId)).length;
  const allSel = M.entries.length > 0 && nSel === M.entries.length;
  const fresh = [...(L.newIds ?? [])].filter((id) => M.entries.some((e) => e.entryId === id));
  const none = nSel ? "" : " disabled";
  const undo = L.fillUndo ? `<div class="fillnote"><span>${esc(L.fillUndo.text)}</span><button class="ol" data-lsw="undoFill">Undo</button></div>` : "";
  return `<section class="mapcol tabq"><div class="mh"><span class="t">Which spot does each entry play?</span><span class="grow"></span><span class="muted">${M.entries.length} entries in ${groups.length} contests</span></div>
<div class="bulk"><button class="${un.length ? "go" : "ol"}" data-lsw="autoFill" title="Fills every empty row: Cash for the Double Ups, GPP #1 for the first entry of each other contest, GPP #2 for the second, and so on. Rows that already have a spot are not touched."${un.length ? "" : " disabled"}>Auto-fill empty rows${un.length ? ` (${un.length})` : ""}</button>
<span class="cb${allSel ? " on" : ""}" data-lsw="pickAll" role="checkbox" aria-checked="${allSel}" tabindex="0" title="Select every row"></span><span class="muted">${nSel} selected</span>
<button class="ol" data-lsw="selectUnmapped"${un.length ? "" : " disabled"}>Select empty rows</button><span class="grow"></span>
<select class="spsel" id="lswFill" title="The spot Fill puts the selected rows in, and where Number in order starts">${spotOptions(M, L.fillSpot ?? M.spots[0]?.name)}</select>
<button class="go" data-lsw="fill"${none}>Fill</button><button class="ol" data-lsw="numberInOrder" title="Gives the selected rows consecutive spots in row order, from the spot picked"${none}>Number in order</button></div>
${undo}${props.length ? `<div class="bulk"><button class="ol" data-lsw="acceptProposals">Use suggested spots (${props.length})</button><span class="muted">entries whose lineup matches a spot you already have</span></div>` : ""}
<div class="er hd"><span></span><span>Entry</span><span class="fe">Fee</span><span>Entry ID</span><span>Spot</span><span>Note</span></div>
${groups.map((g) => { const k = g.entries.filter((e) => L.sel.has(e.entryId)).length, nu = g.entries.filter((e) => e.noSpot).length;
    return `<div class="er gh${nu ? "" : " done"}"><span class="cb${k === g.entries.length ? " on" : k ? " part" : ""}" data-lsw="pickGroup" data-key="${esc(g.key)}" role="checkbox" aria-checked="${k === g.entries.length}" tabindex="0" title="Select this whole contest"></span><span class="gn">${esc(g.name)}</span><span class="muted gc2">${g.entries.length} ${g.entries.length === 1 ? "entry" : "entries"}${nu ? `, <b class="red">${nu} empty</b>` : ""}</span></div>${g.entries.map((e, i) => entryRow(e, i + 1, g.entries.length, M, L)).join("")}`; }).join("")}
${un.length ? `<div class="newbar red"><b>${un.length}</b> ${un.length === 1 ? "entry has" : "entries have"} no lineup assigned${fresh.length ? ` (${fresh.length} came in with this upload)` : ""}. Give ${un.length === 1 ? "it" : "them"} a spot or leave ${un.length === 1 ? "it" : "them"} out: an entry with no spot is never edited or exported.</div>` : ""}
</section>`;
}

const sumOfLineup = (l, byId, k) => (l.slots.every((id) => Number.isFinite(byId.get(id)?.[k])) ? l.slots.reduce((t, id) => t + byId.get(id)[k], 0) : null);

/** The options of one spot's saved-lineup menu; `all` false: only the lineup it holds now (filled in on opening, as entrySpotOptions). */
export function lineupOptions(s, M, L, all = true) {
  const byId = new Map(M.pool.map((p) => [p.dk_id, p]));
  const held = s.source?.lineupId;
  const saved = (L.saved ?? []).slice().reverse().filter((l) => all || (held != null && String(l.id) === String(held)));
  return `<option value="">${s.blank ? "Pick a saved lineup…" : "Change lineup…"}</option>` + saved.map((l) => `<option value="${esc(l.id)}"${held === String(l.id) ? " selected" : ""}>${esc(lineupName(l, L))} · ${esc(l.mode)} · ${f1(sumOfLineup(l, byId, "proj"))} · ${money(sumOfLineup(l, byId, "salary"))}</option>`).join("");
}

/** What a spot lineup is, in words: a saved one by its Lineups tab name, the uploaded one as such. */
const sourceLabel = (s, L) => {
  const saved = s.source.kind === "saved" ? (L.saved ?? []).find((l) => String(l.id) === String(s.source.lineupId)) : null;
  return saved ? lineupName(saved, L) : s.source.kind === "upload" ? "Still the lineup from your uploaded DraftKings file" : s.source.label;
};

function spotRow(s, M, L) {
  const c = spotColour(s.name, M.spots);
  const ask = L.ask?.body.op === "setLineup" && L.ask.body.spot === s.name ? L.ask : null;
  const wait = ask && Date.now() - ask.armedAt < 500;
  const men = s.blank ? '<span class="noteR">No lineup assigned: pick one from the list.</span>' : s.slots.map((x) => (x.man ? `<span class="mm">${x.man.team ? logo(x.man.team, "xs") : ""}${esc(x.man.name)}${outChip(x.man)}</span>` : "")).join("");
  return `<div class="lrow${s.alert ? " outc" : ""}${s.blank ? " nolu" : ""}" style="--sc:${c}">
<span class="sc plain" style="--sc:${c}">${esc(s.name)}</span>
<div class="lmid"><div class="lname">${esc(s.blank ? "" : sourceLabel(s, L))}</div><div class="lmen">${men}</div></div>
<span class="pj">${f1(s.projection)}<small>proj</small></span><span class="le"><b>${s.nEntries}</b> ${s.nEntries === 1 ? "entry" : "entries"}</span>
<select class="lpick" data-lsw-sel="lineupPick" data-spot="${esc(s.name)}" title="Give ${esc(s.name)} one of your saved lineups">${lineupOptions(s, M, L, true)}</select>
${s.alert ? outFlag(s) : ""}${ask ? `<div class="alert"><b>${esc(ask.confirms[0].spot)}:</b> ${esc(ask.confirms[0].alert.text)} <button class="go red2" data-lsw="useLineup" data-id="${esc(ask.body.lineupId)}"${wait ? " disabled" : ""}>Use anyway</button> <button class="ol" data-lsw="askCancel">Cancel</button></div>` : ""}</div>`;
}

/** Tab 2. */
export function lineupsHtml(M, L) {
  return `<section class="mapcol tabq"><div class="mh"><span class="t">Which lineup plays each spot?</span><span class="grow"></span><span class="muted">${M.spots.length} ${M.spots.length === 1 ? "spot" : "spots"}, made in tab 1</span></div>
${L.savedErr ? `<div class="rs red">${esc(L.savedErr)}</div>` : !(L.saved ?? []).length && L.savedLoaded ? '<div class="rs">No saved lineups for this slate yet. Save one from the Lineups tab of the board, then come back here.</div>' : ""}
${M.spots.length ? M.spots.map((s) => spotRow(s, M, L)).join("") : '<div class="rs">No spots yet. Give your entries a spot in tab 1 first.</div>'}
<div class="hints"><div><b>NEXT UPLOAD</b>Spots you have set stay as they are. Contests you have not seen arrive with <em class="red">No lineup assigned</em>.</div><div><b>TO CHANGE A SPOT'S LINEUP</b>Pick another saved lineup from the list on its row. Entries do not move.</div></div></section>`;
}
