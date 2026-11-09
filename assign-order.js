// Assign in order (Adam, 2026-11-04): one button puts the saved lineups, in the order shown on screen, on the GPP spots in turn
// (GPP #1, GPP #2 ...), so twenty lineups do not take twenty clicks. Pure: the plan only; the page asks the server to apply it in one
// call (slate/spots.js, bulk) and keeps the earlier spots for Undo.
import { MAX_SPOTS, MAX_TOTAL_SPOTS, isCashSpot } from "./spot-name.js";

/** The number in "GPP #3", or null for any other name (Cash and typed names are never touched). */
export const gppNumber = (name) => { const m = /^GPP #(\d+)$/.exec(name); return m ? Number(m[1]) : null; };

/**
 * lineups: the saved lineups in screen order, { id, swapped, mode }; spots: the spots as the page read them; replace: Adam ticked "Replace
 * current"; skip: lineup ids left out (the ones with a man who cannot play, when he said "Skip those"); uploaded: names of spots that still hold
 * a lineup from the DraftKings file he uploaded in late swap (they hold a lineup the spots file does not know).
 *
 * By default only free GPP spots are filled and only lineups holding no spot (Cash counts as a spot) are placed; a spot still holding the
 * uploaded lineup is held, not free. With replace every existing GPP spot is given, and every shown lineup placed, in order. A Cash-mode
 * lineup is never put on a GPP spot. The spots that exist are used first, in number order; a new "GPP #n" is made only when the lineups run
 * past the last one (n after the highest existing number, uploaded spots counted). A swapped lineup that is not saved cannot hold a spot and
 * is left out. Returns { assignments: [{ spot, lineupId }], created, left (no room: at most MAX_SPOTS spots besides Cash), skippedSwapped,
 * replaced (how many assignments took a spot another lineup held, uploaded ones included), replacedUploaded (names of those that held the
 * uploaded lineup), keptUploaded (uploaded GPP spots left alone), cashLeft (Cash-mode lineup ids not placed) }.
 */
export function planInOrder({ lineups, spots, replace = false, skip = new Set(), uploaded = [] }) {
  const up = new Set(uploaded);
  const holding = new Set(Object.values(spots).map((s) => s?.lineup_id).filter((id) => id != null).map(String));
  const unsaved = lineups.filter((l) => l.swapped).map((l) => String(l.id));
  const cashLeft = lineups.filter((l) => !l.swapped && l.mode === "Cash").map((l) => String(l.id));
  const wanted = lineups.filter((l) => !l.swapped && l.mode !== "Cash" && !skip.has(String(l.id)) && (replace || !holding.has(String(l.id))));
  const names = [...new Set([...Object.keys(spots), ...up])];
  const isHeld = (n) => spots[n]?.lineup_id != null || up.has(n);
  const existing = names.map((n) => [gppNumber(n), n]).filter(([k]) => k !== null).sort((a, b) => a[0] - b[0]);
  const free = existing.filter(([, n]) => replace || !isHeld(n)).map(([, n]) => n);
  let next = (existing.length ? existing.at(-1)[0] : 0) + 1, counted = names.filter((n) => !isCashSpot(n)).length;
  const assignments = [], created = [], left = [];
  for (const l of wanted) {
    let spot = free.shift();
    if (!spot) {
      if (counted >= MAX_SPOTS || names.length + created.length >= MAX_TOTAL_SPOTS) { left.push(String(l.id)); continue; }
      spot = `GPP #${next++}`;
      created.push(spot);
      counted += 1;
    }
    assignments.push({ spot, lineupId: String(l.id) });
  }
  const took = assignments.filter((a) => isHeld(a.spot));
  const keptUploaded = replace ? [] : existing.map(([, n]) => n).filter((n) => up.has(n) && spots[n]?.lineup_id == null);
  return { assignments, created, left, skippedSwapped: unsaved, replaced: took.length, replacedUploaded: took.map((a) => a.spot).filter((n) => up.has(n)), keptUploaded, cashLeft };
}

/** The line that says what was done: "Assigned 20 lineups to GPP #1 to GPP #20. Created GPP #19, GPP #20. 2 Cash lineups were left off the GPP spots." */
export function orderSummary(plan, { entries = null, spotCount = null } = {}) {
  const n = plan.assignments.length, first = plan.assignments[0]?.spot, last = plan.assignments.at(-1)?.spot;
  const range = (xs) => (xs.length < 8 ? xs.join(", ") : `${xs[0]} to ${xs.at(-1)}`);
  const made = plan.created.length ? ` Created ${range(plan.created)}.` : "";
  const over = plan.replacedUploaded?.length ? ` Replaced the uploaded lineup on ${range(plan.replacedUploaded)}.` : "";
  const kept = plan.keptUploaded?.length ? ` Left ${range(plan.keptUploaded)} alone: still holding the lineup from the uploaded DraftKings file.` : "";
  const cash = plan.cashLeft?.length ? ` ${plan.cashLeft.length} Cash lineup${plan.cashLeft.length === 1 ? " was" : "s were"} left off the GPP spots.` : "";
  // How many entries are in play: the uploaded DraftKings file's, and a warning when the GPP spots now outnumber them.
  const inPlay = entries != null ? ` ${entries} entr${entries === 1 ? "y is" : "ies are"} in the uploaded DraftKings file${spotCount != null && spotCount > entries ? `; ${spotCount} GPP spots now exist, more than the file has entries` : ""}.` : "";
  return `Assigned ${n} lineup${n === 1 ? "" : "s"} to ${n > 1 ? `${first} to ${last}` : first}.${made}${over}${kept}${cash}${plan.left.length ? ` ${plan.left.length} had no spot left.` : ""}${inPlay}`;
}
