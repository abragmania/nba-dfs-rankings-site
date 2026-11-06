// The blunt actions on spots (entries late swap): editing a spot once covers all its entries. Pure: no DOM, no fs, no clock. Each
// returns { state, outcomes, error }: a new state in which only map 2 and the unusable marks can differ, and one outcome per spot in
// scope, { spot, entryIds, status: "changed" | "unchanged" | "flagged" | "confirm", reason, amber, moves, proven, notes, duplicate, alert }. amber means no legal
// fill came back, a lineup assigned to the spot disagrees with a started man (his exact slot always wins), or the spot is blocked: its
// entries disagree on a started man, or one holds a man or slot that cannot be read. A flagged spot is left as it was. error (a sentence) means the action could not start and nothing changed.
import { SLOTS } from "../board/slots.js";
import { leftOut } from "../board/lateswap.js";
import { optimize } from "../lineup/optimize.js";
import { readExposure, countLimits } from "../lineup/exposure.js";
import { lineupOf, spotEntries, spotNames, sameLineup, cleanName, unusableIn, modeFromName } from "./maps.js";
import { contextFor, nameOf, frozenWhy, notAddableWhy, holdsMen, spotBlocks, spotPins, lineupProblems, partLineupProblems, frozenProblems, movesBetween, outAlert, isBoardOut } from "./entry-state.js";

const refused = (state, error) => ({ state, outcomes: [], error });
const idsOf = (state, spot) => spotEntries(state, spot).map((e) => e.entryId);
const flagged = (state, spot, reason, { amber = false, proven = null, notes = [] } = {}) => ({ spot, entryIds: idsOf(state, spot), status: "flagged", reason, amber, moves: [], proven, notes, duplicate: null, alert: null });

/** An outcome for a spot going from lineup `before` to `after`: changed, or unchanged with `reason`. alert names any man in `after` who is Out or gone. */
function moved(state, spot, before, after, ctx, { reason = null, proven = null, notes = [], duplicate = null } = {}) {
  const status = sameLineup(before, after) ? "unchanged" : "changed";
  return { spot, entryIds: idsOf(state, spot), status, reason: status === "unchanged" ? reason : null, amber: false, moves: movesBetween(before, after, ctx, spotEntries(state, spot)), proven, notes, duplicate, alert: outAlert(after, ctx) };
}

/** The ask-first outcome: nothing applied, and the same call with confirmOut: true goes ahead. */
const confirmFirst = (state, spot, alert) => ({ ...flagged(state, spot, alert.text, { amber: true }), status: "confirm", alert });

/** The alert for men in `lineup` not yet gone ahead for on this spot and not in `already`, or null. */
function askFor(state, spot, lineup, ctx, already = []) {
  const yes = Object.hasOwn(state.spots, spot) ? state.spots[spot].confirmedOut : [];
  return outAlert(lineup.filter((id) => !yes.includes(id) && !already.includes(id)), ctx);
}

/** A spot's row in map 2 with a new lineup; a spot with no row gets one, with nothing recorded at upload. notes and duplicate are what
 *  this change leaves on the spot, so the next change to it clears them. Go-aheads stay for men still in the lineup; addConfirmed adds to
 *  them. When the lineup really changes, another spot's Duplicate mark naming this spot no longer holds, so it clears. */
function withLineup(state, spot, lineup, proven, { notes = [], duplicate = null, addConfirmed = [] } = {}) {
  const row = Object.hasOwn(state.spots, spot) ? state.spots[spot] : { atUpload: null, atUploadWhy: null, mode: modeFromName(spot), confirmedOut: [] };
  const confirmedOut = [...new Set([...row.confirmedOut.filter((id) => lineup.includes(id)), ...addConfirmed])];
  const spots = { ...state.spots };
  if (!sameLineup(row.lineup ?? [], lineup)) for (const [s, r] of Object.entries(spots)) if (s !== spot && r.duplicate?.matchedSpot === spot) spots[s] = { ...r, duplicate: null };
  spots[spot] = { ...row, lineup, proven, notes, duplicate, confirmedOut };
  return { ...state, spots };
}

/** Why this lineup cannot go on this spot now, as a sentence, or null: the spot is blocked, an entry's started man would move, or the
 *  lineup is illegal. A lineup with an empty slot (a part-filled upload going back) skips only the legality check. */
function spotRefusal(state, spot, lineup, ctx, confirmed = []) {
  const blocks = spotBlocks(state, spot, ctx);
  if (blocks.length) return blocks.join(" ");
  const frozen = spotEntries(state, spot).filter(holdsMen).flatMap((e) => frozenProblems(e, lineup, ctx, confirmed));
  const legal = lineup.some((id) => id == null) ? [] : lineupProblems(lineup, ctx);
  return frozen.length || legal.length ? [...frozen, ...legal].join(" ") : null;
}

const holds = (state, spot, id) => lineupOf(state, spot).includes(id) || spotEntries(state, spot).some((e) => e.uploaded.includes(id));

/** The spots a scope names: { names } or { error }. scope = { type: "one", spot } | { type: "chosen", spots } | { type: "holding" },
 *  the last meaning every spot holding `man`. */
function readScope(state, scope, man) {
  const all = spotNames(state);
  if (scope?.type === "holding") {
    if (man == null) return { error: "Choosing every spot holding a man needs the man." };
    const names = all.filter((s) => holds(state, s, man));
    return names.length ? { names } : { error: `No spot holds ${man}, so nothing was done.` };
  }
  const wanted = scope?.type === "one" ? [scope.spot] : scope?.type === "chosen" ? scope.spots : null;
  if (!Array.isArray(wanted) || !wanted.length) return { error: 'A scope is { type: "one", spot }, { type: "chosen", spots } or { type: "holding" }.' };
  const unknown = wanted.filter((s) => !all.includes(s));
  if (unknown.length) return { error: `No such spot: ${unknown.join(", ")}.` };
  return { names: all.filter((s) => wanted.includes(s)) };
}

/** The limits across the set: { maxOf: Map dk_id -> most entries } or { error }. Percent of the assigned entries; only a Max binds
 *  here; optimize() refuses limits alongside pins, so the count is kept here, spot by spot. */
function readLimits(state, exposure, ctx) {
  const read = readExposure(exposure);
  if (read.error) return { error: read.error };
  const off = Object.keys(read.exposure).filter((id) => !ctx.man(id));
  if (off.length) return { error: `A Max % is set on ${off.join(", ")}, not on this slate.` };
  const assigned = Object.values(state.entrySpots).filter((s) => s != null).length;
  const maxOf = new Map();
  for (const [id, l] of countLimits(read.exposure, assigned)) {
    if (l.minC > 0) return { error: "Only a Max % applies across a set of entries; a Min % does not." };
    maxOf.set(id, l.maxC);
  }
  return { maxOf };
}

/** The men this spot's entries would carry past their Max: a Set of dk_ids. Every other spot counts with its lineup now, except a spot that
 *  will re-fill later in this action (pending): only its frozen men are sure, and the rest of its lineup is about to be decided. */
function atLimit(maxOf, state, spot, pending, ctx) {
  const out = new Set(), here = spotEntries(state, spot).length;
  for (const [id, most] of maxOf) {
    const counts = (s) => (pending.includes(s) ? id in spotPins(state, s, ctx) : lineupOf(state, s).includes(id));
    const elsewhere = spotNames(state).filter((s) => s !== spot && counts(s)).reduce((t, s) => t + spotEntries(state, s).length, 0);
    if (elsewhere + here > most) out.add(id);
  }
  return out;
}

/** Each man past his Max once the action is done: [{ dk_id, name, entries, most, spots }]. Frozen men and locked backups can put him there. */
function overMax(maxOf, state, ctx) {
  const out = [];
  for (const [id, most] of maxOf) {
    const spots = spotNames(state).filter((s) => lineupOf(state, s).includes(id));
    const entries = spots.reduce((t, s) => t + spotEntries(state, s).length, 0);
    if (entries > most) out.push({ dk_id: id, name: nameOf(id, ctx), entries, most, spots });
  }
  return out;
}

/** Calls optimize() for this spot, best first; { lineups: [{ ids, proven, arranged }], note } or { why, proven }. A throw from its last guards is a flag. */
function runFill(args) {
  let r;
  try { r = optimize(args); } catch (e) { return { why: e.message, proven: null }; }
  if (r.error) return { why: r.error, proven: null };
  if (!r.lineups.length) return { why: r.note ?? "No legal lineup came back.", proven: r.note?.startsWith("Search stopped") ? false : null };
  return { lineups: r.lineups.map((l) => ({ ids: l.slots.map((p) => p.dk_id), proven: l.proven, arranged: l.late_swap })), note: r.note };
}

const menKey = (ids) => [...ids].sort().join("|");
const MAX_LOOK = 20; // the most lineups optimize() builds in one run

/**
 * This spot's fill, not repeating a lineup another spot took in this action (Adam, 11-04). taken: men key -> spot name, kept by the caller
 * in spot order. Returns { lineup, proven, arranged, duplicate } or { why, proven }. duplicate is null, or { altered, text, matchedSpot, reason }:
 * altered true when the next-best legal lineup was taken instead, false when no different one came back and the duplicate stands.
 * Same men in other slots count as the same lineup. Frozen men hold in every lineup of the run, because the pins are the same.
 */
function fillAvoiding(args, taken) {
  const first = runFill({ ...args, settings: { ...args.settings, count: 1 } });
  if (!first.lineups) return first;
  const best = first.lineups[0], matchedSpot = taken.get(menKey(best.ids));
  if (matchedSpot == null) return { lineup: best.ids, proven: best.proven, arranged: best.arranged, duplicate: null };
  const more = runFill({ ...args, settings: { ...args.settings, count: Math.min(MAX_LOOK, taken.size + 1) } });
  const other = more.lineups?.find((l) => !taken.has(menKey(l.ids)));
  if (other) return { lineup: other.ids, proven: other.proven, arranged: other.arranged, duplicate: { altered: true, text: "Duplicate; altered", matchedSpot, reason: null } };
  const reason = more.note ?? more.why ?? (taken.size >= MAX_LOOK ? `The best ${MAX_LOOK} lineups all match other spots.` : "No different legal lineup exists.");
  return { lineup: best.ids, proven: best.proven, arranged: best.arranged, duplicate: { altered: false, text: "Duplicate; no different legal lineup", matchedSpot, reason } };
}

/**
 * Re-fills one spot: frozen men stay in the slots their entries hold them in, every other slot reopens on the newest figures, without
 * anyone in `out`. lock: men who must be in it, in any open slot. Returns { outcome, state? }.
 */
function refill(state, spot, ctx, { out, lock, mode, settings, overLimit, taken }) {
  const pinned = spotPins(state, spot, ctx), before = lineupOf(state, spot), entries = spotEntries(state, spot);
  // A pin with no projection still counts his salary, team, game and slot. The stand-in 0 goes only to this search, where every lineup
  // carries it alike, so it cannot change the pick; it is never stored, and spotView's total for him is missing, never zero (RULES R1).
  // A backup locked in on Adam's go-ahead is the same: he is in every lineup of the run.
  const scoreless = [...Object.keys(pinned), ...lock].filter((id) => !Number.isFinite(ctx.man(id)?.projection));
  const searchMen = [...ctx.players.filter((p) => !scoreless.includes(p.dk_id)), ...scoreless.map((id) => ({ ...ctx.man(id), projection: 0 }))];
  const stays = new Set([...Object.keys(pinned), ...lock]);
  const notAddable = new Set([...ctx.started, ...ctx.untimed]);
  const excluded = new Set(leftOut({ players: ctx.players, started: notAddable, pinned }).excluded);
  for (const id of [...out, ...overLimit, ...ctx.players.filter(isBoardOut).map((p) => p.dk_id)]) excluded.add(id);
  const excludedList = [...excluded].filter((id) => typeof id === "string" && ctx.byId.has(id) && !stays.has(id));
  const runMode = mode ?? (Object.hasOwn(state.spots, spot) ? state.spots[spot].mode : modeFromName(spot));
  const fill = fillAvoiding({ players: searchMen, mode: runMode, settings: { ...settings, pinned }, locked: lock, excluded: excludedList, refMs: ctx.refMs }, taken);
  if (!fill.lineup) return { outcome: flagged(state, spot, `No legal fill: ${fill.why}`, { amber: true, proven: fill.proven }) };
  const bad = [...entries.filter(holdsMen).flatMap((e) => frozenProblems(e, fill.lineup, ctx, lock)), ...lineupProblems(fill.lineup, ctx)];
  if (bad.length) return { outcome: flagged(state, spot, `No legal fill: ${bad.join(" ")}`, { amber: true, proven: fill.proven }) };
  const notes = [];
  if (fill.proven === false) notes.push("The search stopped early, so this lineup is legal but not proven best.");
  if (fill.arranged === false) notes.push("A man's tip time is unreadable, so the open men are in plain slot order, not late-swap order.");
  const leftUntimed = [...ctx.untimed].filter((id) => !stays.has(id));
  if (leftUntimed.length) notes.push(`Left out of the fill, tip time unreadable: ${leftUntimed.map((id) => nameOf(id, ctx)).join(", ")}.`);
  const over = [...overLimit].filter((id) => fill.lineup.includes(id));
  if (over.length) notes.push(`Held in this spot past his Max %: ${over.map((id) => nameOf(id, ctx)).join(", ")}.`);
  if (scoreless.length) notes.push(`No projection for ${scoreless.map((id) => nameOf(id, ctx, entries)).join(", ")}: he counts for salary, team and game, is left out of the score, and the spot's total is missing.`);
  const said = fill.duplicate ? [fill.duplicate.altered ? `Duplicate; altered: the best fill matched ${fill.duplicate.matchedSpot}, so this is the next-best legal lineup.` : `Duplicate kept: this matches ${fill.duplicate.matchedSpot}. ${fill.duplicate.reason}`] : [];
  if (!taken.has(menKey(fill.lineup))) taken.set(menKey(fill.lineup), spot);
  return { outcome: moved(state, spot, before, fill.lineup, ctx, { reason: "The best fill is the lineup it already had.", proven: fill.proven, notes: [...notes, ...said], duplicate: fill.duplicate }), state: withLineup(state, spot, fill.lineup, fill.proven, { notes, duplicate: fill.duplicate, addConfirmed: lock.filter((id) => outAlert([id], ctx)) }) };
}

/** Writes each man past his Max onto the outcomes of the spots holding him, and onto their rows unless the spot was flagged. */
function noteOverMax(state, outcomes, over) {
  let s = state;
  for (const o of over) {
    const text = `${o.name} is in ${o.entries} entries, past his Max of ${o.most}.`;
    for (const out of outcomes) {
      if (!o.spots.includes(out.spot)) continue;
      out.notes = [...out.notes, text];
      if (out.status !== "flagged" && out.status !== "confirm" && Object.hasOwn(s.spots, out.spot)) s = { ...s, spots: { ...s.spots, [out.spot]: { ...s.spots[out.spot], notes: [...s.spots[out.spot].notes, text] } } };
    }
  }
  return s;
}

/** The shared path of actions a and b; y is the backup or null. { state, outcomes, overMax, error }. */
function removeAction(state, { man: x, backup: y = null, scope, slate, nowMs, mode = null, settings: given = null, exposure = null, excluded: barred = null, confirmOut = false }) {
  if (typeof x !== "string" || !x) return refused(state, "Say which man comes out, by DraftKings id.");
  if (y != null && y === x) return refused(state, "The man coming out and his backup are the same man.");
  const settings = given ?? {};
  if (typeof settings !== "object" || Array.isArray(settings)) return refused(state, "Settings must be an object.");
  if ("exposure" in settings) return refused(state, "A Max % across the set goes in exposure, not in the optimizer settings.");
  const excluded = barred ?? [];
  if (!Array.isArray(excluded) || !excluded.every((id) => typeof id === "string")) return refused(state, "Excluded men must be a list of DraftKings ids.");
  const { ctx, error } = contextFor(state, slate, nowMs);
  if (error) return refused(state, error);
  const sc = readScope(state, scope, x);
  if (sc.error) return refused(state, sc.error);
  const limits = readLimits(state, exposure, ctx);
  if (limits.error) return refused(state, limits.error);
  const backup = { x, y, yWhy: y == null ? null : notAddableWhy(y, ctx), yAlert: y == null || confirmOut ? null : outAlert([y], ctx) };
  let s = state;
  const outcomes = [], taken = new Map(); // spots go in map order, so the same action repeats exactly
  for (const [k, spot] of sc.names.entries()) {
    const pending = sc.names.slice(k + 1).filter((later) => !removeRefusal(s, later, ctx, backup)); // a spot that will not re-fill keeps its lineup, and counts whole
    const r = removeRefusal(s, spot, ctx, backup) ?? refill(s, spot, ctx, { out: new Set([...unusableIn(s, spot), ...excluded, x]), lock: y == null ? [] : [y], mode, settings, overLimit: atLimit(limits.maxOf, s, spot, pending, ctx), taken });
    outcomes.push(r.outcome);
    if (r.state) s = r.state;
    if (r.outcome.status === "changed") s = { ...s, unusable: { ...s.unusable, [spot]: [...new Set([...unusableIn(s, spot), x])] } }; // only the spots this action changed
  }
  const over = overMax(limits.maxOf, s, ctx);
  return { state: noteOverMax(s, outcomes, over), outcomes, overMax: over, error: null };
}

/** Why this spot will not re-fill in actions a and b, as { outcome }, or null when it will. */
function removeRefusal(state, spot, ctx, { x, y, yWhy, yAlert }) {
  const blocks = spotBlocks(state, spot, ctx);
  if (blocks.length) return { outcome: flagged(state, spot, blocks.join(" "), { amber: true }) };
  const stuck = spotEntries(state, spot).find((e) => e.uploaded.includes(x) && frozenWhy(x, ctx, e));
  if (stuck) return { outcome: flagged(state, spot, `${nameOf(x, ctx, [stuck])} cannot come out of ${spot}: ${frozenWhy(x, ctx, stuck)}.`) };
  if (y == null && !holds(state, spot, x)) {
    const same = lineupOf(state, spot);
    return { outcome: moved(state, spot, same, same, ctx, { reason: `${spot} does not hold ${nameOf(x, ctx)}.` }) };
  }
  if (y != null && unusableIn(state, spot).includes(y)) return { outcome: flagged(state, spot, `${nameOf(y, ctx)} was taken out of ${spot} earlier in this session, so he cannot be its backup.`) };
  if (yWhy) return { outcome: flagged(state, spot, yWhy) };
  if (yAlert) return { outcome: confirmFirst(state, spot, yAlert) };
  return null;
}

/**
 * a. Remove X and re-optimize. args: { man, scope, slate, nowMs, mode?, settings?, exposure?, excluded? }. mode defaults to the spot row's
 * mode. settings go to optimize() as they are (minSalary, teamMax, maxTotalOwn, lowOwned, maxSteps). exposure is { dk_id: { max } } in percent
 * of the assigned entries, default none; a man past his Max when it is done is in the result's overMax and noted on his spots. excluded is
 * the men already excluded on the board. X stays unusable for later re-fills of each spot this changed, and only those: a removal never
 * carries to a spot outside the scope, and { type: "holding" } is the explicit choice of every spot holding him. An empty scope is refused.
 */
export function removeAndReoptimize(state, args) {
  const { backup: _ignored, ...rest } = args ?? {};
  return removeAction(state, rest);
}

/** b. Remove X, lock backup Y into every spot in scope, re-optimize the rest. Same args as a, plus backup and confirmOut. A spot in a chosen
 *  scope that does not hold X still takes Y. A backup who is Out or gone and has not started asks first: status "confirm", and the same call
 *  with confirmOut: true goes ahead. */
export function removeAndLockBackup(state, args) {
  if (typeof args?.backup !== "string" || !args.backup) return refused(state, "Say who the backup is, by DraftKings id.");
  return removeAction(state, args);
}

/** True when every entry with men has inId in slot i in the file: going back there is never an addition. */
const isBackInSlot = (entries, i, inId) => entries.length > 0 && entries.every((e) => e.uploaded[i] === inId);

/** Why this one-slot swap cannot be made, as a sentence, or null. i: slot index; inId: the man going in. */
function swapProblem(state, spot, i, inId, ctx) {
  const entries = spotEntries(state, spot).filter(holdsMen), lineup = lineupOf(state, spot);
  if (!isBackInSlot(entries, i, inId)) {
    const held = entries.find((e) => e.uploaded[i] != null && frozenWhy(e.uploaded[i], ctx, e));
    if (held) return `${nameOf(held.uploaded[i], ctx, [held])} stays at ${SLOTS[i]}: ${frozenWhy(held.uploaded[i], ctx, held)}.`;
    const cannot = notAddableWhy(inId, ctx);
    if (cannot) return cannot;
  }
  const at = lineup.indexOf(inId);
  if (at >= 0) return `${nameOf(inId, ctx, entries)} is already in ${spot} at ${SLOTS[at]}.`;
  const legal = partLineupProblems(lineup.map((id, k) => (k === i ? inId : id)), ctx); // a part-filled spot is completed one man at a time
  return legal.length ? legal.join(" ") : null;
}

/** c. Hand swap: args { spot, slot, inId, confirmOut?, slate, nowMs }; whoever is in that slot of that spot comes out, inId goes in. A man
 *  Out or gone who has not started asks first: status "confirm", and the same call with confirmOut: true goes ahead. */
export function handSwap(state, args) {
  const { spot, slot, inId, confirmOut = false, slate, nowMs } = args ?? {};
  const { ctx, error } = contextFor(state, slate, nowMs);
  if (error) return refused(state, error);
  const i = SLOTS.indexOf(slot);
  if (i < 0) return refused(state, `${JSON.stringify(slot ?? null)} is not a roster slot.`);
  if (typeof inId !== "string" || !inId) return refused(state, "Say which man goes in, by DraftKings id.");
  const sc = readScope(state, { type: "one", spot });
  if (sc.error) return refused(state, sc.error);
  const before = lineupOf(state, spot);
  if (before[i] === inId) return { state, outcomes: [moved(state, spot, before, before, ctx, { reason: `${nameOf(inId, ctx)} is already at ${slot}.` })], error: null };
  const blocks = spotBlocks(state, spot, ctx);
  if (blocks.length) return { state, outcomes: [flagged(state, spot, blocks.join(" "), { amber: true })], error: null };
  const problem = swapProblem(state, spot, i, inId, ctx);
  if (problem) return { state, outcomes: [flagged(state, spot, problem)], error: null };
  const ask = isBackInSlot(spotEntries(state, spot).filter(holdsMen), i, inId) ? null : askFor(state, spot, [inId], ctx);
  if (ask && !confirmOut) return { state, outcomes: [confirmFirst(state, spot, ask)], error: null };
  const after = before.map((id, k) => (k === i ? inId : id));
  const notes = unusableIn(state, spot).includes(inId) ? [`${nameOf(inId, ctx)} was taken out earlier in this session; the next re-optimize takes him out of ${spot} again.`] : [];
  return { state: withLineup(state, spot, after, null, { notes, addConfirmed: ask ? [inId] : [] }), outcomes: [moved(state, spot, before, after, ctx, { notes })], error: null };
}

/** d. Reset spots to what they held at upload: args { scope, man?, confirmOut?, slate, nowMs } (man for a "holding" scope). X stays unusable.
 *  Flagged amber and left as it was, the way assignLineup does it: a spot that held nothing at upload, one that is blocked, or one where
 *  going back would move a started man in any of its entries. A man coming back who is now Out or gone asks first, status "confirm". A
 *  spot already as uploaded keeps its proven, notes and duplicate. */
export function resetSpots(state, args) {
  const { scope, man = null, confirmOut = false, slate, nowMs } = args ?? {};
  const { ctx, error } = contextFor(state, slate, nowMs);
  if (error) return refused(state, error);
  const sc = readScope(state, scope, man);
  if (sc.error) return refused(state, sc.error);
  let s = state;
  const outcomes = sc.names.map((spot) => {
    const held = Object.hasOwn(s.spots, spot) ? s.spots[spot].atUpload : null;
    if (!held) return flagged(s, spot, (Object.hasOwn(s.spots, spot) ? s.spots[spot].atUploadWhy : null) ?? `${spot} held nothing at upload.`, { amber: true });
    const before = lineupOf(s, spot);
    if (sameLineup(before, held)) return moved(s, spot, before, held, ctx, { reason: "It is already as uploaded.", proven: s.spots[spot].proven });
    const ask = askFor(s, spot, held, ctx, before);
    const refusal = spotRefusal(s, spot, held, ctx, ask ? ask.men.map((m) => m.dk_id) : []);
    if (refusal) return flagged(s, spot, refusal, { amber: true });
    if (ask && !confirmOut) return confirmFirst(s, spot, ask);
    s = withLineup(s, spot, [...held], null, { addConfirmed: ask ? ask.men.map((m) => m.dk_id) : [] });
    return moved(s, spot, before, held, ctx);
  });
  return { state: s, outcomes, error: null };
}

/**
 * Map 2 only: a build or saved lineup assigned to a spot. args { spot, lineup (8 dk_ids in SLOTS order), proven?, confirmOut?, slate, nowMs }.
 * Every entry in the spot is checked against its own uploaded lineup first: frozen men in the exact same slots, no started man added. A
 * spot with no row yet gets one. No entry's spot changes. { state, outcomes, error } like the actions; a failure is a flagged outcome. A
 * lineup holding a man who is Out or gone from the board and has not started is not applied: the outcome has status "confirm" and an
 * alert naming him, and the same call with confirmOut: true goes ahead, its outcome still carrying the alert. A man already gone ahead for
 * on this spot does not ask again. Questionable does not count.
 */
export function assignLineup(state, args) {
  const { spot: rawSpot, lineup, proven = null, confirmOut = false, slate, nowMs } = args ?? {};
  const { ctx, error } = contextFor(state, slate, nowMs);
  if (error) return refused(state, error);
  const spot = cleanName(rawSpot);
  if (spot == null) return refused(state, `${JSON.stringify(rawSpot ?? null)} is not a usable spot name.`);
  if (!Array.isArray(lineup) || lineup.length !== SLOTS.length || !lineup.every((id) => typeof id === "string" && id)) return refused(state, `A lineup is ${SLOTS.length} DraftKings ids in slot order.`);
  if (![true, false, null].includes(proven)) return refused(state, "Proven must be true, false or null.");
  const before = lineupOf(state, spot);
  const ask = askFor(state, spot, lineup, ctx);
  const named = ask ? ask.men.map((m) => m.dk_id) : [];
  const confirmed = [...named, ...(Object.hasOwn(state.spots, spot) ? state.spots[spot].confirmedOut : [])];
  const refusal = spotRefusal(state, spot, lineup, ctx, confirmed);
  if (refusal) return { state, outcomes: [flagged(state, spot, refusal, { amber: true })], error: null };
  if (ask && !confirmOut) return { state, outcomes: [confirmFirst(state, spot, ask)], error: null };
  return { state: withLineup(state, spot, [...lineup], proven, { addConfirmed: named }), outcomes: [moved(state, spot, before, lineup, ctx, { reason: "The spot already holds this lineup.", proven })], error: null };
}

/** The pins a build for this spot must carry: { pinned: { dk_id: slot } } or { error }. */
export function pinsForSpot(state, args) {
  const { spot, slate, nowMs } = args ?? {};
  const { ctx, error } = contextFor(state, slate, nowMs);
  if (error) return { error };
  if (!spotNames(state).includes(spot)) return { error: `No such spot: ${JSON.stringify(spot ?? null)}.` };
  const blocks = spotBlocks(state, spot, ctx);
  if (blocks.length) return { error: blocks.join(" ") };
  return { pinned: spotPins(state, spot, ctx) };
}
