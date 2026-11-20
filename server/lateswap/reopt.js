// Re-optimizing by lineup (entries late swap, Adam 11-18): the best few fills for one spot's lineup around its started men, and the pick of
// one of them, which replaces that lineup in every spot holding it; and re-optimizing chosen spots with no removal needed, with a Min % for
// men who must now be in many entries. Pure: no DOM, no fs; the only clock is the Min % planning's time guard, passed in (clock).
import { SLOTS } from "../board/slots.js";
import { lineupOf, spotEntries, spotNames, sameLineup, unusableIn, modeFromName } from "./maps.js";
import { contextFor, nameOf, spotBlocks, movesBetween, frozenWhy, frozenProblems, lineupProblems, holdsMen, notAddableWhy, outAlert, spotPins, isBoardOut } from "./entry-state.js";
import { refused, keptFill, runFill, menKey, readGames, readKeep, assignLineup, readScope, readLimits, atLimit, overMax, noteOverMax, maxNotes, refill, flagged, moved, confirmFirst, holds, fillScore } from "./actions.js";
import { planMinimum, PLAN_MAX_MS, minEntries } from "./min-pct.js";
import { excludedOk, excludedFor, spotModeOf } from "./board-excludes.js";

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

/** A spot's mode test for the Max % (a GPP rule): the run's mode, else the spot row's, else its name's. */
const gppTest = (state, mode) => (spot) => (mode ?? (Object.hasOwn(state.spots, spot) ? state.spots[spot].mode : modeFromName(spot))) === "GPP";

/** The Max % across the set for a pick of this spot's lineup (review F3 11-19): { limits, overLimit } or { error }. overLimit: the men a
 *  pick would carry past their Max, counting every spot taking the pick (this one and those sharing its lineup) as one (actions.js atLimit). */
function pickLimits(state, spot, targets, ctx, exposure, isGpp) {
  const limits = readLimits(state, exposure, ctx, isGpp);
  if (limits.error) return { error: limits.error };
  return { limits, overLimit: isGpp(spot) ? atLimit(limits.maxOf, state, spot, [], ctx, isGpp, null, targets.filter((t) => t !== spot)) : new Set() };
}

/**
 * Options for one spot's lineup: the best `count` (1 to 10, default 5) distinct fills, frozen men kept in their exact slots and every open
 * slot re-filled on the newest projections, any slot a man's positions allow. args: { spot, count?, remove?, excluded?, excludedGames?, mode?,
 * settings?, settingsByMode?, exposure?, slate, nowMs }. remove: men to leave out (a frozen one stays, and the notes say so). exposure: the
 * Max % across the set ({ dk_id: { max } }); a man the pick would carry past it is left out of every option and named. Nothing is saved.
 * Returns { spot, current: { lineup, proj, salary, own }, options: [{ lineup, proj, salary, own, proven, moves, current, sameSlots }],
 * sharedWith, notes, error }; current is true when an option holds the same men as the lineup now.
 */
export function spotOptions(state, args) {
  const { spot, count = 5, remove = [], keep = null, excluded = [], excludedGames = null, mode = null, settings = null, settingsByMode = null, exposure = null, slate, nowMs } = args ?? {};
  const fail = (error) => ({ spot: spot ?? null, current: null, options: [], sharedWith: [], notes: [], error });
  const { ctx, error } = contextFor(state, slate, nowMs);
  if (error) return fail(error);
  if (!spotNames(state).includes(spot)) return fail(`No such spot: ${JSON.stringify(spot ?? null)}.`);
  if (!Number.isInteger(count) || count < 1 || count > MAX_OPTIONS) return fail(`Ask for 1 to ${MAX_OPTIONS} options.`);
  if (!isIds(remove) || !excludedOk(excluded)) return fail("Men to remove or exclude must be lists of DraftKings ids.");
  const gm = readGames(excludedGames, ctx);
  if (gm.error) return fail(gm.error);
  const blocks = spotBlocks(state, spot, ctx);
  if (blocks.length) return fail(blocks.join(" "));
  const kept = readKeep(keep == null ? null : { [spot]: keep }, [spot], remove, ctx);
  if (kept.error) return fail(kept.error);
  const lim = pickLimits(state, spot, [spot, ...sharingSpots(state, spot)], ctx, exposure, gppTest(state, mode));
  if (lim.error) return fail(lim.error);
  const before = lineupOf(state, spot), entries = spotEntries(state, spot);
  const run = (a) => runFill({ ...a, settings: { ...a.settings, count } });
  const f = keptFill(state, spot, ctx, { out: new Set([...unusableIn(state, spot), ...excludedFor(excluded, spotModeOf(state, spot, mode)), ...remove]), keep: kept.of(spot), mode, settings, settingsByMode, games: gm.games, overLimit: lim.overLimit }, run, (x) => x.lineups?.[0]?.ids ?? null);
  const r = f.fill, notes = [...gm.notes, ...kept.notes, ...f.keptNotes];
  notes.push(...maxNotes([...lim.overLimit].filter((id) => !f.stays.has(id) && !f.notAddable.has(id) && ctx.byId.has(id) && !isBoardOut(ctx.byId.get(id))), lim.limits, ctx));
  const stuck = remove.filter((id) => frozenWhy(id, ctx) && before.includes(id));
  if (stuck.length) notes.push(`${stuck.map((id) => `${nameOf(id, ctx, entries)} stays in ${spot}: ${frozenWhy(id, ctx)}.`).join(" ")}`);
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
 * each spot it changed that held them, as a removal is. The sent lineup is checked again per spot against what Adam set (excluded,
 * excludedGames, keep { spot: [dk_id] }): a man of an excluded game or excluded on the board who is not frozen or kept there, or a kept man
 * left out, flags that spot amber with the reason; so does a man in a free slot who is on the take-out list (takeOut, the saved list) or was
 * taken out of that spot earlier. exposure: the Max % across the set; a man the pick carries past his Max is named in overMax and on his
 * spots' notes. notes: the board's notes (what it could not apply), put on every outcome. { state, outcomes, overMax, error }.
 */
export function pickOption(state, args) {
  const { spot, lineup, proven = null, remove = [], excluded = [], noIds = [], excludedGames = null, keep = null, takeOut = [], exposure = null, mode = null, notes: boardNotes = [], confirmOut = false, slate, nowMs } = args ?? {};
  const { ctx, error } = contextFor(state, slate, nowMs);
  if (error) return refused(state, error);
  if (!spotNames(state).includes(spot)) return refused(state, `No such spot: ${JSON.stringify(spot ?? null)}.`);
  if (!isIds(lineup) || lineup.length !== SLOTS.length || lineup.some((id) => !id)) return refused(state, `A lineup is ${SLOTS.length} DraftKings ids in slot order.`);
  if (!isIds(remove) || !excludedOk(excluded) || !isIds(noIds) || !isIds(takeOut)) return refused(state, "Men to remove or exclude must be lists of DraftKings ids.");
  const gm = readGames(excludedGames, ctx);
  if (gm.error) return refused(state, gm.error);
  const targets = [spot, ...sharingSpots(state, spot)], isGpp = gppTest(state, mode);
  const limits = readLimits(state, exposure, ctx, isGpp);
  if (limits.error) return refused(state, limits.error);
  const kept = readKeep(keep, targets, [], ctx);
  if (kept.error) return refused(state, kept.error);
  const problem = (t) => pickProblem(state, t, lineup, ctx, { excluded: excludedFor(excluded, spotModeOf(state, t, mode)), noIds, games: gm.games, keep: kept.of(t), takeOut });
  const one = (st, t, ok) => assignLineup(st, { spot: t, lineup, proven, confirmOut: ok, slate, nowMs });
  if (!confirmOut) {
    const asks = targets.filter((t) => !problem(t)).map((t) => one(state, t, false).outcomes[0]).filter((o) => o?.status === "confirm");
    if (asks.length) return { state, outcomes: asks, overMax: [], error: null };
  }
  let s = state;
  const outcomes = [];
  for (const t of targets) {
    const before = lineupOf(s, t), why = problem(t);
    if (why) { outcomes.push(flagged(s, t, why, { amber: true, notes: [...boardNotes] })); continue; }
    const r = one(s, t, confirmOut);
    if (r.error) return refused(state, r.error);
    const o = r.outcomes[0];
    o.notes = [...boardNotes, ...o.notes, ...(t !== spot ? [`It held the same lineup as ${spot}, so it took the same pick.`] : [])];
    s = r.state;
    const gone = o.status === "changed" ? remove.filter((id) => before.includes(id) && !lineup.includes(id)) : [];
    if (gone.length) s = { ...s, unusable: { ...s.unusable, [t]: [...new Set([...unusableIn(s, t), ...gone])] } };
    outcomes.push(o);
  }
  const over = overMax(limits.maxOf, s, ctx, isGpp);
  return { state: noteOverMax(s, outcomes, over), outcomes, overMax: over, error: null };
}

/** Why a picked lineup cannot go on spot t as Adam has set things, as a sentence, or null. A man frozen in t, or kept there, may stay. */
function pickProblem(state, t, lineup, ctx, { excluded, noIds = [], games, keep, takeOut = [] }) {
  const pins = spotPins(state, t, ctx), live = keep.filter((id) => !ctx.started.has(id) && !ctx.untimed.has(id));
  const free = lineup.filter((id) => !(id in pins) && !live.includes(id));
  const names = (ids) => ids.map((id) => nameOf(id, ctx)).join(", ");
  const why = [];
  const offGame = free.filter((id) => games.has(ctx.man(id)?.game));
  if (offGame.length) why.push(`${names(offGame)}: his game is excluded on this screen.`);
  const barred = free.filter((id) => excluded.includes(id) && !noIds.includes(id)); // a late swap NO man in a lineup he picks is used as he chose, no flag (Adam 6:16 and 6:19 PM 11-19)
  if (barred.length) why.push(`${names(barred)}: excluded on the board.`);
  const listed = free.filter((id) => takeOut.includes(id)); // review F2 11-19: the take-out list and a removal from this spot hold on a pick too
  if (listed.length) why.push(`${names(listed)}: on the take-out list.`);
  const outHere = free.filter((id) => !takeOut.includes(id) && unusableIn(state, t).includes(id));
  if (outHere.length) why.push(`${names(outHere)}: taken out of ${t} earlier.`);
  const missing = live.filter((id) => !lineup.includes(id));
  if (missing.length) why.push(`${names(missing)} ${missing.length === 1 ? "is" : "are"} locked in ${t} but not in this lineup.`);
  return why.length ? why.join(" ") : null;
}

/** The Min % asked for, read: { wants: [{ id, pct }] } or { error }. Refused in words: not a map of numbers 0 to 100, a man not on the slate,
 *  one also being taken out. A Min above his Max % is not refused: the plan is held to his Max, and the shortfall says so. */
function readAtLeast(atLeast, ctx, remove) {
  if (atLeast == null) return { wants: [] };
  if (typeof atLeast !== "object" || Array.isArray(atLeast)) return { error: "A Min % maps DraftKings ids to a percent, like { \"1234\": 40 }." };
  const wants = [];
  for (const [id, pct] of Object.entries(atLeast)) {
    if (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 100) return { error: `The Min % for ${id} must be a number from 0 to 100.` };
    if (!ctx.man(id)) return { error: `A Min % is set on ${id}, not on this slate.` };
    if (remove.includes(id)) return { error: `${nameOf(id, ctx)} is being taken out and given a Min % at once; pick one.` };
    if (pct > 0) wants.push({ id, pct });
  }
  return { wants };
}

/** Each Min % man's line once the run is done: { dk_id, name, entries, target, total, short, why }. why says, in words, what kept him short. */
function minLines(state, plan, names, ctx, outcomes) {
  const weight = (s) => spotEntries(state, s).length, total = names.reduce((t, s) => t + weight(s), 0);
  return plan.plans.map((p) => {
    const entries = names.filter((s) => lineupOf(state, s).includes(p.id)).reduce((t, s) => t + weight(s), 0);
    const short = Math.max(0, p.target - entries);
    const failed = names.filter((s) => (plan.forced.get(s) ?? []).includes(p.id) && !lineupOf(state, s).includes(p.id));
    const whys = [
      ...(p.heldToMax != null ? [`held to his Max of ${p.heldToMax} entries`] : []),
      ...[...p.skipped].map(([why, spots]) => `${spots.join(", ")}: ${why}`),
      ...(failed.length ? [`${failed.join(", ")}: chosen for him, but ${outcomes.filter((o) => failed.includes(o.spot)).map((o) => o.reason).filter(Boolean)[0] ?? "the re-fill did not hold him"}`] : []),
    ];
    const late = p.unplanned.length ? `Min % not planned for ${p.unplanned.length} ${p.unplanned.length === 1 ? "spot" : "spots"}: too many to weigh in time (${p.unplanned.join(", ")}).` : null;
    const said = short ? `${nameOf(p.id, ctx)} is in ${entries} of the ${p.target} entries asked for (${total} in scope), ${short} short. ${whys.join("; ")}.` : null;
    return { dk_id: p.id, name: nameOf(p.id, ctx), entries, target: p.target, total, short, why: [said, late].filter(Boolean).join(" ") || null };
  });
}

/**
 * Re-optimize spots with no removal needed (Adam 11-18): every spot in scope keeps its frozen men and the men Adam locked (keep), and
 * re-fills every open slot on the newest projections, any slot a man's positions allow. args: { scope, remove?, atLeast?, keep?, slate,
 * nowMs, mode?, settings?, settingsByMode?, exposure?, excluded?, excludedGames?, confirmOut?, notes? }. excluded: one list, or { Cash, GPP }
 * with each spot honouring its own mode's (board-excludes.js; spotOptions and pickOption read it the same way). scope as the remove action's;
 * { type: "holding" } means every spot holding a man in remove. remove: men taken out in the same run (marked out of each spot it changed
 * that held them). atLeast: { dk_id: percent } of the entries in scope, placed in the spots where holding him costs the least projection
 * (min-pct.js), held to his Max % when one is set. A Min % man who is Out or gone asks first: every spot answers "confirm" and nothing
 * changes. onlyHolding (the remove action with a Min %): a spot re-fills only when it holds a man in remove, or when the Min % plan puts a
 * man there, and then says so. clock and planMs bound the Min % planning time (min-pct.js PLAN_MAX_MS). Returns { state, outcomes,
 * overMax, minResults, error }, outcomes shaped as the remove action's.
 */
export function reoptimizeSpots(state, args) {
  const { scope, remove = [], atLeast = null, keep = null, onlyHolding = false, slate, nowMs, mode = null, settings = null, settingsByMode = null, exposure = null, excluded = [], noIds = [], noHeld = [], excludedGames = null, confirmOut = false, notes: boardNotes = [], clock = () => performance.now(), planMs = PLAN_MAX_MS } = args ?? {};
  const no = (error) => ({ ...refused(state, error), overMax: [], minResults: [] });
  if (settings != null && (typeof settings !== "object" || Array.isArray(settings))) return no("Settings must be an object.");
  if (settings && "exposure" in settings) return no("A Max % across the set goes in exposure, not in the optimizer settings.");
  if (!isIds(remove) || !excludedOk(excluded)) return no("Men to remove or exclude must be lists of DraftKings ids.");
  const { ctx, error } = contextFor(state, slate, nowMs);
  if (error) return no(error);
  let names;
  if (scope?.type === "holding") {
    names = spotNames(state).filter((s) => remove.some((id) => holds(state, s, id)));
    if (!names.length) return no(remove.length ? `No spot holds ${remove.map((id) => nameOf(id, ctx)).join(" or ")}, so nothing was done.` : "Choosing every spot holding a man needs the man.");
  } else {
    const sc = readScope(state, scope);
    if (sc.error) return no(sc.error);
    names = sc.names;
  }
  const spotMode = (spot) => spotModeOf(state, spot, mode);
  const isGpp = (spot) => spotMode(spot) === "GPP";
  const exOf = (spot) => excludedFor(excluded, spotMode(spot)); // his excludes of this spot's mode only (board-excludes.js, Adam 11-20)
  const limits = readLimits(state, exposure, ctx, isGpp);
  if (limits.error) return no(limits.error);
  const gm = readGames(excludedGames, ctx);
  if (gm.error) return no(gm.error);
  const kept = readKeep(keep, names, remove, ctx, spotNames(state));
  if (kept.error) return no(kept.error);
  const min = readAtLeast(atLeast, ctx, remove);
  if (min.error) return no(min.error);
  // A late swap NO man he put in at least N% (noHeld) is held to it: his Max is the entries his Min asks for in scope (plus those outside
  // it that hold him), so neither the plan nor a re-fill puts him in more on its own (review F1 11-19).
  const inScope = names.reduce((t, s) => t + spotEntries(state, s).length, 0);
  for (const w of min.wants.filter((x) => noHeld.includes(x.id))) {
    const outside = spotNames(state).filter((s) => !names.includes(s) && isGpp(s) && lineupOf(state, s).includes(w.id)).reduce((t, s) => t + spotEntries(state, s).length, 0);
    const cap = minEntries(w.pct, inScope) + outside;
    if (!limits.maxOf.has(w.id) || limits.maxOf.get(w.id) > cap) { limits.maxOf.set(w.id, cap); limits.pct.set(w.id, w.pct); }
  }
  const ask = confirmOut ? null : outAlert(min.wants.map((w) => w.id), ctx);
  if (ask) return { state, outcomes: names.map((spot) => confirmFirst(state, spot, ask)), overMax: [], minResults: [], error: null };
  // noHeld: late swap NO men Adam put in at least N% himself (screen-ops.js board): the plan may force them where his Min % needs them (a
  // forced man is locked, which wins over this set, actions.js fillArgs), but no re-fill adds them on its own (review F1 11-19).
  const outOf = (spot) => new Set([...unusableIn(state, spot), ...exOf(spot), ...remove, ...noHeld]);
  const fillOpts = (spot) => ({ out: outOf(spot), keep: kept.of(spot), mode, settings, settingsByMode, games: gm.games });
  const t0 = clock();
  const plan = planFor(state, ctx, { names, wants: min.wants, kept, gm, fillOpts, exOf, noIds, limits, isGpp, outOfTime: () => clock() - t0 > planMs });
  let s = state;
  const outcomes = [], taken = new Map();
  for (const [k, spot] of names.entries()) {
    const blocks = spotBlocks(s, spot, ctx);
    if (blocks.length) { outcomes.push(flagged(s, spot, blocks.join(" "), { amber: true })); continue; }
    const before = lineupOf(s, spot), entries = spotEntries(s, spot), forcedHere = plan.forced.get(spot) ?? [];
    const holdsOne = remove.some((id) => holds(s, spot, id));
    if (onlyHolding && !holdsOne && !forcedHere.length) { outcomes.push(moved(s, spot, before, before, ctx, { reason: `${spot} does not hold ${remove.map((id) => nameOf(id, ctx)).join(" or ")}.` })); continue; }
    const stuck = remove.filter((id) => before.includes(id) && frozenWhy(id, ctx, entries.find((e) => e.uploaded.includes(id))));
    const extra = [...boardNotes, ...gm.notes, ...kept.notes, ...stuck.map((id) => `${nameOf(id, ctx, entries)} stays in ${spot}: ${frozenWhy(id, ctx, entries.find((e) => e.uploaded.includes(id)))}.`)];
    if (onlyHolding && !holdsOne) extra.push(...forcedHere.map((id) => `Changed to reach ${nameOf(id, ctx)}'s at-least ${min.wants.find((w) => w.id === id).pct}%.`));
    const pending = names.slice(k + 1).filter((later) => !spotBlocks(s, later, ctx).length);
    const r = refill(s, spot, ctx, { ...fillOpts(spot), out: new Set([...unusableIn(s, spot), ...exOf(spot), ...remove, ...noHeld]), lock: plan.forced.get(spot) ?? [], limit: limits, overLimit: isGpp(spot) ? atLimit(limits.maxOf, s, spot, pending, ctx, isGpp, plan.forced) : new Set(), taken, extra });
    outcomes.push(r.outcome);
    if (r.state) s = r.state;
    const gone = r.outcome.status === "changed" ? remove.filter((id) => before.includes(id) && !lineupOf(s, spot).includes(id)) : [];
    if (gone.length) s = { ...s, unusable: { ...s.unusable, [spot]: [...new Set([...unusableIn(s, spot), ...gone])] } }; // only the spots this run changed
  }
  const over = overMax(limits.maxOf, s, ctx, isGpp);
  return { state: noteOverMax(s, outcomes, over), outcomes, overMax: over, minResults: minLines(s, plan, names, ctx, outcomes), error: null };
}

/** The Min % plan for a run (min-pct.js), with this engine's searches and reasons. A spot's best fill is searched once per set of men held.
 *  A man with a Max % is planned within it, in entries: what his Max allows less the GPP entries outside the scope holding him now. */
function planFor(state, ctx, { names, wants, kept, gm, fillOpts, exOf, noIds = [], limits, isGpp, outOfTime }) {
  if (!wants.length) return { forced: new Map(), plans: [] };
  const seen = new Map();
  const best = (spot, lock) => {
    const key = `${spot}|${[...lock].sort().join(",")}`;
    if (!seen.has(key)) {
      const f = keptFill(state, spot, ctx, { ...fillOpts(spot), lock }, (a) => runFill({ ...a, settings: { ...a.settings, count: 1 } }), (x) => x.lineups?.[0]?.ids ?? null);
      seen.set(key, f.fill.lineups ? { ids: f.fill.lineups[0].ids, score: fillScore(f.fill.lineups[0].ids, ctx) } : { why: f.fill.why });
    }
    return seen.get(key);
  };
  const whyNot = (id, spot) => {
    const cannot = notAddableWhy(id, ctx);
    if (cannot) return cannot.replace(/^.*?cannot be added: /, "").replace(/\.$/, "");
    if (gm.games.has(ctx.man(id).game)) return "his game is excluded on this screen";
    if (noIds.includes(id)) return "on the late swap NO list"; // named as NO before the board's excludes it is merged into (screen-ops.js lateNoState)
    if (exOf(spot).includes(id)) return "excluded on the board"; // in this spot's mode
    if (unusableIn(state, spot).includes(id)) return "he was taken out of that spot earlier";
    if (!Number.isFinite(ctx.man(id).projection)) return "he has no projection, so what holding him costs cannot be weighed";
    const blocks = spotBlocks(state, spot, ctx);
    return blocks.length ? `the spot cannot be changed: ${blocks.join(" ")}` : null;
  };
  // A kept man counts where he will surely stay: frozen there by an entry, or kept with his game not started (a started one is not held, keptFill).
  const sure = (id, spot) => id in spotPins(state, spot, ctx) || (kept.of(spot).includes(id) && !ctx.started.has(id) && !ctx.untimed.has(id));
  const weight = (s) => spotEntries(state, s).length;
  const maxFor = (id) => {
    if (!limits.maxOf.has(id)) return null;
    const outside = spotNames(state).filter((s) => !names.includes(s) && isGpp(s) && lineupOf(state, s).includes(id)).reduce((t, s) => t + weight(s), 0);
    return { most: limits.maxOf.get(id) - outside, allowed: limits.maxOf.get(id), counts: isGpp };
  };
  return planMinimum({ names, weight, wants, total: names.reduce((t, s) => t + weight(s), 0), sure, whyNot, best, maxFor, outOfTime });
}
