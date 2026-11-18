// Min % across a set of entries (entries late swap, Adam 11-18: "now that someone is injured, this guy needs to be in LOTS of lineups").
// Pure: the searches and the time check come in as functions, so the choice of spots is tested directly. Percent is of the assigned
// entries in the run's scope, counted per spot (a spot with 9 entries counts 9).

const EPS = 1e-9;
/** Planning weighs at most this many spots, and stops starting new ones after this long (code review 11-18, item 8). */
export const PLAN_MAX_SPOTS = 40;
export const PLAN_MAX_MS = 8000;

/**
 * The cheapest set of items reaching at least `need` weight: items [{ key, weight, cost, capped? }], weight a whole number above 0, cost 0
 * or more. budget: the most weight the capped items may add together (his Max %), Infinity for none. Exact (a table over the weight reached,
 * capped at need, and the budget used), so a heavier item is taken when the light ones cannot get there; on equal cost fewer items win. When
 * need cannot be reached, it reaches as far as it can, as cheaply as it can. Returns { picked: [key] in item order, weight }.
 */
export function cheapestCover(items, need, budget = Infinity) {
  const usable = items.filter((i) => i.weight > 0);
  if (need <= 0) return { picked: [], weight: 0 };
  const bounded = Number.isFinite(budget);
  const all = usable.reduce((t, i) => t + i.weight, 0);
  if (!bounded && all <= need) return { picked: usable.map((i) => i.key), weight: all };
  const G = bounded ? Math.max(0, Math.floor(budget)) : 0, W = need + 1, at = (w, g) => g * W + w;
  const n = usable.length, size = W * (G + 1);
  const cost = Array.from({ length: n + 1 }, () => new Float64Array(size).fill(Infinity));
  const prev = Array.from({ length: n + 1 }, () => new Int32Array(size).fill(-1)), took = Array.from({ length: n + 1 }, () => new Uint8Array(size));
  cost[0][0] = 0;
  for (let i = 0; i < n; i++) {
    const it = usable[i], uses = bounded && it.capped ? it.weight : 0;
    for (let k = 0; k < size; k++) if (cost[i][k] < cost[i + 1][k]) { cost[i + 1][k] = cost[i][k]; prev[i + 1][k] = k; took[i + 1][k] = 0; }
    for (let g = 0; g + uses <= G; g++) {
      for (let w = 0; w < W; w++) {
        const from = at(w, g);
        if (cost[i][from] === Infinity) continue;
        const to = at(Math.min(need, w + it.weight), g + uses), c = cost[i][from] + it.cost;
        if (c < cost[i + 1][to] - EPS) { cost[i + 1][to] = c; prev[i + 1][to] = from; took[i + 1][to] = 1; }
      }
    }
  }
  let end = -1; // the most weight reached, then the least cost
  for (let w = need; w >= 0 && end < 0; w--) for (let g = 0; g <= G; g++) if (cost[n][at(w, g)] < Infinity && (end < 0 || cost[n][at(w, g)] < cost[n][end] - EPS)) end = at(w, g);
  const picked = [];
  for (let i = n, k = end; i > 0; i--) { if (took[i][k]) picked.push(usable[i - 1].key); k = prev[i][k]; }
  picked.reverse();
  return { picked, weight: usable.filter((i) => picked.includes(i.key)).reduce((t, i) => t + i.weight, 0) };
}

/** The entries a Min % asks for: the whole number at or above pct of total. */
export const minEntries = (pct, total) => Math.ceil((total * pct) / 100 - EPS);

/**
 * Which spots take each man with a Min %, cheapest first. args: { names (spots in order), weight(spot), wants [{ id, pct }] in the order
 * asked, total (entries in scope), sure(id, spot) (he stays there anyway: frozen or kept), whyNot(id, spot) (a phrase, or null when he can
 * be added there), best(spot, lock) ({ ids, score } or { why }: the best fill of that spot with the men in lock held), maxFor(id) (null, or
 * { most, counts(spot) }: his Max % in entries still free for the spots in scope, and whether a spot counts against it), outOfTime() }. A
 * man's cost in a spot is the projection lost by holding him there, times its entries. Each man is planned around the men placed before
 * him. Only the first PLAN_MAX_SPOTS spots are weighed, and none once outOfTime() says so; the rest are listed as unplanned. Returns
 * { forced: Map spot -> [id], plans: [{ id, target, sure, planned, skipped: Map phrase -> [spot], heldToMax, unplanned: [spot] }] }.
 */
export function planMinimum({ names, weight, wants, total, sure, whyNot, best, maxFor = () => null, outOfTime = () => false }) {
  const forced = new Map(names.map((s) => [s, []])), plans = [];
  for (const { id, pct } of wants) {
    const target = minEntries(pct, total), skipped = new Map(), items = [], unplanned = [];
    const skip = (why, spot) => skipped.set(why, [...(skipped.get(why) ?? []), spot]);
    const fixed = names.filter((s) => sure(id, s)), max = maxFor(id);
    for (const [k, spot] of names.entries()) {
      if (fixed.includes(spot) || weight(spot) === 0) continue;
      if (k >= PLAN_MAX_SPOTS || outOfTime()) { unplanned.push(spot); continue; }
      const why = whyNot(id, spot);
      if (why) { skip(why, spot); continue; }
      const base = best(spot, forced.get(spot));
      if (!base.ids) { skip(`no legal fill: ${base.why}`, spot); continue; }
      const withHim = base.ids.includes(id) ? base : best(spot, [...forced.get(spot), id]);
      if (!withHim.ids) { skip("he does not fit around the men already fixed there (salary or slots)", spot); continue; }
      items.push({ key: spot, weight: weight(spot), cost: Math.max(0, base.score - withHim.score) * weight(spot), capped: Boolean(max?.counts(spot)) });
    }
    const have = fixed.reduce((t, s) => t + weight(s), 0);
    const budget = max ? Math.max(0, max.most - fixed.filter((s) => max.counts(s)).reduce((t, s) => t + weight(s), 0)) : Infinity;
    const pick = cheapestCover(items, target - have, budget);
    const free = cheapestCover(items, target - have);
    for (const spot of pick.picked) forced.get(spot).push(id);
    plans.push({ id, target, sure: have, planned: have + pick.weight, skipped, heldToMax: max && pick.weight < free.weight ? max.allowed : null, unplanned });
  }
  return { forced, plans };
}
