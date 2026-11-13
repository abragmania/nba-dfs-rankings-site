// The exposure table over a set of built or saved lineups (Adam 6:48 PM ET 2026-10-29, after the NFL app's optimizer results) and the
// helpers the Lineups tab shares: a man's name opens his player card (board.js reads data-dk-id from any click). Layout ported from the
// NFL app's exposure table, written in this app's own style. exposureRows, sortExposure and savedKeys are pure and tested in node.
// The cards themselves are drawn by lineups-tab.js.
import { esc } from "./board-util.js";
import { setKey } from "./slots.js";
import { nameLink } from "./card-row.js";
import { EXPOSURE_POS } from "./view-memory.js";

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

/** Per starred man on the board: how many of the lineups hold him (0 included, never left out). `byId` is the board's rows (the star is read from them);
 *  `lineups` = arrays of dk_ids. Name order. Pure. */
export function starredCounts(lineups, byId) {
  const men = [...byId.values()].filter((p) => p?.starred === true && p.dk_id != null);
  return men.map((p) => ({ id: p.dk_id, name: p.name ?? String(p.dk_id), count: lineups.filter((ids) => ids.includes(p.dk_id)).length, total: lineups.length }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** The strip above the cards: every starred man lit, "in N of M lineups"; "in 0" in red for a man in none. "" with nobody starred or no lineups. */
export function starStripHtml(counts) {
  if (!counts.length || !counts[0].total) return "";
  const chip = (r) => `<span class="stc${r.count ? "" : " zero"}" title="${r.count ? `${esc(r.name)} is in ${r.count} of ${r.total} lineups` : `${esc(r.name)} is starred and is in none of these lineups`}"><i>★</i>${nameLink({ dk_id: r.id, name: r.name })}<em>${r.count ? `in ${r.count} of ${r.total} lineup${r.total === 1 ? "" : "s"}` : "in 0"}</em></span>`;
  return `<div class="lt-stars">${counts.map(chip).join("")}</div>`;
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
export { setKey }; // defined once in slots.js (the server's save path reads the same key)
/** A lineup's saved-ness key: its mode and its men, the server's rule (a Cash lineup is not "saved" by a GPP one holding the same men). */
export const savedKey = (mode, ids) => `${mode}#${setKey(ids)}`;
export const savedKeys = (saved) => new Set((saved ?? []).map((s) => savedKey(s.mode, s.slots)));

/** A built man as the card keeps him: the board's row when he was built, for his opponent's words and season figures, under the figures the build answered with. */
export const frozenMen = (slots, byId) => slots.map((m) => ({ ...byId.get(m.dk_id), ...m }));

/** The rows a Build's cards draw from: the men it answered with, so a new pull changes nothing on them. A result with no such men reads the board. Pure. */
export function builtFigures(lineups, live) {
  const out = new Map(live);
  for (const l of lineups) for (const m of l.men ?? []) out.set(m.dk_id, m);
  return out;
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
export function exposureHtml(rows, sort, dash, only = null, pos = "All", field = false, dim = false) {
  const head = (key, label, cls = "") => `<th class="sortable${cls ? ` ${cls}` : ""}" data-op="expsort" data-key="${key}" title="Sort by ${label}">${label}${sort.key === key ? (sort.dir > 0 ? " ▲" : " ▼") : ""}</th>`;
  const isOn = (id) => (Array.isArray(only) ? only.includes(id) : only === id); // the men filtered (an AND), or the one the older list had
  const shown = pos === "All" ? rows : rows.filter((r) => (r.positions ?? []).includes(pos));
  const body = !shown.length ? `<tr><td colspan="${field ? 8 : 6}" class="ex-none">No man in these lineups plays ${esc(pos)}.</td></tr>` : sortExposure(shown, sort).map((r) => `<tr${dim && isOn(r.id) ? ' class="held"' : ""}><td class="ex-pct">${r.pct.toFixed(1)}% <span class="ex-n">(${r.count})</span></td>`
    + `<td class="ex-name">${nameLink({ dk_id: r.id, name: r.name })}</td>`
    + `<td>${r.pos ? esc(r.pos) : dash("no position in this slate file")}</td><td>${r.team ? esc(r.team) : dash("no team in this slate file")}</td>`
    + `<td class="ex-own">${r.own == null ? dash("no projected ownership in this pull") : r.own.toFixed(1) + "%"}</td>`
    + (field ? fieldCells(r, dash) : "")
    + `<td class="ex-f"><button class="xf${isOn(r.id) ? " on" : ""}" data-op="expfilter" data-man="${esc(r.id)}" title="${isOn(r.id) ? `Take ${esc(r.name)} out of the filter` : `Show only the lineups with ${esc(r.name)} (and every man already filtered)`}">Filter</button></td></tr>`).join("");
  const filter = `<div class="expos"><span>Pos</span>${EXPOSURE_POS.map((p) => `<button class="xf${p === pos ? " on" : ""}" data-op="exppos" data-pos="${p}">${p}</button>`).join("")}</div>`;
  return `<div class="sec">Exposure</div><div class="exl">${filter}<table class="ext"><thead><tr>${head("pct", "Exposure", "ex-pct")}${head("name", "Player")}${head("pos", "Pos")}${head("team", "Team")}${head("own", "Own", "ex-own")}${field ? `<th title="Amber: his share of these lineups. Blue tick: his projected ownership.">You vs field</th>${head("diff", "Diff", "ex-own")}` : ""}<th></th></tr></thead><tbody>${body}</tbody></table></div>`;
}

/** A Build's result with card i gone (its Discard, standard A13): a saved copy stays saved, the lineup on show stays in range,
 *  and a Filter on a man no lineup holds now ends. A new object; the old result is untouched. */
export function withoutCard(res, i) {
  const lineups = res.lineups.filter((_, k) => k !== i);
  const only = res.only != null && lineups.some((l) => l.ids.includes(res.only)) ? res.only : null;
  return { ...res, lineups, only, idx: Math.max(0, Math.min(i < res.idx ? res.idx - 1 : res.idx, lineups.length - 1)) };
}
