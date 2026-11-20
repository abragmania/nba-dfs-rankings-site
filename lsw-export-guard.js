// The Entries tab's ask after an export that came later than the entries file (review F1 11-19). The server refuses every op that changes
// lineups then (screen-ops.js exportRefusal) unless the request's afterExport is that export's stamp; here that refusal becomes a confirm in
// the same words, and its OK sends the action again with the stamp the server judged (review F3 11-19: a newer export asks again). The OK is
// remembered in memory for that one export stamp (L.exportOk), so he is asked once per export, not per click; a fresh upload makes the
// refusal stop. The page's one copy of the ET time and of the later-than test (the server's is screen-ops.js lateExport); lsw-reset.js
// reads them from here.
import { askConfirm } from "./confirm.js";

export const etTime = (iso) => `${new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET`;

/** True when the last export came after the entries file. file: the model's file block { exportedAt, uploadedAt }. */
export function exportedLate(file) {
  const ex = Date.parse(file?.exportedAt ?? ""), up = Date.parse(file?.uploadedAt ?? "");
  return Number.isFinite(ex) && !(Number.isFinite(up) && ex <= up);
}

// Reset entries and Re-assign all ask their own question every time (lsw-reset.js), so a remembered OK is never sent for them.
const OWN_ASK = ["resetEntries", "reassignAll"];
const AFTER_EXPORT = /^You exported at /;

/** body with afterExport set to the export stamp, or without it when there is none to give. */
function withStamp(body, stamp) {
  const { afterExport: _a, ...rest } = body;
  return stamp == null ? rest : { ...rest, afterExport: stamp };
}

/**
 * Sends body through send (lsw-main.js's act) and answers what it answers. An OK already given for the export on show goes with the body as
 * its stamp; so does lsw-reset.js's own OK (afterExport true: the export it asked about is the one on show). A refusal for a later export
 * (its words start "You exported at") is put to Adam as a confirm, "Go ahead anyway"; on OK the same body goes again with the stamp the
 * refusal's model carries, and the OK is kept for that stamp. A refusal for the very stamp just sent is not asked again (no loop). On Cancel
 * the refusal stands on the screen: nothing was changed. ask: the confirm (askConfirm; a test passes its own).
 */
export async function guardedAct(send, L, body, opts, ask = askConfirm) {
  const stamp = L.M?.file?.exportedAt ?? null, own = OWN_ASK.includes(body?.op);
  const first = body?.afterExport === true ? withStamp(body, stamp)
    : !own && stamp != null && L.exportOk === stamp && body?.afterExport == null ? withStamp(body, stamp) : body;
  const j = await send(first, opts);
  if (!j || typeof j.refused !== "string" || !AFTER_EXPORT.test(j.refused)) return j;
  const seen = j.model?.file?.exportedAt ?? L.M?.file?.exportedAt ?? null; // the export stamp the server judged
  if (seen == null || first?.afterExport === seen) return j;
  if (!(await ask(j.refused.replace(/\s*Nothing was (changed|reset)\.$/, ""), { ok: "Go ahead anyway" }))) return j;
  if (!own) L.exportOk = seen;
  return send(withStamp(body, seen), opts);
}
