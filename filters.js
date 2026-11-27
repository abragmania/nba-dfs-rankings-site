// What narrows the player table (optimizer standard B4, B5): position tab, search, game tile, Locked / Excluded / Starred, team
// chips and the salary boxes. A filter only decides which rows show: nothing here touches the working lineup or the picks, so a
// man filtered out who is seated stays seated and counted. Pure; tested in node.

import { minGapOf } from "./player-table.js";
const plain = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Every filter off. */
export const noFilters = () => ({ tab: "ALL", q: "", game: null, pickFilter: null, teams: [], minSal: "", maxSal: "" });

/** The data-attributes of a click that acts on a man (Adam 11-14: lock, NO, exclude, star): such an act empties the search box. Typing, a card, sorting and filters are not acts. */
const ACT_KEYS = ["lock", "excl", "star", "no"];
export const actsOnMan = (dataset) => ACT_KEYS.some((k) => dataset?.[k] != null);

/** Empties the search box after an act on a man (Adam 11-14): `state.q` resets, the input empties and `redraw` shows the full list. Nothing happens, and nothing redraws, when no search is typed. Returns whether it cleared. */
export function clearSearch(state, input, redraw) {
  if (state.q === "") return false;
  state.q = "";
  if (input) input.value = "";
  redraw();
  return true;
}

/** Adam 11-27 (2:08 PM): after he has typed in the search box, his next click anywhere outside it empties the box and shows the full list; the click still does its own work (this listener sits on the document, so it runs after the click's own handlers). Typing alone never clears. */
export function clearSearchOnClick(doc, state, input, redraw) {
  doc.addEventListener("click", (e) => { if (e.target !== input && !input.contains?.(e.target)) clearSearch(state, input, redraw); });
}

/** Adam 11-27 (2:08 PM, asked again): a finished build (Build or Make N, either mode, late swap too) takes every view filter off so the full list shows: position tab, game tile, Locked / Excluded / Starred / Min gap, team chips, salary boxes, the search, and the In / Out / All switch back to its default. His locks, stars, NOs, excludes, overrides and lineups are not filters and are never touched here. Returns whether anything was on. */
export function clearViewFilters(state, defaultPoolView) {
  const on = filtersOn(state) || state.poolView !== defaultPoolView;
  Object.assign(state, noFilters(), { poolView: defaultPoolView });
  return on;
}

/** True when any filter narrows the table. */
export const filtersOn = (f) => f.tab !== "ALL" || f.q !== "" || f.game != null || f.pickFilter != null || f.teams.length > 0 || f.minSal !== "" || f.maxSal !== "";

/** The two salary boxes read: { min, max } (null when empty or not a number, so a bad box narrows nothing) and bad: each box's reason. */
export function salaryRange(minText, maxText) {
  const read = (text, word) => {
    const t = String(text ?? "").replace(/[$,\s]/g, "");
    if (t === "") return { v: null };
    return /^\d+$/.test(t) ? { v: Number(t) } : { v: null, bad: `${word} must be a whole number of dollars.` };
  };
  const lo = read(minText, "Min salary"), hi = read(maxText, "Max salary");
  const bad = {};
  if (lo.bad) bad.min = lo.bad;
  if (hi.bad) bad.max = hi.bad;
  if (lo.v != null && hi.v != null && lo.v > hi.v) bad.min = bad.max = "Min salary is more than Max salary.";
  return { min: lo.v, max: hi.v, bad };
}

const inTab = (p, tab) => {
  const ps = p.positions;
  if (tab === "ALL") return true;
  if (tab === "G") return ps.includes("PG") || ps.includes("SG");
  if (tab === "F") return ps.includes("SF") || ps.includes("PF");
  return ps.includes(tab);
};

/** The men the filters leave. `picks` holds the Locked and Excluded lists. A man with no salary is not known to be in a salary
 *  range, so a range leaves him out; he is never read as $0. */
export function filterPlayers(players, f, picks) {
  const q = plain(f.q.trim());
  const flagged = { starred: (p) => p.starred, gap: (p) => minGapOf(p) }[f.pickFilter];
  const picked = f.pickFilter ? new Set(flagged ? players.filter(flagged).map((p) => p.dk_id) : picks[f.pickFilter]) : null;
  const teams = f.teams.length ? new Set(f.teams) : null;
  const { min, max } = salaryRange(f.minSal, f.maxSal);
  const inRange = (p) => (min == null && max == null) || (typeof p.salary === "number" && (min == null || p.salary >= min) && (max == null || p.salary <= max));
  return players.filter((p) => inTab(p, f.tab) && (!picked || picked.has(p.dk_id)) && (!f.game || p.game === f.game) && (!teams || teams.has(p.team)) && inRange(p) && (!q || plain(p.name).includes(q)));
}

/** The slate's teams, for the chips. */
export const teamsOf = (players) => [...new Set(players.map((p) => p.team).filter(Boolean))].sort();
