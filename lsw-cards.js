// A spot's card and the spot's lineup rows (entries late swap). Started men are dimmed and locked in their exact slot, changes are pink with
// "was X", an amber spot says why, a duplicate says "Duplicate; altered" with the spot it matched, CORR chips mark game stacks, and rows wear
// the team's tint with its logo. All figures arrive in the model; nothing is computed here but totals of what is shown.
import { esc, money, f1, signed, tint, feeText, spotColour, tipHtml, gameChip, stacksOf, corrChip, manLabel, ICON_LOCK, outFlag } from "./lsw-common.js";
import { logo } from "./board-util.js";
import { SALARY_CAP } from "./slots.js";

/** One lineup row. opts: { swap: bool (a Swap button), selected: slot being swapped }. */
export function slotRowHtml(spot, s, M, stacks, opts = {}) {
  const m = s.man, refMs = M.refMs;
  const tc = m?.team ? tint(m.team) : "#55555d";
  const cls = ["sr", s.changed ? "cg" : "", m?.started || s.frozen ? "stl" : "", opts.selected === s.slot ? "sel" : "", m?.missing ? "fl" : ""].filter(Boolean).join(" ");
  const was = s.changed && s.was ? `<span class="was" title="At upload">was <s>${esc(s.was.name)}</s> ${money(s.was.salary)}</span>` : s.changed && s.at_upload_name ? `<span class="was">was <s>${esc(s.at_upload_name)}</s></span>` : "";
  const locked = s.frozen ? `<span class="lkd" title="${esc(s.why ?? "held in his slot")}">${ICON_LOCK}</span>` : "";
  const lockSlot = `<i class="lkslot">${locked}</i>`;
  const right = opts.swap
    ? (s.frozen || m?.started ? '<span class="lkw">locked</span>' : `<span class="swbs"><button class="swb" data-lsw="swapOpen" data-spot="${esc(spot.name)}" data-slot="${esc(s.slot)}">Swap</button>${s.changed && s.at_upload_id != null ? `<button class="swb rs" data-lsw="slotReset" data-spot="${esc(spot.name)}" data-slot="${esc(s.slot)}">Reset</button>` : ""}</span>`) // Swap on every open slot; Reset only where there is an uploaded man to go back to
    : "";
  return `<div class="${cls}" style="--tc:${tc}" data-slotrow="${esc(s.slot)}">
<span class="slt">${esc(s.slot)}</span>
<span class="nm">${manLabel(m)}${m ? `<small class="ps">${esc((m.positions ?? []).join("/"))}</small>` : ""}${corrChip(stacks.get(s.dk_id))}${was}</span>
${opts.swap ? `<span class="gmc">${gameChip(m, M.games)}</span><span class="tpc">${tipHtml(m, refMs)}</span>` : `<span class="gmc">${gameChip(m, M.games)}</span>`}
<span class="sa">${lockSlot}${m && !m.missing ? money(m.salary) : "—"}</span><span class="pj">${m && !m.missing ? f1(m.proj) : "—"}</span><span class="ow">${m && !m.missing && m.own != null ? `${f1(m.own)}%` : "—"}</span>${right}</div>`;
}

/** Game-stack chips for the card foot: "ATL@WAS x2" in each stack's colour. */
export function stackChips(spot) {
  const st = stacksOf(spot), by = new Map();
  for (const s of spot.slots) { const k = st.get(s.dk_id); if (k && s.man) by.set(s.man.game, { ...k, n: (by.get(s.man.game)?.n ?? 0) + 1 }); }
  return [...by].map(([g, k]) => `<span class="cc" style="color:${k.colour};border-color:${k.colour}88;background:${k.colour}14">${esc(g)} ×${k.n}</span>`).join("");
}

const badge = (spot, held) => (spot.alert ? '<span class="bd out">OUT</span>' : "") + (spot.amber || held ? '<span class="bd chk">CHECK</span>' : spot.changed ? '<span class="bd chg">CHANGED</span>' : "");

/** The card of one spot for the All entries screen. o: this session's outcome for the spot (or null). */
export function spotCardHtml(spot, M, o = null, opts = {}) {
  const c = spotColour(spot.name, M.spots), stacks = stacksOf(spot);
  if (spot.blank) return `<article class="scard flag blankc" style="--sc:${c}" data-spotcard="${esc(spot.name)}"><header class="sh"><span class="sc plain" style="--sc:${c}">${esc(spot.name)}</span><span class="e"><b>${spot.nEntries}</b> ${spot.nEntries === 1 ? "entry" : "entries"} · fees <b>${feeText(spot.fees)}</b></span><span class="grow"></span><span class="noteR">No lineup assigned: give it one in tab 2; its entries are left out of every file.</span></header></article>`;
  const held = spot.entries.some((e) => e.held);
  const cap = Number.isFinite(spot.salary) ? SALARY_CAP - spot.salary : null;
  const dup = spot.duplicate ? `<div class="dupl"><b>${esc(spot.duplicate.text)}</b> — matches ${esc(spot.duplicate.matchedSpot)}.${spot.duplicate.reason ? ` ${esc(spot.duplicate.reason)}` : ""}</div>` : "";
  const notes = (spot.notes ?? []).filter((n) => !/^Duplicate/.test(n)).map((n) => `<div class="rs">${esc(n)}</div>`).join("");
  const flags = [...new Set([...(spot.flags ?? []), ...(o?.status === "flagged" ? [o.reason] : [])])].filter((f) => !spot.alert?.men.some((m) => m.text === f)).map((f) => `<div class="rs">${esc(f)}</div>`).join("");
  const was = spot.changed && Number.isFinite(spot.uploadProjection) ? `<span class="muted">was ${f1(spot.uploadProjection)}</span>` : "";
  return `<article class="scard${spot.alert ? " outc" : ""}${spot.changed ? " chg" : ""}${spot.amber || held ? " flag" : ""}" style="--sc:${c}" data-spotcard="${esc(spot.name)}">
<header class="sh"><button class="sc" data-lsw="openSpot" data-spot="${esc(spot.name)}" title="Open this spot">${esc(spot.name)}</button><span class="e"><b>${spot.nEntries}</b> ${spot.nEntries === 1 ? "entry" : "entries"} · fees <b>${feeText(spot.fees)}</b></span><span class="grow"></span>${badge(spot, held)}</header>
${spot.slots.map((s) => slotRowHtml(spot, s, M, stacks, { swap: false })).join("")}
<div class="sf"><span class="pj">${f1(spot.projection)}</span>${was}<span>salary <b>${money(spot.salary)}</b></span><span>left <b>${money(cap)}</b></span><span class="grow"></span>${stackChips(spot)}</div>
${outFlag(spot)}${dup}${notes}${flags}
<div class="ctr">${spot.contests.map((n) => `<span>${esc(n)}</span>`).join("") || '<span class="muted">no entries in this spot</span>'}</div>
</article>`;
}

/** The totals row for one spot's change since upload: a signed difference of two shown numbers. */
export const delta = (now, then, fmt) => (Number.isFinite(now) && Number.isFinite(then) ? signed(now - then, fmt) : "—");
export { logo };
