// The Entries screen's TIPS strip (entries late swap, Adam 11-18): one chip per game. A game that has not started is a button that excludes
// it from every re-optimize (its men are never added) or lets it back in; a started game's chip is not clickable. The excluded games are
// kept on the server with the screen's state (op "excludeGames"), so this file only draws them and builds the request.
import { esc, chipTime } from "./lsw-common.js";
import { logo, shortTime } from "./board-util.js";

/** The strip's chips for model M. */
export function gamesHtml(M) {
  const off = new Set(M.excludedGames ?? []);
  return M.games.map((g) => {
    const inner = `${logo(g.away, "xs")}<i>@</i>${logo(g.home, "xs")}<small>${esc(chipTime(g.tip, M.refMs))}</small>`;
    const when = `${esc(g.game)} ${esc(shortTime(g.tip, M.refMs) ?? "")}`;
    if (g.started) return `<span class="gc stl${off.has(g.game) ? " off" : ""}" title="${when}: started, its men are fixed">${inner}</span>`;
    const isOff = off.has(g.game);
    const title = isOff ? `${when}: excluded, so re-optimizing adds none of its men. Click to let it back in.` : `${when}: click to exclude this game, so re-optimizing adds none of its men.`;
    return `<button class="gc gcb${isOff ? " off" : ""}" data-lsw="gameToggle" data-game="${esc(g.game)}" aria-pressed="${isOff}" title="${title}">${inner}${isOff ? "<em>out</em>" : ""}</button>`;
  }).join("");
}

/** The request a click on game `game` sends: the whole excluded list with that game turned over. */
export function gameToggleBody(M, game) {
  const off = new Set(M.excludedGames ?? []);
  if (off.has(game)) off.delete(game); else off.add(game);
  return { op: "excludeGames", games: [...off] };
}
