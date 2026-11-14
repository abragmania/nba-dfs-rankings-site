// The game cards' border (Adam 11-13): green where a team's five is confirmed, yellow where it is not. The per-team test is the News
// tab's own (news-model.js teamModel: five.kind === "confirmed"); every other kind counts as unconfirmed. Pure: no DOM, tested in node.

/** Whether a team model's five is confirmed (the News tab's word for it). */
export const isConfirmed = (team) => team?.five?.kind === "confirmed";

/** From newsModel(...).games: { [game]: { away: bool, home: bool } }. {} with no model. */
export function confirmedByGame(model) {
  const out = {};
  for (const g of model?.games ?? []) out[g.game] = { away: isConfirmed(g.away), home: isConfirmed(g.home) };
  return out;
}

/** The two half colours as a style value (away left, home right; board.css `.game.cf` draws them). "" when the card's sides are not known. */
export function borderStyle(sides) {
  if (!sides) return "";
  const c = (ok) => (ok ? "var(--gr)" : "var(--am)");
  return `--bdl:${c(sides.away)};--bdr:${c(sides.home)}`;
}
