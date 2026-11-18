// Our depth chart on the console's team page (Adam 11-17, layout B, his third sketch, "yes" at 2:32 PM): five columns PG, SG, SF, PF and C, the starter on top, each man a chip with a drag handle, his name,
// his minutes, his depth tag (S, 2nd, 3rd) and a B+ mark for a Bench+ man; under it the selected man's bar (up, down, position, Bench+) and the bench order the chart gives. The chart is the engine's own
// (console-tier.js pageChart: the payload's seed with his moves), so what it shows is what the minutes use, save the display-only move of a starter into a column with none (balanceFive). On the public site it is read-only (no handles, no bar). Pure strings, tested in node.
import { esc } from "./board-util.js";
import { pageChart, chartView } from "./console-tier.js";
import { POSITIONS, depthPlaces, fillNote, shiftNote, tonightCols } from "./depth-cols.js";

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
  const ch = T.tier?.depth ? pageChart(team, playing.map((r) => r.id), playing.filter((r) => r.role === "starter").map((r) => r.id)) : null; // with tonight's fill of an empty column and one starter at every position (console-tier.js; the balance is display only)
  if (!ch) return null;
  const { view, idOf } = chartView(team, ch, playing.map((r) => r.id));
  const byId = new Map(rows.map((r) => [r.id, r])), five = new Set(playing.filter((r) => r.role === "starter").map((r) => T.tier.men[r.id].key)), places = depthPlaces(view, five);
  const names = playing.map((r) => r.p?.name ?? T.tier.men[r.id].name), short = (n) => (names.filter((x) => lastName(x) === lastName(n)).length > 1 ? n : lastName(n));
  const D = T.tier.depth, manOf = (k) => {
    const id = idOf.get(k), r = byId.get(id), name = r?.p?.name ?? T.tier.men[id]?.name ?? k;
    return { id, key: k, name: short(name), full: name, min: r?.min ?? null, tag: places.get(k)?.tag ?? "", starter: five.has(k), bplus: r?.role === "bench_plus", words: D.votes?.[k]?.words ?? "no position source names him" };
  };
  const cols = POSITIONS.map((p) => { const men = view[p].map(manOf); return { pos: p, men, sum: men.reduce((s, m) => s + (isNum(m.min) ? m.min : 0), 0) }; });
  // the engine's bench spot, then the chart's own place (Bench+ first, then the 2nds, the 3rds; his place in the column), then name: never his minutes, so a typed number moves nobody (Adam 6:28 PM 11-18;
  // review of 11-18, finding 5: the row carries no blend of its own)
  const spot = (r) => (isNum(r.min_label?.spot) ? r.min_label.spot : 1e3), keyR = (r) => T.tier.men[r.id].key, group = (r) => (r.role === "bench_plus" ? 0 : places.get(keyR(r))?.rank ?? 99), idx = (r) => places.get(keyR(r))?.idx ?? 99;
  const bench = playing.filter((r) => r.role !== "starter").sort((a, b) => spot(a) - spot(b) || group(a) - group(b) || idx(a) - idx(b) || String(a.p?.name ?? a.id).localeCompare(String(b.p?.name ?? b.id))).map((r) => manOf(keyR(r)));
  const keyOf = (id) => T.tier.men[id]?.key ?? null;
  const healthy = healthyView(T, team, rows, idOf, manOf, D, view, five);
  const fill = fillNote(ch.fills ?? [], (k) => D.names?.[k] ?? k), shift = shiftNote(ch.shifts ?? [], (k) => D.names?.[k] ?? k, ch.blocked ?? []);
  const notes = [...(D.notes ?? []).filter((n) => !FILL_NOTE.test(n)), ...[fill, shift].filter(Boolean).map((n) => `${T.code ?? "This team"}: ${n}`)]; // the live scenario's fill and shift, not the read's
  return { cols, none: view.none.map(manOf), healthy, bench, view, posOf: (id) => (keyOf(id) ? ch.posOf.get(keyOf(id)) ?? null : null), sources: D.sources ?? [], notes, fills: ch.fills ?? [] };
}

/**
 * The healthy chart (Adam 3:35 PM 11-18, "show injured"): the standing chart (the sources and his moves, no tonight's fill) over tonight's men AND every absent man, each in his normal place, so an Out starter tops his
 * column with tonight's fill-in behind him. Absent = every man the chart holds who is not playing tonight: tonight's Outs and men not on the player list (out for the season, suspended), named from the chart's own list
 * (D.names). A man marked out of rotation is neither. Returns { cols: [{ pos, men, sum }], none: [men], absent: count } or null. An absent man: { id: null, absent: true, tag: "OUT", min: null, words }. Display only. Pure.
 */
function healthyView(T, team, rows, idOf, manOf, D, view, five) {
  const ch = pageChart(team);
  if (!ch) return null;
  const playingKeys = new Set(idOf.keys()), keyOfId = (id) => T.tier.men[id]?.key ?? null;
  const oor = new Set(rows.filter((r) => r.role === "oor" && !r.out).map((r) => keyOfId(r.id)).filter(Boolean));
  const outRow = new Map(rows.filter((r) => r.out).map((r) => [keyOfId(r.id), r]).filter(([k]) => k));
  const nameOfKey = new Map(Object.entries(T.tier.men).map(([id, m]) => [m.key, m.name]));
  const held = [...new Set([...POSITIONS.flatMap((p) => ch.cols[p]), ...ch.none, ...outRow.keys()])].filter((k) => !oor.has(k)); // an Out man the chart does not hold goes to "No position", never dropped (G62)
  const hv = tonightCols(ch, new Set([...held, ...playingKeys]));
  const man = (k) => {
    if (playingKeys.has(k)) return manOf(k);
    const r = outRow.get(k), full = r?.p?.name ?? nameOfKey.get(k) ?? D.names?.[k] ?? k;
    return { id: null, key: k, name: lastName(full), full, min: null, tag: "OUT", starter: false, bplus: false, absent: true, words: r ? "Out tonight" : "Not on tonight's player list (out for the season, suspended or otherwise away)" };
  };
  // tonight's starter(s) of each column, straight from tonight's balanced view (balanceFive, the one copy of the rule: review of 11-18, finding 3), so both views always agree
  const starts = Object.fromEntries(POSITIONS.map((p) => [p, view[p].filter((k) => five.has(k))])), forOf = new Map(), full = (k) => man(k).full;
  const tops = new Set(POSITIONS.flatMap((p) => starts[p]));
  // Adam 6:38 PM 11-18 (Show injured is where everyone normally slots): each column tops with its NORMAL starter, the healthy chart's first man there (unless he starts tonight in another column), even when he is
  // Out (greyed, OUT, marked "starter"); tonight's starter of the column sits right under him with the green S and "for <him>" (Adam 4:24 PM: someone has to be starting); then the rest in the healthy chart's order.
  const cols = POSITIONS.map((p) => {
    const norm = hv[p].find((k) => !tops.has(k) || starts[p].includes(k)) ?? null, lead = norm && !starts[p].includes(norm) ? norm : null;
    if (lead) for (const k of starts[p]) forOf.set(k, full(lead));
    const head = lead ? [{ ...man(lead), normal: true }] : [];
    const men = [...head, ...starts[p].map((k) => ({ ...manOf(k), forName: forOf.get(k) ?? null })), ...hv[p].filter((k) => !tops.has(k) && k !== lead).map(man)];
    return { pos: p, men, sum: men.reduce((t, m) => t + (isNum(m.min) ? m.min : 0), 0) };
  });
  const bare = rows.filter((r) => r.out && !keyOfId(r.id)).map((r) => { const full = r.p?.name ?? r.id; return { id: null, key: `out:${r.id}`, name: lastName(full), full, min: null, tag: "OUT", starter: false, bplus: false, absent: true, words: "Out tonight; no position source or minutes inputs name him" }; }); // an Out man the chart and the engine hold nothing on (out for the season): kept, under No position (G62)
  const none = [...hv.none.filter((k) => !tops.has(k)).map(man), ...bare];
  return { cols, none, absent: [...cols.flatMap((c) => c.men), ...none].filter((m) => m.absent).length };
}

/** One chip. sel: the selected man's id; ro: read-only. */
function chip(code, m, sel, ro) {
  if (m.absent) return `<div class="dc dc-out dc-ro" data-dout="${esc(m.key)}" data-team="${esc(code)}" title="${esc(`${m.full}: ${m.words}. Shown on the healthy chart only; he is not in tonight's minutes`)}"><span class="dc-nn">${esc(m.name)}</span><span class="dc-tag">OUT</span><span class="dc-mm">out${m.normal ? ` <i class="dc-ns">starter</i>` : ""}</span></div>`;
  const cls = `dc${m.starter ? " dc-st" : ""}${m.id === sel ? " dc-sel" : ""}${ro ? " dc-ro" : ""}`; // every class here is dc-: the board's own .st, .sel and .on must not reach the chart
  const handle = ro ? "" : `<span class="dc-gr" aria-hidden="true">&#10303;</span>`;
  return `<div class="${cls}"${ro ? "" : ` draggable="true" tabindex="0"`} data-dchip="${esc(m.id)}" data-team="${esc(code)}" title="${esc(`${m.full}: ${m.words}${ro ? "" : ". Drag him, or click him and use the bar below"}`)}">${handle}<span class="dc-nn">${esc(m.name)}</span><span class="dc-tag">${esc(m.tag)}</span><span class="dc-mm">${f1(m.min)} min${m.bplus ? ` <i class="dc-bp dc-on">B+</i>` : ""}</span>${m.forName ? `<span class="dc-for">for ${esc(lastName(m.forName))}</span>` : ""}</div>`;
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
export function chartHtml(code, cm, { sel = null, ro = false, showInj = false } = {}) {
  if (!cm) return "";
  const inj = showInj && cm.healthy ? cm.healthy : null, shown = inj ?? cm; // display only: the healthy view adds the absent men; every present man is as in tonight's view
  const head = (c) => `<h3>${c.pos}<small>${f1(c.sum)}</small></h3>`;
  const toggle = cm.healthy ? `<button class="dc-si${inj ? " dc-on" : ""}" type="button" data-dshowinj="1" aria-pressed="${inj ? "true" : "false"}" title="${esc(`Show the team's healthy chart: ${cm.healthy.absent} absent ${cm.healthy.absent === 1 ? "man" : "men"} back in their normal places (display only; nothing changes)`)}">Show injured${inj ? ` <i>${cm.healthy.absent}</i>` : ""}</button>` : "";
  const cols = shown.cols.map((c) => `<div class="dcol" data-dcol="${c.pos}" data-team="${esc(code)}">${head(c)}${c.men.map((m) => chip(code, m, sel, ro || inj !== null)).join("")}</div>`).join("");
  const none = shown.none.length ? `<div class="dc-none" data-dcol="none"><span class="dc-nl">No position</span>${shown.none.map((m) => chip(code, m, sel, ro || inj !== null)).join("")}</div>` : "";
  const order = cm.bench.length ? `<div class="dc-ord"><b>Bench order from this chart:</b> ${cm.bench.map((m, i) => `${i + 1} ${esc(m.name)}`).join(", ")}<span>Bench+ first, then every 2nd, then every 3rd, ties by a blend of last 10 and season minutes a game</span></div>` : "";
  return `<section class="box dchart"><h2>Depth chart <span class="dc-hr"><small>${ro ? "our chart, as Adam set it" : inj ? "healthy chart: absent men greyed; switch off to drag" : "drag a man within or between columns; starter on top"}</small>${toggle}</span></h2><div class="dcols">${cols}</div>${none}${ro ? "" : selBar(code, cm, sel)}${order}</section>`;
}

/** The sources' line for the page's foot notes (G64: stamps at the foot): "Positions: ESPN depth chart 3:40 PM; Lineups.com depth chart not read (403 ...); ...". when: ISO -> short time. */
export function sourcesNote(cm, when) {
  if (!cm?.sources?.length) return null;
  return `Positions (never DraftKings'): ${cm.sources.map((s) => (s.state === "ok" ? `${s.label} ${s.carried ? `${s.day}` : when(s.fetched_at) ?? s.fetched_at}${s.stamp ? ` (its stamp ${when(s.stamp) ?? s.stamp})` : ""}${s.why ? ` [${s.why}]` : ""}` : `${s.label} not used (${s.why ?? "not read"})`)).join("; ")}`;
}
