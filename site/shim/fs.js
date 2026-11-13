// node:fs for the app's own store code on the public site, so picks, overrides, lineups, the working lineup and console work run
// through the same functions as the app. Published files are put in memory by the stand-in (seed); a visitor's own files live in
// this browser's storage. Every storage read and write is in a try/catch: with storage blocked or full, a write stays in memory for
// this page's life and the page is told once (onKeepFailure). A kept file that is not JSON counts as no file, and is removed.
const PREFIX = "nbadfs.site:";
const KEPT = /^\/data\/(cache\/(picks|working|lineups|spots|builds|lateswap)\/[^/]+\.json|cache\/lateswap\/[^/]+\.uploads\/[^/]+|slates\/[^/]+\/(overrides|scenarios)\.json)$/;
// A late swap upload is DraftKings' entries CSV, kept byte for byte: the one kept file that is not JSON.
const NOT_JSON = /\.uploads\/[^/]+$/;
const memory = new Map();
let keepFailed = () => {};

const noFile = (p) => Object.assign(new Error(`ENOENT: no such file, ${p}`), { code: "ENOENT" });
const storage = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch (e) {
    console.warn("Browser storage unavailable:", e.message);
    return null;
  }
};

let layer = null; // { decode(stored, path) -> the file the app reads, encode(text, path) -> what is stored }: a visitor's overrides and scenarios as differences from the published baseline (../layers.js)
function readKept(p) {
  try {
    let stored = storage()?.getItem(PREFIX + p) ?? null;
    if (stored === null) return null;
    const moved = layer?.migrate ? layer.migrate(stored, p) : null; // an earlier version's whole file, converted once into the visitor's own differences
    if (moved !== null) { storage().setItem(PREFIX + p, moved); stored = moved; }
    const text = layer ? layer.decode(stored, p) : stored;
    if (!NOT_JSON.test(p)) JSON.parse(text);
    return text;
  } catch (e) {
    console.warn(`A kept file could not be read and is dropped (${p}):`, e.message);
    removeKept(p);
    return null;
  }
}
function removeKept(p) {
  try {
    storage()?.removeItem(PREFIX + p);
  } catch (e) {
    console.warn("Browser storage could not remove a kept file:", e.message);
  }
}

/** Puts a published file in memory (the stand-in, after it fetches one). */
export function seed(p, text) { memory.set(p, text); }
/** What this page's memory holds at p, or null. */
export const peek = (p) => memory.get(p) ?? null;
/** What this browser's storage holds at p, as stored (before the layer reads it), or null. */
export function readRaw(p) { try { return storage()?.getItem(PREFIX + p) ?? null; } catch { return null; } }
/** Sets the layer that reads and writes a visitor's overrides and scenarios against the published baseline (layers.js). */
export function setLayer(l) { layer = l; }
/** Tells `fn` when a write could not be kept in this browser. */
export function onKeepFailure(fn) { keepFailed = fn; }
/** Removes a visitor's kept file from memory and storage (one that fails its own check). */
export function dropKept(p) { memory.delete(p); removeKept(p); }

function existsSync(p) {
  // A folder exists when it holds a file (the late swap screen lists its uploads folder).
  return memory.has(p) || (KEPT.test(p) && readKept(p) !== null) || (!KEPT.test(p) && readdirSync(p).length > 0);
}
function readFileSync(p) {
  // Storage first for a kept file, so a change made in another tab is read; memory holds it when storage would not.
  const text = KEPT.test(p) ? readKept(p) : null;
  if (text !== null) return text;
  if (memory.has(p)) return memory.get(p);
  throw noFile(p);
}
function writeFileSync(p, text) {
  memory.set(p, String(text));
  if (!KEPT.test(p)) return;
  try {
    const s = storage();
    if (!s) throw new Error("no storage");
    s.setItem(PREFIX + p, layer ? layer.encode(String(text), p) : String(text));
  } catch (e) {
    console.warn("Browser storage would not keep a change:", e.message);
    removeKept(p); // memory now holds the newest; an older copy must not win the next read
    keepFailed();
  }
}
function mkdirSync() {}
function rmSync(p) { dropKept(p); }
/** The names in a folder: this page's memory and this browser's kept files directly under it. */
function readdirSync(dir) {
  const head = `${String(dir).replace(/\/+$/, "")}/`;
  const names = new Set();
  const add = (p) => { if (p.startsWith(head) && !p.slice(head.length).includes("/")) names.add(p.slice(head.length)); };
  for (const p of memory.keys()) add(p);
  try {
    const s = storage();
    for (let i = 0; s && i < s.length; i++) { const k = s.key(i); if (k?.startsWith(PREFIX)) add(k.slice(PREFIX.length)); }
  } catch (e) {
    console.warn("Browser storage could not be listed:", e.message);
  }
  return [...names];
}

export default { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync };
