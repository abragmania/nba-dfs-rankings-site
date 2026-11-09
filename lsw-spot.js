// Screen 3, One spot (entries late swap): hand swaps in one spot, five replacements per slot, Reset per slot and for the whole spot, with the
// before and after figures. A started man is dimmed and locked in his exact slot. A swap is only a request: the engine accepts or refuses it.
import { esc, money, f1, signed, tint, feeText, spotColour, stacksOf, tipHtml, ICON_LOCK, outFlag, outChip } from "./lsw-common.js";
import { slotRowHtml, stackChips, delta } from "./lsw-cards.js";
import { logo, shortTime } from "./board-util.js";
import { SALARY_CAP } from "./slots.js";

const SORTS = [["proj", "Projection"], ["salary", "Salary"], ["own", "Ownership"]];

/** The five best replacements for a slot, by the chosen sort: men who fit the slot, the cap and are not started or already in the lineup. */
export function replacements(spot, slot, M, sort) {
  const cur = spot.slots.find((s) => s.slot === slot);
  const inLineup = new Set(spot.slots.map((s) => s.dk_id));
  // The room under the cap is known only when the spot's salary and the man coming out are both known: never worked out from a missing figure.
  const room = Number.isFinite(spot.salary) && (!cur?.man || Number.isFinite(cur.man.salary)) ? SALARY_CAP - spot.salary + (cur?.man?.salary ?? 0) : null;
  const all = M.pool.filter((p) => !p.missing && !p.started && !p.untimed && !p.gone && !inLineup.has(p.dk_id) && (p.roster_positions ?? []).includes(slot));
  const fit = room == null ? all : all.filter((p) => p.salary <= room);
  const key = (p) => (sort === "own" ? p.own ?? -1 : p[sort] ?? -1);
  return { room, total: all.length, list: fit.sort((a, b) => key(b) - key(a)).slice(0, 5) };
}

function swapPanel(spot, M, L) {
  const slot = L.swapSlot, cur = spot.slots.find((s) => s.slot === slot);
  if (!slot || !cur) return `<aside class="swp empty"><p>Pick Swap on an open slot to see the best replacements for it.</p><p class="muted">Use sets the slot in this spot and in all ${spot.nEntries} ${spot.nEntries === 1 ? "entry" : "entries"} that follow it.</p></aside>`;
  const r = replacements(spot, slot, M, L.swapSort);
  const row = (p, isCur) => `<div class="rp${isCur ? " cur" : ""}" style="--tc:${tint(p.team)}">${logo(p.team, "sm")}<span class="rn"><b>${esc(p.name)}</b>${outChip(p)}${isCur ? '<i class="curb">CURRENT</i>' : ""}<small class="rn2">${esc((p.positions ?? []).join("/"))} · ${esc(p.team)} · ${esc(p.game ?? "")} · tips ${esc(shortTime(p.tip, M.refMs) ?? "—")}</small></span>
<span class="sa">${money(p.salary)}${!isCur && cur.man ? `<small class="${Number.isFinite(p.salary) && Number.isFinite(cur.man.salary) && p.salary > cur.man.salary ? "up" : "dn"}">${delta(p.salary, cur.man.salary, money)}</small>` : ""}</span><span class="pj">${f1(p.proj)}${!isCur && cur.man ? `<small>${delta(p.proj, cur.man.proj, f1)}</small>` : ""}</span><span class="ow">${p.own != null ? `${f1(p.own)}%` : "—"}</span>
<span class="lf">${r.room == null ? "—" : money(r.room - p.salary)}<small>left</small></span>${isCur ? '<button class="ol" data-lsw="swapClose">Keep</button>' : `<button class="go" data-lsw="swapUse" data-spot="${esc(spot.name)}" data-id="${esc(p.dk_id)}">Use</button>`}</div>`;
  return `<aside class="swp"><div class="swh"><h3>Swap ${esc(slot)} slot <i class="curb">OPEN</i></h3><button class="ol" data-lsw="swapClose">✕ close</button></div>
<p class="muted">Now <b>${esc(cur.man?.name ?? "—")}</b>${cur.changed && cur.was ? ` (was ${esc(cur.was.name)})` : ""} · up to <b>${money(r.room)}</b> fits under the cap · open men only</p>
<div class="sorts"><span class="muted">SORT</span>${SORTS.map(([k, n]) => `<button class="${L.swapSort === k ? "on" : ""}" data-lsw="swapSort" data-k="${k}">${n}</button>`).join("")}<span class="grow"></span><span class="muted">${esc(slot)}, ${r.list.length} of ${r.total} shown</span></div>
${cur.man ? row(cur.man, true) : ""}${r.list.map((p) => row(p, false)).join("") || '<div class="rs">No open man fits this slot and the cap.</div>'}
<p class="muted">Use sets the slot in this spot and in all ${spot.nEntries} ${spot.nEntries === 1 ? "entry" : "entries"} that follow it.</p></aside>`;
}

const stat = (label, big, sub) => `<div class="stat"><small>${label}</small><div>${big}</div>${sub ?? ""}</div>`;

export function spotHtml(M, L) {
  const spot = M.spots.find((s) => s.name === L.spot) ?? M.spots[0];
  if (!spot) return '<div class="rs">No spots yet.</div>';
  const stacks = stacksOf(spot), c = spotColour(spot.name, M.spots);
  const nChg = spot.slots.filter((s) => s.changed).length;
  const locked = spot.slots.filter((s) => s.frozen).length;
  const men = spot.slots.map((s) => s.man).filter((m) => m && !m.missing);
  const own = Number.isFinite(spot.ownSum) ? `${Math.round(spot.ownSum)}%` : "—";
  const dsal = Number.isFinite(spot.salary) && Number.isFinite(spot.uploadSalary) ? signed(spot.salary - spot.uploadSalary, money).replace(/^([+-])\$/, "$1$") : null;
  const dpj = Number.isFinite(spot.projection) && Number.isFinite(spot.uploadProjection) ? signed(spot.projection - spot.uploadProjection, f1) : null;
  const outBy = (L.outcomes ?? []).find((o) => o.spot === spot.name);
  const changes = spot.slots.filter((s) => s.changed);
  const E = M.entries.filter((e) => e.spot === spot.name);
  // Men who came out of this spot and are still held by another spot: said, with a way to open that spot.
  const also = changes.filter((s) => s.at_upload_id != null).map((s) => ({ s, others: M.spots.filter((o) => o.name !== spot.name && o.slots.some((x) => x.dk_id === s.at_upload_id)) })).filter((x) => x.others.length);
  return `<div class="spothead"><span class="muted">Late swap ›</span><h2>One spot</h2><span class="sc big" style="--sc:${c}">${esc(spot.name)}</span><span>applies to <b>${spot.nEntries}</b> ${spot.nEntries === 1 ? "entry" : "entries"} · fees ${feeText(spot.fees)}</span>${nChg ? `<span class="bd chg">CHANGED: ${nChg} slot${nChg === 1 ? "" : "s"}</span>` : ""}<span class="grow"></span>
<span class="spotf"><span class="muted">SPOT</span><span class="spotbtns">${M.spots.map((s) => `<button class="fc${s.name === spot.name ? " on" : ""}" data-lsw="openSpot" data-spot="${esc(s.name)}">${esc(s.name)} <b>${s.nEntries}</b></button>`).join("")}</span></span>
<button class="ol pk" data-lsw="resetSpot" data-spot="${esc(spot.name)}"${nChg ? "" : " disabled"}>Reset whole spot</button><button class="go" data-lsw="goAll">Back to all entries</button></div>
<div class="stats4">${stat("Projection, upload → now", `<b>${f1(spot.uploadProjection)}</b> → <b class="am">${f1(spot.projection)}</b> ${dpj ? `<em class="${dpj.startsWith("-") ? "dn" : "up"}">${dpj}</em>` : ""}`)}
${stat("Salary, upload → now", `<b>${money(spot.uploadSalary)}</b> → <b class="am">${money(spot.salary)}</b> ${dsal ? `<em>${dsal}</em>` : ""}`)}
${stat("Salary left", `<b class="am">${money(Number.isFinite(spot.salary) ? SALARY_CAP - spot.salary : null)}</b> <em>of ${money(SALARY_CAP)}</em>`)}
${stat("Ownership sum", `<b class="bl">${own}</b> <em>${men.length} men</em>`)}
${stat("Locked / open slots", `<b>${locked}</b> / <b class="am">${spot.slots.length - locked}</b> <em>started / open</em>`)}</div>
<div class="spotgrid"><section class="scard${spot.changed ? " chg" : ""}${spot.amber ? " flag" : ""}" style="--sc:${c}">
<div class="sr hd"><span>Slot</span><span>Player</span><span>Game</span><span>Status</span><span class="sa">Salary</span><span class="pj">Proj</span><span class="ow">Own</span><span></span></div>
${spot.slots.map((s) => slotRowHtml(spot, s, M, stacks, { swap: true, selected: L.swapSlot })).join("")}
<div class="sf">${spot.mode === "Cash" ? "" : `<b>CORR</b>${stackChips(spot) || '<span class="muted">no game stacks</span>'}`}<span class="grow"></span><span class="muted">tinted by team</span></div>
${outFlag(spot)}${spot.flags.filter((f) => !spot.alert?.men.some((m) => m.text === f)).map((f) => `<div class="rs">${esc(f)}</div>`).join("")}${outBy?.status === "flagged" ? `<div class="rs">${esc(outBy.reason)}</div>` : ""}</section>${swapPanel(spot, M, L)}</div>
<div class="spotfoot"><section class="mapcol"><div class="mh"><span class="t">What changed since the upload</span></div>
${changes.map((s) => `<div class="chrow"><span class="slt">${esc(s.slot)}</span><span class="out">${logo(s.was?.team ?? "", "sm")}<s>${esc(s.at_upload_name ?? "—")}</s></span><span>→</span><span class="in">${s.man?.team ? logo(s.man.team, "sm") : ""}${esc(s.man?.name ?? "—")}</span></div>`).join("") || '<div class="rs dim">Nothing changed from the upload.</div>'}</section>
<section class="mapcol"><div class="mh"><span class="t">Applies to ${E.length} ${E.length === 1 ? "entry" : "entries"}</span></div>
${E.map((e) => `<div class="chrow"><span class="cn">${esc(e.contestName)}</span><span class="id">${esc(e.entryId)}</span><span>${esc(e.entryFee)}</span>${e.held ? `<span class="bad" title="${esc((e.held ?? []).join(" "))}">✗ held back</span>` : e.changed && spot.alert ? '<span class="amb">⚠ holds an Out man</span>' : e.changed ? '<span class="ok">✓ passes</span>' : '<span class="muted">as uploaded</span>'}</div>${e.held ? `<div class="rs">${esc(e.held.join(" "))}</div>` : ""}`).join("")}
${also.map((x) => `<div class="also">Also holding ${esc(x.s.at_upload_name)}: ${x.others.map((o) => `${esc(o.name)} (${o.nEntries} ${o.nEntries === 1 ? "entry" : "entries"}) <button class="lnk" data-lsw="openSpot" data-spot="${esc(o.name)}">Open ${esc(o.name)}</button>`).join(", ")}</div>`).join("")}</section></div>`;
}
export { tipHtml, ICON_LOCK };
