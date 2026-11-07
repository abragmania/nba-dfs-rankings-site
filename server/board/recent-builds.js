// Recently generated builds on the page (Adam, 2026-11-04): the pure parts. A build is kept with the men it answered with, so its
// cards keep drawing the figures it was built with; the server keeps the ten newest per slate (slate/builds.js) and this file turns a
// finished build into the record it stores, and a stored record back into a build the tab draws. Browser and node both load it.

/** The figures of a man a card draws, as stored: scalars and short lists only (the server keeps nothing else, builds.js). */
export const ROW_KEYS = ["dk_id", "name", "team", "opponent", "oppText", "game", "tip", "positions", "roster_positions", "salary", "projection", "proj_own", "value", "minutes", "injury_status", "starred"];
export const KEEP_BUILDS = 10;

/** A man's row cut to what is stored. */
export function compactRow(p) {
  const out = {};
  for (const k of ROW_KEYS) if (p?.[k] !== undefined) out[k] = p[k];
  return out;
}

/** A build id no other build has: the time it was made, then a few random characters. */
export const newBuildId = (now = Date.now(), rnd = Math.random) => `b${now.toString(36)}${Math.floor(rnd() * 36 ** 4).toString(36).padStart(4, "0")}`;

/**
 * A finished build as the page keeps it, from the result the panel has just made (`res.lineups`: { ids, men }) and the mode it was
 * built for. Lineups hold their ids and their frozen men; nothing else of the result is needed to draw its cards.
 */
export function newBuild(res, mode, now = Date.now(), id = newBuildId(now)) {
  return {
    id, mode, built_at: now,
    lineups: res.lineups.map((l) => ({ ids: [...l.ids], men: l.men ?? [] })),
    skipped: res.skipped ?? [], note: res.note ?? null, partial: res.partial ?? null,
    stamps: { picksAt: res.picksAt ?? null, ovAt: res.ovAt ?? null, limAt: res.limAt ?? null, workKey: res.workKey ?? null, pullAt: res.pullAt ?? null },
  };
}

/** A build as the server stores it: each man once, in `rows`, however many lineups hold him. */
export function toRecord(b) {
  const rows = {};
  for (const l of b.lineups) for (const m of l.men ?? []) if (m?.dk_id != null) rows[m.dk_id] = compactRow(m);
  return { id: b.id, mode: b.mode, built_at: b.built_at, lineups: b.lineups.map((l) => ({ ids: [...l.ids] })), rows, skipped: (b.skipped ?? []).slice(0, 300).map((x) => (typeof x === "string" ? x.slice(0, 80) : x)), note: b.note == null ? null : String(b.note).slice(0, 600), partial: b.partial ?? null, stamps: b.stamps?.pullAt ? { pullAt: { key: b.stamps.pullAt.key ?? null, label: b.stamps.pullAt.label ?? null } } : null };
}

/** A stored record as the page draws it: each lineup's men from the stored rows (a man with no row is left out of `men`; the
 *  card then draws him from the board). */
export function fromRecord(r) {
  return {
    id: r.id, mode: r.mode, built_at: r.built_at,
    lineups: r.lineups.map((l) => ({ ids: [...l.ids], men: l.ids.map((id) => r.rows?.[id]).filter(Boolean) })),
    skipped: r.skipped ?? [], note: r.note ?? null, partial: r.partial ?? null, stamps: r.stamps ?? null,
  };
}

/** The builds on the page after a read of the server's list: the server's, newest first, with any build made here that the server
 *  does not have yet kept in front (its write is still on its way); the ten newest stay. */
export function mergeBuilds(local, server) {
  const have = new Set(server.map((b) => b.id));
  return [...local.filter((b) => !have.has(b.id)), ...server].sort((a, b) => b.built_at - a.built_at).slice(0, KEEP_BUILDS);
}

/** The build with this id, with lineup i taken out (a Discard); null when that was its last lineup (the build goes). */
export function withoutLineup(b, i) {
  const lineups = b.lineups.filter((_, k) => k !== i);
  return lineups.length ? { ...b, lineups } : null;
}
