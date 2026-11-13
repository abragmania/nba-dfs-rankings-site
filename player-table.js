// The player table's header and rows (optimizer standard A1, A17), drawn from the column keys columns.js gives, in that order.
// Every figure is read from the slate file as given (Usual and Chg from the slate route's min_usual, the board row's usual minutes); a
// missing one is the board's dash with a title, never zero (RULES R1).
// Pure strings, tested in node; board.js owns the state and the events.
import { esc, money, logo, ICON, statusBadge, figSourceWord, hisProj, hisMin, boardTyped } from "./board-util.js";
import { bumpControlHtml, bumpFigureHtml } from "./bump-control.js";
import { rowPin } from "./lateswap-panel.js";
import { limitCellHtml } from "./row-limits.js";
import { sgn, dcls } from "./console-model.js";
import { tonightRate, outFor, isNum } from "./figures.js";
import { moveLine, moveTag } from "./pull-note.js";
import { starterChipHtml, undoChipHtml } from "./board-marks.js";
import { tgMin } from "./lineup-proposals.js";

export const FIG_COLS = {
  salary: { key: "salary", label: "Salary", cls: "num sal", title: "no salary in this slate file", head: "DraftKings salary" },
  minutes: { key: "minutes", label: "Min", cls: "num", title: "no minutes in this pull", head: "Minutes: tonight's minutes on this board (click a figure to type your own)" },
  // The other source's minutes, beside Min (Adam, 11-09): Ours while TwoGun's is in force, TG if ours ever is. Blank, dim and with its reason on hover until a figure exists.
  min_other: { key: "min_other", label: "Our Min", cls: "num alt", title: "no figure from the other source for him" },
  min_usual: { key: "min_usual", label: "Mins", cls: "num fig", title: "no usual minutes for him in this slate", head: "Usual minutes (Mins): his healthy-minutes figure, the one the console shows as Usual" },
  min_chg: { key: "min_chg", label: "Chg", cls: "num fig chg", title: "needs both Min and Usual", head: "Chg: Min minus Usual minutes, how far tonight's minutes sit from his usual" },
  // This season's figures from Basketball-Reference, attached by the server (usage/board_figures.js); each player's
  // *_note says why a figure is missing, and *_tag marks last season's figure ("LY") or a 1-2 game sample ("1g", "2g").
  dk_per_min: { key: "dk_per_min", label: "DK/min", cls: "num fig", title: "no DK points per minute from the server", head: "DK/min, season: average DraftKings points per minute, which doesn't change with tonight's news: +3 per triple-double; the +1.5 double-double bonus is left out (Basketball-Reference season totals carry no double-double count). 2026-27 regular season" },
  dk_tonight: { key: "dk_tonight", label: "DK/min", cls: "num ton", head: "DK/min, tonight: expected DraftKings points per minute: Proj divided by Min as the board shows them, so it follows minutes set in the console and typed numbers. The arrow compares tonight with the season figure; the small signed number is the move since the last pull" },
  usage: { key: "usage", label: "Usage %", cls: "num fig", title: "no usage rate from the server", head: "Usage rate (usage %), 2026-27 regular season" },
  projection: { key: "projection", label: "Proj", cls: "num proj", title: "no projection in this pull", head: "Projected DraftKings points tonight (click a figure to type your own)" },
  value: { key: "value", label: "Value", cls: "num val", title: "no value in this pull", head: "Value: projected points per $1,000 of salary" },
  proj_own: { key: "proj_own", label: "Own %", cls: "num own", title: "no projected ownership in this pull", head: "Projected ownership: the share of lineups that will hold him (click a figure to type your own)" },
};
/** The three groups of figure columns (Adam, 11-09): "p" tonight's projections, tinted as one band; "s" stats, what happened, quieter; "c" the controls.
 *  Sal, Star and Player belong to none. A column that opens a group after another group or after Sal gets the divider. */
const FAM = { projection: "p", value: "p", proj_own: "p", minutes: "p", min_other: "p", dk_tonight: "p", dk_per_min: "s", usage: "s", min_usual: "s", min_chg: "s", thumbs: "c", lock: "c", exclude: "c", min_pct: "c", max_pct: "c" };
/** The band names over the projection and stats families. */
const BAND = { p: "Tonight", s: "Season Stats" };
export const famOf = (k) => FAM[k] ?? "";
/** The classes a column's cell and header carry for its group: " gp"/" gs"/" gc", and " gd" where the group starts. */
export function famClass(keys, i) {
  const f = famOf(keys[i]);
  // The controls at the far left (after Star or nothing) get no divider; the limits at the right end do.
  const before = i > 0 ? famOf(keys[i - 1]) : "";
  return f ? ` g${f}${i > 0 && before !== f && !(f === "c" && !before) ? " gd" : ""}` : "";
}
const addClass = (html, add) => (add ? html.replace(/^(<t[dh] class=")([^"]*)"/, `$1$2${add}"`) : html);
/** Which source the Min column shows, "twogun" unless the slate says otherwise. Nothing switches it yet. */
export const minSourceOf = (slate) => (slate?.min_source === "ours" ? "ours" : "twogun");
/** The header of the beside column: the source that is NOT in force. */
/** The Our Min header hover (TwoGun in force); the TG Min header (ours in force) has none. */
const MIN_OTHER_HEAD = "Our own minutes estimate for tonight, for comparison with Min; it feeds nothing.";
export const minOtherLabel = (source = "twogun") => (source === "ours" ? "TG Min" : "Our Min");
/** The beside column's figure and hover for a man: { value, note }. While TwoGun's is in force it is ours (min_ours); if ours were in force it is TwoGun's own figure (the base under any minutes set in the console). */
export function minOtherOf(p, source = "twogun") {
  if (source === "ours") {
    const tg = tgMin(p);
    return typeof tg === "number" ? { value: tg, note: "TwoGun's minutes, as pulled" } : { value: null, note: "no TwoGun minutes in this pull" };
  }
  return typeof p.min_ours === "number" ? { value: p.min_ours, note: p.min_ours_note ?? "our own minutes" } : { value: null, note: p.min_ours_note ?? "our own minutes are not on this slate" };
}
/** Minutes; Adam 11-12: flag ours vs TwoGun this far apart. */
export const GAP_WARN = 10;
/** The two figures a gap compares, each to the tenth: the one the board shows as ours (p.minutes under our engine, typed or not; min_ours in TwoGun mode and on the site) and TwoGun's own as pulled; null on a side with no number. */
function gapFigures(p) {
  const t = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
  return { ours: t(p?.proj_source === "ours" ? p.minutes : p?.min_ours), tg: t(tgMin(p)) };
}
/** Ours against TwoGun's own minutes: { ours, tg, gap, word } when both are numbers and GAP_WARN or more apart, else null (G62: a missing figure is no flag, the dash already says so). word names the ours side ("Ours", or "Yours" for a typed row). */
export function minGapOf(p) {
  const { ours, tg } = gapFigures(p);
  if (ours === null || tg === null) return null;
  const gap = Math.round(Math.abs(ours - tg) * 10) / 10;
  return gap >= GAP_WARN ? { ours, tg, gap, word: p.proj_source === "ours" ? figSourceWord(p, "min") || "Ours" : "Ours" } : null;
}
/** The hover for the gap mark. */
export const gapTitle = (g) => `${g.word ?? "Ours"} ${g.ours.toFixed(1)} vs TwoGun ${g.tg.toFixed(1)}: a ${g.gap.toFixed(1)}-minute gap. Check his role before using him.`;
/** The count chip beside the pull chips: names on hover, a click filters to them (filters.js "gap"). At zero it is dim and disabled with how many men were compared and how many lacked a figure (G62), as pullChipHtml does; with the filter on it stays live so he can turn it off. */
export function gapChipHtml(players, on) {
  const men = players.map((p) => ({ p, g: minGapOf(p) })).filter((x) => x.g);
  if (!men.length) {
    const compared = players.filter((p) => { const f = gapFigures(p); return f.ours !== null && f.tg !== null; }).length;
    const why = `No man is ${GAP_WARN}+ minutes apart: ${compared} compared, ${players.length - compared} lacked a figure on one side or both.`;
    return on ? `<button data-chip="gap" class="chip gapchip on zero" title="${esc(`${why} Click to show everyone again`)}">⚠ Min gap <b>0</b></button>` : `<button class="chip gapchip zero" disabled title="${esc(why)}">⚠ Min gap <b>0</b></button>`;
  }
  const names = men.map(({ p, g }) => `${p.name} (${g.word.toLowerCase()} ${g.ours.toFixed(1)}, TwoGun ${g.tg.toFixed(1)})`).join("\n");
  return `<button data-chip="gap" class="chip gapchip${on ? " on" : ""}" title="${esc(`${men.length} player${men.length === 1 ? "" : "s"}: ours and TwoGun ${GAP_WARN}+ minutes apart. ${on ? "Click to show everyone again" : "Click to show only these men"}\n${names}`)}">⚠ Min gap <b>${men.length}</b></button>`;
}
/** Min minus Usual, to the tenth as Min shows; null when either figure is missing (never a stand-in). */
export const minChg = (p) => (typeof p.minutes === "number" && typeof p.min_usual === "number" ? Math.round((p.minutes - p.min_usual) * 10) / 10 : null);
/** Tonight's expected DK/min from the figures the board shows; null with either missing or on zero minutes. */
export const dkTonight = (p) => tonightRate(p.projection, p.minutes);
/** Tonight's DK/min against the season's, inside this far no arrow shows. Builder's value, not Adam's. */
export const TON_ARROW_BAND = 0.02;
/** The figure a sort on column key reads. */
export const sortValue = (p, key, source = "twogun") => (key === "min_chg" ? minChg(p) : key === "dk_tonight" ? dkTonight(p) : key === "min_other" ? minOtherOf(p, source).value : p[key]);
/** The Proj cell's hover under our minutes engine: why his figure is missing, or ours against TwoGun's; null on TwoGun's own figures. */
export function projTitle(p) {
  if (p.proj_note) return p.proj_note;
  if (p.proj_source !== "ours") return null;
  const tg = typeof p.tg_projection === "number" ? p.tg_projection.toFixed(1) : "none";
  const rate = typeof p.ours?.rate === "number" ? p.ours.rate.toFixed(2) : "missing";
  return `Ours: ${typeof p.ours?.minutes === "number" ? p.ours.minutes.toFixed(1) : "—"} min x DK/min ${rate}; TwoGun ${tg}`;
}
/** Why a man has no figure tonight, for the dash's hover. */
const noTonight = (p) => (typeof p.minutes !== "number" ? "no minutes in this pull, so no DK/min tonight" : p.minutes <= 0 ? "on 0 minutes, so no DK/min tonight" : "no projection in this pull, so no DK/min tonight");
/** The Tonight cell: the figure, its arrow against the season's and both numbers on hover. */
function tonightCell(p, col, dash, withWhy, mark) {
  const v = dkTonight(p);
  if (v === null) return `<td class="${col.cls}"><span class="cu"></span>${dash(noTonight(p))}${moveTag(null)}</td>`;
  const season = p.dk_per_min, d = typeof season === "number" ? Math.round((v - season) * 100) / 100 : null;
  const yours = hisProj(p) || p.ovr?.steps || hisMin(p) ? " · from your projection or minutes set in the console" : "";
  const title = `${d === null ? `Tonight ${v.toFixed(2)}; no season figure to compare` : `Tonight ${v.toFixed(2)}, season ${season.toFixed(2)}, ${d > 0 ? "+" : ""}${d.toFixed(2)}`}${mark ? " · your typed DK/min" : yours}. Click to type his DK/min; Proj = Min × DK/min`;
  const arrow = d !== null && Math.abs(d) > TON_ARROW_BAND ? `<i class="ton-arr ${d > 0 ? "up" : "dn"}">${d > 0 ? "▲" : "▼"}</i>` : "";
  return `<td class="${col.cls}" title="${esc(withWhy(title))}"><span class="cu">${undoChipHtml(p.dk_id, "d", mark)}</span>${arrow}<span class="cedit${mark ? " ctyped" : ""}" data-edit="crate" data-id="${esc(p.dk_id)}">${v.toFixed(2)}</span>${moveTag(p.pull_move?.rate, 2, "TwoGun's DK/min", { signed: true })}</td>`;
}
/** The table's row order for sort { key, dir }: a blank figure goes last either way, ties by name. */
export function comparePlayers(a, b, { key, dir }, source = "twogun") {
  if (key === "name") return dir * a.name.localeCompare(b.name);
  const x = sortValue(a, key, source), y = sortValue(b, key, source);
  if (x == null && y == null) return a.name.localeCompare(b.name);
  if (x == null) return 1;
  if (y == null) return -1;
  return dir * (x - y) || a.name.localeCompare(b.name);
}
/** Whether a row holds anything a board reset clears: a projection, ownership or bump typed on the board (board-util.js boardTyped). Console figures and news's keep it off. */
export const hasResettable = (p) => boardTyped(p);
/** Every key the table can sort on. A remembered sort must be one of these (view-memory.js). */
export const SORT_KEYS = ["name", ...Object.keys(FIG_COLS)];
const CTL_HEAD = { star: "Star", lock: "Lock", exclude: "Exclude" };
const LIMIT_HEAD = {
  min_pct: ["Min Exp %", "Min Exp %: the least share of the optimizer's lineups he must be in (type a percent in the box)"],
  max_pct: ["Max Exp %", "Max Exp %: the most share of the optimizer's lineups he may be in (type a percent in the box)"],
};

/** The header row. sort: { key, dir }; headTitle(col) is a season-figure column's tooltip. */
export function headHtml(keys, sort, headTitle, minSource = "twogun") {
  // The arrow is drawn by board.css (th.s::after) in room every sortable header keeps, so a sort moves no column; .up flips it.
  const on = (k) => (sort.key === k ? (sort.dir < 0 ? " s" : " s up") : "");
  const cell = (k) => {
    if (k === "name") return `<th class="pl${on("name")}" data-sort="name">Player</th>`;
    if (k in CTL_HEAD) return `<th class="ctl" title="${CTL_HEAD[k]}"></th>`;
    if (k === "thumbs") return `<th class="bmp" title="Thumbs: raise or lower his projection"></th>`;
    if (k in LIMIT_HEAD) return `<th class="lim" title="${esc(LIMIT_HEAD[k][1])}">${LIMIT_HEAD[k][0]}</th>`;
    const c = FIG_COLS[k];
    return `<th class="${c.cls}${on(k)}" data-sort="${k}"${k === "min_other" ? (minSource === "ours" ? "" : ` title="${MIN_OTHER_HEAD}"`) : c.head ? ` title="${esc(headTitle(c))}"` : ""}>${k === "min_other" ? minOtherLabel(minSource) : c.label}</th>`;
  };
  // A small band name over the first shown column of the projection family ("Tonight") and the stats family ("Season Stats"), drawn by board.css from data-band.
  const band = (k, i) => (i > 0 && famOf(keys[i - 1]) === famOf(k) ? "" : BAND[famOf(k)] ?? "");
  const withBand = (html, b) => (b ? html.replace(/^(<th[^>]*)>/, `$1 data-band="${b}">`) : html);
  return `<tr>${keys.map((k, i) => withBand(addClass(cell(k), famClass(keys, i)), band(k, i))).join("")}</tr>`;
}

/** A number he typed on a man who is Out: kept, drawn struck, and used once he is In (figures.js outFor). */
const struckOut = (p) => isNum(p?.ovr?.projection) && p.ovr.projection > 0 && outFor(p, { engine: true });

/** Adam's overrides (server/slate/overrides.js): a click on Proj or Own opens its editor; a typed number wears the marker
 *  with the base on hover; Val follows the effective projection. */
function figCell(k, p, x) {
  const col = FIG_COLS[k], v = p[k], dash = x.dash;
  // A figure's own hover keeps its use and carries why the row is greyed after it, as it hides the row's own hover.
  const also = x.why ?? "";
  const withWhy = (t) => (also ? `${t} · ${also}` : t);
  if (k === "projection") return `<td class="${col.cls}${struckOut(p) ? " ostruck" : ""}"${projTitle(p) || struckOut(p) ? ` title="${esc([projTitle(p), struckOut(p) ? "Your number is kept while he is Out; it counts once he is In" : ""].filter(Boolean).join(" · "))}"` : ""}>${bumpFigureHtml(p, v == null ? dash(p.proj_note ?? col.title) : v.toFixed(1), also)}${moveTag(p.pull_move?.proj, 1, "TwoGun's projection")}</td>`;
  if (k === "dk_tonight") return tonightCell(p, col, dash, withWhy, x.mark?.d);
  if (k === "value" || k === "proj_own") {
    const own = k === "proj_own", typed = own && p.ovr?.proj_own != null;
    const edit = own ? ` data-edit="own" data-id="${esc(p.dk_id)}" title="${esc(withWhy(typed ? `Your number. Base ${p.base?.proj_own == null ? "none" : p.base.proj_own.toFixed(1) + "%"}; click to change it, or reset the row` : "Click to type your own projected ownership"))}"` : "";
    const vcls = `v${own ? " ov-own" : ""}${typed ? " ov-typed" : ""}`;
    const moved = !own && p.base && p.base.value !== p.value ? ` title="${esc(withWhy(`From the ${p.ovr?.projection != null ? (p.auto?.proj && !p.ovr?.steps ? "console" : "typed") : "bumped"} projection; base ${p.base.value == null ? "none" : p.base.value.toFixed(2)}`))}"` : "";
    if (v == null) return `<td class="${col.cls}"><span class="${vcls}"${edit}>${dash(col.title)}</span></td>`;
    return `<td class="${col.cls}"${moved}><span class="${vcls}"${edit}>${k === "value" ? v.toFixed(2) : v.toFixed(1) + "%"}</span></td>`;
  }
  if (k === "min_other") {
    const o = minOtherOf(p, x.minSource);
    return o.value === null ? `<td class="${col.cls} dim"${x.minSource === "ours" ? "" : ` title="${esc(withWhy(o.note))}"`}></td>` : `<td class="${col.cls}" title="${esc(withWhy(o.note))}">${o.value.toFixed(1)}</td>`;
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
  // Minutes set in the console stay across pulls, as a typed projection does, so they wear its marker and name TwoGun's figure.
  const moved = k === "minutes" ? moveTag(p.pull_move?.min, 1, "TwoGun's minutes") : "";
  if (k === "minutes") {
    // Min is typeable (Adam, 11-07): the number goes to the console as his typed minutes, and the console sends the board his projection.
    const mk = x.mark?.m, applied = v != null && hisMin(p), tg = tgMin(p);
    const tgText = `TwoGun's ${typeof tg === "number" ? tg.toFixed(1) : "none"}`;
    const hover = mk ? `Your typed minutes; ${tgText}. Click to change them` : applied ? `From the console; ${tgText}. Click to type his minutes` : "Click to type his minutes; Proj = Min × DK/min";
    const gap = minGapOf(p), warn = gap ? `<i class="gapw" title="${esc(gapTitle(gap))}">⚠</i>` : "";
    return `<td class="${col.cls}"><span class="cu">${undoChipHtml(p.dk_id, "m", mk)}</span>${warn}<span class="cedit${mk ? " ctyped" : applied ? " min-typed" : ""}" data-edit="cmin" data-id="${esc(p.dk_id)}" title="${esc(withWhy(hover))}">${shown}</span>${moved}</td>`;
  }
  return `<td class="${col.cls}">${shown}${moved}</td>`;
}

/**
 * One player row. x: { dash, when(stamp), colourOf(team), tag (his position tag on this tab), lock, ex (Sets of dk_ids),
 * L (lateSwap view or null), inl (Set of the lineup on show, or null), blocks (Map of dk_id to why he cannot go into the
 * working lineup, or null: a greyed row, its figures and controls still there, standard A18), limits (dk_id to
 * his { min, max }, standard B10), marks(dk_id) (board-marks.js: his S chip and typed minutes and DK/min, or null) }.
 */
export function rowHtml(p, keys, x) {
  const c = x.colourOf(p.team), id = esc(p.dk_id), L = x.L, dash = x.dash;
  const why = L ? null : x.blocks?.get(p.dk_id) ?? null;
  const lk = x.lock.has(p.dk_id), ex = x.ex.has(p.dk_id);
  x = { ...x, mark: x.marks?.(p.dk_id) ?? null }; // the console's word on him (board-marks.js): S chip, typed minutes and DK/min
  const gone = L && L.started.has(p.dk_id) && !L.inLineup.has(p.dk_id);
  // Any started man's lock and exclude are off in the mode: excluding a frozen man would only make the build fail.
  const btn = (title) => (L && L.started.has(p.dk_id) ? ` disabled title="Game started"` : ` title="${title}"`);
  // The row's reset sits at the player cell's right edge (the reset is always drawn, hidden when the row has
  // nothing to reset, so the column never changes width).
  const ovr = hasResettable(p);
  const tools = `<span class="ovt"><button class="rs${ovr ? "" : " off"}" data-reset="${id}" title="${ovr ? `Reset ${esc(p.name)}'s typed projection, ownership and bump (his star stays)` : hisMin(p) ? "His minutes are set in the console; change or clear them there" : `Nothing typed on the board to reset`}"${ovr ? "" : " disabled tabindex=\"-1\""}>↺</button></span>`;
  const cell = (k) => {
    switch (k) {
      case "star": return `<td class="ctl"><button class="fav${p.starred ? " on" : ""}" data-star="${id}" title="${p.starred ? "Unstar" : "Star"}">${p.starred ? "★" : "☆"}</button></td>`;
      case "name": return `<td class="pl"><div class="who">${logo(p.team)}<div class="nm"><div class="l1"><button class="name" data-dk-id="${id}">${esc(p.name)}</button>${starterChipHtml(x.mark?.chip)}${x.tag ? `<span class="pos">${esc(x.tag)}</span>` : ""}${statusBadge(p, x.mark?.inj)}</div><div class="l2${p.pull_move ? " why" : ""}"${p.pull_move && p.tip ? ` title="Tip ${esc(x.when(p.tip))}"` : ""}>${esc(p.team)} ${p.oppText ? esc(p.oppText) : dash("no opponent in this slate file")} · ${p.pull_move ? moveLine(p.pull_move) : p.tip ? esc(x.when(p.tip)) : dash("no tip time in this slate file")}</div></div>${tools}</div></td>`;
      case "thumbs": return `<td class="bmp">${bumpControlHtml(p)}</td>`;
      // Late swap mode: the slot picker takes the lock button's place; a lock is still set from the player card.
      case "lock": return `<td class="ctl${L ? " ls" : ""}">${L ? rowPin(p, L) : `<button class="lk${lk ? " on" : ""}" data-lock="${id}"${btn("Lock")}>${ICON.lock}</button>`}</td>`;
      case "exclude": return `<td class="ctl"><button class="ex${ex ? " on" : ""}" data-excl="${id}"${btn("Exclude")}>${ICON.x}</button></td>`;
      case "min_pct": return limitCellHtml("min", p.dk_id, x.limits, Boolean(L));
      case "max_pct": return limitCellHtml("max", p.dk_id, x.limits, Boolean(L));
      default: return figCell(k, p, { ...x, why });
    }
  };
  return `<tr class="team${p.pull_move ? " moved" : ""}${lk ? " locked" : ""}${ex ? " excl" : ""}${gone ? " started" : ""}${L ? "" : why ? " blk" : " pk"}${x.inl?.has(p.dk_id) ? " inl" : ""}" data-row="${id}" style="--t1:${c.t1};--t2:${c.t2}"${gone ? ` title="Game started"` : why ? ` title="${esc(why)}"` : ""}>${keys.map((k, i) => addClass(cell(k), famClass(keys, i))).join("")}</tr>`;
}
