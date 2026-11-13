// The Compare view on the Lineups tab (Adam, 2026-11-04): the lineups of the view side by side. A. a table, one row per lineup, every
// header a sort; B. a grid of every man used against the lineups that hold him; C. head to head, two or more lineups aligned by man.
// Pure: markup strings and a small state reducer; the panel draws it and routes clicks whose data-op is "cmp" into compareClick.
// A lineup here is { key, name, mode, men } (men in slot order; a null or stale man makes every total that needs him a dash, RULES R1).
// A figure the lineups do not carry shows a dash, never a stand-in. Cash only: the GPP items (stack, men under 5% / 10% own) are hidden.
import { esc, money, nameOpen } from "./board-util.js";
import { totals } from "./card-row.js";
import { gameStacks } from "./corr.js";
import { SLOTS, SALARY_CAP } from "./slots.js";

/** The view's state: sort column and direction, the lineups picked for head to head (keys), the highlighted lineup column (key). */
export const freshCompare = () => ({ sort: "proj", dir: -1, picks: [], col: null });

const num = (x) => typeof x === "number" && Number.isFinite(x);
const live = (men) => men.filter((p) => p && !p.stale);
const allHave = (men, f) => men.length > 0 && men.every((p) => p && !p.stale && p[f] != null);
const sumOf = (men, f) => (men.length && men.every((p) => p && !p.stale && num(p[f])) ? men.reduce((t, p) => t + p[f], 0) : null);
const isQ = (s) => /^(questionable|q|gtd|doubtful|d)$/i.test(String(s ?? "").trim());
const nameOf = (l) => l.name ?? l.key ?? "Lineup";
const idOf = (p) => p.dk_id ?? p.name;
const r1 = (v) => Math.round(v * 10) / 10;
/** The men of a lineup as one key, so two lineups holding the same eight compare equal whatever the slot order. */
const menKey = (l) => (l.men ?? []).filter((p) => p && !p.stale).map(idOf).sort().join("|");
/** Short unique headings for the grid and head to head: C1, C2 for the Cash lineups and G1, G2 for the GPP ones, in list order. */
export function tagsOf(lineups) {
  const n = { Cash: 0, GPP: 0 };
  return lineups.map((l) => { const m = l.mode === "Cash" ? "Cash" : "GPP"; n[m] += 1; return `${m === "Cash" ? "C" : "G"}${n[m]}`; });
}

/** Every figure of one lineup the table shows; top: the lineup with the highest projection (or null). Each is null when not known. */
export function lineupStats(l, top = null) {
  const men = l.men ?? [];
  const t = totals(men.map((p) => (p?.stale ? null : p)));
  const own = allHave(men, "proj_own") && men.every((p) => num(p.proj_own)) ? men.map((p) => p) : null;
  const lo = own ? own.reduce((a, p) => (p.proj_own < a.proj_own ? p : a)) : null;
  const hi = own ? own.reduce((a, p) => (p.proj_own > a.proj_own ? p : a)) : null;
  const stacks = gameStacks(men);
  let stack = null;
  if (men.length && men.every((p) => p && !p.stale && p.game != null && p.team != null)) {
    const by = new Map();
    for (const p of men) if (stacks.has(p.dk_id)) by.set(p.game, (by.get(p.game) ?? 0) + 1);
    const best = [...by].sort((a, b) => b[1] - a[1])[0];
    stack = best ? { text: `${best[0]} ${best[1]}`, n: best[1] } : { text: "None", n: 0 };
  }
  const topIds = top ? new Set((top.men ?? []).filter((p) => p && !p.stale && idOf(p) != null).map(idOf)) : null;
  const diff = topIds && men.length && men.every((p) => p && !p.stale && idOf(p) != null) ? men.filter((p) => !topIds.has(idOf(p))).length : null;
  const topProj = top ? totals((top.men ?? []).map((p) => (p?.stale ? null : p))).projection : null;
  return {
    // The gap is the difference of the figures as shown (one decimal), so 278.0 and 277.8 never read a gap of 0.3.
    proj: t.projection, gap: t.projection != null && topProj != null ? Math.round((r1(t.projection) - r1(topProj)) * 10) / 10 + 0 : null, // + 0 turns -0 into 0
    sal: t.salary, left: t.salary != null ? SALARY_CAP - t.salary : null, own: t.own,
    lo: lo ? { name: lo.name, v: lo.proj_own, id: lo.dk_id } : null, hi: hi ? { name: hi.name, v: hi.proj_own, id: hi.dk_id } : null,
    u5: own ? own.filter((p) => p.proj_own < 5).length : null, u10: own ? own.filter((p) => p.proj_own < 10).length : null,
    q: men.length && men.every((p) => p && !p.stale && p.injury_status !== undefined) ? men.filter((p) => isQ(p.injury_status)).length : null,
    min: sumOf(men, "minutes"),
    value: t.projection != null && t.salary ? (t.projection / t.salary) * 1000 : null,
    stack, teams: men.length && men.every((p) => p && !p.stale && p.team != null) ? new Set(men.map((p) => p.team)).size : null, diff,
  };
}

const f1 = (v) => v.toFixed(1);
const sgn = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1);
// best: which end of the column is highlighted (1 high, -1 low, 0 none); text: sorts ascending first; gpp: hidden when every lineup is Cash.
export const COLS = [
  { k: "name", label: "Lineup", text: true, v: (s, l) => nameOf(l), fmt: (v) => esc(v) },
  { k: "mode", label: "Mode", text: true, v: (s, l) => l.mode ?? null, fmt: (v) => esc(v) },
  { k: "proj", label: "Proj", best: 1, v: (s) => s.proj, fmt: f1 },
  { k: "gap", label: "Gap to top", v: (s) => s.gap, fmt: (v) => (v === 0 ? "0.0" : sgn(v)) },
  { k: "sal", label: "Salary used", best: 1, v: (s) => s.sal, fmt: money },
  { k: "left", label: "Salary left", best: -1, v: (s) => s.left, fmt: (v) => (v < 0 ? `<span class="over">−${money(-v)}</span>` : money(v)) },
  { k: "own", label: "Total own", best: -1, v: (s) => s.own, fmt: (v) => v.toFixed(1) + "%" },
  { k: "lo", label: "Lowest own man", text: true, v: (s) => s.lo?.v ?? null, fmt: (v, s) => `${nameOpen(s.lo.name, s.lo.id)} <b>${v.toFixed(1)}%</b>`, wide: true },
  { k: "hi", label: "Highest own man", text: true, v: (s) => s.hi?.v ?? null, fmt: (v, s) => `${nameOpen(s.hi.name, s.hi.id)} <b>${v.toFixed(1)}%</b>`, wide: true },
  { k: "u5", label: "Under 5% own", best: 1, gpp: true, v: (s) => s.u5, fmt: String },
  { k: "u10", label: "Under 10% own", best: 1, gpp: true, v: (s) => s.u10, fmt: String },
  { k: "q", label: "Questionable", best: -1, v: (s) => s.q, fmt: String },
  { k: "min", label: "Minutes", best: 1, v: (s) => s.min, fmt: f1 },
  { k: "value", label: "Pts per $1K", best: 1, v: (s) => s.value, fmt: (v) => v.toFixed(2) },
  { k: "stack", label: "Biggest game stack", text: true, gpp: true, v: (s) => s.stack?.text ?? null, fmt: (v) => esc(v) },
  { k: "teams", label: "Teams", v: (s) => s.teams, fmt: String },
  { k: "diff", label: "Different from top", v: (s) => s.diff, fmt: String },
];

const defaultDash = (why) => `<span class="dash" title="${esc(why)}">–</span>`;
const hasGpp = (lineups) => lineups.some((l) => l.mode === "GPP");

/** Lineups with their stats, the top-projection one used as the reference (first on a tie; none when no lineup has a projection). */
function withStats(lineups) {
  const proj = lineups.map((l) => totals((l.men ?? []).map((p) => (p?.stale ? null : p))).projection);
  let ti = -1;
  proj.forEach((v, i) => { if (v != null && (ti < 0 || v > proj[ti])) ti = i; });
  const top = ti >= 0 ? lineups[ti] : null;
  return lineups.map((l) => ({ l, s: lineupStats(l, top), top: l === top }));
}

/** The table's rows in the state's order; a missing figure last in either direction. */
export function sortedRows(lineups, state) {
  const col = COLS.find((c) => c.k === state.sort) ?? COLS[2];
  const rows = withStats(lineups).map((r, i) => ({ ...r, i, val: col.v(r.s, r.l) }));
  return rows.sort((a, b) => {
    const x = a.val, y = b.val;
    if ((x == null) !== (y == null)) return x == null ? 1 : -1;
    if (x == null) return a.i - b.i;
    const c = typeof x === "string" ? x.localeCompare(y, "en", { numeric: true }) : x - y;
    return c ? c * state.dir : a.i - b.i;
  });
}

function tableHtml(lineups, state, dash, gpp) {
  // The Mode column is dropped when every name already says its mode ("Lineup 1, Cash"); a name that does not keeps it.
  const nameSaysMode = lineups.every((l) => new RegExp(`\\b${l.mode}\\b`, "i").test(nameOf(l)));
  const cols = COLS.filter((c) => (gpp || !c.gpp) && !(c.k === "mode" && nameSaysMode));
  const rows = sortedRows(lineups, state);
  // The best figure of a column is shaded only when it tells lineups apart: not when every row ties, and not when half the rows or
  // more share it. A column of nothing but zeros is dimmed, it has nothing to say.
  const best = new Map(), zero = new Set();
  for (const c of cols) {
    if (!c.best) continue;
    const vals = rows.filter((r) => !(c.gpp && r.l.mode === "Cash")).map((r) => c.v(r.s, r.l)).filter(num); // a Cash row has no GPP figure
    if (vals.length && vals.every((v) => v === 0)) { zero.add(c.k); continue; }
    if (vals.length < 2) continue;
    const top = c.best > 0 ? Math.max(...vals) : Math.min(...vals);
    if (vals.filter((v) => v === top).length * 2 < vals.length) best.set(c.k, top);
  }
  const head = cols.map((c) => `<th class="${c.text ? "tx" : "n"}${state.sort === c.k ? " on" : ""}${zero.has(c.k) ? " zero" : ""}"><button data-op="cmp" data-a="sort" data-k="${c.k}" title="Sort by ${esc(c.label)}; click again to reverse">${esc(c.label)}${state.sort === c.k ? `<i>${state.dir < 0 ? "▼" : "▲"}</i>` : ""}</button></th>`).join("");
  const body = rows.map((r) => {
    const picked = state.picks.includes(r.l.key);
    const tds = cols.map((c) => {
      const v = c.v(r.s, r.l);
      // In a mixed list a Cash row has no stack, no men under 5% or 10% own: those are GPP ideas, said so instead of a dash that reads as missing data.
      if (c.gpp && r.l.mode === "Cash") return `<td class="${c.text ? "tx" : "n"} na"><span title="A GPP figure: a Cash lineup has none">GPP only</span></td>`;
      let cell = v == null ? dash(`no ${c.label.toLowerCase()}: a figure is missing for this lineup`) : c.fmt(v, r.s);
      if (c.k === "name" && r.l.same) cell += ` <span class="same" title="This ${esc(r.l.mode)} lineup holds exactly the men of ${esc(r.l.same)}">same as ${esc(r.l.same)}</span>`;
      return `<td class="${c.text ? "tx" : "n"}${best.get(c.k) === v && v != null ? " best" : ""}${zero.has(c.k) ? " zero" : ""}">${cell}</td>`;
    }).join("");
    return `<tr class="${state.col === r.l.key ? "hl" : ""}" data-op="cmp" data-a="col" data-key="${esc(r.l.key)}"><td class="pk"><input type="checkbox" data-op="cmp" data-a="pick" data-key="${esc(r.l.key)}"${picked ? " checked" : ""} aria-label="Pick ${esc(nameOf(r.l))} for head to head" title="Pick for head to head"></td>${tds}</tr>`;
  }).join("");
  return `<div class="cp-scroll"><table class="cp-t"><thead><tr><th class="pk"></th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}


/** Every man used, most-held first: [{ p, id, count, in: [bool per lineup] }]. */
export function playerGrid(lineups) {
  const by = new Map();
  lineups.forEach((l, i) => {
    for (const p of live(l.men ?? [])) {
      if (idOf(p) == null) continue;
      if (!by.has(idOf(p))) by.set(idOf(p), { p, id: idOf(p), count: 0, in: lineups.map(() => false) });
      const e = by.get(idOf(p));
      if (!e.in[i]) { e.in[i] = true; e.count++; }
    }
  });
  return [...by.values()].sort((a, b) => b.count - a.count || (b.p.projection ?? -1) - (a.p.projection ?? -1) || String(a.p.name).localeCompare(String(b.p.name)));
}

const manCells = (p, dash) => `<td class="tx mn">${nameOpen(p.name, p.dk_id)}</td><td class="tx">${esc(p.team ?? "")}</td>`
  + `<td class="n">${num(p.salary) ? money(p.salary) : dash("no salary for this man")}</td><td class="n">${num(p.projection) ? f1(p.projection) : dash("no projection for this man")}</td><td class="n">${num(p.proj_own) ? p.proj_own.toFixed(1) + "%" : dash("no projected ownership for this man")}</td>`;

function gridHtml(lineups, state, dash) {
  const rows = playerGrid(lineups);
  const n = lineups.length;
  const tags = tagsOf(lineups);
  const head = lineups.map((l, i) => `<th class="g${state.col === l.key ? " hl" : ""}${l.mode === "Cash" ? " gc" : ""}"><button data-op="cmp" data-a="col" data-key="${esc(l.key)}" title="${esc(nameOf(l))}${l.same ? `, same as ${esc(l.same)}` : ""}">${tags[i]}</button></th>`).join("");
  const body = rows.map((r) => `<tr class="${r.count === n && n > 1 ? "all" : ""}">${manCells(r.p, dash)}<td class="n ct">${r.count}</td>${lineups.map((l, i) => `<td class="g${r.in[i] ? " in" : ""}${state.col === l.key ? " hl" : ""}"></td>`).join("")}</tr>`).join("");
  return `<div class="cp-scroll"><table class="cp-t cp-g"><thead><tr><th class="tx">Man</th><th class="tx">Team</th><th class="n">Salary</th><th class="n">Proj</th><th class="n">Own</th><th class="n">In</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** The lineups for head to head: those picked (in the order of the list), else the top-projected lineup and the next one that holds
 *  different men (an exact duplicate tells nothing); when every lineup is the same, the top two. */
export function h2hLineups(lineups, state) {
  const picked = lineups.filter((l) => state.picks.includes(l.key));
  if (picked.length >= 2) return picked;
  const top = sortedRows(lineups, { sort: "proj", dir: -1 }).map((r) => r.l);
  if (top.length < 2) return top;
  const other = top.slice(1).find((l) => menKey(l) !== menKey(top[0])) ?? top[1];
  return [top[0], other];
}

/** Head to head model: rows by man (shared by all first), and each lineup's totals with the difference from the first. */
export function headToHead(sel) {
  const rows = playerGrid(sel).map((r) => ({ ...r, shared: r.count === sel.length }));
  rows.sort((a, b) => (b.shared - a.shared) || b.count - a.count || (b.p.projection ?? -1) - (a.p.projection ?? -1));
  const tots = sel.map((l) => totals((l.men ?? []).map((p) => (p?.stale ? null : p))));
  // A difference is of the figures as shown (one decimal), and one that rounds to zero is exactly 0 (never -0.0), so it reads "same".
  const gap1 = (a, b) => (a != null && b != null ? Math.round((r1(a) - r1(b)) * 10) / 10 + 0 : null);
  const diffs = tots.map((t) => ({ proj: gap1(t.projection, tots[0].projection), sal: t.salary != null && tots[0].salary != null ? t.salary - tots[0].salary : null, own: gap1(t.own, tots[0].own) }));
  return { rows, tots, diffs };
}

function h2hHtml(lineups, state, dash) {
  const sel = h2hLineups(lineups, state);
  if (sel.length < 2) return `<div class="cp-none">Head to head needs two lineups.</div>`;
  const { rows, tots, diffs } = headToHead(sel);
  const tag = new Map(lineups.map((l, i) => [l.key, tagsOf(lineups)[i]]));
  const head = sel.map((l) => `<th class="n" title="${esc(nameOf(l))}">${tag.get(l.key)}<small>${esc(nameOf(l))}</small></th>`).join("");
  const slotOf = (l, id) => { const k = (l.men ?? []).findIndex((p) => p && !p.stale && idOf(p) === id); return k >= 0 && l.men.length === SLOTS.length ? SLOTS[k] : "●"; };
  const body = rows.map((r) => `<tr class="${r.shared ? "shared" : "diff"}">${manCells(r.p, dash)}${sel.map((l, i) => `<td class="n${r.in[i] ? " in" : ""}">${r.in[i] ? esc(slotOf(l, r.id)) : ""}</td>`).join("")}</tr>`).join("");
  const foot = (label, key, fmt, dflt) => `<tr class="tot"><td class="tx" colspan="5">${label}</td>${sel.map((l, i) => {
    const v = tots[i][key], d = diffs[i][dflt];
    if (v == null) return `<td class="n">${dash(`a figure is missing in ${nameOf(l)}`)}</td>`;
    return `<td class="n">${fmt(v)}${i > 0 && d != null ? ` <em class="${d > 0 ? "up" : d < 0 ? "dn" : ""}">${d === 0 ? "same" : (dflt === "sal" ? (d > 0 ? "+" : "−") + money(Math.abs(d)) : sgn(d) + (dflt === "own" ? "%" : ""))}</em>` : ""}</td>`;
  }).join("")}</tr>`;
  return `<div class="cp-scroll"><table class="cp-t cp-h"><thead><tr class="cp-cap"><th class="tx" colspan="${5 + sel.length}">${rows.filter((r) => r.shared).length} men in all, ${rows.filter((r) => !r.shared).length} that differ</th></tr><tr><th class="tx">Man</th><th class="tx">Team</th><th class="n">Salary</th><th class="n">Proj</th><th class="n">Own</th>${head}</tr></thead><tbody>${body}${foot("Projection (difference from the first)", "projection", f1, "proj")}${foot("Salary", "salary", money, "sal")}${foot("Total own", "own", (v) => v.toFixed(1) + "%", "own")}</tbody></table></div>`;
}

/**
 * The whole Compare view. lineups: [{ key, name, mode, men }]; state: freshCompare()'s shape; ctx: { dash } (the app's dash(reason)).
 * Routes: every control carries data-op="cmp" and data-a (sort | pick | col), plus data-k (a column key) or data-key (a lineup key).
 */
export function compareHtml(lineups, state = freshCompare(), ctx = {}) {
  const dash = ctx.dash ?? defaultDash;
  if (!lineups?.length) return `<div class="cp"><div class="cp-none">No lineups to compare.</div></div>`;
  const gpp = hasGpp(lineups);
  const picks = state.picks.filter((k) => lineups.some((l) => l.key === k)).length;
  // The grid and head to head sit side by side where the page is wide, so both are in view at once; narrower pages stack them.
  return `<div class="cp"><section><h3>Lineups against each other</h3><div class="cp-sub">Click a heading to sort, click it again to reverse. Tick two or more lineups for head to head; the best figure in a column is shaded when it tells the lineups apart.</div>${tableHtml(lineups, state, dash, gpp)}</section>`
    + `<div class="cp-row"><section class="cp-gsec"><h3>Who is in which lineup</h3><div class="cp-sub">Men in every lineup are dimmed: they do not separate the lineups. C1, C2 are the Cash lineups and G1, G2 the GPP ones, in the order shown. Click a lineup number to highlight its column.</div>${gridHtml(lineups, state, dash)}</section>`
    + `<section class="cp-hsec"><h3>Head to head</h3><div class="cp-sub">${picks >= 2 ? `The ${picks} lineups ticked above.` : "The top-projected lineup and the next one that holds different men; tick lineups above to pick others."}${picks ? ` <button class="cp-clear" data-op="cmp" data-a="clear">Clear ticks</button>` : ""}</div>${h2hHtml(lineups, state, dash)}</section></div></div>`;
}

/** A click on a Compare control (its dataset); returns the new state (the same object when it is not ours). */
export function compareClick(ds, state) {
  if (ds?.op !== "cmp") return state;
  if (ds.a === "sort") {
    const col = COLS.find((c) => c.k === ds.k);
    if (!col) return state;
    return state.sort === ds.k ? { ...state, dir: -state.dir } : { ...state, sort: ds.k, dir: col.text ? 1 : -1 };
  }
  if (ds.a === "pick") return { ...state, picks: state.picks.includes(ds.key) ? state.picks.filter((k) => k !== ds.key) : [...state.picks, ds.key] };
  if (ds.a === "col") return { ...state, col: state.col === ds.key ? null : ds.key };
  if (ds.a === "clear") return { ...state, picks: [] };
  return state;
}
