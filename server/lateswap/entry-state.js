// Entries and spots checked against the slate and a passed-in now (entries late swap). Pure: no DOM, no fs, no clock.
// An entry's uploaded lineup is what DraftKings holds, so it, not the spot's edited lineup, says which men are frozen and where.
import { SLOTS, checkLineup } from "../board/slots.js";
import { slateRefMs, startedSplit, pinsOf } from "../board/lateswap.js";
import { lineupOf, spotEntries, modeFromName } from "./maps.js";
import { departedFrom } from "./salary-table.js";
import { isOut, outFor } from "../board/figures.js";

/**
 * The slate read at nowMs; { ctx } or { error }. slate = { name: "2026-11-04-main", players, departed? }. players is the newest
 * pull. departed lists men who have left the board, each with dk_id, name, tip, salary, game and roster_positions: a man ruled out
 * leaves the slate's players, and without his record his tip cannot be read. contextFor fills it from the state's salary table men.
 * out (optional) is the slate file's report list, [{ name, status }]: only status OUT says "Out" rather than "gone" for a man off the board.
 */
export function slateContext(slate, nowMs) {
  if (!Number.isFinite(nowMs)) return { error: "The time now must be a number of milliseconds." };
  const refMs = slateRefMs(slate?.name);
  if (refMs == null) return { error: `The slate name ${JSON.stringify(slate?.name ?? null)} carries no date, so its tip times cannot be read.` };
  const players = slate.players;
  if (!Array.isArray(players) || !players.length) return { error: "The slate has no players; its state is unknown, so nothing was changed." };
  const byId = new Map(players.map((p) => [p.dk_id, p]));
  const departed = (slate.departed ?? []).filter((p) => !byId.has(p.dk_id));
  const departedById = new Map(departed.map((p) => [p.dk_id, p]));
  const split = startedSplit([...players, ...departed], { nowMs, refMs });
  const untimedIds = new Set(split.untimed.map((p) => p.dk_id));
  const started = new Set([...split.started].filter((id) => !untimedIds.has(id))); // startedSplit counts an untimed man as started; here he stays apart so the words say "tip unreadable"
  const outNames = new Set((Array.isArray(slate.out) ? slate.out : []).filter((o) => isOut(o?.status)).map((o) => o.name));
  return { ctx: { name: slate.name, players, byId, departedById, started, untimed: untimedIds, outNames, nowMs, refMs, man: (id) => byId.get(id) ?? departedById.get(id) ?? null } };
}

/** True for a man on the board marked Out (figures.js outFor: his own In beats an outside Out). Questionable and the rest do not count. */
export const isBoardOut = (p) => outFor(p, { engine: true });

/**
 * The alert for a lineup holding men who are Out or gone from the board and have not started, as plain data, or null: { kind: "out", men:
 * [{ dk_id, name, why: "Out" | "gone from the board", text }], text }. A started or untimed man is not in it: he is frozen, not a choice.
 */
export function outAlert(lineup, ctx) {
  const men = lineup.filter((id) => id != null && (ctx.departedById.has(id) || isBoardOut(ctx.byId.get(id))) && !frozenWhy(id, ctx)).map((id) => {
    const name = nameOf(id, ctx), isOut = ctx.byId.has(id) || ctx.outNames.has(name);
    return { dk_id: id, name, why: isOut ? "Out" : "gone from the board", text: isOut ? `${name} is Out; the upload file will hold any row that writes him.` : `${name} is no longer on the newest pull.` };
  });
  return men.length ? { kind: "out", men, text: men.map((m) => m.text).join(" ") } : null;
}

/** slateContext for this state: refuses a slate other than the one the state was made for. */
export function contextFor(state, slate, nowMs) {
  if (slate?.name !== state.slate) return { error: `These entries are for ${state.slate}; the slate given is ${JSON.stringify(slate?.name ?? null)}.` };
  const departed = slate.departed ?? (Array.isArray(slate.players) ? departedFrom(state.fileMen, slate.players) : []);
  return slateContext({ ...slate, departed }, nowMs);
}

/** His name: the slate's, else the file's, else his id. */
export function nameOf(id, ctx, entries = []) {
  const known = ctx.man(id)?.name;
  if (known) return known;
  for (const e of entries) {
    const cell = e.cells.find((c) => c.dk_id === id);
    if (cell?.name) return cell.name;
  }
  return id;
}

/** Why a man cannot move or be added now (a phrase), or null. The file's LOCKED mark counts only for a man in that entry. */
export function frozenWhy(id, ctx, entry = null) {
  if (ctx.started.has(id)) return "his game has started";
  if (ctx.untimed.has(id)) return "his tip time is unreadable, so his game may have started";
  if (entry?.lockedInFile.includes(id)) return "the file marks him LOCKED";
  return null;
}

/** An entry that holds nobody (a reservation) has no started man to keep: spot-level checks skip it, and entryStatus holds its row. */
export const holdsMen = (entry) => entry.uploaded.some((id) => id != null);

/** Why a man can never be added to a lineup (a sentence), or null. A man Out or gone who has not started is not refused here: he is
 *  asked about first (outAlert), and goes in on Adam's go-ahead. */
export function notAddableWhy(id, ctx) {
  const name = nameOf(id, ctx);
  if (!ctx.man(id)) return `${name} is not on the slate, so he cannot be added.`;
  const why = frozenWhy(id, ctx);
  return why ? `${name} cannot be added: ${why}.` : null;
}

/** The entry's uploaded men who must stay where DraftKings has them: a Set of dk_ids. */
export function heldIds(entry, ctx) {
  return new Set(entry.uploaded.filter((id) => id != null && frozenWhy(id, ctx, entry)));
}

/** Why this entry cannot take any change (sentences; none when it can): a slot the file wrote unreadably, or an uploaded man with
 *  no record at all, whose tip cannot be known. Each names the entry. */
export function entryBlocks(entry, ctx) {
  const unknown = [...new Set(entry.uploaded.filter((id) => id != null && !ctx.man(id)))];
  return [
    ...entry.readFlags.map((f) => `Entry ${entry.entryId}: ${f}`),
    ...unknown.map((id) => `Entry ${entry.entryId}: ${nameOf(id, ctx, [entry])} (${id}) is not on the slate, so his tip cannot be read and this entry cannot be changed.`),
  ];
}

/** Slot indexes where a lineup differs from what the entry holds at DraftKings. */
export const slotsDiffering = (uploaded, lineup) => SLOTS.map((_, i) => i).filter((i) => lineup[i] !== uploaded[i]);

/** The lineup's own legality (position, cap, two games, no repeats, no empty slot), as sentences. */
export function lineupProblems(lineup, ctx) {
  const unknown = lineup.filter((id) => id != null && !ctx.man(id));
  if (unknown.length) return unknown.map((id) => `${id} is not on the slate.`);
  return checkLineup(lineup.map((id) => (id == null ? null : ctx.man(id)))).reasons;
}

/** A lineup's legality while it may still have empty slots, so a part-filled spot can be completed one man at a time: everything
 *  lineupProblems checks but the empty slots and the games count. A full lineup gets the full check. */
export function partLineupProblems(lineup, ctx) {
  if (lineup.every((id) => id != null)) return lineupProblems(lineup, ctx);
  const unknown = lineup.filter((id) => id != null && !ctx.man(id));
  if (unknown.length) return unknown.map((id) => `${id} is not on the slate.`);
  return checkLineup(lineup.map((id) => (id == null ? null : ctx.man(id))), { minGames: 0 }).reasons.filter((r) => !/empty slots?\.$/.test(r));
}

/** The slots where writing `lineup` to this entry would move, remove or add a man who may no longer be touched, as sentences. A man
 *  off the newest pull may stay where the file has him, and is written anywhere else only if Adam went ahead for him (confirmed, dk_ids). */
export function frozenProblems(entry, lineup, ctx, confirmed = []) {
  const out = [];
  for (const i of slotsDiffering(entry.uploaded, lineup)) {
    const was = entry.uploaded[i], now = lineup[i];
    const whyWas = was != null && frozenWhy(was, ctx, entry);
    if (whyWas) out.push(`${nameOf(was, ctx, [entry])} must stay at ${SLOTS[i]} in entry ${entry.entryId}: ${whyWas}.`);
    const whyNow = now == null ? null : frozenWhy(now, ctx, entry) ?? (ctx.departedById.has(now) && !confirmed.includes(now) ? "he is no longer on the newest pull" : null);
    if (whyNow) out.push(`${nameOf(now, ctx, [entry])} cannot be written at ${SLOTS[i]} in entry ${entry.entryId}: ${whyNow}.`);
  }
  return out;
}

/** Everything that keeps this entry's changed row out of the upload file now, as sentences; none when it may go. */
export function exportProblems(entry, lineup, ctx, confirmed = []) {
  const blocks = entryBlocks(entry, ctx);
  return blocks.length ? blocks : [...frozenProblems(entry, lineup, ctx, confirmed), ...lineupProblems(lineup, ctx), ...outProblems(entry, lineup, ctx)];
}

/** A man Out on the board whose game has not started keeps the row out of the file, as the DK file refuses him (Adam, 11-13). A frozen man
 *  (started, untimed, or marked LOCKED in this entry's file) stays where he is and only gets the screen's note. */
function outProblems(entry, lineup, ctx) {
  // Out on the board, or left the players for TwoGun's out list (departed, and his name on it): the same man outAlert calls Out.
  const isOutMan = (id) => isBoardOut(ctx.byId.get(id)) || (ctx.departedById.has(id) && ctx.outNames.has(nameOf(id, ctx, [entry])));
  return [...new Set(lineup)].filter((id) => id != null && isOutMan(id) && !frozenWhy(id, ctx, entry))
    .map((id) => `${nameOf(id, ctx, [entry])} is Out and his game has not started, so entry ${entry.entryId} is not written.`);
}

/**
 * The one decision on an entry's row, which the export writes and the screen draws: { status: "unchanged" | "changed" | "held",
 * changedSlots: [slot name], reasons }, measured against that entry's row in the file. held means it stays out of the file, for the
 * reasons given; a lineup with an empty slot is always held, because a row with no lineup makes the DraftKings upload fail.
 */
export function entryStatus(entry, lineup, ctx, confirmed = []) {
  const changedSlots = slotsDiffering(entry.uploaded, lineup).map((i) => SLOTS[i]);
  if (!changedSlots.length && lineup.every((id) => id != null)) return { status: "unchanged", changedSlots, reasons: [] };
  const reasons = exportProblems(entry, lineup, ctx, confirmed);
  return { status: reasons.length ? "held" : "changed", changedSlots, reasons };
}

/** The spot's entries that disagree on a frozen man: [{ slot, dk_id, name, why, holding: [entryId], missing: [entryId], text }]. The
 *  spot has one lineup, so one that holds him there is illegal for an entry that does not, and one that does not is illegal for the
 *  others. A blank entry holds nobody, so it does not count: the man simply cannot be written to it, which entryStatus says. */
export function spotDisagreements(state, spot, ctx) {
  const entries = spotEntries(state, spot).filter(holdsMen), seen = new Map();
  for (const e of entries) {
    e.uploaded.forEach((id, i) => {
      const why = id == null ? null : frozenWhy(id, ctx, e);
      if (!why || seen.has(`${i}|${id}`)) return;
      const holding = entries.filter((x) => x.uploaded[i] === id).map((x) => x.entryId);
      const missing = entries.filter((x) => x.uploaded[i] !== id).map((x) => x.entryId);
      if (!missing.length) return;
      const name = nameOf(id, ctx, entries);
      seen.set(`${i}|${id}`, { slot: SLOTS[i], dk_id: id, name, why, holding, missing, text: `${spot} entries disagree on ${name} at ${SLOTS[i]} (${why}): ${holding.join(", ")} hold him there, ${missing.join(", ")} do not. Split them into another spot.` });
    });
  }
  return [...seen.values()];
}

/** Why this spot's lineup cannot be changed, as sentences; none when it can. */
export function spotBlocks(state, spot, ctx) {
  return [...spotEntries(state, spot).flatMap((e) => entryBlocks(e, ctx)), ...spotDisagreements(state, spot, ctx).map((d) => d.text)];
}

/** The men who must stay in this spot's lineup and where, for optimize(): { dk_id: slot name }. Read only when the spot has no
 *  blocks, so its entries agree. */
export function spotPins(state, spot, ctx) {
  const pinned = {};
  for (const e of spotEntries(state, spot)) Object.assign(pinned, pinsOf({ slots: e.uploaded, started: heldIds(e, ctx) }).pinned);
  return pinned;
}

/** What one slot lost and gained between two lineups, for a lineup update: [{ slot, out, in }], each man { dk_id, name } or null. */
export function movesBetween(before, after, ctx, entries = []) {
  const man = (id) => (id == null ? null : { dk_id: id, name: nameOf(id, ctx, entries) });
  return SLOTS.map((slot, i) => (before[i] === after[i] ? null : { slot, out: man(before[i]), in: man(after[i]) })).filter(Boolean);
}

const sumOf = (men, key) => (men.length === SLOTS.length && men.every((p) => Number.isFinite(p?.[key])) ? men.reduce((t, p) => t + p[key], 0) : null);

/**
 * What the screen draws for one spot at this now. slots: { slot, dk_id, name, at_upload_id, at_upload_name, changed, frozen, frozen_id, why }:
 * changed compares the lineup with what the spot held at upload; frozen_id is the man an entry holds frozen in that slot, whether or not
 * the spot's entries agree. entries: { entryId, contestName, status, changed, changedSlots, amber, reasons }, from entryStatus, the call
 * the export makes; amber means the row is held out of the file. flags: sentences naming what is wrong. notes and duplicate are what the
 * last change to the spot left on it. alert is outAlert for its lineup, which also turns the spot amber. unusable is the men out of this spot. salary and projection are null when any man's figure is missing, never a partial total or zero.
 */
export function spotView(state, spot, ctx) {
  const entries = spotEntries(state, spot), lineup = lineupOf(state, spot), row = Object.hasOwn(state.spots, spot) ? state.spots[spot] : null;
  const blocks = spotBlocks(state, spot, ctx);
  const holderAt = (i) => entries.find((e) => e.uploaded[i] != null && frozenWhy(e.uploaded[i], ctx, e)) ?? null;
  const slots = SLOTS.map((slot, i) => {
    const id = lineup[i], up = row?.atUpload?.[i] ?? null, holder = holderAt(i);
    return {
      slot, dk_id: id, name: id == null ? null : nameOf(id, ctx, entries),
      at_upload_id: up, at_upload_name: up == null ? null : nameOf(up, ctx, entries),
      changed: row?.atUpload ? id !== up : id != null,
      frozen: holder != null, frozen_id: holder?.uploaded[i] ?? null, why: holder ? frozenWhy(holder.uploaded[i], ctx, holder) : null,
    };
  });
  const present = [...new Set([...lineup, ...entries.flatMap((e) => e.uploaded)].filter((id) => id != null))];
  const alert = outAlert(lineup, ctx), confirmed = row?.confirmedOut ?? [];
  const flags = [...new Set([
    ...blocks,
    ...(row?.atUploadWhy ? [row.atUploadWhy] : []),
    ...(alert ? alert.men.map((m) => m.text) : []),
    ...present.filter((id) => ctx.departedById.has(id)).map((id) => `${nameOf(id, ctx, entries)} is no longer on the newest pull.`),
    ...present.filter((id) => ctx.untimed.has(id)).map((id) => `${nameOf(id, ctx, entries)}'s tip time is unreadable: he is held in his slot, and cannot be added elsewhere.`),
    ...entries.flatMap((e) => frozenProblems(e, lineup, ctx, confirmed)),
  ])];
  const men = lineup.map((id) => (id == null ? null : ctx.man(id)));
  const rows = entries.map((e) => {
    const { status, changedSlots, reasons } = entryStatus(e, lineup, ctx, confirmed);
    return { entryId: e.entryId, contestName: e.contestName, status, changed: changedSlots.length > 0, changedSlots, amber: status === "held", reasons };
  });
  return { spot, mode: row?.mode ?? modeFromName(spot), proven: row?.proven ?? null, notes: row?.notes ?? [], duplicate: row?.duplicate ?? null, atUploadWhy: row?.atUploadWhy ?? null, confirmedOut: confirmed, alert, unusable: Object.hasOwn(state.unusable, spot) ? state.unusable[spot] : [], slots, flags, amber: blocks.length > 0 || alert != null || rows.some((r) => r.amber), salary: sumOf(men, "salary"), projection: sumOf(men, "projection"), entries: rows };
}

/** The entries-to-spots table for the screen: one row per entry in file order, { entryId, contestName, contestId, entryFee, spot,
 *  proposedSpot, reservation, flags }. flags name men off the slate, unreadable slots and men gone from the newest pull. */
export function entryRows(state, ctx) {
  return state.entries.map((e) => ({
    entryId: e.entryId, contestName: e.contestName, contestId: e.contestId, entryFee: e.entryFee,
    spot: state.entrySpots[e.entryId] ?? null,
    proposedSpot: state.proposals[e.entryId] ?? null,
    reservation: e.uploaded.every((id) => id == null),
    flags: [...entryBlocks(e, ctx), ...[...new Set(e.uploaded)].filter((id) => id != null && ctx.departedById.has(id)).map((id) => `${nameOf(id, ctx, [e])} is no longer on the newest pull.`)],
  }));
}
