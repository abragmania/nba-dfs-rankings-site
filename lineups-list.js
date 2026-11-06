// The built lineups as a list (Adam 6:48 PM ET 2026-10-29, after the NFL app's optimizer results): every lineup of the
// last Build as its own card, one vertical column of 8 men, and an exposure table over the whole set. A man's name opens
// his player card (board.js reads data-dk-id from any click). Layout ported from the NFL app's lineup cards and exposure
// table, written in this app's own style. The panel's helpers (dash, totals, the late-swap seat) come in as arguments, so
// this file never imports panel.js back. exposureRows, sortExposure and savedKeys are pure and tested in node. Every card's
// rows and totals come from card-row.js, the working lineup's own, and each card is one column with its totals last (A19).
import { esc } from "./board-util.js";
import { SLOTS } from "./slots.js";
import { cardRowHtml, capLine, nameLink } from "./card-row.js";
import { EXPOSURE_POS, DEFAULT_EXPOSURE_SORT } from "./view-memory.js";
import { swapButtonHtml, swapPanelHtml, swapOptions, lineupStarted } from "./swap-list.js";

/** Per man in the set: how many lineups hold him and what share of the lineups that is. `lineups` = arrays of dk_ids;
 *  `byId` gives the slate player (or undefined). A man no longer on the slate is left out. Order is by sortExposure. */
export function exposureRows(lineups, byId) {
  const counts = new Map();
  for (const ids of lineups) for (const id of new Set(ids)) counts.set(id, (counts.get(id) ?? 0) + 1);
  const rows = [];
  for (const [id, count] of counts) {
    const p = byId.get(id);
    if (!p) continue;
    const positions = p.positions ?? [];
    rows.push({ id, name: p.name ?? String(id), positions, pos: positions.length ? positions.join("/") : null, team: p.team ?? null, oppText: p.oppText ?? null, own: p.proj_own ?? null, count, pct: (count / lineups.length) * 100, diff: typeof p.proj_own === "number" ? (count / lineups.length) * 100 - p.proj_own : null });
  }
  return sortExposure(rows);
}

/** The table's order (A10): sort is { key, dir } on any column, Exposure's key being "pct". A man with no figure in that column
 *  goes last either way; ties by name so the order never jumps. */
export function sortExposure(rows, { key = "pct", dir = -1 } = {}) {
  const byName = (a, b) => String(a.name).localeCompare(String(b.name));
  return [...rows].sort((a, b) => {
    const x = a[key], y = b[key];
    if (x == null || y == null) return (x == null) - (y == null) || byName(a, b);
    return dir * (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) || byName(a, b);
  });
}

/** The sort after a click on a column's head: the same column turns round; a new one starts high to low on a figure, A to Z on words. */
export const nextExposureSort = (sort, key) => (sort.key === key ? { key, dir: -sort.dir } : { key, dir: key === "pct" || key === "own" || key === "diff" ? -1 : 1 });

/** A key for a set of men whatever the slot order, so a built lineup matches the saved one holding the same eight. */
export const setKey = (ids) => [...ids].map(String).sort().join("|");
export const savedKeys = (saved) => new Set((saved ?? []).map((s) => setKey(s.slots)));

/** A built man as the card keeps him: the board's row when he was built, for his opponent's words and season figures, under the figures the build answered with. */
export const frozenMen = (slots, byId) => slots.map((m) => ({ ...byId.get(m.dk_id), ...m }));

/** The rows a Build's cards draw from: the men it answered with, so a new pull changes nothing on them. A result with no such men reads the board. Pure. */
export function builtFigures(lineups, live) {
  const out = new Map(live);
  for (const l of lineups) for (const m of l.men ?? []) out.set(m.dk_id, m);
  return out;
}

function cardHtml(l, i, { byId, locked, saved, dash, seat, colourOf, tagOf = () => null, swap = null }) {
  const men = seat(l.ids.map((id) => byId.get(id) ?? { dk_id: id, stale: true })).men; // as the CSV writes it
  const save = saved ? `<button class="sm on" disabled>Saved ✓</button>` : `<button class="sm" data-op="savecard" data-i="${i}">Save</button>`;
  const ls = `<button class="sm" data-op="lscard" data-i="${i}" title="Start late swap from this lineup">Late swap</button>`;
  const discard = `<button class="sm x" data-op="discard" data-i="${i}" title="Take this lineup off the list">Discard</button>`;
  return `<div class="lc${saved ? " savedc" : ""}"><div class="lch"><span>Lineup ${i + 1}</span><span class="lcb">${ls}${save}${discard}</span></div>`
    + SLOTS.map((s, k) => {
      const lk = locked.has(men[k]?.dk_id), tag = tagOf(men[k]);
      const open = swap?.open?.i === i && swap.open.id === men[k]?.dk_id;
      const row = cardRowHtml({ ctl: swap ? swapButtonHtml(men[k], i, swap.ctx, swap.open?.i === i ? swap.open.id : null, lineupStarted(men, swap.ctx)) : null, slot: s, p: men[k], dash, colourOf, cls: `lr${lk ? " locked" : ""}${tag ? " gonetag" : ""}`, note: [lk ? "locked" : "", tag ?? ""].filter(Boolean).join(" · ") });
      return row + (open ? swapPanelHtml(swapOptions(l.ids, men[k].dk_id, swap.ctx), i, dash) : "");
    }).join("")
    + capLine(men.map((p) => (p.stale ? null : p)), { dash }) + `</div>`;
}

/** The two extra cells (Adam, 2026-11-04): a bar of the man's share of the lineups with a tick at his projected own, then the
 *  share minus that own. Only in this table, never on a lineup card; a man with no projected own gets dashes. */
function fieldCells(r, dash) {
  const why = "no projected ownership in this pull";
  if (r.own == null) return `<td class="ex-bar">${dash(why)}</td><td class="ex-own">${dash(why)}</td>`;
  const cap = (v) => Math.max(0, Math.min(100, v)).toFixed(1);
  return `<td class="ex-bar"><span class="xb"><i style="width:${cap(r.pct)}%"></i><u style="left:${cap(r.own)}%"></u></span></td>`
    + `<td class="ex-diff">${r.diff >= 0 ? "+" : "−"}${Math.abs(r.diff).toFixed(1)}</td>`;
}

/** The one exposure table (A10): every column sorts, `Pos` shows the men who can play one position (`pos`, "All" for all), and
 *  each man's Filter button shows only the lineups holding him (`only` is the man it is on now; his name opens his card, A7). */
export function exposureHtml(rows, sort, dash, only = null, pos = "All", field = false) {
  const head = (key, label, cls = "") => `<th class="sortable${cls ? ` ${cls}` : ""}" data-op="expsort" data-key="${key}" title="Sort by ${label}">${label}${sort.key === key ? (sort.dir > 0 ? " ▲" : " ▼") : ""}</th>`;
  const isOn = (id) => (Array.isArray(only) ? only.includes(id) : only === id); // the men filtered (an AND), or the one the older list had
  const shown = pos === "All" ? rows : rows.filter((r) => (r.positions ?? []).includes(pos));
  const body = !shown.length ? `<tr><td colspan="${field ? 8 : 6}" class="ex-none">No man in these lineups plays ${esc(pos)}.</td></tr>` : sortExposure(shown, sort).map((r) => `<tr><td class="ex-pct">${r.pct.toFixed(1)}% <span class="ex-n">(${r.count})</span></td>`
    + `<td class="ex-name">${nameLink({ dk_id: r.id, name: r.name })}</td>`
    + `<td>${r.pos ? esc(r.pos) : dash("no position in this slate file")}</td><td>${r.team ? esc(r.team) : dash("no team in this slate file")}</td>`
    + `<td class="ex-own">${r.own == null ? dash("no projected ownership in this pull") : r.own.toFixed(1) + "%"}</td>`
    + (field ? fieldCells(r, dash) : "")
    + `<td class="ex-f"><button class="xf${isOn(r.id) ? " on" : ""}" data-op="expfilter" data-man="${esc(r.id)}" title="${isOn(r.id) ? `Take ${esc(r.name)} out of the filter` : `Show only the lineups with ${esc(r.name)} (and every man already filtered)`}">Filter</button></td></tr>`).join("");
  const filter = `<div class="expos"><span>Pos</span>${EXPOSURE_POS.map((p) => `<button class="xf${p === pos ? " on" : ""}" data-op="exppos" data-pos="${p}">${p}</button>`).join("")}</div>`;
  return `<div class="sec">Exposure</div><div class="exl">${filter}<table class="ext"><thead><tr>${head("pct", "Exposure", "ex-pct")}${head("name", "Player")}${head("pos", "Pos")}${head("team", "Team")}${head("own", "Own", "ex-own")}${field ? `<th title="Amber: his share of these lineups. Blue tick: his projected ownership.">You vs field</th>${head("diff", "Diff", "ex-own")}` : ""}<th></th></tr></thead><tbody>${body}</tbody></table></div>`;
}

/** The lineups a Filter button leaves on show, each with its place in the whole Build (a card's Save and Late swap use it). */
export function filterLineups(lineups, only) {
  return lineups.map((l, i) => ({ l, i })).filter(({ l }) => only == null || l.ids.includes(only));
}

/** A Build's result with card i gone (its Discard, standard A13): a saved copy stays saved, the lineup on show stays in range,
 *  and a Filter on a man no lineup holds now ends. A new object; the old result is untouched. */
export function withoutCard(res, i) {
  const lineups = res.lineups.filter((_, k) => k !== i);
  const only = res.only != null && lineups.some((l) => l.ids.includes(res.only)) ? res.only : null;
  return { ...res, lineups, only, idx: Math.max(0, Math.min(i < res.idx ? res.idx - 1 : res.idx, lineups.length - 1)) };
}

/**
 * The whole list for a Build: a heading, the exposure table, then every lineup card. `res` = P.results[mode]
 * ({ lineups: [{ids}], only }); `sort` = the exposure sort; ctx = { byId, picks, saved, dash, seat, colourOf, pos (the table's Pos filter) }.
 */
export function lineupListHtml(res, sort, { byId: live, picks, saved, dash, seat, colourOf = null, pos = "All", tagOf = () => null, swap = null }) {
  const lineups = res.lineups, n = lineups.length, only = res.only ?? null, byId = builtFigures(lineups, live);
  const keys = savedKeys(saved), locked = new Set(picks.locked);
  const nSaved = lineups.filter((l) => keys.has(setKey(l.ids))).length;
  const shown = filterLineups(lineups, only);
  const man = only == null ? null : byId.get(only);
  const with_ = only == null ? "" : ` · ${shown.length} with ${man ? nameLink(man, "il") : esc(only)}`;
  const head = `<div class="sec">${n} lineup${n === 1 ? "" : "s"} from ${res.kept ? "an earlier" : "the last"} Build${nSaved ? ` · ${nSaved} saved` : ""}${with_}</div>`;
  const cards = shown.map(({ l, i }) => cardHtml(l, i, { byId, locked, saved: keys.has(setKey(l.ids)), dash, seat, colourOf, tagOf, swap })).join("");
  return head + exposureHtml(exposureRows(lineups.map((l) => l.ids), byId), n === 1 && sort.key === "diff" ? DEFAULT_EXPOSURE_SORT : sort, dash, only, pos, n > 1) + `<div class="lcs">${cards}</div>`;
}
