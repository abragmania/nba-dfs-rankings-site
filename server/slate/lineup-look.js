// The last look at each lineup page (Adam 11-13: each source is judged on its own). data/cache/lineup-look/<slate>.json, git-ignored, { <source>: { at, ok, ok_at, history, why? } }:
// at/ok are the newest look and whether it counted; ok_at the newest look that counted; history the times of the last HISTORY_KEEP looks that counted (oldest first), so a replay between two looks sees the earlier one.
// A look counts only when the page was read, its fives were usable for the slate's teams, and the 5-minute check did not carry the source back (server/pullnow/lineup-sync.js); a failed look never refreshes a source.
// Written only by server/pullnow/lineup-sync.js (the 5-minute check and the light check's hand-over); a pull's own lineup step does not write it, its read time in latest.json counts. Read by readNewsLineups (latest.look) and judged by lineup-proposals.js freshnessOf.
// A damaged file reads as no looks (never as fresh): the sources' own read times then stand, and the file is named once in the log.
import fs from "../../site/shim/fs.js";
import path from "../../site/shim/path.js";
import { dataDir } from "../../site/shim/log.js";
import { writeFileAtomic } from "../../site/shim/atomic.js";

export const LOOK_KEYS = ["monster", "rotowire", "rotogrinders"];
export const HISTORY_KEEP = 200;
export const lookFile = (slate, root = dataDir()) => path.join(root, "cache", "lineup-look", `${slate}.json`);

const warned = new Set(); // one line per damaged file, not one per read

/** The saved looks, {} with none or a damaged file. */
export function readLook(slate, root = dataDir()) {
  const file = lookFile(slate, root);
  try {
    const d = JSON.parse(fs.readFileSync(file, "utf8"));
    return d && typeof d === "object" && !Array.isArray(d) ? d : {};
  } catch (e) {
    if (e.code !== "ENOENT" && !warned.has(file)) { warned.add(file); console.warn(`lineup look file ${file} unreadable (${e.name}); the sources' read times stand`); }
    return {};
  }
}

const ms = (iso) => { const t = Date.parse(iso ?? ""); return Number.isNaN(t) ? null : t; };

/**
 * Records one set of looks: pages = { source: { status: "ok"|"failed", fetched_at, note } } (status "failed" with a note for a page read but not usable). A newer look replaces an older; an older one never moves a source back.
 * A failed look sets at/ok/why and keeps ok_at and history. Returns the doc. Throws on a write failure (the caller says so).
 */
export function recordLook({ slate, root = dataDir(), pages, write = writeFileAtomic }) {
  const doc = readLook(slate, root);
  let changed = false;
  for (const key of LOOK_KEYS) {
    const p = pages?.[key];
    if (!p) continue;
    const at = ms(p.fetched_at);
    if (at === null) continue;
    const was = doc[key], wasAt = ms(was?.at);
    if (wasAt !== null && at < wasAt) continue;
    const history = Array.isArray(was?.history) ? was.history : [];
    const next = p.status === "ok"
      ? { at: p.fetched_at, ok: true, ok_at: p.fetched_at, history: [...history.filter((h) => h !== p.fetched_at), p.fetched_at].slice(-HISTORY_KEEP) }
      : { at: p.fetched_at, ok: false, ok_at: was?.ok_at ?? null, history, why: String(p.note ?? "not read").slice(0, 160) };
    if (JSON.stringify(next) !== JSON.stringify(was)) { doc[key] = next; changed = true; }
  }
  if (changed) write(lookFile(slate, root), `${JSON.stringify(doc, null, 1)}\n`);
  return doc;
}
