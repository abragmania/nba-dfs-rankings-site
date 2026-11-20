// Saved files kept per mode (Adam 11-14; his yes 5:14 PM ET 11-19 and "yes go" 12:42 PM ET 11-20: Cash and GPP keep fully separate player
// picks and lineups): the one reader and writer store.js uses for the picks and the working lineup.
//   { slate, Cash: { ...fields, saved_at, carried?, replaced? }, GPP: { ... } }
// A file from before the split (no Cash or GPP key) is the same fields for both modes, marked carried, until each mode's own first save.
// Each mode is judged on its own (review 11-20): a mode that cannot be read is unreadable alone and the other mode stands; a file that is not
// JSON leaves both unreadable. Nothing unreadable is ever read as empty: the caller refuses what needs it (a build, a re-fill). A save keeps
// every readable mode as stored, copies a file holding an unreadable mode aside first, and marks each mode it had to empty `replaced`.
import fs from "../../site/shim/fs.js";
import path from "../../site/shim/path.js";
import { writeFileAtomic } from "../../site/shim/atomic.js";

export const MODES = Object.freeze(["Cash", "GPP"]);
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const both = (entry) => Object.fromEntries(MODES.map((m) => [m, entry]));

/**
 * The file per mode, or null with no file: { Cash: entry, GPP: entry }, entry { fields, saved_at, carried, replaced } or { unreadable: why }.
 * Throws when the file cannot be read at all (any error but ENOENT): unknown, never "unreadable content".
 * parse(one) gives a mode's fields from its stored object (or from null: none saved) and throws when they cannot be used. rel names the file
 * in words (cache/picks/<slate>.json).
 */
export function readModeFile(file, rel, parse) {
  if (!fs.existsSync(file)) return null;
  let text;
  // Only what the file SAYS can make a mode unreadable; failing to read it at all (a lock, a permission) throws, so the caller answers 500
  // and nothing is written over a file that may be whole (review 11-20). Gone since existsSync: no file.
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { if (e?.code === "ENOENT") return null; throw e; }
  let saved;
  try { saved = JSON.parse(text); } catch (e) { return both({ unreadable: `${rel} is not valid JSON (${e.message})` }); }
  if (!plain(saved)) return both({ unreadable: `${rel} is not an object` });
  const split = MODES.some((m) => Object.hasOwn(saved, m));
  const out = {};
  for (const m of MODES) {
    const one = split ? saved[m] : saved;
    try {
      // A missing key is nothing saved for that mode; an explicit null is a damaged entry, unreadable (review 11-20).
      if (split && one === undefined) { out[m] = { fields: parse(null), saved_at: null, carried: false, replaced: null }; continue; }
      if (!plain(one)) throw new Error(`"${m}" is not an object`);
      out[m] = { fields: parse(one), saved_at: typeof one.saved_at === "string" ? one.saved_at : null, carried: split ? one.carried === true : true, replaced: split && plain(one.replaced) ? one.replaced : null };
    } catch (e) { out[m] = { unreadable: `${rel}${split ? ` (${m})` : ""}: ${e.message}` }; }
  }
  return out;
}

/** What the read says beyond the fields: { unreadable: { mode: why } | null, replaced: { mode: { at, copy, why } } | null }. */
export function modeTrouble(stored) {
  const pick = (f) => { const o = Object.fromEntries(MODES.filter((m) => f(stored?.[m])).map((m) => [m, f(stored[m])])); return Object.keys(o).length ? o : null; };
  return { unreadable: pick((e) => e?.unreadable ?? null), replaced: pick((e) => (e && !e.unreadable ? e.replaced : null)) };
}

/**
 * Sets one mode's fields and keeps every other readable mode exactly as stored (its carried and replaced marks too), in one read and one
 * atomic write with nothing awaited between, so two pages saving different modes never undo each other. A file holding an unreadable mode is
 * first copied whole to <its folder>/<slate>.unreadable-<stamp>.json (never lost; a failed copy throws and nothing is written); each other
 * mode that could not be read is emptied and marked replaced { at, copy, why }, shown at the page foot until that mode saves. A failed copy
 * throws code COPY_ASIDE_FAILED (the route answers 500, nothing written); a file that cannot be read at all throws (readModeFile).
 * Returns null, or { copy, emptied: [modes], why } when something could not be read.
 */
export function saveModeFile({ file, rel, slate, mode, fields, parse, empty }) {
  const cur = readModeFile(file, rel, parse);
  const bad = MODES.filter((m) => cur?.[m]?.unreadable);
  const now = new Date().toISOString();
  let copy = null;
  if (bad.length) {
    const name = `${slate}.unreadable-${now.replace(/[:.]/g, "-")}.json`;
    try { fs.copyFileSync(file, path.join(path.dirname(file), name), fs.constants.COPYFILE_EXCL); } catch (e) {
      throw Object.assign(new Error(`Nothing was written: the old file ${rel} could not be copied aside (${e.message}).`), { code: "COPY_ASIDE_FAILED" });
    }
    copy = `${rel.slice(0, rel.lastIndexOf("/") + 1)}${name}`; // plain strings: the public site's path stand-in has no posix
  }
  const next = { slate };
  for (const m of MODES) {
    const e = cur?.[m];
    if (m === mode) next[m] = { ...fields, saved_at: now };
    else if (e?.unreadable) next[m] = { ...empty(), saved_at: null, replaced: { at: now, copy, why: e.unreadable } };
    else if (e) next[m] = { ...e.fields, saved_at: e.saved_at, ...(e.carried ? { carried: true } : {}), ...(e.replaced ? { replaced: e.replaced } : {}) };
    else next[m] = { ...empty(), saved_at: null };
  }
  writeFileAtomic(file, JSON.stringify(next, null, 1) + "\n");
  return bad.length ? { copy, emptied: bad.filter((m) => m !== mode), why: cur[bad[0]].unreadable } : null;
}

/** The answer's words for a save that met an unreadable file (route side): where the old file is, and which mode was emptied. */
export const replacedWords = (r, noun) => (r ? `The saved ${noun} could not be read (${r.why}); the old file is kept at ${r.copy}${r.emptied.length ? `, and the ${r.emptied.join(" and ")} ${noun} ${r.emptied.length > 1 || noun.endsWith("s") ? "are" : "is"} now empty` : ""}.` : null);
