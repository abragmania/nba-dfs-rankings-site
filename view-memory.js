// What the page remembers per slate in the browser (optimizer standard A9): the filters, the sort, Cash or GPP, the exposure
// table's sort and Pos filter, and the Out strip's open or shut. The viewer's own choices only, never a figure. The working
// lineup is kept per slate on the server and the settings by settings-panel.js. A stored choice is checked against the slate on
// show: anything it no longer names falls back, so a sort on a column that has gone (the ceiling) can never come back. tryStore
// holds every read and write in its try and catch: with no storage the page draws from the defaults. Pure; tested in node.
import { noFilters } from "./filters.js";

const MODES = ["Cash", "GPP"];
const PICK_FILTERS = ["locked", "excluded", "starred"];
const BOX_MAX = 200; // a typed box's text; longer is not something this page wrote
export const EXPOSURE_KEYS = ["pct", "name", "pos", "team", "own", "diff"];
export const EXPOSURE_POS = ["All", "PG", "SG", "SF", "PF", "C"];
export const DEFAULT_SORT = { key: "projection", dir: -1 };
export const DEFAULT_EXPOSURE_SORT = { key: "pct", dir: -1 };

const text = (v) => (typeof v === "string" && v.length <= BOX_MAX ? v : "");
const sortOf = (s, keys, fallback) => (s && keys.includes(s.key) && (s.dir === 1 || s.dir === -1) ? { key: s.key, dir: s.dir } : { ...fallback });

/** The defaults, or a stored view made safe. facts: { tabs, teams, games, sortKeys } of the slate on show and this page. */
export function cleanView(saved, { tabs, teams, games, sortKeys }) {
  const v = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  return {
    ...noFilters(),
    tab: tabs.includes(v.tab) ? v.tab : "ALL",
    q: text(v.q),
    game: games.includes(v.game) ? v.game : null,
    pickFilter: PICK_FILTERS.includes(v.pickFilter) ? v.pickFilter : null,
    teams: Array.isArray(v.teams) ? [...new Set(v.teams)].filter((t) => teams.includes(t)) : [],
    minSal: text(v.minSal),
    maxSal: text(v.maxSal),
    sort: sortOf(v.sort, sortKeys, DEFAULT_SORT),
    outOpen: v.outOpen !== false,
    mode: MODES.includes(v.mode) ? v.mode : null, // null: nothing chosen on this slate yet, the mode on show stays
    expSort: sortOf(v.expSort, EXPOSURE_KEYS, DEFAULT_EXPOSURE_SORT),
    expPos: EXPOSURE_POS.includes(v.expPos) ? v.expPos : "All",
  };
}

const storeKey = (slate) => `nbaboard.view.${slate}`;
export const loadView = (tryStore, slate, facts) => cleanView(tryStore(() => JSON.parse(localStorage.getItem(storeKey(slate)) ?? "null")), facts);
export const saveView = (tryStore, slate, view) => tryStore(() => localStorage.setItem(storeKey(slate), JSON.stringify(view)));
