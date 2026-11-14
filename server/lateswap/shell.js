// The suggested shell of the entries-to-spots map (entries late swap, Adam 11-04): a starting map he then changes by hand. Pure: no DOM, no fs,
// no clock. Cash contests (Double Up, 50/50) go to Cash; in every other contest, taken in file order, the first entry goes to GPP #1, the
// second to GPP #2 and so on. Only unmapped entries are filled, never one already mapped; a new entry in a contest takes the lowest GPP
// number not already used in that contest.

/** A cash contest: its name holds "Double Up" or "50/50", in any case. */
export const isCashContest = (name) => /double[\s-]*up|50\s*\/\s*50/i.test(String(name ?? ""));

const GPP = /^GPP #(\d+)$/;
const contestKey = (e) => (e.contestId ? `id:${e.contestId}` : `name:${e.contestName}`);

/**
 * suggestShell(entries, entrySpots, knownSpots) -> { pairs: [[entryId, spot]], created: [spot names that exist nowhere yet], counts: Map spot -> n }.
 * entries are the file's rows in order; entrySpots maps Entry ID -> spot or null. An entry with no lineup is still given a spot: whether the
 * spot has a lineup is a different question, answered where the spot is drawn.
 */
export function suggestShell(entries, entrySpots, knownSpots = []) {
  const used = new Map(); // contest -> Set of GPP numbers already taken there
  for (const e of entries) {
    const m = GPP.exec(entrySpots[e.entryId] ?? "");
    if (m) { const k = contestKey(e); if (!used.has(k)) used.set(k, new Set()); used.get(k).add(Number(m[1])); }
  }
  const pairs = [], counts = new Map();
  // A spot that has entries, or a row of its own (a lineup given with no entries yet), is not new.
  const existing = new Set([...Object.values(entrySpots).filter((s) => s != null), ...knownSpots]);
  for (const e of entries) {
    if (entrySpots[e.entryId] != null) continue;
    let spot;
    if (isCashContest(e.contestName)) spot = "Cash";
    else {
      const k = contestKey(e);
      if (!used.has(k)) used.set(k, new Set());
      let n = 1;
      while (used.get(k).has(n)) n++;
      used.get(k).add(n);
      spot = `GPP #${n}`;
    }
    pairs.push([e.entryId, spot]);
    counts.set(spot, (counts.get(spot) ?? 0) + 1);
  }
  const created = [...counts.keys()].filter((s) => !existing.has(s));
  return { pairs, created, counts };
}

/** The words for what a shell did: "Cash 1, GPP #1 8, GPP #2 to #20 19". The spots above GPP #1 are one range when there are several. */
export function shellSummary(counts) {
  const parts = [], gpp = [];
  for (const [spot, n] of counts) { const m = GPP.exec(spot); if (m) gpp.push([Number(m[1]), n]); else parts.push(`${spot} ${n}`); }
  gpp.sort((a, b) => a[0] - b[0]);
  const first = gpp.filter(([k]) => k === 1), rest = gpp.filter(([k]) => k !== 1);
  for (const [k, n] of first) parts.push(`GPP #${k} ${n}`);
  if (rest.length === 1) parts.push(`GPP #${rest[0][0]} ${rest[0][1]}`);
  else if (rest.length) parts.push(`GPP #${rest[0][0]} to #${rest[rest.length - 1][0]} ${rest.reduce((t, [, n]) => t + n, 0)}`);
  return parts.join(", ");
}
