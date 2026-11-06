// The late swap screen's files, per slate under data/cache/ so they never travel through git (entries late swap): lateswap/<slate>.json (the
// engine's state through its own serializeState and restoreState, plus the upload's name and the spots stamps already applied; the salary
// table's men are in the state) and lateswap/<slate>.uploads/ (every uploaded entries file byte for byte, never overwritten). Which lineup a
// spot holds is the Lineups tab's own file and code (spots.js): this file does not read or write it. Pure file access; the route is
// lateswap-route.js.
import fs from "../../site/shim/fs.js";
import path from "../../site/shim/path.js";
import { dataRoot } from "./store.js";
import { writeFileAtomic } from "../../site/shim/atomic.js";
import { serializeState, restoreState } from "../lateswap/maps.js";

const dir = () => path.join(dataRoot(), "cache", "lateswap");
const stateFile = (slate) => path.join(dir(), `${slate}.json`);
const uploadsDir = (slate) => path.join(dir(), `${slate}.uploads`);
const VERSION = 1;

/** The saved screen state: { ok: true, saved: null | { state, uploadName, uploadedAt, exportedAt, spotSync } } or { ok: false, error }. An
 *  unreadable file is an error, never an empty state. */
export function readSaved(slate) {
  const file = stateFile(slate);
  if (!fs.existsSync(file)) return { ok: true, saved: null };
  let w;
  try { w = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return { ok: false, error: `The saved late swap state is not readable: ${e.message}` }; }
  if (!w || w.version !== VERSION || typeof w.stateText !== "string") return { ok: false, error: "The saved late swap state is not in the form this app reads." };
  const r = restoreState(w.stateText);
  if (!r.ok) return { ok: false, error: r.error };
  if (r.state.slate !== slate) return { ok: false, error: `The saved late swap state is for ${r.state.slate}, not ${slate}.` };
  return { ok: true, saved: { state: r.state, uploadName: w.uploadName ?? null, uploadedAt: w.uploadedAt ?? null, exportedAt: w.exportedAt ?? null, spotSync: w.spotSync ?? {}, pendingSync: w.pendingSync ?? {}, syncNotes: Array.isArray(w.syncNotes) ? w.syncNotes : [] } };
}

/** Writes the screen state atomically. */
export function writeSaved(slate, saved) {
  const w = { version: VERSION, slate, savedAt: new Date().toISOString(), uploadName: saved.uploadName ?? null, uploadedAt: saved.uploadedAt ?? null, exportedAt: saved.exportedAt ?? null, spotSync: saved.spotSync ?? {}, pendingSync: saved.pendingSync ?? {}, syncNotes: saved.syncNotes ?? [], stateText: serializeState(saved.state) };
  writeFileAtomic(stateFile(slate), JSON.stringify(w) + "\n");
}

const safeName = (s) => String(s ?? "upload").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60) || "upload";

/** Keeps an uploaded file byte for byte under a stamp that is never reused; returns { file, at }. */
export function saveUpload(slate, text, name, nowMs = Date.now()) {
  fs.mkdirSync(uploadsDir(slate), { recursive: true });
  let at = nowMs, file;
  for (;;) {
    file = `${new Date(at).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}__${safeName(name)}`;
    if (fs.existsSync(path.join(uploadsDir(slate), file))) { at += 1000; continue; } // a kept file is never overwritten
    writeFileAtomic(path.join(uploadsDir(slate), file), text);
    break;
  }
  return { file, at: new Date(at).toISOString() };
}

/** The slate's kept uploads, newest first: [{ file, name, at }]. */
export function listUploads(slate) {
  if (!fs.existsSync(uploadsDir(slate))) return [];
  return fs.readdirSync(uploadsDir(slate)).filter((f) => /^\d{8}T\d{6}Z__/.test(f)).sort().reverse().map((file) => {
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z__(.*)$/.exec(file);
    return { file, name: m[7], at: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` };
  });
}

/** One kept upload's text; null when the name is not one of the listed files. */
export function readUpload(slate, file) {
  if (!listUploads(slate).some((u) => u.file === file)) return null;
  return fs.readFileSync(path.join(uploadsDir(slate), file), "utf8");
}


