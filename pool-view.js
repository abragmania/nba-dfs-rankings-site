// The Player list's In / Out / All switch (Adam 12:52 PM and 1:26 PM 11-20: "I want a default view where I don't see the excluded players on my normal
// screen, but I want to be able to see all players (included + excluded), excluded only and included only (default view)", "in should be the default").
// In: the men in the open mode's pool (no excluded man, no man Out tonight). Out: only the excluded and Out men, where he puts a man back In.
// All: everyone. In is the view every time the page opens (never remembered). The counts follow the open mode's picks (Cash or GPP), as the
// rows do (board.js shown: his excludes plus the men not playing, excluded.js). Locked and Starred stay filters inside any view. Pure; tested in node.
import { esc } from "./board-util.js";

export const POOL_VIEWS = Object.freeze(["in", "out", "all"]);
export const DEFAULT_POOL_VIEW = "in";
const WORD = { in: "In", out: "Out", all: "All" };

/** The men a view keeps. shown: the open mode's picks as the list shows them ({ excluded }: his excludes and the Out men). Pure. */
export function inPoolView(players, view, shown) {
  if (view !== "in" && view !== "out") return players;
  const out = new Set(shown?.excluded ?? []);
  return players.filter((p) => out.has(p.dk_id) === (view === "out"));
}

/** { in, out, all }: how many men each view holds for the open mode. Pure. */
export function poolCounts(players, shown) {
  const out = new Set(shown?.excluded ?? []);
  const n = players.filter((p) => out.has(p.dk_id)).length;
  return { in: players.length - n, out: n, all: players.length };
}

/** The switch, where the Excluded chip sat: In (count) | Out (count) | All, the open view lit. mode: "Cash" or "GPP", named on the hover. */
export function poolSwitchHtml(view, counts, mode = "") {
  const tip = { in: `The men in the ${mode} pool: no excluded or Out man`, out: `Only the excluded and Out men${mode ? ` in ${mode}` : ""}: put one back In here`, all: "Everyone, in and out" };
  return `<span class="pview" role="group" aria-label="Which men the list shows">${POOL_VIEWS.map((v) => `<button data-pview="${v}" class="pv${view === v ? " on" : ""}" aria-pressed="${view === v}" title="${esc(tip[v].replace(/\s+/g, " "))}">${WORD[v]}${v === "all" ? "" : ` <b>${counts[v]}</b>`}</button>`).join("")}</span>`;
}

/** The short toast for a man his click took out of the view on show: "Moved to Out" or "Moved to In"; null when he stays in view (All, or no move). Pure. */
export function movedWord(view, wasOut, isOut) {
  if (view === "all" || wasOut === isOut) return null;
  if (view === "in" && isOut) return "Moved to Out";
  if (view === "out" && !isOut) return "Moved to In";
  return null;
}

/** A remembered filter from before the switch: the old Excluded chip's filter is the Out view now, so it is not restored as a filter (the view opens In). Pure. */
export const withoutOldFilter = (view) => (view?.pickFilter === "excluded" ? { ...view, pickFilter: null } : view);
