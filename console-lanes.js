// The console's B layout (Adam, 11-06): one lane per role, Starter, Bench+, Bench, Out of rotation, Out, each man a card with his
// minutes and DK points per minute boxes (the same pins as the table's cells) and his projection. A card is dragged to another lane,
// or on a phone tapped and then its lane tapped; either is the same role move as the A table's buttons. Strings only.
import { esc } from "./board-util.js";
import { keyOf } from "./console-engine.js";
import { calc, f1, tableName, tonightMin } from "./console-model.js";
import { ROLES, ROLE_LABEL } from "./console-roles.js";
import { isNum as num } from "./figures.js";
import { MISS, basisText, dash, medianFlag, roleLines, stc, teamHead, whyMissing } from "./console-render.js";

const rateText = (v) => (num(v) ? v.toFixed(2) : MISS);

/** One box: a pin cell of the A table's kind (input.ed, so the same keys and saves apply), read-only for a man out. */
function box(T, t, r, k) {
  const p = r.p;
  if (r.out) return `<input class="ed out" readonly data-team="${esc(t)}" data-i="${esc(p.id)}" data-k="${k}" data-v="" value="${k === "m" ? "OUT" : rateText(p.rate)}" tabindex="-1">`;
  const v = k === "m" ? r.min : r.rate;
  if (!num(v)) return `<input class="ed df gone" data-team="${esc(t)}" data-i="${esc(p.id)}" data-k="${k}" data-v="" value="${MISS}" title="${esc(whyMissing(p, k))}" autocomplete="off" spellcheck="false">`;
  const was = k === "m" ? tonightMin(T, p) : p.rate;
  const moved = num(was) && Math.abs(v - was) > (k === "m" ? 0.05 : 0.004);
  return `<input class="ed ${stc(r.pinned[k], moved)}" data-team="${esc(t)}" data-i="${esc(p.id)}" data-k="${k}" data-v="${v}" value="${k === "m" ? f1(v) : rateText(v)}" autocomplete="off" spellcheck="false">`;
}

function manCard(T, t, r, picked) {
  const p = r.p, tg = num(p.tg_min) ? f1(p.tg_min) : MISS;
  return `<div class="mc${picked ? " picked" : ""}${r.out ? " out" : ""}" draggable="true" data-drag="${esc(p.id)}" data-team="${esc(t)}">`
    + `<div class="l1"><span class="grip" aria-hidden="true">⋮⋮</span><button class="mn" data-pick="${esc(p.id)}" data-team="${esc(t)}" title="${esc(p.name)}: tap, then tap a lane to move him">${esc(tableName(T, p))}</button>${p.pos ? `<span class="pos">${esc(p.pos)}</span>` : ""}<span class="bsl${r.pinned.m ? " pin" : r.pinned.r ? " rb" : ""}" title="${esc(basisText(r))}">${medianFlag(r)}${esc(basisText(r))}</span><span class="tgm" title="TwoGun's minutes tonight">TG ${tg}</span></div>`
    + `<div class="l2"><label>Min${box(T, t, r, "m")}</label><label>DK/min${box(T, t, r, "d")}</label><span class="pj">Proj <b class="${r.pinned.p || r.pinned.d || r.pinned.m ? "pin" : ""}">${r.out ? "0.0" : num(r.proj) ? f1(r.proj) : dash(whyMissing(p, "p"))}</b></span></div></div>`;
}

/** The lanes for one team, and the order its men are walked in by the keyboard. */
export function lanesHtml(model, G, code, colour) {
  const T = model.TEAMS[code], S = model.ST[code], key = keyOf(S.outs);
  const R = calc(T, S, S.outs);
  const order = [];
  const lanes = ROLES.map((role) => {
    const men = R.rows.filter((r) => r.role === role).sort((a, b) => (b.min ?? -1) - (a.min ?? -1) || a.p.name.localeCompare(b.p.name));
    order.push(...men.map((r) => ({ team: code, id: r.id })));
    const total = men.reduce((s, r) => s + (num(r.min) ? r.min : 0), 0);
    const count = role === "starter" ? `${men.length} / 5` : String(men.length);
    const cards = men.map((r) => manCard(T, code, r, G.pick?.team === code && G.pick.id === r.id)).join("");
    return `<div class="lane ${role}${G.pick?.team === code ? " target" : ""}" data-lane="${role}" data-team="${esc(code)}"><div class="lh"><b>${ROLE_LABEL[role]}</b><span class="mu">${count}</span><span class="grow"></span><span class="lt" title="Minutes in this lane, for reference">${f1(total)}</span></div><div class="lb">${cards || `<div class="none">drop a man here</div>`}</div></div>`;
  }).join("");
  G.rows = order;
  const hint = G.pick?.team === code ? `<div class="rmv">Moving <b>${esc(T.byId[G.pick.id]?.name ?? "")}</b>: tap the lane he goes to, or tap him again to cancel.</div>` : "";
  return `<div class="cwork lanesv"><div class="panel main lanesp" style="--t1:${colour}">${teamHead(T, S, code, key)}${roleLines(G, code, R)}${hint}<div class="lanes">${lanes}</div><div class="lnote mu">Drag a man to another lane, or tap his name and then a lane. Team minutes ${num(R.totals.min) ? f1(R.totals.min) : MISS}, for reference only. Amber = typed by you.</div></div></div>`;
}
