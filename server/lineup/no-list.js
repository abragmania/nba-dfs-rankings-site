// The NO lists (Adam 4:34-4:52 PM ET 11-19): men a build leaves out, one list per build mode (Cash, GPP), apart from his excludes, so a
// NO never touches his exclude, projection or exposures and clearing it leaves nothing behind. Late swap has its OWN list (Adam 5:28 PM
// 11-19: "I want the no OPTION in those scenarios, don't just carry a player 'no' over"), "Late", applied to late-swap fills and the
// entered-lineup rebuild that runs through them; the build lists never reach late swap and the Late list never reaches a build.
// Kept per slate beside his picks, one file per kind; a kind with every list empty keeps only its saved_at (the save's base, 11-13 audit state 3):
//   data/cache/picks/<slate>.no.json       { slate, Cash: [dk_id], GPP: [dk_id], names: { dk_id: name }, saved_at }
//   data/cache/picks/<slate>.no-late.json  { slate, Late: [dk_id], names, saved_at }
// so a damaged file stops only its own kind. The route, the reads and writes, and the pure steps the build route uses are here.
import fs from "../../site/shim/fs.js";
import path from "../../site/shim/path.js";
import { dataRoot } from "../slate/store.js";
import { writeFileAtomic } from "../../site/shim/atomic.js";
import { laterThan, badBase } from "../slate/mode-file.js";
import { refuseCrossSiteRead } from "../lib/origin.js";
import { countLimits } from "./exposure.js";
import { DEFAULT_COUNT } from "../board/slots.js";

export const NO_MODES = Object.freeze(["Cash", "GPP"]);
export const LATE = "Late";
const KINDS = { build: { suffix: "no", lists: ["Cash", "GPP"] }, late: { suffix: "no-late", lists: [LATE] } };
export const kindOf = (mode) => (mode === LATE ? "late" : "build");
const fileName = (slate, kind) => `${slate}.${KINDS[kind].suffix}.json`;
const noFile = (slate, kind = "build") => path.join(dataRoot(), "cache", "picks", fileName(slate, kind));
const emptyOf = (kind) => Object.fromEntries(KINDS[kind].lists.map((m) => [m, []]));
/** A NO name as kept and shown: at most 60 characters, so a long name never refuses a kept build or a save. */
const NAME_MAX = 60;
const cutName = (n) => String(n).slice(0, NAME_MAX);

/** One kind's saved lists. A man no longer on the slate is ignored: he is left out of the list he was on and named in `dropped`
 *  ({ id, name, mode }, G62). The file keeps him until the next NO save of that kind, which writes only men on the slate. No file is
 *  empty lists. An unreadable file throws: who is on NO is then unknown, never "nobody". */
export function readNoKind(slate, slateData, kind) {
  const file = noFile(slate, kind);
  if (!fs.existsSync(file)) return { slate, ...emptyOf(kind), dropped: [], saved_at: null };
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) throw new Error(`cache/picks/${fileName(slate, kind)} is not a NO list`);
  const known = new Set((slateData?.players ?? []).map((p) => String(p.dk_id)));
  const names = saved.names && typeof saved.names === "object" ? saved.names : {};
  const out = { slate, dropped: [], saved_at: saved.saved_at ?? null };
  for (const mode of KINDS[kind].lists) {
    const list = saved[mode] ?? [];
    if (!Array.isArray(list)) throw new Error(`cache/picks/${fileName(slate, kind)}: "${mode}" is not a list`);
    out[mode] = list.map(String).filter((id) => known.has(id));
    out.dropped.push(...list.map(String).filter((id) => !known.has(id)).map((id) => ({ id, name: typeof names[id] === "string" ? names[id] : null, mode })));
  }
  return out;
}
/** The build lists (Cash, GPP), as readNoKind. */
export const readNo = (slate, slateData) => readNoKind(slate, slateData, "build");

/** What GET answers: every list, each kind judged on its own (a damaged file empties only its lists and is named in `unreadable`). */
export function readAllNo(slate, slateData) {
  const out = { slate, Cash: [], GPP: [], [LATE]: [], dropped: [], saved_at: null, unreadable: {}, bases: {} };
  for (const kind of Object.keys(KINDS)) {
    try {
      const r = readNoKind(slate, slateData, kind);
      for (const m of KINDS[kind].lists) out[m] = r[m];
      out.bases[kind] = r.saved_at ?? null; // each kind file's saved_at: the page sends it back as `base` (saveNo; 11-13 audit, state 3)
      out.dropped.push(...r.dropped);
      if (r.saved_at && (!out.saved_at || r.saved_at > out.saved_at)) out.saved_at = r.saved_at;
    } catch (e) { out.unreadable[kind] = `The ${kind === "late" ? "late swap " : ""}NO list could not be read: ${e.message}`; }
  }
  return out;
}
/** The words for NO men ignored because they are no longer on the slate: "Name (GPP), DraftKings id 123 (Cash)". */
export const droppedText = (dropped) => dropped.map((d) => `${d.name ?? `DraftKings id ${d.id}`} (${d.mode})`).join(", ");

/** Checks a POST body { mode, ids } (that mode's whole list; [] is clear all): { ok, mode, ids, ignored } or { ok: false, message }.
 *  A man not on the slate (he left it in a pull since the page read the list) degrades, G62: the others are saved and he is named in
 *  `ignored`. Only a list with more than half its men unknown is refused, with the count. */
export function checkNoBody(body, slateData) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, message: "Body must be a JSON object." };
  if (!NO_MODES.includes(body.mode) && body.mode !== LATE) return { ok: false, message: '"mode" must be "Cash", "GPP" or "Late".' };
  const { ids } = body;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) return { ok: false, message: '"ids" must be a list of player ids.' };
  if (new Set(ids).size !== ids.length) return { ok: false, message: '"ids" repeats an id.' };
  const known = new Set((slateData.players ?? []).map((p) => String(p.dk_id)));
  const ignored = ids.filter((id) => !known.has(id));
  if (ignored.length * 2 > ids.length) return { ok: false, message: `${ignored.length} of the ${ids.length} NO men sent are not on this slate (${ignored.map((id) => id.slice(0, 40)).join(", ")}); nothing was saved.` };
  if (badBase(body)) return { ok: false, message: '"base" must be the time the NO list was last saved, or null.' };
  return { ok: true, mode: body.mode, ids: ids.filter((id) => known.has(id)), ignored, ...(Object.hasOwn(body, "base") ? { base: body.base } : {}) };
}

/** Sets one list, keeping the others of its kind as saved. All of a kind empty: its file keeps only empty lists and saved_at, so a cleared NO leaves no man behind.
 *  Answers as readAllNo. An unreadable file is replaced (so the page can always clear or reset it): the other list of its kind is then
 *  taken as empty, and the answer says so in `replaced_unreadable`. Until then that kind's builds refuse (build-route.js). */
export function saveNo(slate, slateData, mode, ids, base = undefined) { // base: the kind file's saved_at as the page last saw it; another page's save since throws CHANGED_ELSEWHERE, nothing written (11-13 audit, state 3)
  const kind = kindOf(mode), lists = KINDS[kind].lists;
  let cur, replaced = null;
  try { cur = readNoKind(slate, slateData, kind); } catch (e) { cur = emptyOf(kind); replaced = e.message; }
  if (base !== undefined && replaced) throw Object.assign(new Error(`The NO list could not be read (${replaced}), so a change made on a copy of it was not written; reset it from the red chip.`), { code: "NO_UNREADABLE" }); // only a save with no base (the reset) replaces it (review of 11-21, finding 7)
  if (base !== undefined && base !== (cur.saved_at ?? null)) throw Object.assign(new Error("The NO list was saved from another page since this one read it."), { code: "CHANGED_ELSEWHERE" });
  const next = Object.fromEntries(lists.map((m) => [m, m === mode ? ids : cur[m]]));
  const file = noFile(slate, kind);
  const others = lists.filter((m) => m !== mode);
  const said = replaced ? { replaced_unreadable: `The saved ${kind === "late" ? "late swap " : ""}NO list could not be read (${replaced}); it was replaced${others.length ? `, and the ${others.join(" and ")} list is now empty` : ""}.` } : {};
  // All of a kind empty keeps a stub holding saved_at and nothing else, so a page that read the list before the clear still meets a newer base (review of 11-21, finding 11).
  const byId = new Map((slateData?.players ?? []).map((p) => [String(p.dk_id), p]));
  const names = Object.fromEntries(lists.flatMap((m) => next[m]).map((id) => [id, cutName(byId.get(id)?.name ?? `DraftKings id ${id}`)]));
  writeFileAtomic(file, JSON.stringify({ slate, ...next, names, saved_at: laterThan(new Date().toISOString(), cur.saved_at) }, null, 1) + "\n"); // always later than the one it replaces, so two saves never share a base
  return { ...readAllNo(slate, slateData), ...said };
}

/** GET the slate's NO lists; POST { mode, ids } sets that mode's list. Origin and JSON content type are checked by openSlate; a GET from another site is refused, as the other reads are. */
export async function handleNo(req, res, slate, { openSlate, send, fail, readJson }) {
  if (req.method === "GET") {
    const refused = refuseCrossSiteRead(req.headers);
    if (refused) return fail(res, refused.status, refused.code, refused.message);
  }
  const slateData = openSlate(req, res, slate, "The NO list");
  if (!slateData) return;
  let answer;
  try {
    if (req.method === "GET") answer = readAllNo(slate, slateData);
    else {
      const read = await readJson(req, res);
      if (!read) return;
      const checked = checkNoBody(read.body, slateData);
      if (!checked.ok) return fail(res, 400, "BAD_NO", checked.message);
      answer = saveNo(slate, slateData, checked.mode, checked.ids, checked.base);
      if (checked.ignored.length) answer = { ...answer, ignored: checked.ignored }; // men no longer on the slate: not saved, named back (G62)
    }
  } catch (e) {
    if (e?.code === "CHANGED_ELSEWHERE") return fail(res, 409, "NO_CHANGED_ELSEWHERE", `${e.message} Nothing was written; the page lays its change on the saved list and sends again.`);
    if (e?.code === "NO_UNREADABLE") return fail(res, 409, "NO_UNREADABLE", e.message);
    return fail(res, 500, "NO_UNREADABLE", `The NO list could not be read or saved: ${e.message}`);
  }
  send(res, 200, answer);
}

// ---------- the build's side (pure) ----------
const SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;
/** A man's last name: "Cameron Boozer" -> "Boozer"; a suffix is passed over ("Jaren Jackson Jr." -> "Jackson"). */
export function lastName(name) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  while (parts.length > 1 && SUFFIX.test(parts.at(-1))) parts.pop();
  return parts.at(-1) ?? "";
}
/** The names a build's NO line shows, in list order: last names, or the full name where two NO men share a last name; each cut to 60 characters. */
export function noNames(ids, byId) {
  const names = ids.map((id) => byId.get(id)?.name ?? `DraftKings id ${id}`);
  const lasts = names.map(lastName);
  return names.map((n, i) => cutName(lasts.filter((l) => l === lasts[i]).length > 1 || !lasts[i] ? n : lasts[i]));
}
/** The line a lineup's heading carries: "NO: Boozer, Coward"; "" with none. */
export const noLine = (names) => (Array.isArray(names) && names.length ? `NO: ${names.join(", ")}` : "");

/**
 * The build route's NO step (build-route.js): reads the list and applies the build's mode. Outside late swap an unreadable list is
 * { error: 500 NO_UNREADABLE } (nothing is built); NO men of the mode no longer among the build's players are named in the note (G62).
 * In late swap (Adam 5:28 PM 11-19) only the late swap list is read (the build lists never carry over): its men leave the open slots; a
 * NO man pinned in the entry (started, or pinned by hand) or locked by him stays (Adam 6:16 and 6:19 PM 11-19: his own choices win, no
 * note); a damaged late swap file refuses, a damaged build file does not touch late swap. `late` is the answer's late_swap.no (data):
 * { applied: [name], pinned: [name], ignored: [words] }. Out: { error } or { excluded, exposure, noOut: { applied, note }, late }.
 */
export function noForBuild({ slate, slateData, players, mode, lateSwap, locked, excluded, handPicked, exposure, pinned = {}, count }) {
  const byId = new Map(players.map((p) => [String(p.dk_id), p]));
  const slateName = (id) => byId.get(id)?.name ?? slateData?.players?.find((p) => String(p.dk_id) === id)?.name ?? `DraftKings id ${id}`;
  const kind = lateSwap ? "late" : "build";
  let list;
  try { list = readNoKind(slate, slateData, kind); } catch (e) {
    return { error: { status: 500, code: "NO_UNREADABLE", message: `The ${lateSwap ? "late swap " : ""}NO list could not be read, so nothing was built: ${e.message}. Reset it from the red NO chip.` } };
  }
  const modeNo = lateSwap ? list[LATE] : NO_MODES.includes(mode) ? list[mode] : [];
  const gone = (m) => [...list.dropped.filter((d) => d.mode === m), ...modeNo.filter((id) => !byId.has(id)).map((id) => ({ id, name: slateName(id), mode: m }))];
  if (lateSwap) {
    // Adam 6:16 and 6:19 PM 11-19: NO keeps a man out of what the optimizer picks on its own, nothing else; a NO man he locked is used as he chose, with no note.
    const held = modeNo.filter((id) => byId.has(id) && Object.hasOwn(pinned ?? {}, id)), open = modeNo.filter((id) => byId.has(id) && !Object.hasOwn(pinned ?? {}, id));
    const out = open.filter((id) => !locked.includes(id));
    return { excluded: [...new Set([...excluded, ...out])], exposure, noOut: null, late: { applied: out.map(slateName), pinned: held.map(slateName), ignored: gone(LATE).map((d) => `${d.name ?? `DraftKings id ${d.id}`} is no longer on this slate`) } };
  }
  const noIds = modeNo.filter((id) => byId.has(id)); // a man the build's players lack cannot be built anyway
  const no = applyNo({ noIds, mode, locked, excluded, handPicked, exposure, byId, count });
  const ignored = gone(mode);
  const ignoredNote = ignored.length ? `${ignored.length} NO ${ignored.length === 1 ? "man is" : "men are"} no longer on this slate and ${ignored.length === 1 ? "was" : "were"} ignored: ${droppedText(ignored)}.` : null;
  return { excluded: no.excluded, exposure: no.exposure, noOut: { applied: no.applied, note: [no.note, ignoredNote].filter(Boolean).join(" ") || null }, late: null };
}

/**
 * What a build does with the NO list of its mode (Adam 6:16 and 6:19 PM 11-19: "when I press NO, just don't have that guy shown in
 * optimizations ... I don't need a note or a sticky or anything"): NO keeps a man out of what the optimizer picks on its own, and nothing
 * else. A NO man he locked, hand-picked into the working lineup or gave a Min % is used as he chose, with no note and no refusal. Every
 * other NO man joins this build's excluded list (his saved excludes are not changed), and a Max % on him is left out of this build's
 * settings only (he is out of every lineup, so it could not bind). in: { noIds, mode, lateSwap, locked, excluded, handPicked, exposure,
 * byId }. Out: { excluded, exposure, applied: { ids, names } | null (the men left out: each lineup heading's NO line), note: null }.
 */
export function applyNo({ noIds = [], mode = "GPP", lateSwap = false, locked = [], excluded = [], handPicked = [], exposure = null, byId, count = DEFAULT_COUNT }) {
  if (lateSwap || !noIds.length) return { excluded, exposure, applied: null, note: null };
  const lim = exposure && typeof exposure === "object" && !Array.isArray(exposure) ? exposure : null;
  // A Min % binds in either mode (Cash obeys its own, question Q9 yes, optimize.js), so in either it puts a NO man in.
  const minOnly = (id) => Number(lim?.[id]?.min) > 0 && !locked.includes(id) && !handPicked.includes(id);
  const his = (id) => locked.includes(id) || handPicked.includes(id) || minOnly(id);
  const out = noIds.filter((id) => !his(id)), drop = new Set(out);
  let nextExposure = exposure;
  if (lim && noIds.some((id) => (drop.has(id) && Object.hasOwn(lim, id)) || minOnly(id))) {
    // A NO man kept in only by his Min %: held to it (his Max % becomes the share of exactly the lineups his Min % asks for in this build of
    // `count`, or his own Max when lower), since anything above it would be the optimizer choosing him on its own, which NO forbids (review
    // F1 11-19). A left-out NO man's limits are dropped for this build only.
    const heldTo = (l) => { const minC = countLimits({ x: { min: Number(l.min) } }, count).get("x")?.minC ?? 0; return Math.min((minC * 100) / count, l.max != null && Number.isFinite(Number(l.max)) ? Number(l.max) : Infinity); };
    nextExposure = Object.fromEntries(Object.entries(lim).filter(([id]) => !drop.has(id)).map(([id, l]) => [id, minOnly(id) ? { ...l, max: heldTo(l) } : l]));
  }
  return { excluded: [...new Set([...excluded, ...out])], exposure: nextExposure, applied: out.length ? { ids: [...out], names: noNames(out, byId) } : null, note: null };
}
