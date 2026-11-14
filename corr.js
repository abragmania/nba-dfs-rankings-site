// CORR chips (Adam, 2026-11-04): inside one lineup, a game is a game stack when the lineup holds men from BOTH teams of that
// game (one against one counts); every man of the lineup from that game wears a CORR chip, and each game stack has its own
// colour, by order in the lineup (the first man's game first), never by team. Two teammates with nobody from the other side
// are not a stack. A man with no game (or no team) gets no chip. Pure: tested in node.

/** A small fixed palette that avoids the app's warning red and amber and stays readable on every team tint. */
export const CORR_COLOURS = ["#35d0ff", "#c08bff", "#ff7ac6", "#5eeac4"];

/**
 * men: the lineup's men in the order shown (a null or stale entry is skipped). Returns a Map dk_id -> { n, colour }, n the
 * stack's place (0 for the first stack in the lineup). A fifth stack in one lineup cannot happen (eight men), the palette has four.
 */
export function gameStacks(men) {
  const teams = new Map(); // game -> Set of teams
  for (const p of men) {
    if (!p || p.stale || p.game == null || p.team == null) continue;
    if (!teams.has(p.game)) teams.set(p.game, new Set());
    teams.get(p.game).add(p.team);
  }
  const place = new Map(); // game -> n, in order of first man
  const out = new Map();
  for (const p of men) {
    if (!p || p.stale || p.game == null || (teams.get(p.game)?.size ?? 0) < 2) continue;
    if (!place.has(p.game)) place.set(p.game, place.size);
    const n = place.get(p.game);
    out.set(p.dk_id, { n, colour: CORR_COLOURS[n % CORR_COLOURS.length] });
  }
  return out;
}
