// The records as they stood at lock, for the back-tests (R5; Adam 11-18: the lineup check, the news apply and the resend go on after lock for every team whose game has not tipped, so the live files
// change after lock). Before the first write at or after lock, a file whose own stamp is from before lock is copied byte for byte beside it (news/lineups/prelock.json, a slate's prelock-scenarios.json and
// prelock-overrides.json), once, never overwritten. The back-tests read the copy when the live file was written at or after lock (readAtLock). One copy of the rule: tools/lineups_read.mjs uses keepPrelockCopy.
import fs from "../../site/shim/fs.js";
import path from "../../site/shim/path.js";
import { dataDir, warn } from "../../site/shim/log.js";
import { writeFileAtomic } from "../../site/shim/atomic.js";
import { slateRefMs, tipMs } from "../board/board-util.js";

/** The copy's file name beside a live file: "scenarios.json" -> "prelock-scenarios.json". */
export const prelockName = (name) => `prelock-${name}`;

/**
 * Copies `live` to `copy` byte for byte, once: only at or after lock, only when no copy exists, only when the live file's own stamp (`stampKey`) is before lock. Returns null (copied, or nothing to copy),
 * or why the copy could not be kept, for the caller to say (G62). Never throws.
 */
export function keepPrelockCopy({ live, copy, lockMs, nowMs, stampKey }) {
  if (!Number.isFinite(lockMs) || !(nowMs >= lockMs) || fs.existsSync(copy)) return null;
  let text, at;
  try { text = fs.readFileSync(live, "utf8"); } catch (e) { return e.code === "ENOENT" ? null : `${path.basename(live)} could not be read for its copy at lock (${e.code ?? e.message})`; }
  try { at = Date.parse(JSON.parse(text)?.[stampKey] ?? ""); } catch { return `${path.basename(live)} is not valid JSON, so no copy of it at lock was kept`; }
  if (!Number.isFinite(at)) return `${path.basename(live)} has no readable ${stampKey}, so no copy of it at lock was kept`;
  if (!(at < lockMs)) return null; // already written after lock: there is no record from before lock to keep
  try { writeFileAtomic(copy, text); return null; } catch (e) { return `the copy of ${path.basename(live)} at lock could not be written (${e.code ?? e.message})`; }
}

/** The slate's lock in ms from its slate.json, NaN when it cannot be read. */
export function slateLockMs(slate, root = dataDir()) {
  const ref = slateRefMs(slate);
  try { const s = JSON.parse(fs.readFileSync(path.join(root, "slates", slate, "slate.json"), "utf8")); return ref === null || typeof s?.lock !== "string" ? NaN : tipMs(s.lock, ref + 6 * 3600e3); } catch { return NaN; }
}

/** Before a write of the slate's `name` (scenarios.json, overrides.json, stamped updated_at): keeps prelock-<name>. A copy that cannot be kept is logged, never a stop to the write. */
export function keepSlatePrelock(slate, name, { nowMs = Date.now(), root = dataDir() } = {}) {
  const dir = path.join(root, "slates", slate), copy = path.join(dir, prelockName(name));
  if (fs.existsSync(copy)) return null;
  const lockMs = slateLockMs(slate, root);
  if (!Number.isFinite(lockMs)) { // a slate whose lock does not read: no copy can be judged, said once per slate (G62)
    const why = `${slate}'s lock could not be read, so no copy of ${name} at lock can be kept`;
    if (!saidNoLock.has(slate)) { saidNoLock.add(slate); warn(`prelock copy: ${why}`, { slate }); }
    return why;
  }
  const why = keepPrelockCopy({ live: path.join(dir, name), copy, lockMs, nowMs, stampKey: "updated_at" });
  if (why) warn(`prelock copy: ${why}`, { slate });
  return why;
}
const saidNoLock = new Set();

/**
 * The bring-down's put-back (server/pullnow/bringdown.js putBack) as the first write at or after lock: the fast-forward has already replaced the file, so the copy at lock is chosen from the candidates
 * (this computer's set-aside bytes, GitHub's copy): the one with the latest updated_at before lock. Once, never overwritten. Returns null or why (logged).
 */
export function keepSlatePrelockFrom(slate, name, candidates, { nowMs = Date.now(), root = dataDir() } = {}) {
  const copy = path.join(root, "slates", slate, prelockName(name)), lockMs = slateLockMs(slate, root);
  if (fs.existsSync(copy) || !Number.isFinite(lockMs) || !(nowMs >= lockMs)) return null;
  let best = null;
  for (const b of candidates) {
    if (!b) continue;
    let at;
    try { at = Date.parse(JSON.parse(b.toString("utf8"))?.updated_at ?? ""); } catch { continue; } // a copy that cannot be read is no record at lock
    if (at < lockMs && (!best || at > best.at)) best = { at, b };
  }
  if (!best) return null; // both copies are from after lock: there is no record from before lock to keep
  try { writeFileAtomic(copy, best.b); return null; } catch (e) { const why = `the copy of ${name} at lock could not be written (${e.code ?? e.message})`; warn(`prelock copy: ${why}`, { slate }); return why; }
}

/** The write-once copies (a bring-down never replaces one: resolve.js keeps this computer's when it has one). */
export const PRELOCK_PATH = /^data\/slates\/[^/]+\/(prelock-(scenarios|overrides)\.json|news\/lineups\/prelock\.json)$/;

/**
 * A back-test's read of a slate file as it stood at lock: { doc, from: "live" | "prelock" | "live_after_lock", why }. The live file when it was written before lock (its updated_at), else the prelock copy
 * when there is one, else the live file as it is with from "live_after_lock" and why (the caller shows it, G62, and judges its time as before). doc null when the live file does not exist. A live file
 * that cannot be parsed throws, as a plain read would.
 */
export function readAtLock(dir, name, lockMs) {
  const live = path.join(dir, name);
  if (!fs.existsSync(live)) return { doc: null, from: "live" };
  const doc = JSON.parse(fs.readFileSync(live, "utf8"));
  if (!Number.isFinite(lockMs) || Date.parse(doc?.updated_at ?? "") < lockMs) return { doc, from: "live" };
  try { return { doc: JSON.parse(fs.readFileSync(path.join(dir, prelockName(name)), "utf8")), from: "prelock" }; } catch (e) {
    if (e.code !== "ENOENT") warn(`prelock copy: ${prelockName(name)} could not be read, so the live file is used`, { dir, error: e.message });
    return { doc, from: "live_after_lock", why: `${name} was written at or after lock and ${e.code === "ENOENT" ? "no copy from before lock was kept" : `its copy from before lock could not be read (${e.code ?? e.message})`}` };
  }
}

/** The sources note for a back-test's reads (readAtLock answers by file name): { prelock_copy: [names] } and { prelock_missing: [{ file, why }] }, each only when there is one. Pure. */
export function atLockNote(reads) {
  const copy = Object.entries(reads).filter(([, r]) => r.from === "prelock").map(([n]) => n), miss = Object.entries(reads).filter(([, r]) => r.from === "live_after_lock").map(([file, r]) => ({ file, why: r.why }));
  return { ...(copy.length ? { prelock_copy: copy } : {}), ...(miss.length ? { prelock_missing: miss } : {}) };
}
