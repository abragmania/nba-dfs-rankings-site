// The upload files for DraftKings (entries late swap). Pure: no DOM, no fs, no clock. An entry's row holds its spot's lineup. A row
// reaches a file only with all 8 slots filled, because a row with no lineup makes the DraftKings upload fail. An entry with no spot is
// left out of every file and returned as data. entryStatus (entry-state.js) decides each row, the same call the screen draws from: one
// held is left out, amber, with its reasons, and the rest still go. A row matching the entry's file row is its uploaded text.
import { entryHoldings, lineupOf, spotNames } from "./maps.js";
import { contextFor, entryStatus, outAlert } from "./entry-state.js";
import { entryRow } from "./entries-csv.js";

function buildFile(state, args, includeUnchanged) {
  const { slate, nowMs, spots = null } = args ?? {};
  const empty = { text: null, written: 0, changed: [], unchanged: [], heldBack: [], leftOut: [], alerts: [] };
  const { ctx, error } = contextFor(state, slate, nowMs);
  if (error) return { ok: false, error, ...empty };
  if (spots !== null && !Array.isArray(spots)) return { ok: false, error: "Chosen spots must be a list of spot names.", ...empty };
  const unknown = (spots ?? []).filter((s) => !spotNames(state).includes(s));
  if (unknown.length) return { ok: false, error: `No such spot: ${unknown.join(", ")}.`, ...empty };
  const rows = [], changed = [], unchanged = [], heldBack = [], leftOut = [];
  const holdings = entryHoldings(state.entrySpots, state.spots), inScope = new Set();
  const issued = new Map(state.fileMen.map((p) => [p.dk_id, p.name_id]));
  const cellOf = (id) => (state.file.namedCells ? issued.get(id) ?? id : id); // as DraftKings issued it, or the bare id, never the board's spelling
  for (const entry of state.entries) {
    const { spot, lineup } = holdings[entry.entryId];
    if (spot == null) {
      leftOut.push({ entryId: entry.entryId, contestName: entry.contestName, contestId: entry.contestId, entryFee: entry.entryFee, reservation: entry.uploaded.every((id) => id == null) });
      continue;
    }
    if (spots && !spots.includes(spot)) continue;
    inScope.add(spot);
    const { status, reasons } = entryStatus(entry, lineup, ctx, Object.hasOwn(state.spots, spot) ? state.spots[spot].confirmedOut : []);
    if (status === "held") heldBack.push({ entryId: entry.entryId, contestName: entry.contestName, spot, amber: true, reasons });
    else if (status === "changed") { rows.push(entryRow(entry, lineup, cellOf)); changed.push(entry.entryId); } else if (includeUnchanged) { rows.push(entry.rowText); unchanged.push(entry.entryId); }
  }
  const alerts = [...inScope].map((spot) => ({ spot, alert: outAlert(lineupOf(state, spot), ctx) })).filter((a) => a.alert);
  const { headerText, eol } = state.file;
  return { ok: true, error: null, text: rows.length ? [headerText, ...rows].join(eol) + eol : null, written: rows.length, changed, unchanged, heldBack, leftOut, alerts };
}

/** Entries whose spot's lineup differs from that entry's row in the file. args { slate, nowMs, spots? }: spots narrows it to those
 *  spots, so ["Cash"] is just Cash. { ok, error, text, written, changed, unchanged: [], heldBack: [{ entryId, contestName, spot, amber,
 *  reasons }], leftOut: [{ entryId, contestName, contestId, entryFee, reservation }], alerts: [{ spot, alert }] }. text is null when no row
 *  can go. leftOut is every entry with no spot, in any export; written never counts it. alerts names the spots in this export holding a
 *  man who is Out or gone from the board and has not started (outAlert); they do not stop a row. */
export function exportChanged(state, args) {
  return buildFile(state, args, false);
}

/** Every assigned entry, with only the changed ones edited; same args and result, unchanged naming the rows written as uploaded. A
 *  changed entry that fails its check is left out of the file and listed in heldBack, not written as uploaded. */
export function exportAll(state, args) {
  return buildFile(state, args, true);
}
