// Screen 2, All entries (entries late swap): the blunt bar (pick a man, scope one spot or every spot holding him, Remove and re-optimize,
// Remove and lock a backup, Undo all, restore a man removed by mistake), the spot filter, every spot's card, exposure by spot and
// entries by spot. The bar only collects the request; the engine decides and the cards show its answer.
import { esc, money, f1, spotColour, tint, feeText, outChip, ICON_LOCK } from "./lsw-common.js";
import { spotCardHtml } from "./lsw-cards.js";
import { logo } from "./board-util.js";

/** Men in any spot's lineup: [{ man, spots: [name], entries }] sorted by name. */
export function menInSpots(M) {
  const by = new Map();
  for (const s of M.spots) for (const x of s.slots) {
    if (!x.man) continue;
    if (!by.has(x.man.dk_id)) by.set(x.man.dk_id, { man: x.man, spots: [], entries: 0 });
    const r = by.get(x.man.dk_id);
    r.spots.push(s.name); r.entries += s.nEntries;
  }
  return [...by.values()].sort((a, b) => a.man.name.localeCompare(b.man.name));
}

/** The scope of a removal from the spots the page shows holding the man: one spot (coerced to one that holds him), or exactly the spots drawn as holding him. */
export function scopeFor(M, b) {
  const shown = menInSpots(M).find((m) => m.man.dk_id === b.man)?.spots ?? [];
  if (!shown.length) return null;
  if (b.scope === "one") return { type: "one", spot: shown.includes(b.spot) ? b.spot : shown[0] };
  return { type: "chosen", spots: shown };
}

/** Backup candidates: men on the slate whose game has not started and who are not Out, best projection first. */
export function backupLabels(M) {
  return M.pool.filter((p) => !p.missing && !p.started && !p.untimed && !p.out).sort((a, b) => (b.proj ?? 0) - (a.proj ?? 0))
    .map((p) => ({ id: p.dk_id, label: `${p.name} (${p.team} ${money(p.salary)})` }));
}

function bluntBar(M, L) {
  const men = menInSpots(M), b = L.blunt;
  const sel = men.find((m) => m.man.dk_id === b.man);
  const lab = backupLabels(M);
  const backup = lab.find((x) => x.id === b.backup);
  const holding = sel?.spots.length ?? 0;
  const can = Boolean(sel) && (b.scope === "holding" ? holding > 0 : Boolean(b.spot));
  const busy = L.busy ? " disabled" : "";
  return `<div class="blunt"><label>Remove</label>
<select id="lswMan" class="mansel"><option value="">Pick a man</option>${men.map((m) => `<option value="${esc(m.man.dk_id)}"${m.man.dk_id === b.man ? " selected" : ""}>${esc(m.man.name)} · ${esc(m.man.team ?? "")} · ${money(m.man.salary)}${m.man.started ? " · started" : ""} · in ${m.spots.length}</option>`).join("")}</select>
<div class="bn"><b>${holding}</b><small>${holding === 1 ? "spot" : "spots"}, ${sel?.entries ?? 0} entries</small></div>
<div class="scope"><button class="${b.scope === "one" ? "on" : ""}" data-lsw="scope" data-scope="one">One spot</button><select id="lswScopeSpot" ${b.scope === "one" ? "" : "disabled"}>${(sel?.spots ?? M.spots.map((s) => s.name)).map((n, i) => `<option${n === b.spot || (i === 0 && !(sel?.spots ?? []).includes(b.spot)) ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>
<button class="${b.scope === "holding" ? "on" : ""}" data-lsw="scope" data-scope="holding">Every spot holding him <b>${holding}</b></button></div>
<span class="grow"></span>
<button class="go big" data-lsw="remove"${can && !busy ? "" : " disabled"}>Remove and re-optimize</button>
<div class="bkc"><button class="go big" data-lsw="removeBackup" title="Takes him out, locks the backup into every spot in scope, re-optimizes the rest"${can && backup && !busy ? "" : " disabled"}>Remove, lock backup</button><input id="lswBackup" list="lswBackups" placeholder="backup man" value="${esc(backup?.label ?? L.backupText ?? "")}" autocomplete="off"><datalist id="lswBackups">${lab.map((x) => `<option value="${esc(x.label)}"></option>`).join("")}</datalist></div>
<button class="ol big" data-lsw="undoAll"${busy}>Undo all</button></div>
${M.removals.length ? `<div class="removed"><span class="muted">Taken out, by spot:</span>${M.spots.filter((sp) => M.removals.some((r) => r.spot === sp.name)).map((sp) => `<span class="rm"><b style="color:${spotColour(sp.name, M.spots)}">${esc(sp.name)}</b> ${M.removals.filter((r) => r.spot === sp.name).map((r) => `${esc(r.name)}<button data-lsw="allow" data-spot="${esc(sp.name)}" data-man="${esc(r.id)}" title="Let the next re-fill of ${esc(sp.name)} use him again">Allow</button>`).join(" ")}<button data-lsw="undoSpot" data-spot="${esc(sp.name)}" title="Put ${esc(sp.name)} back exactly as uploaded">Undo ${esc(sp.name)}</button></span>`).join("")}</div>` : ""}`;
}

export function filterChips(M, L) {
  const nCheck = M.spots.filter((s) => s.amber || s.entries.some((e) => e.held)).length;
  const nChg = M.spots.filter((s) => s.changed).length;
  const unEntries = M.entries.filter((e) => e.noSpot).length;
  const holdMan = L.blunt.man && M.spots.some((s) => s.slots.some((x) => x.dk_id === L.blunt.man)) ? menInSpots(M).find((m) => m.man.dk_id === L.blunt.man) : null;
  const chip = (k, label, n, extra = "") => `<button class="fc ${extra}${L.filter === k ? " on" : ""}" data-lsw="filter" data-f="${esc(k)}">${esc(label)}${n != null ? ` <b>${n}</b>` : ""}</button>`;
  return `<div class="fcs"><span class="muted">SPOT</span>${chip("All", "All", M.spots.length)}${M.spots.map((s) => chip(`spot:${s.name}`, s.name, s.nEntries)).join("")}${chip("Unassigned", "No lineup assigned", unEntries, unEntries ? "red" : "")}${chip("Changed", "Changed", nChg, "pk")}${chip("Check", "Check", nCheck, "am")}${holdMan ? chip("Holding", `Holding ${holdMan.man.name}`, holdMan.spots.length) : ""}<span class="grow"></span><button class="ol" data-lsw="goMaps">Entries tab</button><span class="muted lg"><span class="lkg">${ICON_LOCK}</span>started, locked<i class="pkq"></i>changed from upload<i class="amq"></i>check: held out of the file or flagged</span></div>`;
}

function visibleSpots(M, L) {
  const f = L.filter;
  if (f.startsWith("spot:")) return M.spots.filter((s) => s.name === f.slice(5));
  if (f === "Changed") return M.spots.filter((s) => s.changed);
  if (f === "Check") return M.spots.filter((s) => s.amber || s.entries.some((e) => e.held));
  if (f === "Holding") return M.spots.filter((s) => s.slots.some((x) => x.dk_id === L.blunt.man));
  if (f === "Unassigned") return [];
  return M.spots;
}

/** The two by-spot tables have a column per spot, so a slate with 151 spots is shown PAGE spots at a time (L.spotPage): no horizontal page scroll. */
export const SPOT_PAGE = 12;
export function spotPageOf(M, L) {
  const pages = Math.max(1, Math.ceil(M.spots.length / SPOT_PAGE)), p = Math.min(Math.max(Number(L.spotPage) || 0, 0), pages - 1);
  return { spots: M.spots.slice(p * SPOT_PAGE, (p + 1) * SPOT_PAGE), p, pages, total: M.spots.length, all: M.spots.length > SPOT_PAGE };
}
const pager = (pg) => (pg.all ? `<span class="pgr"><button class="ol sm" data-lsw="spotPage" data-dir="-1"${pg.p ? "" : " disabled"}>‹ Prev</button><span class="muted">spots ${pg.p * SPOT_PAGE + 1} to ${pg.p * SPOT_PAGE + pg.spots.length} of ${pg.total}</span><button class="ol sm" data-lsw="spotPage" data-dir="1"${pg.p < pg.pages - 1 ? "" : " disabled"}>Next ›</button></span>` : "");

function exposure(M, L) {
  const rows = menInSpots(M).sort((a, b) => b.entries - a.entries || a.man.name.localeCompare(b.man.name));
  const total = M.spots.reduce((t, s) => t + s.nEntries, 0);
  const pg = spotPageOf(M, L), shownSpots = pg.spots;
  const cols = `style="--n:${shownSpots.length}"`;
  return `<section class="mapcol"><div class="mh"><span class="t">Exposure by spot</span><span class="grow"></span>${pager(pg)}</div>
<div class="mx hd" ${cols}><span>Player</span>${shownSpots.map((s) => `<span class="c" style="color:${spotColour(s.name, M.spots)}">${esc(s.name)}</span>`).join("")}<span class="c">Entries</span></div>
${rows.map((r) => `<div class="mx${r.man.started ? " stl" : ""}" ${cols} data-man="${esc(r.man.dk_id)}"><span class="mxn">${r.man.team ? logo(r.man.team, "xs") : ""}<span>${esc(r.man.name)}</span>${outChip(r.man)}${r.man.started ? `<span class="lkd">${ICON_LOCK}</span>` : ""}</span>${shownSpots.map((s) => `<span class="c">${r.spots.includes(s.name) ? `<i class="dt" style="background:${spotColour(s.name, M.spots)}"></i>` : '<i class="z">·</i>'}</span>`).join("")}<span class="c"><b>${r.entries}</b> of ${total}</span></div>`).join("")}</section>`;
}

function entriesBySpot(M, L) {
  const by = new Map();
  for (const e of M.entries) {
    if (!by.has(e.contestName)) by.set(e.contestName, new Map());
    const k = e.spot ?? "__none";
    by.get(e.contestName).set(k, (by.get(e.contestName).get(k) ?? 0) + 1);
  }
  const hasNone = M.entries.some((e) => e.noSpot);
  const pg = spotPageOf(M, L), cols = `style="--n:${pg.spots.length + (hasNone ? 1 : 0)}"`;
  const cell = (n, cls = "") => `<span class="c ${cls}">${n ? `<b>${n}</b>` : '<i class="z">·</i>'}</span>`;
  return `<section class="mapcol"><div class="mh"><span class="t">Entries by spot</span><span class="grow"></span>${pager(pg)}<span class="muted">${M.entries.length} entries, ${by.size} contests</span></div>
<div class="mx eb hd" ${cols}><span>Contest</span>${pg.spots.map((s) => `<span class="c" style="color:${spotColour(s.name, M.spots)}">${esc(s.name)}</span>`).join("")}${hasNone ? '<span class="c red">No lineup</span>' : ""}</div>
${[...by].map(([n, m]) => `<div class="mx eb" ${cols}><span>${esc(n)}</span>${pg.spots.map((s) => cell(m.get(s.name))).join("")}${hasNone ? cell(m.get("__none"), "red") : ""}</div>`).join("")}</section>`;
}

export function allHtml(M, L) {
  if (!M.spots.length) return '<div class="mapcol"><div class="rs">No spots yet. Give your entries a spot in tab 1: Auto-fill empty rows does it in one click.</div></div>';
  const vis = visibleSpots(M, L);
  const un = M.entries.filter((e) => e.noSpot);
  const outBy = new Map((L.outcomes ?? []).map((o) => [o.spot, o]));
  return `${bluntBar(M, L)}${filterChips(M, L)}
${L.filter === "Unassigned" ? unassignedList(un) : `<div class="cards" style="--cols:${Math.min(Math.max(vis.length, 1), 3)}">${vis.map((s) => spotCardHtml(s, M, outBy.get(s.name))).join("") || '<div class="rs">Nothing matches this filter.</div>'}</div>`}
${un.length && L.filter !== "Unassigned" ? `<div class="newbar red"><b>${un.length}</b> ${un.length === 1 ? "entry has" : "entries have"} no lineup assigned and ${un.length === 1 ? "is" : "are"} never edited or exported. <button class="ol red" data-lsw="goMaps">Give them a spot</button></div>` : ""}
<div class="two">${exposure(M, L)}${entriesBySpot(M, L)}</div>`;
}

function unassignedList(un) {
  return `<div class="mapcol"><div class="mh"><span class="t red">No lineup assigned</span><span class="muted">${un.length} entries are never edited or exported</span></div>${un.map((e) => `<div class="er nolu"><span></span><span class="cn">${esc(e.contestName)}</span><span class="fe">${esc(e.entryFee)}</span><span class="id">${esc(e.entryId)}</span><span class="noteR">No lineup assigned</span></div>`).join("")}</div>`;
}
export { tint, f1, feeText };
