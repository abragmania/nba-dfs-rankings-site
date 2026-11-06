// The console's HTML: the team picker, scenario bar, team table with its compare block, slate sweep, side readout and Apply box.
// Strings only; console.js puts them on the page. A missing figure is the one mark saying why, never zero.
import { esc, isoToEastern } from "./board-util.js";
import { keyOf, outsOf, handoutShares, teamFor, TEAM_USAGE } from "./console-engine.js";
import { calc, chipName, dcls, f1, fullLabel, hasPins, label, savedFor, sgn, tableName, tonightMin, tonightProj, tonightUsg, usualMin, usualProj, pinsOf } from "./console-model.js";
import { FN, fmtv } from "./console-cmd.js";
import { isNum as num } from "./figures.js";
import { ROLES, ROLE_LABEL, ROLE_SHORT } from "./console-roles.js";

export const COLS = ["m", "u", "d", "p"];
export const MISS = "—";
export const stc = (pin, moved) => (pin ? "pin" : moved ? "mv" : "df");
export const whyMissing = (p, k) => p.missing?.[{ m: "min", u: "usg", d: "rate", p: "rate", h: "healthy" }[k]] ?? "missing";
export const dash = (why) => `<span class="cmiss" title="${esc(why)}">${MISS}</span>`;
const fig = (v, why) => (num(v) ? f1(v) : dash(why));
const chg = (now, was, cls = "") => (num(now) && num(was) ? `<td class="${dcls(now - was)} ${cls}">${sgn(now - was)}</td>` : `<td class="${cls}">${dash("no figure to compare")}</td>`);
const rateText = (v) => (num(v) ? v.toFixed(2) : MISS);
const posTag = (p) => (p.pos ? `<span class="pos">${esc(p.pos)}</span>` : "");

function cellIn(t, id, k, state, txt, raw, extra, title) {
  return `<td class="ic${k === "d" ? " gs" : ""}">${extra ?? ""}<input class="ed ${state}" data-team="${esc(t)}" data-i="${esc(id)}" data-k="${k}" data-v="${raw ?? ""}" value="${esc(txt)}"${title ? ` title="${esc(title)}"` : ""} autocomplete="off" spellcheck="false"><s class="dt"></s></td>`;
}
function outCell(t, p, k) {
  const txt = k === "m" ? "OUT" : k === "d" ? rateText(p.rate) : "0.0";
  const fm = k === "p" ? '<span class="fm"></span>' : "";
  return `<td class="ic${k === "d" ? " gs" : ""}">${fm}<input class="ed out${k === "d" && !num(p.rate) ? " gone" : ""}" readonly data-team="${esc(t)}" data-i="${esc(p.id)}" data-k="${k}" data-v="${k === "d" ? "" : "0"}" value="${txt}"><s class="dt"></s></td>`;
}
function rowCells(T, t, r) {
  const p = r.p;
  if (r.out) return Object.fromEntries(COLS.map((k) => [k, outCell(t, p, k)]));
  const cell = (k, v, txt, state, extra) => (num(v) ? cellIn(t, p.id, k, state, txt, v, extra, k === "d" && r.clamped ? "Rate multiplier held at the end of its range" : null) : cellIn(t, p.id, k, "df gone", MISS, "", extra, whyMissing(p, k)));
  const tProj = tonightProj(T, p), tMin = tonightMin(T, p), tUsg = tonightUsg(T, p); // "moved" is against Tonight
  return {
    m: cell("m", r.min, num(r.min) ? f1(r.min) : "", stc(r.pinned.m, num(tMin) && Math.abs(r.min - tMin) > 0.05)),
    u: cell("u", r.usg, num(r.usg) ? f1(r.usg) : "", stc(r.pinned.u, num(tUsg) && Math.abs(r.usg - tUsg) > 0.05)),
    d: cell("d", r.rate, rateText(r.rate), `${stc(r.pinned.d, num(p.rate) && Math.abs(r.rate - p.rate) > 0.004)}${r.clamped ? " clamp" : ""}`),
    p: cell("p", r.proj, num(r.proj) ? f1(r.proj) : "", stc(r.pinned.p, !r.pinned.p && num(tProj) && Math.abs(r.proj - tProj) > 0.05), `<span class="fm">${r.pinned.p && num(r.formula) ? f1(r.formula) : ""}</span>`),
  };
}
/** The role buttons for a man: the one he holds is lit; amber when he flipped it, plain when the rule gave it. Out is his scenario's out list. */
export const roleSeg = (t, r) => `<span class="seg">${ROLES.map((k) => `<button class="rs${r.role === k ? ` on ${k}${r.pinned?.r || (k === "out" && r.out) ? " set" : ""}` : ""}" data-role="${k}" data-ri="${esc(r.id)}" data-team="${esc(t)}" title="${ROLE_LABEL[k]}" tabindex="-1">${ROLE_SHORT[k]}</button>`).join("")}</span>`;
const roleCell = (t, r) => `<td class="rl">${roleSeg(t, r)}</td>`;
const nameCell = (T, p) => `<td class="nm" title="${esc(p.name)}"><span class="n">${esc(tableName(T, p))}</span>${posTag(p)}</td>`;
/** Where a man's minutes come from, in words: what he typed, his role's figure, or TwoGun's board and its hand-outs. */
export function basisText(r) {
  if (r.out) return "out";
  if (r.pinned.m) return "typed by you";
  if (r.pinned.r) return r.min_basis ?? "role figure";
  const tg = r.p ? (r.p.out ? 0 : r.p.min) : null; // an untouched man the hand-outs moved off TwoGun's figure is the model's
  return num(tg) && num(r.min) && Math.abs(r.min - tg) > 0.05 ? "model (hand-outs)" : "TwoGun";
}
/** Adam's flag (11-06): a flipped man on a position median, not his own figure, so he knows to adjust it. Gone once he types the minutes. */
export const medianFlag = (r) => (r.min_median && !r.pinned.m ? `<span class="mdf" title="A position median, not his own figure: type his minutes if you know better">median — adjust?</span>` : "");
const basisCell = (r) => `<td class="bs${r.pinned.m ? " pin" : r.pinned.r ? " rb" : ""}" title="${esc(basisText(r))}">${medianFlag(r)}${esc(basisText(r))}</td>`;

/** How far a usage total may sit off 100 and read as rounding. A working value. */
const BOARD_ROUNDING = 1;
/** Whether a total shows as a miss: the engine says why, or an untouched board total is past its rounding. */
const missed = (total, target, why) => Boolean(why) || !num(total) || Math.round(Math.abs(total - target) * 10) / 10 > BOARD_ROUNDING;
/** A total in the number column, with "/ target" or, past a real miss, what it is off by in the tag slot and why on hover, never hidden. */
function totalCell(total, target, why, cls = "") {
  if (!num(total)) return `<td class="ic ${cls}"><span class="tnum">${dash("no man has this figure")}</span><s class="tt">/ ${target}</s></td>`;
  const off = total - target, ok = !missed(total, target, why);
  return `<td class="ic ${cls}"${why ? ` title="${esc(why)}"` : ""}><span class="tnum ${ok ? "" : "sumbad"}">${f1(total)}</span><s class="tt ${ok ? "" : "dn"}">${ok ? `/ ${target}` : `${off > 0 ? "+" : ""}${f1(off)}`}</s></td>`;
}
/** The team's minutes, for reference only (Adam, 11-06: no team total to reach): never red, never a refusal. */
const minTotalCell = (total) => `<td class="ic" title="The team's minutes, for reference only: nothing is brought to a total"><span class="tnum">${num(total) ? f1(total) : dash("no man has this figure")}</span><s class="tt">min</s></td>`;
/** Why typed usage misses 100, under the team's table. Nothing refuses Apply. */
const missLines = (totals) => (totals.usg_why ? `<div class="mis">${esc(totals.usg_why)}</div>` : "");
/** The five-starter rule's word on the team: the move it just made, and TwoGun's flags when they were not five. */
export function roleLines(G, code, R) {
  const moved = G.roleMoves?.team === code && G.roleMoves.moved.length ? `<div class="rmv">To keep five starters: ${G.roleMoves.moved.map((m) => `<b>${esc(R.rows.find((r) => r.id === m.id)?.p.name ?? m.id)}</b> ${esc(ROLE_LABEL[m.from])} to ${esc(ROLE_LABEL[m.to])}`).join(", ")}. <kbd>Ctrl+Z</kbd> undoes it.</div>` : "";
  return moved + usageLine(R) + (R.roles_note ? `<div class="rnote">${esc(R.roles_note)}</div>` : "");
}
/** When a man typed or flipped to 0 minutes hands his usage out, his teammates' DK/min move with it: said once on the team. */
function usageLine(R) {
  const gave = R.rows.filter((r) => !r.out && (r.pinned.m || r.pinned.r) && r.min === 0 && num(r.p.usg) && r.p.usg > 0);
  const moved = R.rows.some((r) => !r.out && !r.pinned.d && num(r.rate) && num(r.p.rate) && Math.abs(r.rate - r.p.rate) > 0.004);
  return gave.length && moved ? `<div class="rnote">Teammates' DK/min moved: ${esc(gave.map((r) => r.p.name).join(", "))} on 0 minutes, ${gave.length === 1 ? "his" : "their"} usage handed out.</div>` : "";
}
/** The team's projection, against Tonight's. A total with men missing is partial: it says how many and compares with nothing. */
function projTotal(res, against) {
  const n = res.totals.proj_missing;
  const delta = n ? `<s class="tt part" title="${n} men have no projection, so this total is partial and is not compared">partial</s>`
    : num(res.totals.proj) && num(against) ? `<s class="tt ${dcls(res.totals.proj - against)}">${sgn(res.totals.proj - against)}</s>` : '<s class="tt"></s>';
  return `<td class="ic"><span class="fm nostrike">${n ? `${n} ${MISS}` : ""}</span><span class="tnum">${num(res.totals.proj) ? f1(res.totals.proj) : MISS}</span>${delta}</td>`;
}
/** Tonight's own projection total, the board's. */
const tonightTotal = (T) => T.pl.reduce((sum, p) => { const v = tonightProj(T, p); return num(v) ? sum + v : sum; }, 0);

const GROUP_ROW = `<tr class="band"><th colspan="2" class="blank"></th><th colspan="4" class="grp">Minutes</th><th colspan="3" class="grp gs">Usage %</th><th colspan="2" class="grp gs">Output</th></tr>`;
const HEAD_ROW = `<tr><th>Role</th><th>Player</th><th>Usual</th><th class="hsl">Scenario</th><th title="Against TwoGun's Tonight">Chg</th><th class="bsh">From</th><th class="gs">Usual</th><th class="hsl">Scenario</th><th>Chg</th><th class="hsl gs">DK / min</th><th class="hsl">Projection</th></tr>`;
const COLGROUP = `<colgroup><col class="c-o"><col class="c-n"><col class="c-u"><col class="c-c"><col class="c-d"><col class="c-b"><col class="c-u"><col class="c-c"><col class="c-d"><col class="c-c"><col class="c-p"></colgroup>`;

function compareHtml(T, S, key, colour) {
  const C = savedFor(T, S).map((k) => ({ k, r: calc(T, S, outsOf(k)) }));
  const act = (k) => (k === key ? " cact" : "");
  const h1 = C.map((c) => `<th colspan="2" class="grp${act(c.k)}"><button class="sv hd${c.k === key ? " on" : ""}" data-key="${esc(c.k)}" title="${esc(fullLabel(T, c.k))}">${esc(label(T, c.k))}</button>${c.k === "" || c.k === T.tonightKey ? "" : `<button class="dl" data-del="${esc(c.k)}" title="Remove from compare">x</button>`}</th>`).join("");
  const h2 = C.map((c) => `<th class="${act(c.k)}">Min</th><th class="${act(c.k)}">Proj</th>`).join("");
  const body = T.pl.map((p, i) => `<tr data-man="${esc(p.id)}">${C.map((c) => {
    const r = c.r.rows[i], a = act(c.k);
    if (r.out) return `<td class="dimc${a}">OUT</td><td class="dimc${a}">-</td>`;
    return `<td class="${r.pinned.m ? "pin" : ""}${a}">${fig(r.min, whyMissing(p, "m"))}</td><td class="proj${r.pinned.p || r.pinned.d ? " pin" : ""}${a}">${fig(r.proj, whyMissing(p, "p"))}</td>`;
  }).join("")}</tr>`).join("");
  const partial = (r) => (r.totals.proj_missing ? `<span class="pm" title="${r.totals.proj_missing} men have no projection, so this total is partial">${r.totals.proj_missing} ${MISS} </span>` : "");
  const foot = `<tr>${C.map((c) => `<td class="${act(c.k)}">${num(c.r.totals.min) ? f1(c.r.totals.min) : MISS}</td><td class="${act(c.k)}">${partial(c.r)}${num(c.r.totals.proj) ? f1(c.r.totals.proj) : MISS}</td>`).join("")}</tr>`;
  return `<div class="panel cmp" style="--t1:${colour}"><div class="ph"><b>Compare saved scenarios</b><span class="mu">amber = has your pins</span></div><div class="cmpx"><table class="tc"><thead><tr class="band">${h1}</tr><tr>${h2}</tr></thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div></div>`;
}

export function teamHtml(model, G, code, colour) {
  const T = model.TEAMS[code], S = model.ST[code], outs = S.outs, key = keyOf(outs);
  const R = calc(T, S, outs);
  const rows = R.rows.map((r) => {
    const p = r.p, c = rowCells(T, code, r), uMin = usualMin(p);
    const usual = `<td class="mu">${fig(uMin, whyMissing(p, "h"))}</td>`, usualU = `<td class="mu gs">${fig(p.usg_usual, whyMissing(p, "u"))}</td>`;
    return `<tr${r.out ? ' class="out"' : ""}>${roleCell(code, r)}${nameCell(T, p)}${usual}${c.m}${chg(r.min, tonightMin(T, p))}${basisCell(r)}${usualU}${c.u}${chg(r.usg, tonightUsg(T, p))}${c.d}${c.p}</tr>`;
  }).join("");
  const list = `<div class="tlx"><table class="tl">${COLGROUP}<thead>${GROUP_ROW}${HEAD_ROW}</thead><tbody>${rows}</tbody><tfoot><tr><td>Team</td><td></td><td></td>${minTotalCell(R.totals.min)}<td></td><td></td><td class="gs"></td>${totalCell(R.totals.usg, TEAM_USAGE, R.totals.usg_why)}<td></td><td class="gs"></td>${projTotal(R, tonightTotal(T))}</tr></tfoot></table></div>`;
  return `<div class="cwork"><div class="panel main" style="--t1:${colour}">${teamHead(T, S, code, key)}${roleLines(G, code, R)}${list}${missLines(R.totals)}</div>${compareHtml(T, S, key, colour)}</div>`;
}

/** The team panel's heading: its code, its scenario and who is out. Shared by both layouts. */
export function teamHead(T, S, code, key) {
  const named = S.outs.map((i) => T.byId[i]).filter(Boolean).map((p) => chipName(T, p));
  const outText = !S.outs.length ? "everyone available" : named.length <= 3 ? `${named.join(" + ")} out` : `${named.length} men out`;
  return `<div class="ph"><span class="code">${esc(code)}</span><b>Scenario: ${esc(label(T, key))}</b><span class="mu" title="${esc(named.join(", "))}">${esc(outText)}</span></div>`;
}

export function slateHtml(model, G, colourOf) {
  const L = [];
  for (const [c, T] of Object.entries(model.TEAMS)) {
    for (const r of calc(T, model.ST[c], model.ST[c].outs).rows) {
      const was = tonightProj(T, r.p), base = usualProj(r.p);
      const proj = r.out ? 0 : r.proj;
      const mv = num(was) && num(proj) ? proj - was : null;
      // The sweep is what moved against Tonight; a man who came in or went out with no figure to compare stays on it.
      const changed = mv !== null ? Math.abs(mv) > 0.05 : r.out !== T.tonight.includes(r.id);
      if (changed) L.push({ c, r, mv, base });
    }
  }
  L.sort((a, b) => (b.mv === null ? -1 : Math.abs(b.mv)) - (a.mv === null ? -1 : Math.abs(a.mv))); // a move that cannot be worked out goes last
  G.rows = L.map((x) => ({ team: x.c, id: x.r.p.id }));
  const mx = Math.max(1, ...L.map((x) => Math.abs(x.mv ?? 0)));
  const up = L.filter((x) => x.mv > 0).reduce((s, x) => s + x.mv, 0), dn = L.filter((x) => x.mv < 0).reduce((s, x) => s + x.mv, 0);
  const rows = L.map((x, i) => {
    const r = x.r, p = r.p, T = model.TEAMS[x.c], c = rowCells(T, x.c, r);
    const bar = x.mv === null ? "" : `<span class="mb"><i class="${x.mv > 0 ? "up" : "dn"}" style="width:${Math.round((Math.abs(x.mv) / mx) * 100)}%"></i></span>`;
    return `<tr${r.out ? ' class="out"' : ""}><td class="rk">${i + 1}</td><td><span class="tc2" style="--t1:${colourOf(x.c)}">${esc(x.c)}</span></td>${nameCell(T, p)}<td class="mu">${fig(usualMin(p), whyMissing(p, "h"))}</td>${c.m}<td class="mu gs">${fig(p.usg_usual, whyMissing(p, "u"))}</td>${c.u}${c.d}<td class="mu">${fig(x.base, whyMissing(p, "p"))}</td>${c.p}${x.mv === null ? `<td>${dash("no figure Tonight to compare")}</td>` : `<td class="${dcls(x.mv)}">${sgn(x.mv)}</td>`}<td class="bc">${bar}</td></tr>`;
  }).join("");
  return `<div class="panel sweep" style="--t1:var(--gr)"><div class="ph"><b>Slate sweep</b><span class="mu">${L.length} players moved from Tonight by the current scenarios, ranked by projection move</span><div class="grow"></div><span class="up">${sgn(up)}</span><span class="dn">${sgn(dn)}</span></div><div class="sweepx"><table class="tl ts"><thead><tr><th>#</th><th>Team</th><th>Player</th><th>Usual min</th><th class="hsl">Minutes</th><th class="gs">Usual usg</th><th class="hsl">Usage %</th><th class="hsl gs">DK / min</th><th>Usual proj</th><th class="hsl">Projection</th><th>Move</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="12" class="none">Nobody has moved from Tonight. Mark a man out or pin a number on a team.</td></tr>`}</tbody></table></div></div>`;
}

const SOURCE_NAME = { saved: "your edit", recipe: "TwoGun's recipe", twogun_table: "TwoGun's table", closeness: "position closeness" };

/** Who his minutes go to if he sits, the top few among the men playing in this scenario, and where the shares came from. */
function handoutHtml(T, S, p) {
  const { weights, source } = handoutShares(teamFor(T, T.tonight.includes(p.id) ? { ...S, handouts: {} } : S), p.id, "m", new Set(T.pl.filter((x) => !S.outs.includes(x.id) && x.id !== p.id).map((x) => x.id)));
  const entries = Object.entries(weights).filter(([id, v]) => v > 0 && T.byId[id] && !S.outs.includes(id) && id !== p.id);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (!total) return `<div class="dimc pr">no one to hand his minutes to</div>`;
  const top = entries.sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, v]) => `<span class="ho"><b>${esc(chipName(T, T.byId[id]))}</b> ${Math.round((v / total) * 100)}%</span>`).join("");
  return `<div class="hos">${top}<span class="mu">from ${esc(SOURCE_NAME[source] ?? "nowhere")}</span></div>`;
}

function headFigures(T, p, r, f) {
  const sc = (cls, k, txt) => `<div class="kv ${f.k === k ? "fk " : ""}"><span>${FN[k]}</span><b class="${cls}">${txt}</b></div>`;
  const tProj = tonightProj(T, p), tMin = tonightMin(T, p), tUsg = tonightUsg(T, p);
  if (r.out) return `<div class="kv kvst"><span>status</span><b class="dn">OUT here - minutes and usage went to teammates who were not typed or flipped</b></div>`;
  return sc(stc(r.pinned.m, num(tMin) && Math.abs(r.min - tMin) > 0.05), "m", num(r.min) ? f1(r.min) : MISS)
    + sc(stc(r.pinned.u, num(tUsg) && Math.abs(r.usg - tUsg) > 0.05), "u", num(r.usg) ? `${f1(r.usg)}%` : MISS)
    + sc(stc(r.pinned.d, num(p.rate) && Math.abs(r.rate - p.rate) > 0.004), "d", rateText(r.rate))
    + sc(stc(r.pinned.p, !r.pinned.p && num(tProj) && Math.abs(r.proj - tProj) > 0.05), "p", num(r.proj) ? f1(r.proj) : MISS);
}

function byScenarioRows(T, S, f, key) {
  return savedFor(T, S).map((k) => {
    const q = calc(T, S, outsOf(k)).rows.find((x) => x.id === f.id);
    const figures = q.out ? `<td class="dimc">OUT</td><td class="dimc">-</td><td class="dimc">-</td><td class="dimc">-</td>`
      : `<td class="${q.pinned.m ? "pin" : ""}">${num(q.min) ? f1(q.min) : MISS}</td><td class="${q.pinned.u ? "pin" : ""}">${num(q.usg) ? f1(q.usg) : MISS}</td><td class="${q.pinned.d ? "pin" : ""}">${rateText(q.rate)}</td><td class="proj ${q.pinned.p ? "pin" : ""}">${num(q.proj) ? f1(q.proj) : MISS}</td>`;
    return `<tr class="${k === key ? "cact" : ""}"><td class="nm" title="${esc(fullLabel(T, k))}">${esc(label(T, k))}</td>${figures}</tr>`;
  }).join("");
}

function pinsList(T, S, f) {
  const pins = [];
  for (const k of Object.keys(S.pins)) {
    if (!outsOf(k).every((id) => T.byId[id])) continue;
    for (const c of COLS) {
      const v = S.pins[k][c]?.[f.id];
      if (v !== undefined) pins.push(`<div class="pr"><span>${esc(label(T, k))}</span><span>${FN[c]}</span><b class="pin">${fmtv(c, v)}</b><button class="x" data-pinx="${esc(f.team)}|${esc(k)}|${c}|${esc(f.id)}" title="Clear this pin">x</button></div>`);
    }
  }
  return pins.length ? pins.join("") : `<div class="dimc pr">none - every number is the model default</div>`;
}

export function sideHtml(model, G, colourOf) {
  const f = G.focus, T = model.TEAMS[f.team], S = model.ST[f.team];
  const p = T?.byId[f.id];
  if (!p) return "";
  const key = keyOf(S.outs), r = calc(T, S, S.outs).rows.find((x) => x.id === f.id);
  const hist = G.hist.map((h, i) => ({ h, i })).slice(-12).reverse().map((x) => `<div class="hr ${x.i === G.hi ? "cur" : x.i > G.hi ? "redo" : ""}" data-hist="${x.i}"><i>${x.i}</i>${esc(x.h.label)}</div>`).join("");
  const line1 = `TwoGun tonight <b>${num(p.tg_min) ? f1(p.tg_min) : MISS}</b> min, <b>${num(p.tg_proj) ? p.tg_proj.toFixed(2) : MISS}</b> pts`;
  const line2 = `season USG <b>${num(p.usg_pct) ? `${f1(p.usg_pct)}%` : MISS}</b> · row cap <b>${num(p.cap) ? f1(p.cap) : MISS}</b>`;
  const last = p.season ? `2025-26 <b>${num(p.season.mpg) ? f1(p.season.mpg) : MISS}</b> MPG, started <b>${num(p.season.st) ? Math.round(p.season.st * 100) : MISS}%</b> of ${p.season.g} games${p.season.team === "TOT" ? " (traded)" : p.season.team !== f.team ? ` (${esc(p.season.team)})` : ""}` : "2025-26: no row";
  const line3 = `<div class="facts">Role <b>${esc(ROLE_LABEL[r.role] ?? "")}</b>${r.pinned.r ? " (yours)" : ""} · minutes from <b title="${esc(basisText(r))}">${esc(basisText(r))}</b></div><div class="facts">${last}</div>`;
  const missing = [...Object.entries(p.missing ?? {}).map(([k, why]) => `<div class="mis"><b>${esc(k)}</b> missing: ${esc(why)}</div>`), ...(r.clamped ? [`<div class="mis"><b>rate</b> held at the end of its range</div>`] : []), ...(r.back_on_zero ? [`<div class="mis"><b>back on 0 minutes</b>; pin his minutes</div>`] : [])].join("");
  return `<div class="cside" style="--t1:${colourOf(f.team)}"><div class="ph"><span class="code">${esc(f.team)}</span><b class="sname" title="${esc(p.name)}">${esc(tableName(T, p))}</b>${posTag(p)}<span class="mu slabel" title="${esc(fullLabel(T, key))}">${esc(label(T, key))}</span></div><div class="kvs">${headFigures(T, p, r, f)}</div><div class="facts">${line1}</div><div class="facts">${line2}</div>${line3}${missing}`
    + `<h4>By scenario</h4><table class="ts2"><thead><tr><th>Scenario</th><th>Min</th><th>Usg</th><th>DK</th><th>Proj</th></tr></thead><tbody>${byScenarioRows(T, S, f, key)}</tbody></table>`
    + `<h4>His pins</h4>${pinsList(T, S, f)}`
    + `<h4>If he sits, his minutes go to</h4>${handoutHtml(T, S, p)}`
    + `<h4>History <span class="mu">${G.hi} of ${G.hist.length - 1}  (Ctrl+Z / Ctrl+Y)</span></h4><div class="hist">${hist}</div><div class="helpl">Also: Alt+Up/Down steps a cell, Alt+Shift a big step; Shift+Del clears all his pins.</div></div>`;
}

export function pickerHtml(model, G, colourOf, games) {
  const codes = Object.keys(model.TEAMS);
  const tile = (c, opp, home) => {
    const T = model.TEAMS[c], outs = model.ST[c].outs, names = outs.map((x) => T.byId[x]).filter(Boolean).map((p) => chipName(T, p));
    const i = codes.indexOf(c);
    return `<button class="pk${c === G.cur && G.view === "team" ? " on" : ""}" data-t="${esc(c)}" style="--t1:${colourOf(c)}"${names.length > 1 ? ` title="${esc(names.join(", "))} out"` : ""}>${i < 9 ? `<kbd>${i + 1}</kbd>` : ""}<b>${esc(c)}</b><span>${home ? "vs" : "@"} ${esc(opp)}</span><em>${names.length === 1 ? `${esc(names[0])} out` : names.length ? `${names.length} out` : ""}</em></button>`;
  };
  const tiles = games.map((g) => `<span class="gm">${tile(g.away, g.home, false)}${tile(g.home, g.away, true)}</span>`).join("");
  return `<div class="pks">${tiles}</div><div class="pkb"><button class="vw${G.view === "slate" ? " on" : ""}" id="vslate"><kbd>S</kbd>Slate sweep</button><button class="vw" id="vapply"><kbd>A</kbd>Apply</button></div>`;
}

/** What an Apply or a Reverse moved, in words: projections and minutes counted apart, since a man may have either or both. */
export function countsText(proj, min) {
  const part = (n, one, many) => (n ? `${n} ${n === 1 ? `man's ${one}` : `men's ${many}`}` : "");
  return [part(proj, "projection", "projections"), part(min, "minutes", "minutes")].filter(Boolean).join(" and ") || "no man's figures";
}

export function barHtml(model, G, applied) {
  const stamp = applied ? `<span class="appl" title="Press R or type reverse to take back what it set">Applied ${esc(isoToEastern(applied.at) ?? applied.at)}: ${countsText(applied.count, applied.min_count)} <button class="rst" id="vreverse"><kbd>R</kbd>Reverse</button></span>` : `<span class="mu appl">Board has none of this until Apply</span>`;
  if (G.view === "slate") return `<div class="row"><span class="lbl">Slate</span><span class="mu">Each team shows its own current scenario; edit any cell in place. Switch to a team (Alt+1-9, &lt; &gt;, or type its code) to change who is out.</span><div class="grow"></div>${stamp}</div>`;
  const T = model.TEAMS[G.cur], S = model.ST[G.cur], key = keyOf(S.outs), list = savedFor(T, S);
  const pinCount = hasPins(S.pins[key]) ? Object.values(pinsOf(S, key)).reduce((s, o) => s + Object.keys(o).length, 0) : 0;
  return `<div class="row"><span class="lbl">Scenario</span>${list.map((k) => `<button class="sv${k === key ? " on" : ""}" data-key="${esc(k)}" title="${esc(fullLabel(T, k))}">${esc(label(T, k))}</button>`).join("")}<button class="sv add" id="save"${list.includes(key) ? " disabled" : ""}>+ Save current</button><span class="lay" title="How the team shows: a table, or lanes to drag men between roles. Remembered on this browser.">${[["a", "A Table"], ["b", "B Lanes"]].map(([k, t]) => `<button class="sv${G.layout === k ? " on" : ""}" data-lay="${k}">${t}</button>`).join("")}</span><div class="grow"></div>${stamp}<span class="mu pc">pins here: ${pinCount}</span><button class="rst" id="reset">Reset scenario</button></div>`
    + `<div class="row"><span class="lbl">Who is out</span><div class="chips2">${T.pl.map((p) => `<button class="chip${S.outs.includes(p.id) ? " out" : ""}" data-o="${esc(p.id)}" data-team="${esc(G.cur)}" title="${esc(p.name)}"><span class="cn">${esc(chipName(T, p))}</span><i>${num(usualMin(p)) ? f1(usualMin(p)) : MISS}</i></button>`).join("")}</div></div>`;
}

/** A pull's folder stamp as its time in Eastern, "7:00 PM ET"; the stamp itself when it is not one. */
export function pullTime(stamp) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})([+-]\d{2})(\d{2})$/.exec(String(stamp));
  return m ? isoToEastern(`${m[1]}T${m[2]}:${m[3]}:${m[4]}${m[5]}:${m[6]}`) ?? stamp : stamp;
}

/** The source line beside the command box: where the minutes and the usage came from, and when. */
export function sourceHtml(inputs) {
  const basis = inputs.basis.kind === "row" ? "TwoGun row" : "slate file";
  const u = inputs.usage;
  const usage = u.state === "ready" ? `<span>Usage <b>${esc(u.source ?? "league table")}</b> ${esc(isoToEastern(u.as_of) ?? "")}</span>` : `<span class="dn" title="${esc(u.message ?? "")}">Usage missing</span>`;
  const notes = inputs.notes?.length ? `<span class="dn" title="${esc(inputs.notes.join(" "))}">${inputs.notes.length} note${inputs.notes.length === 1 ? "" : "s"}</span>` : "";
  return `<span title="Tonight is this pull's board, exactly">Minutes <b>${basis}</b> ${inputs.basis.pull ? esc(pullTime(inputs.basis.pull)) : "no pull"}</span>${usage}${notes}`;
}

function planNotes(plan) {
  const line = (n, what, names) => (n ? `<div class="mis">${what}${names ? `: ${esc(names)}` : ""}.</div>` : "");
  return plan.refused.map((t) => `<div class="mis"><b>${esc(t.team)} refused, nothing sent for it:</b> ${esc(t.name)}. ${esc(t.why)}</div>`).join("")
    + line(plan.kept.length, `${plan.kept.length} men keep the number you typed on the board, no pin here`, plan.kept.map((k) => `${k.name} ${k.typed}`).join(", "))
    + line(plan.clamped.length, `${plan.clamped.length} men's rate held at the end of its range`, plan.clamped.map((k) => k.name).join(", "))
    + line(plan.back_on_zero.length, `Back on 0 minutes; pin his minutes`, plan.back_on_zero.map((m) => m.name).join(", "))
    + line(plan.back_in?.length, `Out tonight, but this scenario has them playing; mark them out if that is not your choice`, plan.back_in?.map((m) => m.name).join(", "))
    + line(plan.missing.length, `${plan.missing.length} men on the board have no projection here and stay as they are`, plan.missing.map((m) => m.name).join(", "))
    + line(plan.orphaned_pins.length, `Pins not sent, on scenarios that are not on show`, plan.orphaned_pins.map((o) => `${o.team} ${o.key || "Healthy"} (${o.count})`).join(", "))
    + (plan.usage?.state === "ready" ? "" : `<div class="mis">Usage is missing (${esc(plan.usage?.message ?? "not read")}), so rates did not move with usage.</div>`);
}

export function applyHtml(plan, name) {
  const up = plan.changes.filter((c) => c.move > 0).length, dn = plan.changes.filter((c) => c.move < 0).length;
  const total = plan.changes.reduce((s, c) => s + Math.abs(c.move ?? 0), 0);
  const noProj = !plan.changes.length, nothing = noProj && !plan.min_moves;
  const minNote = plan.min_moves ? `<div class="sum">${plan.min_moves} men's minutes on the board move to their scenarios.</div>` : "";
  const cell = (v, text, cls, why) => `<td${cls ? ` class="${cls}"` : ""}>${num(v) ? text(v) : dash(why)}</td>`;
  const rate = (v) => v.toFixed(2);
  const moves = plan.rows.map((c) => `<tr><td class="nm" title="${esc(c.name)}"><span class="tc2">${esc(c.team)}</span> ${esc(c.short)}</td>`
    + cell(c.min_from, f1, "mu", "no minutes on the board") + cell(c.min_to, f1, "", "no minutes after Apply")
    + cell(c.rate_from, rate, "mu gs", "no DK/min Tonight") + cell(c.rate_to, rate, "", "no DK/min in this scenario")
    + cell(c.proj_from, rate, "mu gs", "no projection on the board") + cell(c.proj_to, rate, "", "no projection after Apply")
    + cell(c.move, (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}`, dcls(c.move ?? 0), "no figure to compare") + `</tr>`).join("");
  const teams = plan.teams.filter((t) => t.moves > 0 || t.min_moves > 0).map((t) => `<span class="tp"><b>${esc(t.team)}</b> ${esc(t.name)} <i>${t.moves} move${t.moves === 1 ? "" : "s"}</i>${num(t.min_total) ? ` <em class="mu" title="The team's minutes, for reference only">${f1(t.min_total)} min</em>` : ""}</span>`).join("");
  return `<div class="box"><div class="ph" style="--t1:var(--gr)"><b>Apply to the board</b><span class="mu">${esc(name)}</span></div>`
    + `<div class="sum">${nothing ? "<b>No man changes.</b> Teams on Tonight with no pins send nothing." : noProj ? "<b>No man's projection changes.</b>" : `<b>${plan.changes.length} men change</b> by ${f1(total / plan.changes.length)} points on average: ${up} up, ${dn} down.`}</div>${minNote}${teams ? `<div class="tps">${teams}</div>` : ""}${planNotes(plan)}`
    + (plan.rows.length ? `<div class="movesx"><table class="ts2"><thead><tr><th>Moves</th><th title="Minutes the board holds now">Min now</th><th>Min after</th><th class="gs" title="Tonight's DK points per minute: the board holds no scenario rate, so this is Tonight's even after an earlier Apply">DK/min Tonight</th><th>DK/min after</th><th class="gs" title="Projection the board holds now">Proj now</th><th>Proj after</th><th>Move</th></tr></thead><tbody>${moves}</tbody></table></div>` : "")
    + `<div class="cacts">${nothing ? "" : `<button class="sv on" id="applyGo"><kbd>Enter</kbd>Apply</button>`}<button class="sv" id="applyNo"><kbd>Esc</kbd>${nothing ? "Close" : "Cancel"}</button></div></div>`;
}

export function reverseHtml(rev, name) {
  const kept = rev.kept.length ? `<div class="mis">${rev.kept.length} men keep the number you typed since: ${esc(rev.kept.join(", "))}.</div>` : "";
  return `<div class="box"><div class="ph" style="--t1:var(--am)"><b>Reverse the last Apply</b><span class="mu">${esc(name)}</span></div><div class="sum">Reverse takes back <b>${countsText(rev.restored, rev.restored_min)}</b>, as held before Apply (${esc(isoToEastern(rev.at) ?? rev.at)}).</div>${kept}<div class="cacts"><button class="sv on" id="applyGo"><kbd>Enter</kbd>Reverse</button><button class="sv" id="applyNo"><kbd>Esc</kbd>Cancel</button></div></div>`;
}
