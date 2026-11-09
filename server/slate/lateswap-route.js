// The Late swap screen's route, called from server.js with its shared helpers (entries late swap):
//   GET  /api/slate/<slate>/lateswap   the screen's model (screen-model.js), or { has: false, slate, uploads } before any upload
//   POST /api/slate/<slate>/lateswap   { op } one of: upload { text, fileName } | useUpload { file } | assign { entryIds, spot } |
//        acceptProposals | setLineup { spot, lineupId, confirmOut?, confirmMen? } | syncConfirm { spot, confirmOut, confirmMen } |
//        confirmMan { spot, man } | remove { man, backup?, scope, confirmOut?, confirmMen? } | swap { spot, slot, inId, confirmOut?, confirmMen? } |
//        reset { scope, man? } | undoSpot { spot } | undoAll | allow { spot, man } | dismissNotes | export { kind, spots?, fp }
// Answers: 200 with the model for everything the engine decided (refused: "words" when it would not, confirms when it asks about an Out or
// gone man); an HTTP error only when something failed. An export carries the fingerprint of what the page drew; another one now means the
// screen is behind (a pull or an action came in), so { stale: true, model } comes back and no file is made.
// Writes go through openSlate (origin and JSON content type) and the slate and saved files are read only after the body has arrived, so
// overlapping POSTs each apply onto the other's saved result. Every answer carries ms, the time the server spent on it.
import { refuseCrossSiteRead } from "../lib/origin.js";
import { error } from "../../site/shim/log.js";
import { SLATE_NAME, readLineups, readSlate } from "./store.js";
import { readSaved, writeSaved, saveUpload, saveExport, listUploads, readUpload } from "./lateswap-store.js";
import { readSpotsShown, applySpots, writeSpots } from "./spots.js";
import { applyOp, uploadText, syncSpots, exportFile, slateFor } from "../lateswap/screen-ops.js";
import { buildModel } from "../lateswap/screen-model.js";
import { readEntries } from "../lateswap/entries-csv.js";
import { suggestShell } from "../lateswap/shell.js";
import { topStamps } from "../board/board-util.js";

export const MAX_UPLOAD = 4 * 1024 * 1024; // an entries file is about 50 KB; the cap is a guard

/** The Lineups tab's spots that hold a lineup, { name: { lineup_id, slots, assigned_at } }: its own code (spots.js) reads them, an emptied spot
 *  ({ lineup_id: null }) holds none. An unreadable file throws, never an empty map. */
const heldSpots = (slate) => Object.fromEntries(Object.entries(readSpotsShown(slate).spots).filter(([, r]) => r.lineup_id !== null));

/** Gives a spot a saved lineup through the Lineups tab's own rules and file code; the engine has already had Adam's go-ahead for any Out or
 *  gone man, so the off-the-board confirmation is given. Returns the stamp, or { fail } with the refusal. */
function giveSpotLineup(slate, spot, lineupId, lineups) {
  const w = applySpots(readSpotsShown(slate).spots, { kind: "assign", spot, lineupId, confirmed: true }, lineups);
  if (!w.ok) return { fail: w };
  writeSpots(slate, w.spots);
  return { stamp: w.spots[spot].assigned_at };
}
const BOOT = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; // this server start: the count below begins again at 1 with each, and the page must know
let revision = 0; // counts the answers in the order the server made them (one request is handled whole at a time), so the page can tell a newer state from an older one

/** The route for /api/slate/<slate>/lateswap, or null for another path. */
export function lateswapHandler(p) {
  const m = p.match(/^\/api\/slate\/([^/]+)\/lateswap$/);
  return m ? { handler: handle, encodedSlate: m[1] } : null;
}

/** The one place the screen reads the slate: the newest pull's effective players (overrides applied), its Out list as the file has it and
 *  its games. A refreshed board shows here on the next request. Returns the slate or null after answering 500. */
function slateNow(res, ctx, name, slateData) {
  const players = ctx.effectivePlayers(res, name, slateData);
  if (!players) return null;
  return { ...slateFor(name, players, slateData.out ?? []), games: slateData.games ?? [] };
}

/** The kept uploads for the Upload screen: entries, the spots that file's lineups would make (the engine's own proposal), and a note. */
const uploadsView = (slate) => listUploads(slate).slice(0, 8).map((u) => {
  let entries = null, spots = [];
  try { const r = readEntries(readUpload(slate, u.file)); entries = r.ok ? r.entries.length : null; spots = r.ok ? [...new Set(suggestShell(r.entries, Object.fromEntries(r.entries.map((e) => [e.entryId, null]))).pairs.map((p) => p[1]))] : []; } catch (e) { error("kept upload unreadable", { slate, file: u.file, message: e.message }); }
  return { ...u, entries, spots };
});

/** What the newest upload says about itself now: the entries still without a spot, else when it was exported, else whether anything changed. */
function noteOf(model) {
  const un = model.entries.filter((e) => e.noSpot).length;
  if (un) return { note: `${un} ${un === 1 ? "entry" : "entries"} not yet in a spot`, noteKind: "red" };
  if (model.file.exportedAt) return { note: `exported ${new Date(model.file.exportedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET`, noteKind: "" };
  const chg = model.exports.changed.changed.length;
  return { note: chg ? `${chg} ${chg === 1 ? "entry" : "entries"} changed here` : "no changes", noteKind: "" };
}

/** The model for the saved state at this moment, or null after answering 500. extra = { pendingSpots }. */
function modelFor(res, ctx, slate, slateData, saved, extra = {}) {
  const sl = slateNow(res, ctx, slate, slateData);
  if (!sl) return null;
  const model = buildModel(saved.state, { slate: sl, nowMs: ctx.now(), spotsFile: heldSpots(slate), meta: {
    uploadName: saved.uploadName, uploadedAt: saved.uploadedAt, exportedAt: saved.exportedAt, uploads: uploadsView(slate), syncNotes: saved.syncNotes ?? [],
    pendingSpots: extra.pendingSpots ?? [], pull: slateData.as_of?.pull_started ?? null, boardStamp: topStamps(slateData).board ?? null,
  } });
  if (!model.ok) { ctx.fail(res, 500, "LATESWAP_MODEL", model.error); return null; }
  if (model.file.uploads[0]) Object.assign(model.file.uploads[0], noteOf(model));
  return model;
}

function respond(res, ctx, slate, slateData, saved, extra, t0) {
  const model = modelFor(res, ctx, slate, slateData, saved, extra);
  if (!model) return;
  const { pendingSpots: _p, ...rest } = extra;
  ctx.send(res, 200, { has: true, model, ...rest, rev: ++revision, boot: BOOT, injected: ctx.injected ?? false, ms: Date.now() - t0 });
}

const hhmm = (ms) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" }).replace(":", "");
const mergeNotes = (saved, notes) => (notes.length ? { ...saved, syncNotes: [...new Set([...(saved.syncNotes ?? []), ...notes])] } : saved);

async function handle(req, res, slate, ctx) {
  const t0 = Date.now();
  if (req.method !== "GET" && req.method !== "POST") return ctx.fail(res, 405, "METHOD", "GET or POST only.");
  if (!SLATE_NAME.test(slate)) return ctx.fail(res, 400, "BAD_SLATE", "Slate names look like 2026-10-29-main.");
  if (req.method === "GET") {
    const refused = refuseCrossSiteRead(req.headers);
    if (refused) return ctx.fail(res, refused.status, refused.code, refused.message);
  }
  let slateData = ctx.openSlate(req, res, slate, "Late swap");
  if (!slateData) return;
  let body = null;
  if (req.method === "POST") {
    const read = await ctx.readJson(req, res, MAX_UPLOAD);
    if (!read) return;
    body = read.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) return ctx.fail(res, 400, "BAD_LATESWAP", "Body must be a JSON object.");
    slateData = readSlate(slate) ?? slateData; // the pull may have changed while the body arrived: from here on nothing awaits
  }
  try {
    const file = readSaved(slate);
    if (!file.ok) return ctx.fail(res, 500, "LATESWAP_STATE", file.error);
    let saved = file.saved;
    if (body?.op === "upload" || body?.op === "useUpload") return upload(res, ctx, slate, slateData, saved, body, t0);
    if (!saved) {
      if (req.method === "POST") return ctx.fail(res, 409, "NO_UPLOAD", "Upload the entries file first.");
      return ctx.send(res, 200, { has: false, slate, uploads: uploadsView(slate), nowMs: ctx.now(), rev: ++revision, boot: BOOT, ms: Date.now() - t0 });
    }
    const sl = slateNow(res, ctx, slate, slateData);
    if (!sl) return;
    const nowMs = ctx.now();
    const spotsFile = heldSpots(slate);
    const sync = syncSpots(saved, spotsFile, { slate: sl, nowMs });
    saved = mergeNotes(sync.saved, sync.notes);
    const extra = { pendingSpots: sync.pending };
    const dirty = saved.state !== file.saved.state || JSON.stringify(saved.spotSync) !== JSON.stringify(file.saved.spotSync) || JSON.stringify(saved.pendingSync) !== JSON.stringify(file.saved.pendingSync) || sync.notes.length > 0;
    if (req.method === "GET") {
      if (dirty) writeSaved(slate, saved);
      return respond(res, ctx, slate, slateData, saved, extra, t0);
    }
    if (body.op === "export") return exportOp(res, ctx, slate, slateData, saved, body, { sl, nowMs, dirty, extra, t0 });
    const lineups = body.op === "setLineup" ? readLineups(slate, slateData).lineups : [];
    const out = applyOp(saved, body, { slate: sl, nowMs, lineups, spotsFile });
    if (out.error) { if (dirty) writeSaved(slate, saved); return respond(res, ctx, slate, slateData, saved, { ...extra, refused: out.error, outcomes: out.outcomes }, t0); }
    if (out.confirms?.length && !out.spotWrite && out.saved === saved) { if (dirty) writeSaved(slate, saved); return respond(res, ctx, slate, slateData, saved, { ...extra, outcomes: out.outcomes, confirms: out.confirms }, t0); } // nothing is written until the go-ahead
    let next = mergeNotes(out.saved, out.notes ?? []);
    // What this action did may change what waits on the Lineups tab's file (a go-ahead, a spot reset), so it is looked at again, but only
    // looked at: nothing from that file is applied in the same answer as an action, and no stamp is used up. The next read applies it.
    extra.pendingSpots = syncSpots(next, heldSpots(slate), { slate: sl, nowMs, dry: true }).pending;
    try {
      if (out.spotWrite) { // the Lineups tab's file first, then this screen's state; a failure between them is said in words
        const given = giveSpotLineup(slate, out.spotWrite.spot, out.spotWrite.lineupId, lineups);
        if (given.fail) return ctx.fail(res, given.fail.status, given.fail.code, `Nothing was changed: ${given.fail.message}`);
        next = { ...next, spotSync: { ...next.spotSync, [out.spotWrite.spot]: given.stamp } };
        try { writeSaved(slate, next); } catch (e) {
          error("late swap state not saved after the spot was written", { slate, message: e.message });
          return ctx.fail(res, 500, "LATESWAP_PARTIAL", `${out.spotWrite.spot} was given saved lineup ${out.spotWrite.lineupId} in the Lineups tab's file, but this screen could not save its own state (${e.message}). Reload: the screen will apply that lineup again.`);
        }
      } else writeSaved(slate, next);
    } catch (e) {
      error("late swap write failed", { slate, message: e.message });
      return ctx.fail(res, 500, "LATESWAP_WRITE", `Nothing was changed: the spot's file could not be written (${e.message}).`);
    }
    return respond(res, ctx, slate, slateData, next, { ...extra, outcomes: out.outcomes, confirms: out.confirms, overMax: out.overMax ?? [], mapResult: out.mapResult }, t0);
  } catch (e) {
    error("late swap failed", { slate, message: e.message });
    return ctx.fail(res, 500, "LATESWAP_FAILED", `The late swap screen could not finish: ${e.message}`);
  }
}

/** An export: refused on a copy running on a test clock without its own data folder, and made only for the screen the page drew. */
function exportOp(res, ctx, slate, slateData, saved, body, { sl, nowMs, dirty, extra, t0 }) {
  if (ctx.injected && !process.env.NBADFS_DATA_DIR) return ctx.fail(res, 403, "TEST_CLOCK", "This server runs on a test clock without a data folder of its own, so it will not make an upload file.");
  const model = modelFor(res, ctx, slate, slateData, saved, extra);
  if (!model) return;
  if (typeof body.fp !== "string") return ctx.fail(res, 400, "BAD_EXPORT", "Send the fingerprint of the screen the export was asked from (fp).");
  if (body.fp !== model.fp) { if (dirty) writeSaved(slate, saved); return ctx.send(res, 200, { stale: true, has: true, model, injected: ctx.injected ?? false, ms: Date.now() - t0 }); }
  const r = exportFile(saved, body, { slate: sl, nowMs, hold: (extra.pendingSpots ?? []).filter((p) => p.takenBack).map((p) => p.spot) });
  if (!r.ok) return ctx.fail(res, 400, "BAD_EXPORT", r.error);
  if (r.text) writeSaved(slate, { ...saved, exportedAt: new Date(nowMs).toISOString() });
  else if (dirty) writeSaved(slate, saved);
  const names = (list) => list.map((x) => ({ entryId: x.entryId, contestName: x.contestName }));
  const fileName = `DKEntries_late_swap_${slate}_${body.kind}${body.spots ? `_${body.spots.length}spots` : ""}_${hhmm(nowMs)}ET.csv`;
  // A copy is kept on this machine at a path the screen can name; the browser's own download goes to its downloads folder, which the app cannot see.
  let savedPath = null, saveError = null;
  if (r.text) { try { savedPath = saveExport(slate, r.text, fileName); } catch (e) { saveError = e.message; error("export copy not kept", { slate, message: e.message }); } }
  return ctx.send(res, 200, { export: { ...r, heldBackNames: names(r.heldBack), leftOutNames: names(r.leftOut), oddIds: saved.state.file.oddIds, fileName, savedPath, saveError }, ms: Date.now() - t0 });
}

function upload(res, ctx, slate, slateData, saved, body, t0) {
  let text = body.text, name = typeof body.fileName === "string" ? body.fileName : null;
  if (body.op === "useUpload") {
    const ups = listUploads(slate);
    const pick = body.file === "last" || body.file == null ? ups[0] : ups.find((u) => u.file === body.file);
    if (!pick) return ctx.fail(res, 404, "NO_UPLOAD", "No kept upload to use.");
    // An older file would roll the baseline back to what DraftKings held earlier, and could move a man whose game has started.
    if (saved && pick.file !== ups[0].file) return respond(res, ctx, slate, slateData, saved, { refused: "Only the newest upload can be opened again: an older one would put back what DraftKings held earlier. Drop a fresh file from DraftKings instead." }, t0);
    text = readUpload(slate, pick.file);
    name = pick.name;
  }
  if (typeof text !== "string" || !text) return ctx.fail(res, 400, "BAD_UPLOAD", "Send the entries file's text.");
  const sl0 = slateNow(res, ctx, slate, slateData);
  if (!sl0) return;
  const r = uploadText(saved, text, sl0, name, new Date(ctx.now()).toISOString());
  if (r.error) return saved ? respond(res, ctx, slate, slateData, saved, { refused: r.error }, t0) : ctx.send(res, 200, { has: false, slate, refused: r.error, uploads: uploadsView(slate), nowMs: ctx.now(), ms: Date.now() - t0 });
  if (body.op === "upload") saveUpload(slate, text, name, ctx.now());
  const sync = syncSpots(r.saved, heldSpots(slate), { slate: sl0, nowMs: ctx.now() });
  const next = mergeNotes(sync.saved, sync.notes);
  writeSaved(slate, next);
  return respond(res, ctx, slate, slateData, next, { report: r.report, pendingSpots: sync.pending }, t0);
}
