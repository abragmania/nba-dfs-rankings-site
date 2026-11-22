// The latest build on the page (Adam, 2026-11-04; one build only since 2026-11-07): the pure parts. A build is kept with the men it
// answered with, so its cards keep drawing the figures it was built with; the server keeps only the newest per slate (slate/builds.js),
// so a new build replaces the last on the page and on disk, and only Save puts a lineup in the saved list. This file turns a finished
// build into the record it stores, and a stored record back into a build the tab draws. Browser and node both load it.

/** The figures of a man a card draws, as stored: scalars and short lists only (the server keeps nothing else, builds.js). */
export const ROW_KEYS = ["dk_id", "name", "team", "opponent", "oppText", "game", "tip", "positions", "roster_positions", "salary", "projection", "proj_own", "value", "minutes", "injury_status", "his", "starred"];
/** Builds kept per slate, PER MODE: one Cash and one GPP at most. Adam 11-07 ("the only lineups that should save are the ones I press Save
 *  on") and 11-12 ("not keep any except the ones I saved"): nothing piles up beyond the latest, and only Save keeps lineups. Adam 11-14
 *  (his yes 5:14 PM ET 11-19 and 12:42 PM ET 11-20): Cash and GPP keep fully separate lineups, so a new build replaces only the last build
 *  of its own mode; a Cash build never takes GPP's built lineups away, nor the reverse. */
export const KEEP_BUILDS = 1;
const BUILD_MODES = ["Cash", "GPP"];
/** The newest build of each mode, newest first: what a slate keeps (an older file holding more reads as the newest of each mode only).
 *  A build of no known mode is never kept (the server refuses one, slate/builds.js checkBuild). */
export function keepRecent(list) {
  const newest = [...list].sort((a, b) => (b.built_at ?? 0) - (a.built_at ?? 0));
  return BUILD_MODES.flatMap((m) => newest.filter((b) => b.mode === m).slice(0, KEEP_BUILDS)).sort((a, b) => (b.built_at ?? 0) - (a.built_at ?? 0));
}

/** A man's row cut to what is stored. */
export function compactRow(p) {
  const out = {};
  for (const k of ROW_KEYS) if (p?.[k] !== undefined) out[k] = p[k];
  return out;
}

/** A build id no other build has: the time it was made, then a few random characters. */
export const newBuildId = (now = Date.now(), rnd = Math.random) => `b${now.toString(36)}${Math.floor(rnd() * 36 ** 4).toString(36).padStart(4, "0")}`;

/** The NO line's names a build or saved lineup keeps (Adam 4:50 PM 11-19: "NO: Boozer, Coward" in each lineup's heading, kept after
 *  the NO is cleared): each cut to 60 characters when made, so a long name never refuses a kept build or a save; null with none. */
export const noOf = (names) => {
  const out = Array.isArray(names) ? names.filter((n) => typeof n === "string" && n).map((n) => n.slice(0, 60)) : [];
  return out.length ? out : null;
};
/** The NO names a kept build or saved lineup may carry: none, or a list of at most 300 names (the one check, slate/builds.js and slate/store.js, which then keep noOf of it). */
export const NO_NAMES_RULE = '"no" must be a list of at most 300 names.';
export const noNamesOk = (v) => v == null || (Array.isArray(v) && v.length <= 300 && v.every((n) => typeof n === "string"));

/**
 * A finished build as the page keeps it, from the result the panel has just made (`res.lineups`: { ids, men }) and the mode it was
 * built for. Lineups hold their ids and their frozen men; nothing else of the result is needed to draw its cards.
 */
export function newBuild(res, mode, now = Date.now(), id = newBuildId(now)) {
  return {
    id, mode, built_at: now,
    lineups: res.lineups.map((l) => ({ ids: [...l.ids], men: l.men ?? [] })),
    skipped: res.skipped ?? [], note: res.note ?? null, partial: res.partial ?? null, no: noOf(res.no),
    stamps: { picksAt: res.picksAt ?? null, ovAt: res.ovAt ?? null, limAt: res.limAt ?? null, workKey: res.workKey ?? null, pullAt: res.pullAt ?? null },
    rerun: res.rerun ?? null, // the build answer's seed, mode, settings and players' hash (lineup/build-route.js rerunOf; the 11-13 audit): kept with the build, never in stamps
  };
}

/** The most of a build's note the server keeps (slate/builds.js checks it). */
const NOTE_MAX = 600;
/**
 * A note cut to NOTE_MAX characters from the middle, keeping its last sentence (the result's foot notes, such as the ownership
 * no-figure count, come last) and marking the cut with "…"; a last sentence too long to keep whole leaves the head, cut and marked.
 */
export function cutNote(note) {
  const t = String(note);
  if (t.length <= NOTE_MAX) return t;
  const at = t.lastIndexOf(". ");
  const last = at >= 0 ? t.slice(at + 2) : "";
  if (!last || last.length > NOTE_MAX - 3) return `${t.slice(0, NOTE_MAX - 1)}…`;
  return `${t.slice(0, NOTE_MAX - 2 - last.length)}… ${last}`;
}

/** A build as the server stores it: each man once, in `rows`, however many lineups hold him. */
export function toRecord(b) {
  const rows = {};
  for (const l of b.lineups) for (const m of l.men ?? []) if (m?.dk_id != null) rows[m.dk_id] = compactRow(m);
  return { id: b.id, mode: b.mode, built_at: b.built_at, lineups: b.lineups.map((l) => ({ ids: [...l.ids] })), rows, skipped: (b.skipped ?? []).slice(0, 300).map((x) => (typeof x === "string" ? x.slice(0, 80) : x)), note: b.note == null ? null : cutNote(b.note), partial: b.partial ?? null, no: noOf(b.no), stamps: b.stamps?.pullAt ? { pullAt: { key: b.stamps.pullAt.key ?? null, label: b.stamps.pullAt.label ?? null } } : null, ...(b.rerun ? { rerun: b.rerun } : {}) };
}

/** A stored record as the page draws it: each lineup's men from the stored rows (a man with no row is left out of `men`; the
 *  card then draws him from the board). */
export function fromRecord(r) {
  return {
    id: r.id, mode: r.mode, built_at: r.built_at,
    lineups: r.lineups.map((l) => ({ ids: [...l.ids], men: l.ids.map((id) => r.rows?.[id]).filter(Boolean) })),
    skipped: r.skipped ?? [], note: r.note ?? null, partial: r.partial ?? null, no: noOf(r.no), stamps: r.stamps ?? null, rerun: r.rerun ?? null, // an older record has none
  };
}

/** The builds on the page after a read of the server's list: the server's, newest first, with any build made here that the server
 *  does not have yet kept in front (its write is still on its way); the newest of each mode stays (keepRecent). */
export function mergeBuilds(local, server) {
  const have = new Set(server.map((b) => b.id));
  return keepRecent([...local.filter((b) => !have.has(b.id)), ...server]);
}

/** The build with this id, with lineup i taken out (a Discard); null when that was its last lineup (the build goes). */
export function withoutLineup(b, i) {
  const lineups = b.lineups.filter((_, k) => k !== i);
  return lineups.length ? { ...b, lineups } : null;
}
