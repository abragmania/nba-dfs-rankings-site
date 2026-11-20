// The Scenario tab's markup (layout A of the 11-19 mock-ups, Adam's pick; his yes 12:42 PM 11-20): a top bar (team, what-if men, view, Arm, Save), the saved row, the one-line summary,
// then the full table (Min, Usg, DK/min, Proj, Value: index 0, index 1 and the change) or the ripple view (only the men who change, biggest first, with a bar). Index 1's Min, Usg and DK/min are
// boxes he types in. Notes, counts and the arm word sit at the foot only (G64). Pure: each builder takes what it draws and returns html. A missing figure is a dash with its reason, never 0 (R1).
import { esc } from "./board-util.js";
import { isNum } from "./figures.js";
import { summaryText, rippleRows } from "./whatif-model.js";

const DASH = (why) => `<span class="sn-miss" title="${esc(why)}">—</span>`;
const fx = (v, dp, why = "no figure") => (isNum(v) ? v.toFixed(dp) : DASH(why));
const minus = (s) => s.replace(/^-/, "−");
/** A change cell: green for a gain, red for a loss, blank tint for none; dp decimals. */
function deltaTd(v, dp, sep = false) {
  if (!isNum(v)) return `<td class="sn-d${sep ? " sep" : ""}"></td>`;
  const zero = Math.abs(v) < 0.5 * 10 ** -dp; // rounds to nothing at the figure's own decimals
  const cls = zero ? "" : v > 0 ? " up" : " dn";
  return `<td class="sn-d${cls}${sep ? " sep" : ""}">${zero ? "±0" : minus(`${v > 0 ? "+" : ""}${v.toFixed(dp)}`)}</td>`;
}

/** The men the what-if has starting (Adam 1:37 PM 11-20: "Y starts, here are everyone's minutes"): a chip each, and a picker to add one. startMen: the men playing in it, not already starting. */
function startsHtml(starts, startMen, nameOf) {
  const chips = starts.map((id, i) => `<span class="sn-pick on sn-st">${esc(nameOf(id))} starts<button class="sn-x" data-sn="unstart" data-i="${i}" title="Take this starter off the what-if">×</button></span>`).join("");
  const add = starts.length < 5 && startMen.length ? `<select class="sn-sel sn-add" data-sn="start" title="A man in the starting five for this what-if: it is used only when the confirmed five has him starting"><option value="" selected>+ starts:</option>${startMen.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}${m.pos ? ` · ${esc(m.pos)}` : ""}</option>`).join("")}</select>` : "";
  return chips + add;
}

/** The top bar. teams: [{ code, opp }]; men: [{ id, name, pos, min }] the men he can sit (playing on the board); outs: the men picked; starts / startMen: startsHtml's; save: { label, disabled, title }. */
export function barHtml({ teams, team, men, outs, adding, starts = [], startMen = [], nameOf = (id) => id, view, armed, save, many }) {
  const teamSel = `<select class="sn-sel" data-sn="team" title="The team">${teams.map((t) => `<option value="${esc(t.code)}"${t.code === team ? " selected" : ""}>${esc(t.code)} vs ${esc(t.opp)}</option>`).join("")}</select>`;
  const opts = (cur) => `<option value=""${cur ? "" : " selected"}>Pick a player</option>${men.filter((m) => m.id === cur || !outs.includes(m.id)).map((m) => `<option value="${esc(m.id)}"${m.id === cur ? " selected" : ""}>${esc(m.name)}${m.pos ? ` · ${esc(m.pos)}` : ""}</option>`).join("")}`;
  const picks = [...outs, ...(adding || !outs.length ? [""] : [])].map((id, i) => `<span class="sn-pick${id ? " on" : ""}"><select class="sn-sel" data-sn="who" data-i="${i}" title="A man who sits in this what-if">${opts(id)}</select>${id && outs.length > 1 ? `<button class="sn-x" data-sn="unwho" data-i="${i}" title="Take him off this what-if">×</button>` : ""}</span>`).join("");
  const add = outs.length && !adding && outs.length < 5 ? `<button class="sn-chip" data-sn="add">+ add another player</button>` : "";
  const vw = (k, l) => `<button class="sn-chip${view === k ? " on" : ""}" data-sn="view" data-v="${k}">${l}</button>`;
  return `<div class="sn-bar"><span class="sn-k">TEAM</span>${teamSel}<span class="sn-k">WHAT IF</span>${picks}${add}${outs.length ? startsHtml(starts, startMen, nameOf) : ""}<span class="sn-gap"></span><span class="sn-k">VIEW</span>${vw("ripple", "Ripple")}${vw("full", "Full table")}<span class="sn-grow"></span>`
    + `<button class="sn-arm${armed ? " on" : ""}" data-sn="arm" title="Armed: when our feeds rule ${many ? "all of them" : "him"} Out${starts.length ? " and the confirmed five has its starters" : ""}, its numbers go on the board as your Console work; of several that fit, the one with the most conditions"${outs.length ? "" : " disabled"}><span class="sn-sw"></span>Arm: use if ${many ? "they're" : "he's"} ruled Out</button>`
    + `<button class="sn-save" data-sn="save"${save.disabled ? " disabled" : ""} title="${esc(save.title ?? "")}">${esc(save.label)}</button></div>`;
}

/** The saved row: the team's what-ifs, the one on show lit, an armed one marked; the compare-against choice at the right. */
export function savedHtml(list, curId) {
  const chips = list.length ? list.map((w) => `<span class="sn-saved${w.id === curId ? " on" : ""}"><button class="sn-chip" data-sn="load" data-id="${esc(w.id)}" title="${esc(w.last?.text ?? (w.armed ? "Armed" : "Not armed"))}">${w.armed ? '<i class="sn-dot" title="Armed"></i>' : ""}${esc(w.name)}</button><button class="sn-x" data-sn="drop" data-id="${esc(w.id)}" title="Delete this what-if">×</button></span>`).join("") : '<span class="sn-none">none yet on this team</span>';
  return `<div class="sn-bar"><span class="sn-k">SAVED</span>${chips}<span class="sn-grow"></span><span class="sn-k">compare against</span><span class="sn-chip on" title="Index 0: our engine on the team as the board holds it now">Current board</span></div>`;
}

/** The one-line summary. */
export function summaryHtml(team, s) {
  const t = summaryText(team, s);
  const color = (txt) => txt.replace(/team ([+−]?[\d.]+) pts/, (m, v) => `team <b class="${v.startsWith("−") ? "dn" : v === "0.0" ? "" : "up"}">${v}</b> pts`).replace(/winner (.+?) ([+−][\d.]+)/, (m, n, v) => `winner <b class="up">${esc(n)} ${v}</b>`).replace(/loser (.+?) ([+−][\d.]+)$/, (m, n, v) => `loser <b class="dn">${esc(n)} ${v}</b>`).replace(/usage (x[\d.]+ → x[\d.]+)/, (m, v) => `usage <b>${v}</b>`);
  return `<div class="sn-sum"><span class="sn-lead">${esc(t.lead)}</span> ${color(esc(t.rest))}</div>`;
}

const posTag = (pos) => (pos ? `<span class="sn-pos">${esc(String(pos).split("/")[0])}</span>` : "");
const val = (v) => (isNum(v) ? `${v.toFixed(1)}x` : DASH("no value: a projection or salary is missing"));
/** An index-1 box he types in: his own edit lit; the figure the engine gives otherwise. */
function box(r, k, v, dp) {
  const why = r.missing.join("; ") || "no figure";
  return `<td class="sn-e${r.edited[k] ? " ed" : ""}"><input class="sn-in" data-sn="edit" data-k="${k}" data-id="${esc(r.id)}" value="${isNum(v) ? v.toFixed(dp) : ""}" placeholder="—" inputmode="decimal" autocomplete="off" title="${r.edited[k] ? "Your number; clear the box to take it off" : isNum(v) ? "Type to set it" : esc(why)}"></td>`;
}

/** The full table: every man playing on either side. */
export function fullHtml(rows) {
  const head = `<tr><th>PLAYER</th><th>SAL</th><th class="sep">Min₀</th><th>Min₁</th><th>Δ</th><th class="sep">Usg₀</th><th>Usg₁</th><th>Δ</th><th class="sep">DK/min₀</th><th>DK/min₁</th><th>Δ</th><th class="sep">Proj₀</th><th>Proj₁</th><th>Δ</th><th class="sep">Value₀</th><th>Value₁</th><th>Δ</th></tr>`;
  const body = rows.map((r) => {
    if (r.sitting) return `<tr class="out"><td>${esc(r.name)}${posTag(r.pos)}</td><td>${r.sal ? `$${r.sal.toLocaleString("en-US")}` : DASH("no salary")}</td><td class="sep">${fx(r.min0, 1)}</td><td>OUT</td>${deltaTd(r.dmin, 1)}<td class="sep">${fx(r.usg0, 1)}</td><td>—</td>${deltaTd(r.dusg, 1)}<td class="sep">${fx(r.rate0, 2)}</td><td>—</td><td class="sn-d"></td><td class="sep">${fx(r.proj0, 1)}</td><td>${fx(r.proj1, 1)}</td>${deltaTd(r.dproj, 1)}<td class="sep">${val(r.val0)}</td><td>—</td><td class="sn-d"></td></tr>`;
    return `<tr${r.set_aside ? ` title="${esc(`your typed minutes were set aside: the man moved across the starter line`)}"` : ""}><td>${esc(r.name)}${posTag(r.pos)}</td><td>${r.sal ? `$${r.sal.toLocaleString("en-US")}` : DASH("no salary")}</td>`
      + `<td class="sep">${fx(r.min0, 1)}</td>${box(r, "m", r.min1, 1)}${deltaTd(r.dmin, 1)}`
      + `<td class="sep">${fx(r.usg0, 1)}</td>${box(r, "u", r.usg1, 1)}${deltaTd(r.dusg, 1)}`
      + `<td class="sep">${fx(r.rate0, 2)}</td>${box(r, "d", r.rate1, 2)}${deltaTd(r.drate, 2)}`
      + `<td class="sep">${fx(r.proj0, 1)}</td><td>${fx(r.proj1, 1, r.missing.join("; ") || "no projection")}</td>${deltaTd(r.dproj, 1)}`
      + `<td class="sep">${val(r.val0)}</td><td>${val(r.val1)}</td>${deltaTd(r.dval, 1)}</tr>`;
  }).join("");
  return `<div class="sn-tw"><table class="sn-t sn-full"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

/** The ripple view: only the men who change, biggest projection change first, Min, Usg and Proj with a bar each. */
export function rippleHtml(rows) {
  const list = rippleRows(rows), top = Math.max(0.1, ...list.map((r) => Math.abs(r.dproj ?? 0)));
  const head = `<tr><th>PLAYER (ONLY MEN WHO CHANGE, BY PROJ Δ)</th><th class="sep">Min₀</th><th>Min₁</th><th>Δ</th><th class="sep">Usg₀</th><th>Usg₁</th><th>Δ</th><th class="sep">Proj₀</th><th>Proj₁</th><th>Δ</th><th class="sn-rl">RIPPLE</th></tr>`;
  const body = list.map((r) => {
    const w = isNum(r.dproj) ? (Math.abs(r.dproj) / top) * 100 : 0, bar = `<td class="sn-rb"><i class="${(r.dproj ?? 0) < 0 ? "dn" : "up"}" style="width:${w.toFixed(1)}%"></i></td>`;
    const m1 = r.sitting ? "<td>OUT</td>" : box(r, "m", r.min1, 1), u1 = r.sitting ? "<td>—</td>" : box(r, "u", r.usg1, 1);
    return `<tr${r.sitting ? ' class="out"' : ""}><td>${esc(r.name)}${posTag(r.pos)}</td><td class="sep">${fx(r.min0, 1)}</td>${m1}${deltaTd(r.dmin, 1)}<td class="sep">${fx(r.usg0, 1)}</td>${u1}${deltaTd(r.dusg, 1)}<td class="sep">${fx(r.proj0, 1)}</td><td>${fx(r.proj1, 1)}</td>${deltaTd(r.dproj, 1)}${bar}</tr>`;
  }).join("");
  return `<div class="sn-tw"><table class="sn-t sn-rip"><thead>${head}</thead><tbody>${body || '<tr><td colspan="11" class="sn-none">Nobody moves.</td></tr>'}</tbody></table></div>`;
}

/** The foot: what the numbers are, the arm word, and every count of what could not be used (G62, G64). */
export const footHtml = (lines) => `<div class="sn-foot">${lines.filter(Boolean).map((l) => `<div>${esc(l)}</div>`).join("")}</div>`;
