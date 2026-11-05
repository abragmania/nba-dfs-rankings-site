// The player table's header and rows (optimizer standard A1, A17), drawn from the column keys columns.js gives, in that order.
// Every figure is read from the slate file as given (Usual and Chg from the slate route's min_usual, the board row's usual minutes); a
// missing one is the board's dash with a title, never zero (RULES R1).
// Pure strings, tested in node; board.js owns the state and the events.
import { esc, money, logo, ICON, injBadge } from "./board-util.js";
import { bumpControlHtml, bumpFigureHtml } from "./bump-control.js";
import { rowPin } from "./lateswap-panel.js";
import { limitCellHtml } from "./row-limits.js";
import { sgn, dcls } from "./console-model.js";
import { tonightRate } from "./figures.js";
import { moveLine, moveTag } from "./pull-note.js";

export const FIG_COLS = {
  salary: { key: "salary", label: "Sal", cls: "num sal", title: "no salary in this slate file" },
  minutes: { key: "minutes", label: "Min", cls: "num", title: "no minutes in this pull" },
  min_usual: { key: "min_usual", label: "Usual", cls: "num", title: "no usual minutes for him in this slate", head: "Usual minutes: his healthy-minutes figure, the one the console shows as Usual" },
  min_chg: { key: "min_chg", label: "Chg", cls: "num chg", title: "needs both Min and Usual", head: "Min minus Usual: how far tonight's minutes sit from his usual" },
  // This season's figures from Basketball-Reference, attached by the server (usage/board_figures.js); each player's
  // *_note says why a figure is missing, and *_tag marks last season's figure ("LY") or a 1-2 game sample ("1g", "2g").
  dk_per_min: { key: "dk_per_min", label: "DK/m SZN", cls: "num fig", title: "no DK points per minute from the server", head: "Season average DraftKings points per minute, which doesn't change with tonight's news: +3 per triple-double; the +1.5 double-double bonus is left out (Basketball-Reference season totals carry no double-double count). 2026-27 regular season" },
  dk_tonight: { key: "dk_tonight", label: "DK/m TON", cls: "num ton", head: "Tonight's expected DraftKings points per minute: Proj divided by Min as the board shows them, so it follows an Apply and typed numbers. The arrow compares tonight with the season figure; the small signed number is the move since the last pull" },
  usage: { key: "usage", label: "Usg", cls: "num fig", title: "no usage rate from the server", head: "Usage rate, 2026-27 regular season" },
  projection: { key: "projection", label: "Proj", cls: "num proj", title: "no projection in this pull" },
  value: { key: "value", label: "Val", cls: "num bar val", title: "no value in this pull" },
  proj_own: { key: "proj_own", label: "Own", cls: "num bar own", title: "no projected ownership in this pull" },
};
/** Min minus Usual, to the tenth as Min shows; null when either figure is missing (never a stand-in). */
export const minChg = (p) => (typeof p.minutes === "number" && typeof p.min_usual === "number" ? Math.round((p.minutes - p.min_usual) * 10) / 10 : null);
/** Tonight's expected DK/min from the figures the board shows; null with either missing or on zero minutes. */
export const dkTonight = (p) => tonightRate(p.projection, p.minutes);
/** Tonight's DK/min against the season's, inside this far no arrow shows. Builder's value, not Adam's. */
export const TON_ARROW_BAND = 0.02;
/** The figure a sort on column key reads. */
export const sortValue = (p, key) => (key === "min_chg" ? minChg(p) : key === "dk_tonight" ? dkTonight(p) : p[key]);
/** Why a man has no figure tonight, for the dash's hover. */
const noTonight = (p) => (typeof p.minutes !== "number" ? "no minutes in this pull, so no DK/min tonight" : p.minutes <= 0 ? "on 0 minutes, so no DK/min tonight" : "no projection in this pull, so no DK/min tonight");
/** The Tonight cell: the figure, its arrow against the season's and both numbers on hover. */
function tonightCell(p, col, dash, withWhy) {
  const v = dkTonight(p);
  if (v === null) return `<td class="${col.cls}">${dash(noTonight(p))}${moveTag(null)}</td>`;
  const season = p.dk_per_min, d = typeof season === "number" ? Math.round((v - season) * 100) / 100 : null;
  const yours = p.ovr?.projection != null || p.ovr?.steps || "base_minutes" in p ? " · from your projection or applied minutes" : "";
  const title = `${d === null ? `Tonight ${v.toFixed(2)}; no season figure to compare` : `Tonight ${v.toFixed(2)}, season ${season.toFixed(2)}, ${d > 0 ? "+" : ""}${d.toFixed(2)}`}${yours}`;
  const arrow = d !== null && Math.abs(d) > TON_ARROW_BAND ? `<i class="ton-arr ${d > 0 ? "up" : "dn"}">${d > 0 ? "▲" : "▼"}</i>` : "";
  return `<td class="${col.cls}" title="${esc(withWhy(title))}">${arrow}${v.toFixed(2)}${moveTag(p.pull_move?.rate, 2, "TwoGun's DK/min", { signed: true })}</td>`;
}
/** The table's row order for sort { key, dir }: a blank figure goes last either way, ties by name. */
export function comparePlayers(a, b, { key, dir }) {
  if (key === "name") return dir * a.name.localeCompare(b.name);
  const x = sortValue(a, key), y = sortValue(b, key);
  if (x == null && y == null) return a.name.localeCompare(b.name);
  if (x == null) return 1;
  if (y == null) return -1;
  return dir * (x - y) || a.name.localeCompare(b.name);
}
/** Whether a row holds anything a reset clears: a typed number, a bump or applied minutes (applied minutes are not in ovr, which the bump controls read). */
export const hasResettable = (p) => Boolean(p.ovr) || "base_minutes" in p;
/** Every key the table can sort on. A remembered sort must be one of these (view-memory.js). */
export const SORT_KEYS = ["name", ...Object.keys(FIG_COLS)];
const CTL_HEAD = { star: "Star", lock: "Lock", exclude: "Exclude" };
const LIMIT_HEAD = { min_pct: "Min %", max_pct: "Max %" };

/** The header row. sort: { key, dir }; headTitle(col) is a season-figure column's tooltip. */
export function headHtml(keys, sort, headTitle) {
  const mark = (k) => (sort.key === k ? ` ${sort.dir < 0 ? "▾" : "▴"}` : "");
  const on = (k) => (sort.key === k ? " s" : "");
  const cell = (k) => {
    if (k === "name") return `<th class="pl${on("name")}" data-sort="name">Player${mark("name")}</th>`;
    if (k in CTL_HEAD) return `<th class="ctl" title="${CTL_HEAD[k]}"></th>`;
    if (k === "thumbs") return `<th class="bmp" title="Thumbs: raise or lower his projection"></th>`;
    if (k in LIMIT_HEAD) return `<th class="lim">${LIMIT_HEAD[k]}</th>`;
    const c = FIG_COLS[k];
    return `<th class="${c.cls}${on(k)}" data-sort="${k}"${c.head ? ` title="${esc(headTitle(c))}"` : ""}>${c.label}${mark(k)}</th>`;
  };
  return `<tr>${keys.map(cell).join("")}</tr>`;
}

/** Adam's overrides (server/slate/overrides.js): a click on Proj or Own opens its editor; a typed number wears the marker
 *  with the base on hover; Val follows the effective projection. */
function figCell(k, p, x) {
  const col = FIG_COLS[k], v = p[k], dash = x.dash;
  // A figure's own hover keeps its use and carries why the row is greyed after it, as it hides the row's own hover.
  const also = x.why ?? "";
  const withWhy = (t) => (also ? `${t} · ${also}` : t);
  if (k === "projection") return `<td class="${col.cls}">${bumpFigureHtml(p, v == null ? dash(col.title) : v.toFixed(1), also)}${moveTag(p.pull_move?.proj, 1, "TwoGun's projection")}</td>`;
  if (k === "dk_tonight") return tonightCell(p, col, dash, withWhy);
  if (k === "value" || k === "proj_own") {
    const own = k === "proj_own", typed = own && p.ovr?.proj_own != null;
    const edit = own ? ` data-edit="own" data-id="${esc(p.dk_id)}" title="${esc(withWhy(typed ? `Your number. Base ${p.base?.proj_own == null ? "none" : p.base.proj_own.toFixed(1) + "%"}; click to change it, or reset the row` : "Click to type your own projected ownership"))}"` : "";
    const vcls = `v${own ? " ov-own" : ""}${typed ? " ov-typed" : ""}`;
    const moved = !own && p.base && p.base.value !== p.value ? ` title="${esc(withWhy(`From the ${p.ovr?.projection != null ? "typed" : "bumped"} projection; base ${p.base.value == null ? "none" : p.base.value.toFixed(2)}`))}"` : "";
    if (v == null) return `<td class="${col.cls}"><span class="b off"></span><span class="${vcls}"${edit}>${dash(col.title)}</span></td>`;
    const w = k === "value" ? Math.max(4, x.vmax > x.vmin ? ((v - x.vmin) / (x.vmax - x.vmin)) * 100 : 100) : x.omax ? (v / x.omax) * 100 : 0;
    return `<td class="${col.cls}"${moved}><span class="b"><i style="width:${w}%"></i></span><span class="${vcls}"${edit}>${k === "value" ? v.toFixed(2) : v.toFixed(1) + "%"}</span></td>`;
  }
  if (k === "min_usual") return `<td class="${col.cls}">${v == null ? dash(p.min_usual_note ?? col.title) : v.toFixed(1)}</td>`;
  if (k === "min_chg") {
    const c = minChg(p);
    return c == null ? `<td class="${col.cls}">${dash(p.min_usual_note ?? col.title)}</td>` : `<td class="${col.cls} ${dcls(c)}">${sgn(c)}</td>`;
  }
  if (k === "dk_per_min" || k === "usage") {
    const note = p[k + "_note"], tag = p[k + "_tag"];
    if (v == null) return `<td class="${col.cls}">${dash(note ?? col.title)}</td>`;
    const txt = k === "usage" ? v.toFixed(1) + "%" : v.toFixed(2);
    const hover = note ?? (k === "dk_per_min" ? "Season average from Basketball-Reference; doesn't change with tonight's news" : null);
    return `<td class="${col.cls}${tag ? " tagged" : ""}"${hover ? ` title="${esc(withWhy(hover))}"` : ""}>${txt}${tag ?`<sup class="tg${tag === "LY" ? " ly" : ""}">${esc(tag)}</sup>` : ""}</td>`;
  }
  const shown = v == null ? dash(col.title) : k === "salary" ? money(v) : v.toFixed(1);
  // Applied minutes stay across pulls, as a typed projection does, so they wear its marker and name TwoGun's figure.
  const moved = k === "minutes" ? moveTag(p.pull_move?.min, 1, "TwoGun's minutes") : "";
  if (k === "minutes" && v != null && "base_minutes" in p) return `<td class="${col.cls}"><span class="min-typed" title="${esc(withWhy(`From your Apply; TwoGun's ${p.base_minutes == null ? "none" : p.base_minutes.toFixed(1)}`))}">${shown}</span>${moved}</td>`;
  return `<td class="${col.cls}">${shown}${moved}</td>`;
}

/**
 * One player row. x: { dash, when(stamp), colourOf(team), tag (his position tag on this tab), lock, ex (Sets of dk_ids),
 * L (lateSwap view or null), inl (Set of the lineup on show, or null), blocks (Map of dk_id to why he cannot go into the
 * working lineup, or null: a greyed row, its figures and controls still there, standard A18), vmin, vmax, omax, limits (dk_id to
 * his { min, max }, standard B10) }.
 */
export function rowHtml(p, keys, x) {
  const c = x.colourOf(p.team), id = esc(p.dk_id), L = x.L, dash = x.dash;
  const why = L ? null : x.blocks?.get(p.dk_id) ?? null;
  const lk = x.lock.has(p.dk_id), ex = x.ex.has(p.dk_id);
  const gone = L && L.started.has(p.dk_id) && !L.inLineup.has(p.dk_id);
  // Any started man's lock and exclude are off in the mode: excluding a frozen man would only make the build fail.
  const btn = (title) => (L && L.started.has(p.dk_id) ? ` disabled title="Game started"` : ` title="${title}"`);
  // The note and the row's reset sit at the player cell's right edge (the reset is always drawn, hidden when the row has
  // nothing to reset, so the column never changes width).
  const ovr = hasResettable(p);
  const tools = `<span class="ovt"><button class="nt${p.note ? " on" : ""}" data-note="${id}" title="${esc(p.note ? `Note: ${p.note}` : "Note")}">✎</button><button class="rs${ovr ? "" : " off"}" data-reset="${id}" title="Reset ${esc(p.name)}'s typed numbers, bump and applied minutes (his star and note stay)"${ovr ? "" : " disabled tabindex=\"-1\""}>↺</button></span>`;
  const cell = (k) => {
    switch (k) {
      case "star": return `<td class="ctl"><button class="fav${p.starred ? " on" : ""}" data-star="${id}" title="${p.starred ? "Unstar" : "Star"}">${p.starred ? "★" : "☆"}</button></td>`;
      case "name": return `<td class="pl"><div class="who">${logo(p.team)}<div class="nm"><div class="l1"><button class="name" data-dk-id="${id}">${esc(p.name)}</button>${x.tag ? `<span class="pos">${esc(x.tag)}</span>` : ""}${injBadge(p.injury_status)}</div><div class="l2${p.pull_move ? " why" : ""}"${p.pull_move && p.tip ? ` title="Tip ${esc(x.when(p.tip))}"` : ""}>${esc(p.team)} ${p.oppText ? esc(p.oppText) : dash("no opponent in this slate file")} · ${p.pull_move ? moveLine(p.pull_move) : p.tip ? esc(x.when(p.tip)) : dash("no tip time in this slate file")}</div></div>${tools}</div></td>`;
      case "thumbs": return `<td class="bmp">${bumpControlHtml(p)}</td>`;
      // Late swap mode: the slot picker takes the lock button's place; a lock is still set from the player card.
      case "lock": return `<td class="ctl${L ? " ls" : ""}">${L ? rowPin(p, L) : `<button class="lk${lk ? " on" : ""}" data-lock="${id}"${btn("Lock")}>${ICON.lock}</button>`}</td>`;
      case "exclude": return `<td class="ctl"><button class="ex${ex ? " on" : ""}" data-excl="${id}"${btn("Exclude")}>${ICON.x}</button></td>`;
      case "min_pct": return limitCellHtml("min", p.dk_id, x.limits, Boolean(L));
      case "max_pct": return limitCellHtml("max", p.dk_id, x.limits, Boolean(L));
      default: return figCell(k, p, { ...x, why });
    }
  };
  return `<tr class="team${p.pull_move ? " moved" : ""}${lk ? " locked" : ""}${ex ? " excl" : ""}${gone ? " started" : ""}${L ? "" : why ? " blk" : " pk"}${x.inl?.has(p.dk_id) ? " inl" : ""}" data-row="${id}" style="--t1:${c.t1};--t2:${c.t2}"${gone ? ` title="Game started"` : why ? ` title="${esc(why)}"` : ""}>${keys.map(cell).join("")}</tr>`;
}
