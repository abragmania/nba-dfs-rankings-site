// A man's Min % and Max % (optimizer standard B10) in a multi-lineup build. Pure: optimize.js hands in its search. The limits are
// counted on the lineups asked: Max % rounds down and Min % rounds up, so what comes back is true of the percentage typed (Max 30%
// of 5 lineups is 1 lineup, Min 30% is 2). Each lineup is still the best one left: a man who has reached his Max is out of the
// rest, and a man is held in a lineup only when the Min % of the men still owed lineups cannot be met any later, so the highest
// scoring lineups stay free. The plan that says who is owed where is an exact packing of them into the lineups left, each set
// tested by the search itself. Later lineups' uniqueness and Max cuts cannot be known yet, so a build can still fall short after
// its first lineup; that, and every limit that cannot be met, comes back as a sentence, never a silent miss.
const isPlain = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const isPct = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
const ROUND = 1e-9; // 7 x 100 / 7 style rounding must not lose a whole lineup
const PLAN_BUDGET = 2000; // packing steps per lineup, past any real set of limits; past it only the men who can wait no longer are held

/** settings.exposure ({ dk_id: { min?, max? } }, percentages) checked; { exposure } or { error }. */
export function readExposure(raw) {
  if (raw == null) return { exposure: {} };
  if (!isPlain(raw)) return { error: "Min % and Max % must map DraftKings ids to {min, max}." };
  for (const [id, l] of Object.entries(raw)) {
    if (!isPlain(l) || Object.keys(l).some((k) => k !== "min" && k !== "max")) return { error: `The Min % and Max % of player ${id} must be {min, max}.` };
    if ((l.min != null && !isPct(l.min)) || (l.max != null && !isPct(l.max))) return { error: `The Min % and Max % of player ${id} must be numbers from 0 to 100.` };
    if (l.min != null && l.max != null && l.min > l.max) return { error: `The Min % of player ${id} (${l.min}) is above his Max % (${l.max}).` };
  }
  return { exposure: raw };
}

/** The limits that bind in a build of `count` lineups: dk_id -> { min, max, minC, maxC }; a limit that changes nothing is left out. */
export function countLimits(exposure, count) {
  const out = new Map();
  for (const [id, l] of Object.entries(exposure)) {
    const minC = l.min == null ? 0 : Math.ceil((count * l.min) / 100 - ROUND);
    const maxC = l.max == null ? count : Math.floor((count * l.max) / 100 + ROUND);
    if (minC > 0 || maxC < count) out.set(id, { min: l.min ?? null, max: l.max ?? null, minC, maxC });
  }
  return out;
}

/** Why these limits cannot hold before any search runs, as a sentence; null when they can. held: the men in every lineup. why(id):
 *  what stops a man being used (excluded, a missing figure), or null. */
export function limitStart(limits, count, { nameOf, held, why }) {
  for (const [id, l] of limits) {
    if (l.minC > l.maxC) return `With ${count} lineups, ${nameOf(id)}'s Min % of ${l.min} and Max % of ${l.max} leave no whole number of lineups.`;
    if (held.has(id) && l.maxC < count) return `${nameOf(id)} is locked or hand-picked, so he is in all ${count} lineups; his Max % of ${l.max} allows ${l.maxC}.`;
    if (!held.has(id) && l.minC > 0 && why(id)) return `${nameOf(id)} ${why(id)}, so his Min % of ${l.min} cannot be met.`;
  }
  return null;
}

/**
 * Packs the men owed lineups (needs: [{ id, need }]) into the `left` lineups, as late as they fit. fits(ids) answers whether one
 * lineup can hold those men: true, false, or null when the search ran out of steps. Returns { now } (the men this lineup must
 * hold), or { stuck } (the men who cannot all be placed, with gaveUp when the budget ended it), or { unknown: true }.
 */
export function planHolds(needs, left, fits) {
  const men = [...needs].sort((a, b) => b.need - a.need || (a.id < b.id ? -1 : 1));
  const bins = Array.from({ length: left }, () => []);
  const known = new Map();
  let steps = 0, deepest = 0, unknown = false;
  const fit = (ids) => {
    const key = [...ids].sort().join();
    if (!known.has(key)) known.set(key, fits(ids));
    return known.get(key);
  };
  const place = (m) => {
    if (m === men.length) return true;
    deepest = Math.max(deepest, m);
    const pick = (need, from) => {
      if (need === 0) return place(m + 1);
      const tried = new Set(); // lineups holding the same men are alike: one try covers them all
      for (let b = from; b >= need - 1; b--) {
        const key = [...bins[b]].sort().join();
        if (tried.has(key)) continue;
        tried.add(key);
        if (++steps > PLAN_BUDGET) return false;
        const ok = fit([...bins[b], men[m].id]);
        if (ok === null) { unknown = true; return false; }
        if (!ok) continue;
        bins[b].push(men[m].id);
        if (pick(need - 1, b - 1)) return true;
        bins[b].pop();
        if (unknown || steps > PLAN_BUDGET) return false;
      }
      return false;
    };
    return pick(men[m].need, left - 1);
  };
  if (place(0)) return { now: bins[0] };
  if (unknown) return { unknown: true };
  return { stuck: men.slice(0, deepest + 1).map((x) => x.id), gaveUp: steps > PLAN_BUDGET };
}

const countedOn = (count) => `Min % and Max % were counted on the ${count} asked`;

/**
 * What a batch that may be short of `count` does to the limits, as a sentence; "" when it keeps them or holds no lineup. A Min is
 * missed under the lineups asked; a Max is passed when his share of the lineups that came back is over it, as a short batch can
 * be even with his count allowed. lineups: { slots } as a build returns them, or 8 dk_ids each. A figure of a Stop, a limit or a
 * failure comes back through here, so a batch never misses a limit without saying so.
 */
export function limitMisses(exposure, count, lineups, nameOf = (id) => id) {
  const n = lineups.length;
  if (!n) return "";
  const have = new Map();
  for (const l of lineups) for (const id of Array.isArray(l) ? l : l.slots.map((p) => p.dk_id)) have.set(id, (have.get(id) ?? 0) + 1);
  const parts = [];
  for (const [id, l] of countLimits(exposure, count)) {
    const c = have.get(id) ?? 0;
    if (c < l.minC) parts.push(`${nameOf(id)} is in ${c} of the ${l.minC} lineups his Min % needs`);
    if (l.max != null && (c / n) * 100 > l.max + ROUND) parts.push(`${nameOf(id)} is in ${c} of these ${n}, over his Max % of ${l.max}`);
  }
  return [zeroMaxNote(exposure, count, nameOf), parts.length ? `${countedOn(count)}: ${parts.join("; ")}.` : ""].filter(Boolean).join(" ");
}

/** A Max % that rounds down to no lineup at all names the man it leaves out ("Max 30% of 3 lineups allows 0; he is left out."); "" with none. A typed Max of 0 is meant, so it is not named. */
export function zeroMaxNote(exposure, count, nameOf = (id) => id) {
  const parts = [];
  for (const [id, l] of countLimits(exposure, count)) if (l.max != null && l.max > 0 && l.maxC === 0) parts.push(`${nameOf(id)}: Max ${l.max}% of ${count} lineups allows 0; he is left out.`);
  return parts.join(" ");
}

/** The sentence when the plan cannot place the men owed lineups (every man still short is named); `done` lineups are already built. */
function stuckNote(short, done, count, nameOf, misses) {
  const left = count - done, names = short.map(nameOf).join(", ");
  const first = done ? `Only ${done} of ${count} lineups could be built. ` : "";
  const why = short.length === 1 ? `no lineup left can hold him often enough in the ${left} left to build` : `they cannot all be in enough of the ${left} lineups left to build`;
  return `${first}Min % cannot be met for ${names}: under these settings ${why}. ${misses || `${countedOn(count)}.`}`;
}

/** The sentence when no further lineup exists: what came back, and every limit that it misses. */
function shortNote(done, count, misses) {
  if (!done) return "No lineup meets these settings.";
  return `Only ${done} of ${count} lineups could be built under these settings with these Min % and Max % limits. ${misses || `${countedOn(count)}.`}`;
}

/**
 * The batch under the limits. search(held, out, built, firstFit) -> { ids (8 dk_ids) or null, proven }: the best lineup holding the
 * men `held`, without the men in the Set `out`, that differs enough from each of `built`; firstFit stops at the first one found.
 * addLineup(ids, proven) takes each lineup found. Returns the build's note, or null when all of `count` came back.
 * carryOn (the fast GPP build): a plan the search ran out of budget on goes on like one too big to pack. Only the search for the
 * lineup itself failing ends the batch; the exact search stops at the plan.
 */
export function buildLimited({ exposure, count, limits, search, addLineup, nameOf, stepsNote, carryOn = false }) {
  const have = new Map(), built = [];
  let carried = false;
  const misses = () => limitMisses(exposure, count, built, nameOf);
  const stepped = (r, found) => [stepsNote(r, found), misses()].filter(Boolean).join(" ");
  for (let r = 0; r < count; r++) {
    const out = new Set([...limits].filter(([id, l]) => (have.get(id) ?? 0) >= l.maxC).map(([id]) => id));
    const needs = [...limits].map(([id, l]) => ({ id, need: l.minC - (have.get(id) ?? 0) })).filter((x) => x.need > 0);
    const plan = planHolds(needs, count - r, (ids) => {
      const f = search(ids, out, built, true);
      return f.ids ? true : f.proven ? false : null;
    });
    if (plan.unknown && !carryOn) return stepped(r, false);
    carried ||= Boolean(plan.unknown);
    // Once a lineup has gone by unplanned, a plan that no longer fits says nothing about the settings, so it does not end the batch.
    if (plan.stuck && !plan.gaveUp && !carried) return stuckNote(needs.map((x) => x.id), r, count, nameOf, misses());
    // Too many men to pack in the steps allowed: go on holding only those who can wait no longer; a miss still comes back as a sentence.
    const held = plan.gaveUp || plan.unknown || plan.stuck ? needs.filter((x) => x.need === count - r).map((x) => x.id) : plan.now;
    const { ids, proven } = search(held, out, built, false);
    if (ids) {
      built.push(ids);
      for (const id of ids) have.set(id, (have.get(id) ?? 0) + 1);
      addLineup(ids, proven);
    }
    if (!proven) return stepped(r, Boolean(ids));
    if (!ids) return shortNote(r, count, misses());
  }
  return zeroMaxNote(exposure, count, nameOf) || null;
}
