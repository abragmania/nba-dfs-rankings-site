// What the Late swap screen draws (entries late swap), assembled from the engine's own views. Pure: no DOM, no fs, no clock (nowMs is
// passed in). Nothing here decides anything: spotView, entryRows, movesBetween and the two exports say what is changed, held and
// left out; this only shapes their answers, with each man's figures, for the page.
import { SLOTS } from "../board/slots.js";
import { tipMs } from "../board/board-util.js";
import { slateRefMs } from "../board/lateswap.js";
import { sameLineup, spotNames, spotEntries, lineupOf } from "./maps.js";
import { contextFor, spotView, entryRows, movesBetween, nameOf, slotsDiffering, isBoardOut } from "./entry-state.js";
import { exportChanged, exportAll } from "./export.js";
import { manFor, marksNotesOf, LS_MODES } from "./board-excludes.js";

const fee = (e) => { const n = Number(String(e.entryFee).replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : null; };

/** Spots in screen order: Cash first, then by name with numbers in order (GPP #2 before GPP #10). */
export function orderSpots(names) {
  const key = (s) => (/^cash/i.test(s) ? 0 : 1);
  return [...names].sort((a, b) => key(a) - key(b) || a.localeCompare(b, "en", { numeric: true }));
}

/** One man for the page: his figures from the slate (the newest pull), or only his id and name when the slate does not hold him. mode: the
 *  spot's, whose thumbs his projection carries (board-excludes.js manFor, Adam 1:24 PM 11-20); none gives the shared row (GPP's thumbs). */
export function manView(ctx, id, entries = [], mode = null) {
  if (id == null) return null;
  const p = mode ? manFor(ctx, id, mode) : ctx.man(id);
  if (!p) return { dk_id: id, name: nameOf(id, ctx, entries), missing: true };
  return {
    dk_id: id, name: p.name, team: p.team ?? null, game: p.game ?? null, positions: p.positions ?? p.roster_positions ?? [], roster_positions: p.roster_positions ?? [],
    salary: p.salary ?? null, proj: p.projection ?? null, own: p.proj_own ?? null, tip: p.tip ?? null,
    rest_b2b2nd: p.rest_b2b2nd ?? null, rest_plays_tomorrow: p.rest_plays_tomorrow ?? null, // the back-to-back dot beside his name (board-util.js restDot)
    started: ctx.started.has(id), untimed: ctx.untimed.has(id), gone: ctx.departedById.has(id), injury: null, out: isBoardOut(p),
  };
}

const exportSummary = (r) => ({ ok: r.ok, error: r.error, written: r.written, changed: r.changed, unchanged: r.unchanged, heldBack: r.heldBack, leftOut: r.leftOut, alerts: r.alerts });

/** The source label of a spot's lineup: what the screen says under the card. */
function sourceOf(state, spot, fromFile) {
  const row = Object.hasOwn(state.spots, spot) ? state.spots[spot] : null;
  if (!row || row.lineup.every((id) => id == null)) return { label: "No lineup yet", kind: "none" };
  if (row.atUpload && sameLineup(row.lineup, row.atUpload)) return { label: "From your upload", kind: "upload" };
  if (fromFile?.lineup_id != null && Array.isArray(fromFile.slots) && sameLineup(row.lineup, fromFile.slots)) return { label: `Saved lineup ${fromFile.lineup_id}`, kind: "saved", lineupId: String(fromFile.lineup_id) };
  return { label: "Changed here", kind: "edited" };
}

/**
 * The model for the screen. args: { slate: { name, players, departed, games }, nowMs, spotsFile: { "<spot>": { lineup_id, slots, assigned_at } },
 * meta: { uploadName, uploadedAt, exportedAt, uploads, syncNotes } }. { ok: false, error } when the slate cannot be read at this now.
 */
export function buildModel(state, { slate, nowMs, spotsFile = {}, meta = {} }) {
  const { ctx, error } = contextFor(state, slate, nowMs);
  if (error) return { ok: false, error };
  const names = orderSpots(spotNames(state));
  const hold = (meta.pendingSpots ?? []).filter((p) => p.takenBack).map((p) => p.spot); // spots whose lineup the Lineups tab took back stay out of both files until answered
  const exp = { changed: exportChanged(state, { slate, nowMs, hold }), all: exportAll(state, { slate, nowMs, hold }) };
  const spots = names.map((name) => {
    const entries = spotEntries(state, name), view = spotView(state, name, ctx), lineup = lineupOf(state, name);
    const known = entries.concat();
    const slots = view.slots.map((s) => ({ ...s, man: manView(ctx, s.dk_id, known, view.mode), was: s.changed && s.at_upload_id != null ? manView(ctx, s.at_upload_id, known, view.mode) : null }));
    const fees = entries.map(fee);
    const blank = lineup.every((id) => id == null);
    const row = Object.hasOwn(state.spots, name) ? state.spots[name] : null;
    const changedSlots = slots.filter((s) => s.changed).length;
    return {
      name, nEntries: entries.length, fees: fees.every((f) => f != null) ? fees.reduce((a, b) => a + b, 0) : null, contests: [...new Set(entries.map((e) => e.contestName))],
      blank, source: sourceOf(state, name, Object.hasOwn(spotsFile, name) ? spotsFile[name] : null), mode: view.mode, atUploadWhy: view.atUploadWhy, confirmedOut: view.confirmedOut, proven: view.proven, salary: view.salary, projection: view.projection,
      uploadSalary: row?.atUpload ? sumOf(row.atUpload.map((id) => (id == null ? null : ctx.man(id))), "salary") : null,
      uploadProjection: row?.atUpload ? sumOf(row.atUpload.map((id) => (id == null ? null : manFor(ctx, id, view.mode))), "projection") : null, // the spot's own mode's figures
      ownSum: sumOf(lineup.map((id) => (id == null ? null : manFor(ctx, id, view.mode))), "proj_own"), // missing while the spot's mode's figures are unknown (manFor)
      alert: view.alert, notes: view.notes, duplicate: view.duplicate, unusable: view.unusable, slots, flags: view.flags, amber: view.amber, changedSlots, changed: !blank && (changedSlots > 0 || view.entries.some((e) => e.changed)), // a spot with no lineup at all is not a change: it is held, and says "No lineup assigned"
      entries: view.entries.map((e) => ({ ...e, changed: blank ? false : e.changed, held: e.status === "held" })),
    };
  });
  const inSpot = new Map(spots.map((s) => [s.name, s]));
  const rows = entryRows(state, ctx).map((r) => {
    const sp = r.spot == null ? null : inSpot.get(r.spot);
    const e = state.entries.find((x) => x.entryId === r.entryId);
    const view = sp?.entries.find((x) => x.entryId === r.entryId) ?? null;
    const lineup = r.spot == null ? null : lineupOf(state, r.spot);
    const moves = lineup && !lineup.includes(null) ? movesBetween(e.uploaded, lineup, ctx, [e]).map((m) => ({ ...m, out: m.out && manView(ctx, m.out.dk_id, [e], sp?.mode ?? null), in: m.in && manView(ctx, m.in.dk_id, [e], sp?.mode ?? null) })) : [];
    const diff = lineup ? slotsDiffering(e.uploaded, lineup).length : 0;
    return { ...r, changed: sp?.blank ? false : view?.changed ?? false, changedSlots: sp?.blank ? [] : view?.changedSlots ?? [], amber: view?.amber ?? false, reasons: view?.reasons ?? [], noSpot: r.spot == null, noLineup: r.spot == null || (sp?.blank ?? true), held: view?.status === "held" ? view.reasons : null, moves: diff ? moves : [] };
  });
  const clock = clockOf(slate, nowMs);
  const removals = Object.entries(state.unusable).flatMap(([spot, ids]) => ids.map((id) => ({ spot, id, name: nameOf(id, ctx) })));
  const model = {
    ok: true, slate: state.slate, nowMs, refMs: ctx.refMs, clock, games: clock.games, pull: meta.pull ?? null, boardStamp: meta.boardStamp ?? null,
    spots, entries: rows, removals, gone: state.gone, file: { ...meta, skipped: state.file.skipped, oddIds: state.file.oddIds },
    exports: { changed: exportSummary(exp.changed), all: exportSummary(exp.all) },
    pool: ctx.players.map((p) => manView(ctx, p.dk_id)), // the shared rows (GPP's thumbs): names, teams, who started
    // Each mode's own figures (thumbs and stars per mode, Adam 1:24 PM 11-20): every per-spot list and total on the page reads its spot's mode's pool.
    pools: Object.fromEntries(LS_MODES.map((m) => [m, ctx.players.map((p) => manView(ctx, p.dk_id, [], m))])),
    marksNotes: marksNotesOf(ctx), // a mode whose thumbs and stars could not be read: one foot line each (G62)
    departed: [...ctx.departedById.values()].map((p) => p.dk_id),
    syncNotes: meta.syncNotes ?? [], pendingSpots: meta.pendingSpots ?? [],
    excludedGames: meta.excludedGames ?? [], keptMen: meta.keptMen ?? {}, takeOut: meta.takeOut ?? [], atLeast: meta.atLeast ?? {}, // Adam's choices on this screen (screen-ops.js setExcludedGames, setKeptMen)
  };
  return { ...model, fp: fingerprint(model), mapFp: mapFp(state) };
}

/**
 * A short fingerprint of what the page draws: the pull it was built from, every spot's lineup, which entries the two exports would write or
 * hold, and who is assigned where. An export sends the one the page drew; a different one now means a pull or an action came in between,
 * so the file is not made until the screen has been redrawn and clicked again.
 */
export function fingerprint(model) {
  return hashText(JSON.stringify([model.pull, model.boardStamp, model.spots.map((s) => [s.name, s.slots.map((x) => x.dk_id)]), model.exports.changed.changed, model.exports.changed.heldBack.map((h) => h.entryId), model.exports.all.written, model.entries.map((e) => [e.entryId, e.spot])]));
}

function hashText(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** A fingerprint of the entries-to-spots map alone: a fill or its undo names the one it was made from, and is refused if the map has moved. */
export const mapFp = (state) => hashText(JSON.stringify(state.entries.map((e) => [e.entryId, state.entrySpots[e.entryId] ?? null])));

const sumOf = (men, key) => (men.length === SLOTS.length && men.every((p) => Number.isFinite(p?.[key])) ? men.reduce((t, p) => t + p[key], 0) : null);

/** The slate's games with whether each has tipped at nowMs: { games: [{ game, away, home, tip, tipMs, started }], tipped, left }. */
export function clockOf(slate, nowMs) {
  const refMs = slateRefMs(slate?.name);
  const games = (slate.games ?? []).map((g) => {
    const t = tipMs(g.tip, refMs);
    return { game: g.game, away: g.away, home: g.home, tip: g.tip, tipMs: t, started: t != null && t <= nowMs };
  }).sort((a, b) => (a.tipMs ?? 1e18) - (b.tipMs ?? 1e18));
  const tipped = games.filter((g) => g.started).length;
  return { games, tipped, left: games.length - tipped };
}
