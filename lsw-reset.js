// The Entries tab's Reset entries and Re-assign all buttons (Adam 6:30 PM 11-19), kept out of lsw-main.js for room. Each asks first, with the
// counts of what goes; after an export that came later than the entries file, a second ask names both times, and only its OK sends
// afterExport (the server refuses without it, screen-ops.js resetRefusal). The answer line gives the counts the server sends back.
import { askConfirm } from "./confirm.js";
import { etTime, exportedLate } from "./lsw-export-guard.js";

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const total = (o) => Object.values(o ?? {}).reduce((t, ids) => t + (Array.isArray(ids) ? ids.length : 0), 0);

/** What a reset drops beyond the map, as the confirm and the answer say it; a count of 0 is not mentioned. */
function dropsText(locks, letBack) {
  return [locks && `${plural(locks, "locked man is", "locked men are")} dropped`, letBack && `${plural(letBack, "man", "men")} taken out of single spots ${letBack === 1 ? "is" : "are"} let back in`].filter(Boolean);
}

/** The second ask after such an export, naming both times; true on OK. */
function afterExportOk(M) {
  const up = Date.parse(M.file.uploadedAt ?? ""), file = Number.isFinite(up) ? etTime(M.file.uploadedAt) : "an unknown time";
  return askConfirm(`You exported at ${etTime(M.file.exportedAt)}, after the entries file from ${file}. If that export went to DraftKings, drop a fresh entries file first, or this puts back the ${file} lineups.`, { ok: "Go ahead anyway" });
}

/** kind "resetEntries" or "reassignAll". ctx = { L, act, render }. */
export async function resetFlow(kind, { L, act, render }) {
  const M = L.M;
  if (!M) return;
  const drops = dropsText(total(M.keptMen), M.removals.length);
  const tail = drops.length ? ` ${drops.join("; ")}.` : "";
  const ask = kind === "reassignAll"
    ? `Re-assign all ${M.entries.length} entries as on a first upload? Every spot row is rebuilt from the uploaded file's lineups (any lineup changed here since is gone), then Auto-fill gives Cash to the Double Ups and GPP #1, GPP #2 ... to each other contest's entries. There is no Undo.${tail}`
    : `Reset entries? All ${M.entries.length} entries lose their spot and the ${plural(M.spots.length, "spot row goes", "spot rows go")}, as when the file was just uploaded; Auto-fill is offered again and rebuilds rows from the uploaded file's lineups.${tail} The take-out list, put in at least and excluded games stay.`;
  if (!(await askConfirm(ask, { ok: kind === "reassignAll" ? "Re-assign all" : "Reset" }))) return;
  const late = exportedLate(M.file);
  if (late && !(await afterExportOk(M))) return;
  const body = { op: kind, mapFp: M.mapFp, ...(late ? { afterExport: true } : {}) };
  const j = await act(body);
  if (!j || j.refused || !j.mapResult?.reset) return;
  const r = j.mapResult, z = r.reset, more = dropsText(z.locks, z.letBack).map((x) => `; ${x}`).join("");
  L.fillUndo = null; L.sel = new Set();
  L.msg = { kind: "ok", text: kind === "reassignAll"
    ? `Re-assigned all ${r.count} entries from the uploaded file: ${r.summary}; ${plural(z.rows, "old spot row", "old spot rows")} cleared and rebuilt from the file${more}.`
    : `Reset: ${plural(z.entries, "entry", "entries")} without a spot, ${plural(z.rows, "spot row", "spot rows")} cleared${more}; Auto-fill is offered again.` };
  render();
}
