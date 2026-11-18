// Our depth chart on the console's team page (Adam 11-17, layout B, his third sketch, "yes" at 2:32 PM): five columns PG, SG, SF, PF and C, the starter on top, each man a chip with a drag handle, his name,
// his minutes, his depth tag (S, 2nd, 3rd) and a B+ mark for a Bench+ man; under it the selected man's bar (up, down, position, Bench+) and the bench order the chart gives. The chart is the engine's own
// (console-tier.js pageChart: the payload's seed with his moves), so what it shows is what the minutes use. On the public site it is read-only (no handles, no bar). Pure strings, tested in node.
import { esc } from "./board-util.js";
import { pageChart, chartView } from "./console-tier.js";
import { POSITIONS, depthPlaces, fillNote } from "./depth-cols.js";

const FILL_NOTE = /Our chart had no healthy man at /;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const f1 = (x) => (isNum(x) ? (Math.round(x * 10) / 10).toFixed(1) : "—");
const SUFFIX = /^(?:jr\.?|sr\.?|ii|iii|iv|v)$/i;
const lastName = (n) => { const w = String(n ?? "").trim().split(/\s+/); while (w.length > 1 && SUFFIX.test(w.at(-1))) w.pop(); return w.at(-1) ?? ""; };

/**
 * The chart for team T on his work S: { cols: [{ pos, men, sum }], none: [men], bench: [men in the engine's bench order], posOf(id) -> position or null, view, sources, notes } or null when the inputs carry no
 * chart (an older payload). A man: { id, key, name (last name, or full when two share it), min, tag, starter, bplus, words (the sources' votes) }. rows: console-model.js calc rows.
 */
export function chartModel(T, S, rows) {
  const team = { tier: T.tier, depth_moves: S.depth_moves }, playing = rows.filter((r) => !r.out && r.role !== "oor" && T.tier?.men?.[r.id]);
  const ch = T.tier?.depth ? pageChart(team, playing.map((r) => r.id)) : null; // with tonight's fill of an empty column (the engine's own, console-tier.js)
  if (!ch) return null;
  const { view, idOf } = chartView(team, ch, playing.map((r) => r.id));
  const byId = new Map(rows.map((r) => [r.id, r])), five = new Set(playing.filter((r) => r.role === "starter").map((r) => T.tier.men[r.id].key)), places = depthPlaces(view, five);
  const names = playing.map((r) => r.p?.name ?? T.tier.men[r.id].name), short = (n) => (names.filter((x) => lastName(x) === lastName(n)).length > 1 ? n : lastName(n));
  const D = T.tier.depth, manOf = (k) => {
    const id = idOf.get(k), r = byId.get(id), name = r?.p?.name ?? T.tier.men[id]?.name ?? k;
    return { id, key: k, name: short(name), full: name, min: r?.min ?? null, tag: places.get(k)?.tag ?? "", starter: five.has(k), bplus: r?.role === "bench_plus", words: D.votes?.[k]?.words ?? "no position source names him" };
  };
  const cols = POSITIONS.map((p) => { const men = view[p].map(manOf); return { pos: p, men, sum: men.reduce((s, m) => s + (isNum(m.min) ? m.min : 0), 0) }; });
  const spot = (r) => (isNum(r.min_label?.spot) ? r.min_label.spot : 1e3);
  const bench = playing.filter((r) => r.role !== "starter").sort((a, b) => spot(a) - spot(b) || (b.min ?? 0) - (a.min ?? 0)).map((r) => manOf(T.tier.men[r.id].key));
  const keyOf = (id) => T.tier.men[id]?.key ?? null;
  const fill = fillNote(ch.fills ?? [], (k) => D.names?.[k] ?? k), notes = [...(D.notes ?? []).filter((n) => !FILL_NOTE.test(n)), ...(fill ? [`${T.code ?? "This team"}: ${fill}`] : [])]; // the live scenario's fill, not the read's
  return { cols, none: view.none.map(manOf), bench, view, posOf: (id) => (keyOf(id) ? ch.posOf.get(keyOf(id)) ?? null : null), sources: D.sources ?? [], notes, fills: ch.fills ?? [] };
}

/** One chip. sel: the selected man's id; ro: read-only. */
function chip(code, m, sel, ro) {
  const cls = `dc${m.starter ? " dc-st" : ""}${m.id === sel ? " dc-sel" : ""}${ro ? " dc-ro" : ""}`; // every class here is dc-: the board's own .st, .sel and .on must not reach the chart
  const handle = ro ? "" : `<span class="dc-gr" aria-hidden="true">&#10303;</span>`;
  return `<div class="${cls}"${ro ? "" : ` draggable="true" tabindex="0"`} data-dchip="${esc(m.id)}" data-team="${esc(code)}" title="${esc(`${m.full}: ${m.words}${ro ? "" : ". Drag him, or click him and use the bar below"}`)}">${handle}<span class="dc-nn">${esc(m.name)}</span><span class="dc-tag">${esc(m.tag)}</span><span class="dc-mm">${f1(m.min)} min${m.bplus ? ` <i class="dc-bp dc-on">B+</i>` : ""}</span></div>`;
}

/** The selected man's bar: his name, up and down, his position and the Bench+ toggle (read-only: none). */
function selBar(code, cm, sel) {
  const all = [...cm.cols.flatMap((c) => c.men), ...cm.none], m = all.find((x) => x.id === sel);
  if (!m) return `<div class="dc-ctl"><span class="dc-hint">Click a man for his arrows, position and B+; or drag him by his handle.</span></div>`;
  const pos = cm.posOf(m.id), col = pos ? cm.view[pos] : [], i = col.indexOf(m.key);
  const btn = (attr, text, title, off) => `<button class="dc-mv" type="button" ${attr} data-team="${esc(code)}" data-id="${esc(m.id)}" title="${esc(title)}"${off ? " disabled" : ""}>${text}</button>`;
  const opts = POSITIONS.map((p) => `<option value="${p}"${p === pos ? " selected" : ""}>${p}</option>`).join("");
  return `<div class="dc-ctl"><b>${esc(m.full)}</b>${btn('data-dstep="-1"', "&#9650;", "Up one in his column", !pos || i <= 0)}${btn('data-dstep="1"', "&#9660;", "Down one in his column", !pos || i < 0 || i >= col.length - 1)}
<select class="dc-pos" data-dpos="1" data-team="${esc(code)}" data-id="${esc(m.id)}" aria-label="${esc(m.full)}'s position">${pos ? "" : `<option value="" selected>No position</option>`}${opts}</select>
${m.starter ? "" : `<button class="dc-bp${m.bplus ? " dc-on" : ""}" type="button" data-dbp="1" data-team="${esc(code)}" data-id="${esc(m.id)}" title="${esc(m.bplus ? "Bench+ tonight. Click to make him plain Bench" : "Click to make him Bench+ tonight: he goes to the head of the bench order")}">B+</button>`}</div>`;
}

/** The whole box. sel: the selected man's id (or null); ro: read-only (the public site). */
export function chartHtml(code, cm, { sel = null, ro = false } = {}) {
  if (!cm) return "";
  const head = (c) => `<h3>${c.pos}<small>${f1(c.sum)}</small></h3>`;
  const cols = cm.cols.map((c) => `<div class="dcol" data-dcol="${c.pos}" data-team="${esc(code)}">${head(c)}${c.men.map((m) => chip(code, m, sel, ro)).join("")}</div>`).join("");
  const none = cm.none.length ? `<div class="dc-none" data-dcol="none"><span class="dc-nl">No position</span>${cm.none.map((m) => chip(code, m, sel, ro)).join("")}</div>` : "";
  const order = cm.bench.length ? `<div class="dc-ord"><b>Bench order from this chart:</b> ${cm.bench.map((m, i) => `${i + 1} ${esc(m.name)}`).join(", ")}<span>Bench+ first, then every 2nd, then every 3rd, ties by a blend of last 10 and season minutes a game</span></div>` : "";
  return `<section class="box dchart"><h2>Depth chart <small>${ro ? "our chart, as Adam set it" : "drag a man within or between columns; starter on top"}</small></h2><div class="dcols">${cols}</div>${none}${ro ? "" : selBar(code, cm, sel)}${order}</section>`;
}

/** The sources' line for the page's foot notes (G64: stamps at the foot): "Positions: ESPN depth chart 3:40 PM; Lineups.com depth chart not read (403 ...); ...". when: ISO -> short time. */
export function sourcesNote(cm, when) {
  if (!cm?.sources?.length) return null;
  return `Positions (never DraftKings'): ${cm.sources.map((s) => (s.state === "ok" ? `${s.label} ${s.carried ? `${s.day}` : when(s.fetched_at) ?? s.fetched_at}${s.stamp ? ` (its stamp ${when(s.stamp) ?? s.stamp})` : ""}${s.why ? ` [${s.why}]` : ""}` : `${s.label} not used (${s.why ?? "not read"})`)).join("; ")}`;
}
