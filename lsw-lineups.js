// The Entries screen's step 3, by lineup (entries late swap, Adam 11-18, mock-up "entries-by-lineup"): the games strip sits in the top bar;
// here are the two lists (Take out of every lineup, Put in at least), one card per lineup, a lineup opened full width with its five best
// options, and the export foot. Nothing is decided here: every click is a request to the engine through the route (ops lists, keepMen,
// options, pickOption, reoptimize), and the cards draw what comes back.
import { esc, money, f1, signed, outChip, ICON_LOCK, nameOpen } from "./lsw-common.js";
import { logo } from "./board-util.js";
import { SLOTS } from "./slots.js";

const sameIds = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Spots holding the same lineup drawn once: [{ spots: [spot], lineup }], in screen order. Blank spots are left out. */
export function lineupGroups(M) {
  const groups = [];
  for (const s of M.spots) {
    if (s.blank) continue;
    const ids = s.slots.map((x) => x.dk_id);
    const g = groups.find((x) => sameIds(x.lineup, ids));
    if (g) g.spots.push(s); else groups.push({ spots: [s], lineup: ids });
  }
  return groups;
}

const poolOf = (M) => new Map(M.pool.map((p) => [p.dk_id, p]));
const nameIn = (M, id) => poolOf(M).get(id)?.name ?? id;
const entriesHolding = (M, id) => M.spots.filter((s) => s.slots.some((x) => x.dk_id === id)).reduce((t, s) => t + s.nEntries, 0);

function listsHtml(M, L) {
  const out = (M.takeOut ?? []).map((id) => {
    const p = poolOf(M).get(id);
    return `<span class="lbchip out"><b>${esc(p?.name ?? id)}</b> ${esc(p?.team ?? "")}${p?.out ? " · Out" : p?.injury ? ` · ${esc(p.injury)}` : ""} <small>in ${entriesHolding(M, id)} entries</small><button data-lsw="lbOutRm" data-id="${esc(id)}" title="Let him back into every lineup">✕</button></span>`;
  }).join("");
  const res = new Map((L.lbMin ?? []).map((r) => [r.dk_id, r]));
  const min = Object.entries(M.atLeast ?? {}).map(([id, pct]) => {
    const r = res.get(id);
    return `<span class="lbchip in"><b>${esc(nameIn(M, id))}</b> ${pct}% of entries${r ? ` <small>now ${r.entries} of ${r.total}</small>` : ""}<button data-lsw="lbMinRm" data-id="${esc(id)}" title="Drop this minimum">✕</button></span>`;
  }).join("");
  const outChoices = M.pool.filter((p) => !p.started && !p.untimed && !(M.takeOut ?? []).includes(p.dk_id) && entriesHolding(M, p.dk_id) > 0);
  const inChoices = M.pool.filter((p) => !p.started && !p.untimed && !(M.takeOut ?? []).includes(p.dk_id) && !Object.hasOwn(M.atLeast ?? {}, p.dk_id)).sort((a, b) => (b.proj ?? 0) - (a.proj ?? 0));
  const label = (p) => `${p.name} (${p.team ?? ""} ${money(p.salary)})`;
  return `<div class="lblists"><section class="lbbox"><h4>Take out of every lineup</h4><div class="lbrow">${out}<input class="lbadd" data-lsw-in="out" list="lbOutList" placeholder="+ add a player" autocomplete="off"><datalist id="lbOutList">${outChoices.map((p) => `<option value="${esc(label(p))}" data-id="${esc(p.dk_id)}"></option>`).join("")}</datalist></div></section>
<section class="lbbox"><h4>Put in at least</h4><div class="lbrow">${min}<input class="lbadd" data-lsw-in="min" list="lbInList" placeholder="+ add a player" autocomplete="off"><datalist id="lbInList">${inChoices.map((p) => `<option value="${esc(label(p))}" data-id="${esc(p.dk_id)}"></option>`).join("")}</datalist></div></section></div>`;
}

/** One row of a lineup: slot, logo, name, lock, salary, projection. keep: { spots, kept } for the lock box, or null (an option card). */
function rowHtml(M, slot, id, { keep = null, fresh = false, outIds = [] } = {}) {
  const p = id == null ? null : poolOf(M).get(id);
  if (!p) return `<div class="lbr"><span class="ls">${slot}</span><span class="ln dim">${id == null ? "open" : esc(id)}</span><span class="la">—</span><span class="lp">—</span></div>`;
  const out = outIds.includes(id);
  let lock = "";
  if (p.started || p.untimed) lock = `<span class="lbl fixed" title="His game has started: he stays">${ICON_LOCK}</span>`;
  else if (keep) {
    const on = keep.kept.includes(id);
    lock = `<button class="lbl${on ? " on" : ""}" data-lsw="lbKeep" data-spots="${esc(keep.spots.join("|"))}" data-id="${esc(id)}" title="${on ? "Kept in every option and re-optimize of this lineup. Click to let him go." : "Keep him in this lineup through every re-optimize"}">${ICON_LOCK}</button>`;
  }
  const cls = ["lbr", p.started || p.untimed ? "stl" : "", fresh ? "new" : "", out ? "outr" : ""].filter(Boolean).join(" ");
  return `<div class="${cls}"><span class="ls">${slot}</span><span class="ln">${p.team ? logo(p.team, "xs") : ""}${nameOpen(p.name, p.dk_id, "span", "mn")}${lock}${out ? '<i class="outchip">OUT</i>' : outChip(p)}</span><span class="la">${money(p.salary)}</span><span class="lp">${f1(p.proj)}</span></div>`;
}

const sumOf = (M, ids, k) => { const pool = poolOf(M); const v = ids.map((id) => pool.get(id)?.[k]); return v.every(Number.isFinite) ? v.reduce((a, b) => a + b, 0) : null; };

function headHtml(g, M, extra = "") {
  const n = g.spots.reduce((t, s) => t + s.nEntries, 0), contests = [...new Set(g.spots.flatMap((s) => s.contests))];
  const outMen = (M.takeOut ?? []).filter((id) => g.lineup.includes(id));
  return `<header class="lbh"><b>Lineup ${esc(g.spots.map((s) => s.name).join(", "))}</b><span class="muted">in ${plural(n, "entry", "entries")}${contests.length ? ` · ${esc(contests.slice(0, 2).join(", "))}${contests.length > 2 ? ` +${contests.length - 2}` : ""}` : ""}</span>${outMen.map((id) => `<i class="lbout">${esc(nameIn(M, id).toUpperCase())} OUT</i>`).join("")}<span class="grow"></span>${extra}</header>`;
}

function cardHtml(g, M, L) {
  const kept = M.keptMen?.[g.spots[0].name] ?? [], spotNames = g.spots.map((s) => s.name);
  const locked = g.lineup.filter((id) => { const p = poolOf(M).get(id); return p && (p.started || p.untimed); }).length;
  return `<article class="lbcard${(M.takeOut ?? []).some((id) => g.lineup.includes(id)) ? " hasout" : ""}">${headHtml(g, M, `<button class="go sm" data-lsw="lbOpen" data-spot="${esc(spotNames[0])}"${L.busy ? " disabled" : ""}>Re-optimize</button>`)}
${SLOTS.map((slot, i) => rowHtml(M, slot, g.lineup[i], { keep: { spots: spotNames, kept }, outIds: M.takeOut ?? [] })).join("")}
<footer class="lbf"><span class="lp">${f1(sumOf(M, g.lineup, "proj"))}</span><span>salary <b>${money(sumOf(M, g.lineup, "salary"))}</b></span><span class="muted">${locked} locked</span><span class="grow"></span><button class="lnk" data-lsw="openSpot" data-spot="${esc(spotNames[0])}">Edit one slot</button></footer></article>`;
}

function openHtml(g, M, L) {
  const o = L.lbOpts, now = g.lineup, nowProj = sumOf(M, now, "proj"), spotNames = g.spots.map((s) => s.name);
  const kept = M.keptMen?.[spotNames[0]] ?? [];
  const nowCard = `<div class="lbopt now"><div class="loh"><b>NOW</b><span class="muted">${now.filter((id) => poolOf(M).get(id)?.started).length} locked</span></div>${SLOTS.map((slot, i) => rowHtml(M, slot, now[i], { keep: { spots: spotNames, kept }, outIds: M.takeOut ?? [] })).join("")}<div class="lbf"><span class="lp">${f1(nowProj)}</span><span>${money(sumOf(M, now, "salary"))}</span></div></div>`;
  const opts = !o ? '<div class="rs">Finding the best options…</div>' : o.options.map((x, n) => {
    const k = SLOTS.filter((_, i) => x.lineup[i] !== now[i]).length;
    return `<div class="lbopt"><div class="loh"><b>OPTION ${n + 1}</b><span class="muted">${k ? plural(k, "change", "changes") : "same as now"}</span><span class="grow"></span><button class="go sm" data-lsw="lbUse" data-n="${n}"${L.busy || !k ? " disabled" : ""}>Use this</button></div>${SLOTS.map((slot, i) => rowHtml(M, slot, x.lineup[i], { fresh: x.lineup[i] !== now[i] })).join("")}<div class="lbf"><span class="lp">${f1(x.proj)}</span><span class="${(x.proj ?? 0) >= (nowProj ?? 0) ? "gr" : "red"}">${Number.isFinite(x.proj) && Number.isFinite(nowProj) ? signed(x.proj - nowProj, f1) : "—"}</span><span>${money(x.salary)}</span></div></div>`;
  }).join("");
  const notes = o?.notes?.length ? `<div class="lbnotes">${o.notes.map((n) => `<div>${esc(n)}</div>`).join("")}</div>` : "";
  return `<article class="lbcard open">${headHtml(g, M, `<button class="ol sm" data-lsw="lbClose">Close</button>`)}<div class="lbopts">${nowCard}${opts}</div>${notes}</article>`;
}

/** The whole step-3 view. */
export function byLineupHtml(M, L) {
  const groups = lineupGroups(M);
  if (!groups.length) return '<div class="mapcol"><div class="rs">No lineups yet. Give your entries a spot in tab 1 and a lineup in tab 2.</div></div>';
  const open = L.openLu ? groups.find((g) => g.spots.some((s) => s.name === L.openLu)) : null;
  const rest = groups.filter((g) => g !== open);
  const chg = M.exports.changed, nSpots = M.spots.filter((s) => s.changed).length;
  return `${listsHtml(M, L)}
<div class="lbtitle"><b>Your lineups</b><span class="muted">each lineup once, however many entries hold it</span><span class="grow"></span><button class="go" data-lsw="lbAll"${L.busy ? " disabled" : ""}>Re-optimize every lineup</button></div>
${open ? openHtml(open, M, L) : ""}
<div class="lbgrid">${rest.map((g) => cardHtml(g, M, L)).join("")}</div>
<div class="lbfoot"><b>${plural(nSpots, "lineup", "lineups")} changed · ${plural(chg.changed.length, "entry", "entries")}</b><span class="muted">changes stay here until you export</span><span class="grow"></span><button class="go" data-lsw="exportChanged"${chg.written ? "" : " disabled"}>Export changed entries (${chg.written})</button><button class="go ol2" data-lsw="exportAll"${M.exports.all.written ? "" : " disabled"}>Export all assigned entries (${M.exports.all.written})</button></div>`;
}

/** The clicks of this view; true when handled. c = { L, M, act, render, boardState }. */
export async function byLineupClick(a, d, c) {
  const { L, M, act, render, boardState } = c;
  const lists = (takeOut, atLeast) => act({ op: "lists", takeOut, atLeast });
  switch (a) {
    case "lbOutRm": await lists((M.takeOut ?? []).filter((id) => id !== d.id), M.atLeast ?? {}); return true;
    case "lbMinRm": { const { [d.id]: _gone, ...rest } = M.atLeast ?? {}; await lists(M.takeOut ?? [], rest); return true; }
    case "lbKeep": {
      const spots = d.spots.split("|"), cur = M.keptMen?.[spots[0]] ?? [];
      await act({ op: "keepMen", spots, keep: cur.includes(d.id) ? cur.filter((id) => id !== d.id) : [...cur, d.id] });
      if (L.openLu && spots.includes(L.openLu)) await loadOptions(c, L.openLu);
      return true;
    }
    case "lbOpen": L.openLu = d.spot; L.lbOpts = null; render(); await loadOptions(c, d.spot); return true;
    case "lbClose": L.openLu = null; L.lbOpts = null; render(); return true;
    case "lbUse": {
      const x = L.lbOpts?.options?.[Number(d.n)];
      if (!x || !L.openLu) return true;
      const j = await act({ op: "pickOption", spot: L.openLu, lineup: x.lineup, proven: x.proven, remove: M.takeOut ?? [] }, { label: `Lineup ${L.openLu}` });
      if (j && !j.refused && !j.confirms?.length) { L.openLu = null; L.lbOpts = null; render(); }
      return true;
    }
    case "lbAll": {
      const spots = M.spots.filter((s) => !s.blank).map((s) => s.name);
      const j = await act({ op: "reoptimize", scope: { type: "chosen", spots }, remove: M.takeOut ?? [], atLeast: M.atLeast ?? {}, ...boardState() }, { label: "Re-optimize every lineup" });
      if (j?.minResults) L.lbMin = j.minResults;
      if (L.banner) { // one line for the run; only the spots that need a look are listed (the cards show the rest)
        L.banner.lines = [...(L.banner.lines ?? []), ...(j?.minResults ?? []).filter((r) => r.why).map((r) => r.why)];
        L.banner.outcomes = L.banner.outcomes.filter((o) => o.status === "flagged" || o.status === "confirm");
      }
      render();
      return true;
    }
    default: return false;
  }
}

async function loadOptions({ L, M, act, render, boardState }, spot) {
  const j = await act({ op: "options", spot, count: 5, remove: M.takeOut ?? [], ...boardState() });
  if (L.openLu !== spot) return;
  L.lbOpts = j?.options ?? { options: [], notes: [j?.refused ?? "The options could not be found."] };
  render();
}

/** A player picked in one of the two "+ add a player" boxes; true when handled. */
export async function byLineupChange(t, { L, M, act }) {
  const kind = t.dataset.lswIn;
  if (!kind) return false;
  const opt = [...(t.list?.options ?? [])].find((o) => o.value === t.value);
  if (!opt) return true; // still typing: nothing picked yet
  const id = opt.dataset.id;
  t.value = ""; // picked once: the input and change events that follow find nothing
  if (kind === "out") { await act({ op: "lists", takeOut: [...new Set([...(M.takeOut ?? []), id])], atLeast: M.atLeast ?? {} }); return true; }
  const pct = Number(window.prompt(`Put ${opt.value} in at least what percent of entries?`, "40"));
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) { L.msg = { kind: "warn", text: "A percent from 1 to 100, please." }; return true; }
  await act({ op: "lists", takeOut: M.takeOut ?? [], atLeast: { ...(M.atLeast ?? {}), [id]: pct } });
  return true;
}
