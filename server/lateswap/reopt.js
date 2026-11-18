// Re-optimizing by lineup (entries late swap, Adam 11-18): the best few fills for one spot's lineup around its started men, and the pick of
// one of them, which replaces that lineup in every spot holding it. Pure: no DOM, no fs, no clock.
import { SLOTS } from "../board/slots.js";
import { lineupOf, spotEntries, spotNames, sameLineup, unusableIn } from "./maps.js";
import { contextFor, nameOf, spotBlocks, movesBetween, frozenWhy, frozenProblems, lineupProblems, holdsMen } from "./entry-state.js";
import { refused, fillArgs, runFill, menKey, readGames, assignLineup } from "./actions.js";

export const MAX_OPTIONS = 10;
const isIds = (a) => Array.isArray(a) && a.every((id) => typeof id === "string");

/** A lineup's totals from the newest pull: { proj, salary, own }, each null when any man's figure is missing (never a partial sum or zero). */
export function totalsOf(lineup, ctx) {
  const men = lineup.map((id) => (id == null ? null : ctx.man(id)));
  const sum = (k) => (men.length === SLOTS.length && men.every((p) => Number.isFinite(p?.[k])) ? Math.round(men.reduce((t, p) => t + p[k], 0) * 100) / 100 : null);
  return { proj: sum("projection"), salary: sum("salary"), own: sum("proj_own") };
}

/** The other spots holding exactly this spot's lineup (same 8 men, same slots): Adam thinks of it as one lineup. A blank lineup is shared by none. */
export function sharingSpots(state, spot) {
  const mine = lineupOf(state, spot);
  if (mine.some((id) => id == null)) return [];
  return spotNames(state).filter((s) => s !== spot && sameLineup(lineupOf(state, s), mine));
}

/**
 * Options for one spot's lineup: the best `count` (1 to 10, default 5) distinct fills, frozen men kept in their exact slots and every open
 * slot re-filled on the newest projections, any slot a man's positions allow. args: { spot, count?, remove?, excluded?, excludedGames?, mode?,
 * settings?, settingsByMode?, slate, nowMs }. remove: men to leave out (a frozen one stays, and the notes say so). Nothing is saved.
 * Returns { spot, current: { lineup, proj, salary, own }, options: [{ lineup, proj, salary, own, proven, moves, current, sameSlots }],
 * sharedWith, notes, error }; current is true when an option holds the same men as the lineup now.
 */
export function spotOptions(state, args) {
  const { spot, count = 5, remove = [], excluded = [], excludedGames = null, mode = null, settings = null, settingsByMode = null, slate, nowMs } = args ?? {};
  const fail = (error) => ({ spot: spot ?? null, current: null, options: [], sharedWith: [], notes: [], error });
  const { ctx, error } = contextFor(state, slate, nowMs);
  if (error) return fail(error);
  if (!spotNames(state).includes(spot)) return fail(`No such spot: ${JSON.stringify(spot ?? null)}.`);
  if (!Number.isInteger(count) || count < 1 || count > MAX_OPTIONS) return fail(`Ask for 1 to ${MAX_OPTIONS} options.`);
  if (!isIds(remove) || !isIds(excluded)) return fail("Men to remove or exclude must be lists of DraftKings ids.");
  const gm = readGames(excludedGames, ctx);
  if (gm.error) return fail(gm.error);
  const blocks = spotBlocks(state, spot, ctx);
  if (blocks.length) return fail(blocks.join(" "));
  const before = lineupOf(state, spot), entries = spotEntries(state, spot);
  const f = fillArgs(state, spot, ctx, { out: new Set([...unusableIn(state, spot), ...excluded, ...remove]), mode, settings, settingsByMode, games: gm.games });
  const notes = [...gm.notes];
  const stuck = remove.filter((id) => id in f.pinned);
  if (stuck.length) notes.push(`${stuck.map((id) => `${nameOf(id, ctx, entries)} stays in ${spot}: ${frozenWhy(id, ctx, entries.find((e) => e.uploaded.includes(id)))}.`).join(" ")}`);
  const r = runFill({ ...f.args, settings: { ...f.args.settings, count } });
  if (!r.lineups) return { ...fail(`No legal lineup for ${spot}: ${r.why}`), notes };
  if (r.note) notes.push(r.note);
  const leftUntimed = [...ctx.untimed].filter((id) => !f.stays.has(id));
  if (leftUntimed.length) notes.push(`Left out, tip time unreadable: ${leftUntimed.map((id) => nameOf(id, ctx)).join(", ")}.`);
  if (f.scoreless.length) notes.push(`No projection for ${f.scoreless.map((id) => nameOf(id, ctx, entries)).join(", ")}: he counts for salary, team and game, and the totals are missing.`);
  // The engine's last guard, as every re-fill has it: a fill that would move a started man or is illegal is never offered, and is counted.
  const good = r.lineups.filter((l) => !entries.filter(holdsMen).some((e) => frozenProblems(e, l.ids, ctx).length) && !lineupProblems(l.ids, ctx).length);
  if (good.length < r.lineups.length) notes.push(`${r.lineups.length - good.length} of the ${r.lineups.length} fills found would move a started man or break a rule, so they are not offered.`);
  if (good.length < count) notes.push(`Only ${good.length} different legal ${good.length === 1 ? "lineup" : "lineups"} came back of the ${count} asked for.`);
  const nowKey = menKey(before.filter((id) => id != null));
  const options = good.map((l) => ({ lineup: l.ids, ...totalsOf(l.ids, ctx), proven: l.proven, moves: movesBetween(before, l.ids, ctx, entries), current: menKey(l.ids) === nowKey, sameSlots: sameLineup(before, l.ids) }));
  if (options[0]?.current) notes.push("The best fill holds the men this lineup already has.");
  return { spot, current: { lineup: before, ...totalsOf(before, ctx) }, options, sharedWith: sharingSpots(state, spot), notes, error: null };
}

/**
 * The picked option replaces the lineup everywhere it is: this spot and every other spot holding exactly the same lineup now. args: { spot,
 * lineup (8 dk_ids in SLOTS order), proven?, remove?, confirmOut?, slate, nowMs }. Each spot goes through assignLineup's own checks (frozen
 * men exact, Out or gone asks first); a spot that refuses is flagged amber with its reason and the rest still change. When any spot asks
 * about an Out or gone man, nothing changes until the same call comes with confirmOut. remove: the men this pick took out, marked out of
 * each spot it changed that held them, as a removal is. { state, outcomes, error }.
 */
export function pickOption(state, args) {
  const { spot, lineup, proven = null, remove = [], confirmOut = false, slate, nowMs } = args ?? {};
  const { ctx, error } = contextFor(state, slate, nowMs);
  if (error) return refused(state, error);
  if (!spotNames(state).includes(spot)) return refused(state, `No such spot: ${JSON.stringify(spot ?? null)}.`);
  if (!isIds(lineup) || lineup.length !== SLOTS.length || lineup.some((id) => !id)) return refused(state, `A lineup is ${SLOTS.length} DraftKings ids in slot order.`);
  if (!isIds(remove)) return refused(state, "Men to remove must be a list of DraftKings ids.");
  const targets = [spot, ...sharingSpots(state, spot)];
  const one = (st, t, ok) => assignLineup(st, { spot: t, lineup, proven, confirmOut: ok, slate, nowMs });
  if (!confirmOut) {
    const asks = targets.map((t) => one(state, t, false).outcomes[0]).filter((o) => o?.status === "confirm");
    if (asks.length) return { state, outcomes: asks, error: null };
  }
  let s = state;
  const outcomes = [];
  for (const t of targets) {
    const before = lineupOf(s, t);
    const r = one(s, t, confirmOut);
    if (r.error) return refused(state, r.error);
    const o = r.outcomes[0];
    if (t !== spot) o.notes = [...o.notes, `It held the same lineup as ${spot}, so it took the same pick.`];
    s = r.state;
    const gone = o.status === "changed" ? remove.filter((id) => before.includes(id) && !lineup.includes(id)) : [];
    if (gone.length) s = { ...s, unusable: { ...s.unusable, [t]: [...new Set([...unusableIn(s, t), ...gone])] } };
    outcomes.push(o);
  }
  return { state: s, outcomes, error: null };
}
