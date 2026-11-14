// The player card's "Efficiency and role" chart: two stacked panels on one shared x axis (never a dual axis), DK points
// per minute on top and usage rate (USG%) below. Each panel: his line with dots, his own average for the period shown
// (solid), the league average (dashed), a green/red wash between his line and the league line, right-edge labels (now,
// his avg, league), solid hairline gridlines. A period with no figure is a gap in his line, never a zero; a period of
// fewer than SMALL games is a hollow dot. One crosshair and one tooltip cover both panels: it snaps to the nearest
// period and follows the pointer (arrow keys move it when the chart has focus). Team changes are dotted verticals
// labelled "to ATL". The model comes from card-usage.js; everything here but wireChart is pure and DOM-free.
import { esc } from "./board-util.js";

export const DIMS = { W: 606, L: 42, R: 106, top: 27, ph: 150, gap: 58 };
// Fewer games than this is a small sample. A copy of board_figures.js SMALL_SAMPLE_GAMES (the server's one copy): the
// browser cannot import server/usage, so this is the client's one copy; change both together.
export const SMALL = 3;
const MINUS = "−";
export const METRICS = [
  { key: "dk", lg: "lgDk", title: "DK points per minute", unit: "", dp: 2, minSpan: 0.1, color: "var(--am)", short: "DK pts/min" },
  { key: "usg", lg: "lgUsg", title: "Usage rate (USG%)", unit: "%", dp: 1, minSpan: 2, color: "var(--bl)", short: "USG%" },
];
/** A finite number (the card files' one copy). */
export const isNum = (v) => typeof v === "number" && Number.isFinite(v);
export const signed = (v, dp) => (v >= 0 ? "+" : MINUS) + Math.abs(v).toFixed(dp);

/** A clean axis over the given values (nulls skipped): { lo, hi, step, ticks }, about maxTicks steps, never below 0
 *  when every value is 0 or more. Null when there is no value. minSpan: the least range the data may be drawn over, centred
 *  on it (a short flat career is not blown up); dp: the decimals the labels print, so the step is never finer than the
 *  last printed digit and two ticks never read alike. */
export function niceScale(values, maxTicks = 5, { minSpan = 0, dp = null } = {}) {
  const v = values.filter(isNum);
  if (!v.length) return null;
  let lo = Math.min(...v), hi = Math.max(...v);
  if (hi === lo) { const d = Math.abs(lo) * 0.1 || 1; lo -= d; hi += d; }
  if (hi - lo < minSpan) { const mid = (lo + hi) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
  const pad = (hi - lo) * 0.08;
  const floor0 = Math.min(...v) >= 0;
  lo -= pad; hi += pad;
  if (floor0 && lo < 0) lo = 0;
  const raw = (hi - lo) / maxTicks, mag = 10 ** Math.floor(Math.log10(raw));
  const least = dp === null ? 0 : 10 ** -dp - 1e-12;
  const step = [1, 2, 2.5, 5, 10, 20, 25, 50, 100].map((m) => m * mag).find((s) => s >= raw - 1e-12 && s >= least);
  const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let k = 0; a + k * step <= b + step * 1e-6; k++) ticks.push(Number((a + k * step).toFixed(6)));
  return { lo: Number(a.toFixed(6)), hi: Number(b.toFixed(6)), step, ticks };
}

/** x positions and y pixels (null for a gap) -> an SVG path, a new "M" after every gap. A point with a gap on both sides
 *  draws nothing, or a short flat dash when `isolated` is a half-width. */
export function linePath(xs, ys, isolated = 0) {
  let d = "", open = false;
  ys.forEach((y, i) => {
    if (y === null) { open = false; return; }
    const lone = !open && (i === ys.length - 1 || ys[i + 1] === null);
    if (lone) { if (isolated) d += `M${(xs[i] - isolated).toFixed(1)} ${y.toFixed(1)}L${(xs[i] + isolated).toFixed(1)} ${y.toFixed(1)}`; return; }
    d += `${open ? "L" : "M"}${xs[i].toFixed(1)} ${y.toFixed(1)}`;
    open = true;
  });
  return d;
}

/** The wash between his line (py) and the league line (ly), in pixels: polygons [{ pts: [[x, y]...], above }], split
 *  exactly where the lines cross; nothing over a gap on either line. above: he is over the league (smaller y). */
export function fillPolys(xs, py, ly) {
  const out = [];
  for (let i = 0; i < xs.length - 1; i++) {
    if ([py[i], py[i + 1], ly[i], ly[i + 1]].some((v) => v === null)) continue;
    const d0 = ly[i] - py[i], d1 = ly[i + 1] - py[i + 1];
    const a = [xs[i], py[i]], b = [xs[i + 1], py[i + 1]], la = [xs[i], ly[i]], lb = [xs[i + 1], ly[i + 1]];
    if (d0 * d1 >= 0) {
      if (d0 !== 0 || d1 !== 0) out.push({ pts: [a, b, lb, la], above: d0 + d1 > 0 });
      continue;
    }
    const t = d0 / (d0 - d1), c = [xs[i] + t * (xs[i + 1] - xs[i]), ly[i] + t * (ly[i + 1] - ly[i])];
    out.push({ pts: [a, c, la], above: d0 > 0 }, { pts: [c, b, lb], above: d1 > 0 });
  }
  return out;
}

/** Right-edge labels kept at least `gap` apart and inside [lo, hi]: sets `ly` on each item (sorted by y). */
export function spreadLabels(items, gap, lo, hi) {
  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.ly = it.y;
  for (let k = 0; k < 20; k++) for (let i = 1; i < items.length; i++) {
    const d = items[i].ly - items[i - 1].ly;
    if (d < gap) { const s = (gap - d) / 2; items[i - 1].ly -= s; items[i].ly += s; }
  }
  for (const it of items) it.ly = Math.min(hi, Math.max(lo, it.ly));
  for (let i = 1; i < items.length; i++) if (items[i].ly - items[i - 1].ly < gap) items[i].ly = items[i - 1].ly + gap;
  const last = items.length - 1;
  if (last >= 0 && items[last].ly > hi) {
    items[last].ly = hi;
    for (let i = last - 1; i >= 0; i--) items[i].ly = Math.min(items[i].ly, items[i + 1].ly - gap);
  }
  return items;
}

/** Which x tick labels to print so none collide: every k-th, always the last. */
export function tickEvery(n, spacing, widest) {
  const k = Math.max(1, Math.ceil((widest + 10) / Math.max(spacing, 1)));
  return (i) => i === n - 1 || (i % k === 0 && n - 1 - i >= k);
}

const pts = (list) => list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

/** Geometry and markup for a model: { svg, W, H, X, Ys: [Y for each panel or null] }. */
export function chartParts(model) {
  const { W, L, R, top, ph, gap } = DIMS;
  const P = model.points, n = P.length, x0 = L, x1 = W - R;
  const padX = n > 12 ? 8 : 16;
  const X = (i) => (n === 1 ? (x0 + x1) / 2 : x0 + padX + (i * (x1 - x0 - 2 * padX)) / (n - 1));
  const xs = P.map((_, i) => X(i));
  const axisY = top + ph + gap + ph;
  // Team-change labels: a second row when two would touch.
  const moves = (model.moves ?? []).map((m) => ({ ...m, x: m.mid || m.index === 0 ? X(m.index) : (X(m.index - 1) + X(m.index)) / 2 }));
  let lastX = [-1e9, -1e9];
  for (const m of moves) { m.row = m.x - lastX[0] >= 52 ? 0 : 1; lastX[m.row] = m.x; }
  const rows = moves.length ? 1 + Math.max(...moves.map((m) => m.row)) : 0;
  const H = axisY + 24 + rows * 15 + 4;
  let s = "";
  const Ys = METRICS.map((m, k) => {
    const y0 = top + k * (ph + gap);
    const vals = P.map((p) => (isNum(p[m.key]) ? p[m.key] : null)), lg = P.map((p) => (isNum(p[m.lg]) ? p[m.lg] : null));
    const avg = isNum(model.avg?.[m.key]) ? model.avg[m.key] : null;
    s += `<text x="0" y="${y0 - 13}" class="ue-pt">${m.title}</text>`;
    const sc = niceScale([...vals, ...lg, avg], 5, { minSpan: m.minSpan, dp: m.dp });
    if (!sc || vals.every((v) => v === null)) {
      s += `<line x1="${x0}" x2="${x1}" y1="${y0 + ph}" y2="${y0 + ph}" class="ue-base"/><text x="${(x0 + x1) / 2}" y="${y0 + ph / 2}" class="ue-none" text-anchor="middle">No ${m.short} figures for this period</text>`;
      return null;
    }
    const Y = (v) => y0 + ph - ((v - sc.lo) / (sc.hi - sc.lo)) * ph;
    for (const t of sc.ticks) s += `<line x1="${x0}" x2="${x1}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}" class="ue-grid"/><text x="${x0 - 7}" y="${(Y(t) + 4).toFixed(1)}" class="ue-tk" text-anchor="end">${t.toFixed(m.dp)}</text>`;
    s += `<line x1="${x0}" x2="${x1}" y1="${y0 + ph}" y2="${y0 + ph}" class="ue-base"/>`;
    const py = vals.map((v) => (v === null ? null : Y(v)));
    const flat = model.flatLeague && lg.some((v) => v !== null);
    const ly = flat ? lg.map(() => Y(lg.find((v) => v !== null))) : lg.map((v) => (v === null ? null : Y(v)));
    for (const f of fillPolys(xs, py, ly)) s += `<polygon points="${pts(f.pts)}" class="${f.above ? "ue-up" : "ue-dn"}"/>`;
    if (flat) s += `<line x1="${x0}" x2="${x1}" y1="${ly[0].toFixed(1)}" y2="${ly[0].toFixed(1)}" class="ue-lg"/>`;
    else s += `<path d="${linePath(xs, ly, 8)}" class="ue-lg"/>`;
    if (avg !== null) s += `<line x1="${x0}" x2="${x1}" y1="${Y(avg).toFixed(1)}" y2="${Y(avg).toFixed(1)}" stroke="${m.color}" class="ue-avg"/>`;
    s += `<path d="${linePath(xs, py)}" stroke="${m.color}" class="ue-ln"/>`;
    P.forEach((p, i) => {
      if (py[i] === null) return;
      const small = isNum(p.games) && p.games < SMALL;
      s += `<circle cx="${xs[i].toFixed(1)}" cy="${py[i].toFixed(1)}" r="4" ${small ? `fill="var(--p)" stroke="${m.color}" stroke-width="1.6"` : `fill="${m.color}" stroke="var(--p)" stroke-width="2"`}/>`;
    });
    // Right-edge labels: his latest figure, his average, the league's at his latest period.
    const li = vals.map((v, i) => (v === null ? -1 : i)).reduce((a, b) => Math.max(a, b), -1);
    const items = [{ y: py[li], txt: `${li === n - 1 ? model.endWord : "last"} ${vals[li].toFixed(m.dp)}${m.unit}`, cls: "ue-now" }];
    if (avg !== null) items.push({ y: Y(avg), txt: `his avg ${avg.toFixed(m.dp)}${m.unit}`, cls: "ue-rl" });
    const lgi = flat ? 0 : lg.map((v, i) => (v === null ? -1 : i)).reduce((a, b) => Math.max(a, b), -1);
    if (lgi >= 0 && ly[lgi] !== null) items.push({ y: ly[lgi], txt: `league ${(flat ? lg.find((v) => v !== null) : lg[lgi]).toFixed(m.dp)}${m.unit}`, cls: "ue-rl" });
    spreadLabels(items, 17, y0 + 4, y0 + ph - 2);
    for (const it of items) {
      if (Math.abs(it.ly - it.y) > 1.5) s += `<polyline points="${x1},${it.y.toFixed(1)} ${x1 + 4},${it.y.toFixed(1)} ${x1 + 7},${it.ly.toFixed(1)}" class="ue-lead"/>`;
      s += `<text x="${x1 + 10}" y="${(it.ly + 4).toFixed(1)}" class="${it.cls}">${esc(it.txt)}</text>`;
    }
    return Y;
  });
  // Shared x axis: ticks, labels (thinned so none collide), team changes.
  const widest = Math.max(...P.map((p) => String(p.tick).length)) * 7.3; // 12px monospace labels (board.css .ue-xl)
  const show = tickEvery(n, n > 1 ? xs[1] - xs[0] : 999, widest);
  // Both panels get the same ticks and labels under their own axis line (the top one sits in the gap above the lower title).
  for (const ay of [top + ph, axisY]) P.forEach((p, i) => {
    s += `<line x1="${xs[i].toFixed(1)}" x2="${xs[i].toFixed(1)}" y1="${ay}" y2="${ay + 4}" class="ue-base"/>`;
    if (show(i)) s += `<text x="${xs[i].toFixed(1)}" y="${ay + 17}" class="ue-xl" text-anchor="middle">${esc(p.tick)}</text>`;
  });
  for (const m of moves) {
    s += `<line x1="${m.x.toFixed(1)}" x2="${m.x.toFixed(1)}" y1="${top - 4}" y2="${axisY + 6}" class="ue-mv"/>`;
    s += `<text x="${m.x.toFixed(1)}" y="${axisY + 33 + m.row * 15}" class="ue-mvt" text-anchor="middle">to ${esc(m.team)}${m.mid ? " (mid-season)" : ""}</text>`;
  }
  s += `<line class="ue-xh" x1="0" x2="0" y1="${top - 4}" y2="${axisY}" visibility="hidden"/>`;
  METRICS.forEach((m, k) => { s += `<circle class="ue-hov" data-k="${k}" r="6" fill="${m.color}" stroke="var(--p)" stroke-width="2" visibility="hidden"/>`; });
  const svg = `<svg class="ue-svg" viewBox="0 0 ${W} ${H}" width="100%" tabindex="0" role="img" aria-label="DK points per minute and usage rate by period, with his average and the league average">${s}</svg>`;
  return { svg, W, H, X, Ys };
}

/** The tooltip for period i: period, games and minutes, then for each metric the value, vs his avg, vs the league. */
export function tooltipHtml(model, i) {
  const p = model.points[i];
  const rows = METRICS.map((m) => {
    const v = p[m.key], avg = model.avg?.[m.key], lg = p[m.lg];
    if (!isNum(v)) return `<div class="ue-tv"><i style="background:${m.color}"></i>—<u>${m.short}: ${esc(p.games === 0 ? "no games" : (m.key === "dk" && p.dkNote) || "no figure for this period")}</u></div>`;
    const vs = (ref, what) => `<div class="ue-tr"><span>vs ${what}</span><b>${isNum(ref) ? signed(v - ref, m.dp) + m.unit : "—"}</b></div>`;
    return `<div class="ue-tv"><i style="background:${m.color}"></i>${v.toFixed(m.dp)}${m.unit}<u>${m.short}</u></div>${vs(avg, "his avg")}${vs(lg, "league")}`;
  }).join("");
  const sub = p.games === 0 ? "no games" : p.sub;
  const notes = [];
  if (isNum(p.games) && p.games > 0 && p.games < SMALL) notes.push(`Small sample: ${p.games} game${p.games === 1 ? "" : "s"}`);
  if (p.gamesNote) notes.push(`Games and minutes missing: ${p.gamesNote}`);
  if (p.team) notes.push(`Team: ${p.team}`);
  return `<div class="ue-tt"><span>${esc(p.label)}</span><em>${esc(sub)}</em></div>${rows}${notes.map((t) => `<div class="ue-tn">${esc(t)}</div>`).join("")}`;
}

/** Hooks the crosshair and tooltip to a rendered chart inside `box` (the .ue-chart element). */
export function wireChart(box, model) {
  const svg = box.querySelector(".ue-svg"), tip = box.querySelector(".ue-tip");
  if (!svg || !tip || !model.points.length) return;
  const g = chartParts(model);
  const xh = svg.querySelector(".ue-xh"), hov = [...svg.querySelectorAll(".ue-hov")];
  let cur = -1;
  const nearest = (vx) => {
    let best = 0;
    model.points.forEach((_, i) => { if (Math.abs(g.X(i) - vx) < Math.abs(g.X(best) - vx)) best = i; });
    return best;
  };
  const show = (i, at) => {
    cur = i;
    const x = g.X(i).toFixed(1);
    xh.setAttribute("x1", x); xh.setAttribute("x2", x); xh.setAttribute("visibility", "visible");
    hov.forEach((c, k) => {
      const Y = g.Ys[k], v = model.points[i][METRICS[k].key];
      if (!Y || !isNum(v)) return c.setAttribute("visibility", "hidden");
      c.setAttribute("cx", x); c.setAttribute("cy", Y(v).toFixed(1)); c.setAttribute("visibility", "visible");
    });
    tip.innerHTML = tooltipHtml(model, i);
    tip.hidden = false;
    // Positions in the box's own CSS pixels (the page may be zoomed): beside the pointer, flipped to stay inside.
    const r = svg.getBoundingClientRect(), b = box.getBoundingClientRect(), z = b.width / box.offsetWidth || 1;
    const px = at ? (at.x - b.left) / z : (g.X(i) / g.W) * (r.width / z), py = at ? (at.y - b.top) / z : box.offsetHeight / 3;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    // Right of the pointer on the chart's left half, left of it past the middle (so it never covers the right-edge labels).
    let left = px > box.offsetWidth / 2 ? px - 16 - tw : px + 16;
    if (left + tw > box.offsetWidth) left = px - 16 - tw;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${Math.min(Math.max(0, py - th / 2), box.offsetHeight - th)}px`;
  };
  const hide = () => { cur = -1; tip.hidden = true; xh.setAttribute("visibility", "hidden"); hov.forEach((c) => c.setAttribute("visibility", "hidden")); };
  svg.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect();
    show(nearest(((e.clientX - r.left) / r.width) * g.W), { x: e.clientX, y: e.clientY });
  });
  svg.addEventListener("pointerleave", hide);
  svg.addEventListener("blur", hide);
  svg.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const n = model.points.length;
    show(cur < 0 ? n - 1 : Math.min(n - 1, Math.max(0, cur + (e.key === "ArrowRight" ? 1 : -1))));
  });
}
