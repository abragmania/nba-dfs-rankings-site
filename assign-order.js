// Assign in order (Adam, 2026-11-04): one button puts the saved lineups, in the order shown on screen, on the GPP spots in turn
// (GPP #1, GPP #2 ...), so twenty lineups do not take twenty clicks. Pure: the plan only; the page asks the server to apply it in one
// call (slate/spots.js, bulk) and keeps the earlier spots for Undo.
import { MAX_SPOTS } from "./spot-name.js";

/** The number in "GPP #3", or null for any other name (Cash and typed names are never touched). */
export const gppNumber = (name) => { const m = /^GPP #(\d+)$/.exec(name); return m ? Number(m[1]) : null; };

/**
 * lineups: the saved lineups in screen order, { id, swapped }; spots: the spots as the page read them; replace: Adam ticked "Replace
 * current"; skip: lineup ids left out (the ones with a man who cannot play, when he said "Skip those").
 *
 * By default only empty GPP spots are filled and only lineups holding no spot (Cash counts as a spot) are placed; with replace
 * every existing GPP spot is given, and every shown lineup placed, in order. The spots that exist are used first, in number order;
 * a new "GPP #n" is made only when the lineups run past the last one (n after the highest existing number). A swapped lineup that
 * is not saved cannot hold a spot and is left out. Returns { assignments: [{ spot, lineupId }], created, left (no room: the spots
 * file holds at most MAX_SPOTS), skippedSwapped, replaced (how many assignments took a spot another lineup held) }.
 */
export function planInOrder({ lineups, spots, replace = false, skip = new Set() }) {
  const holding = new Set(Object.values(spots).map((s) => s?.lineup_id).filter((id) => id != null).map(String));
  const unsaved = lineups.filter((l) => l.swapped).map((l) => String(l.id));
  const wanted = lineups.filter((l) => !l.swapped && !skip.has(String(l.id)) && (replace || !holding.has(String(l.id))));
  const existing = Object.keys(spots).map((n) => [gppNumber(n), n]).filter(([k]) => k !== null).sort((a, b) => a[0] - b[0]);
  const free = existing.filter(([, n]) => replace || spots[n].lineup_id === null).map(([, n]) => n);
  let next = (existing.length ? existing.at(-1)[0] : 0) + 1, total = Object.keys(spots).length;
  const assignments = [], created = [], left = [];
  for (const l of wanted) {
    let spot = free.shift();
    if (!spot) {
      if (total >= MAX_SPOTS) { left.push(String(l.id)); continue; }
      spot = `GPP #${next++}`;
      created.push(spot);
      total += 1;
    }
    assignments.push({ spot, lineupId: String(l.id) });
  }
  return { assignments, created, left, skippedSwapped: unsaved, replaced: assignments.filter((a) => spots[a.spot]?.lineup_id != null).length };
}

/** The line that says what was done: "Assigned 20 lineups to GPP #1 to GPP #20. Created GPP #19, GPP #20." */
export function orderSummary(plan) {
  const n = plan.assignments.length, first = plan.assignments[0]?.spot, last = plan.assignments.at(-1)?.spot;
  return `Assigned ${n} lineup${n === 1 ? "" : "s"} to ${n > 1 ? `${first} to ${last}` : first}.${plan.created.length ? ` Created ${plan.created.length < 8 ? plan.created.join(", ") : `${plan.created[0]} to ${plan.created.at(-1)}`}.` : ""}${plan.left.length ? ` ${plan.left.length} had no spot left.` : ""}`;
}
