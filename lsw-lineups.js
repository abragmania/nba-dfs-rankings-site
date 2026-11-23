// The Entries screen's step 3, by lineup (entries late swap, Adam 11-18, mock-up "entries-by-lineup"): the games strip sits in the top bar;
// here are the two lists (Take out of every lineup, Put in at least), one card per lineup, a lineup opened full width with its five best
// options, and the export foot. Nothing is decided here: every click is a request to the engine through the route (ops lists, keepMen,
// options, pickOption, reoptimize), and the cards draw what comes back.
import { esc, money, f1, signed, outChip, ICON_LOCK, nameOpen, poolFor } from "./lsw-common.js";
import { logo } from "./board-util.js";
import { SLOTS } from "./slots.js";
import { noChipHtml, noTagHtml, LATE } from "./no-picks.js";

const sameIds = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Spots of one mode holding the same lineup drawn once: [{ spots: [spot], lineup, mode }], in screen order. Blank spots are left out; a Cash
 *  and a GPP spot holding the same men are two cards, each with its own thumbs, excludes and limits (Adam 11-20; reopt.js sharingSpots). */
export function lineupGroups(M) {
  const groups = [];
  for (const s of M.spots) {
    if (s.blank) continue;
    const ids = s.slots.map((x) => x.dk_id);
    const g = groups.find((x) => x.mode === s.mode && sameIds(x.lineup, ids));
    if (g) g.spots.push(s); else groups.push({ spots: [s], lineup: ids, mode: s.mode });
  }
  return groups;
}

const pools = new WeakMap(); // one id map per pool list the page holds
/** The men by id as a spot of `mode` shows them (lsw-common.js poolFor); the shared pool with no mode. */
const poolOf = (M, mode = null) => { const list = poolFor(M, mode); if (!pools.has(list)) pools.set(list, new Map(list.map((p) => [p.dk_id, p]))); return pools.get(list); };
/** The late swap NO men as a Set, or null when this page has no NO list (L.no, lsw-main.js). */
const noSet = (L) => (L.no ? new Set(L.no.ids) : null);
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

/** One row of a lineup: slot, logo, name, lock, NO, salary, projection. keep: { spots, kept } for the lock box, or null (an option card).
 *  no: the late swap NO list (a Set, no-picks.js; Adam 5:28 PM 11-19): a NO man's row is pink with the NO tag; his NO button is on the
 *  lineup cards, off for a man whose game has started (he stays where he is). */
function rowHtml(M, slot, id, { keep = null, fresh = false, outIds = [], no = null, mode = null } = {}) {
  const p = id == null ? null : poolOf(M, mode).get(id); // the card's own mode's figures
  if (!p) return `<div class="lbr"><span class="ls">${slot}</span><span class="ln dim">${id == null ? "open" : esc(id)}</span><span class="la">—</span><span class="lp">—</span></div>`;
  const out = outIds.includes(id), fixed = p.started || p.untimed, isNo = Boolean(no?.has(id));
  let lock = "", noBtn = "";
  if (fixed) lock = `<span class="lbl fixed" title="His game has started: he stays">${ICON_LOCK}</span>`;
  else if (keep) {
    const on = keep.kept.includes(id);
    lock = `<button class="lbl${on ? " on" : ""}" data-lsw="lbKeep" data-spots="${esc(keep.spots.join("|"))}" data-id="${esc(id)}" title="${on ? "Kept in every option and re-optimize of this lineup. Click to let him go." : "Keep him in this lineup through every re-optimize"}">${ICON_LOCK}</button>`;
  }
  if (keep && no) noBtn = fixed ? `<button class="nob${isNo ? " on" : ""}" disabled title="His game has started: he stays">NO</button>`
    : `<button class="nob${isNo ? " on" : ""}" data-lsw="lbNo" data-id="${esc(id)}" aria-pressed="${isNo}" title="${isNo ? `Clear NO: late swap may use ${esc(p.name)} again` : `NO: late swap re-fills leave ${esc(p.name)} out of every open slot (a man kept here stays)`}">NO</button>`;
  const cls = ["lbr", fixed ? "stl" : "", fresh ? "new" : "", out ? "outr" : "", isNo ? "isno" : ""].filter(Boolean).join(" ");
  return `<div class="${cls}"><span class="ls">${slot}</span><span class="ln">${p.team ? logo(p.team, "xs") : ""}${nameOpen(p.name, p.dk_id, "span", "mn")}${noTagHtml(isNo, true)}${lock}${noBtn}${out ? '<i class="outchip">OUT</i>' : outChip(p)}</span><span class="la">${money(p.salary)}</span><span class="lp">${f1(p.proj)}</span></div>`;
}

/** A re-fill answer's late swap NO summary (screen-ops.js lateNoState) in one banner line: "Late swap NO: left out A, B; ignored D (no
 *  longer on this slate)."; "" when it did nothing. */
export function lateNoLine(n) {
  if (!n) return "";
  // Only what the re-fill left out, and any NO man no longer on the slate (G62): where he chose a man himself nothing is said (Adam 6:19 PM 11-19).
  const parts = [n.applied?.length ? `left out ${n.applied.join(", ")}` : "", n.ignored?.length ? `ignored ${n.ignored.join(", ")}` : ""].filter(Boolean);
  return parts.length ? `Late swap NO: ${parts.join("; ")}.` : "";
}

/** The late swap NO chip over the lineups (no-picks.js noChipHtml, "🚫 NO · late swap"); "" with nobody on it, or with no NO list on this page. */
const noRowHtml = (M, L) => (L.no ? `<div class="lbno">${noChipHtml({ mode: LATE, ids: L.no.ids, nameOf: (id) => nameIn(M, id), error: L.no.error, lsw: true })}</div>` : "");

const sumOf = (M, ids, k, mode = null) => { const pool = poolOf(M, mode); const v = ids.map((id) => pool.get(id)?.[k]); return v.every(Number.isFinite) ? v.reduce((a, b) => a + b, 0) : null; };

function headHtml(g, M, extra = "") {
  const n = g.spots.reduce((t, s) => t + s.nEntries, 0), contests = [...new Set(g.spots.flatMap((s) => s.contests))];
  const outMen = (M.takeOut ?? []).filter((id) => g.lineup.includes(id));
  return `<header class="lbh"><b>Lineup ${esc(g.spots.map((s) => s.name).join(", "))}</b><span class="muted">in ${plural(n, "entry", "entries")}${contests.length ? ` · ${esc(contests.slice(0, 2).join(", "))}${contests.length > 2 ? ` +${contests.length - 2}` : ""}` : ""}</span>${outMen.map((id) => `<i class="lbout">${esc(nameIn(M, id).toUpperCase())} OUT</i>`).join("")}<span class="grow"></span>${extra}</header>`;
}

function cardHtml(g, M, L) {
  const kept = M.keptMen?.[g.spots[0].name] ?? [], spotNames = g.spots.map((s) => s.name);
  const locked = g.lineup.filter((id) => { const p = poolOf(M).get(id); return p && (p.started || p.untimed); }).length;
  return `<article class="lbcard${(M.takeOut ?? []).some((id) => g.lineup.includes(id)) ? " hasout" : ""}">${headHtml(g, M, `<button class="go sm" data-lsw="lbOpen" data-spot="${esc(spotNames[0])}"${L.busy ? " disabled" : ""}>Re-optimize</button>`)}
${SLOTS.map((slot, i) => rowHtml(M, slot, g.lineup[i], { keep: { spots: spotNames, kept }, outIds: M.takeOut ?? [], no: noSet(L), mode: g.mode })).join("")}
<footer class="lbf"><span class="lp">${f1(sumOf(M, g.lineup, "proj", g.mode))}</span><span>salary <b>${money(sumOf(M, g.lineup, "salary", g.mode))}</b></span><span class="muted">${locked} locked</span><span class="grow"></span><button class="lnk" data-lsw="openSpot" data-spot="${esc(spotNames[0])}">Edit one slot</button></footer></article>`;
}

function openHtml(g, M, L) {
  const o = L.lbOpts, now = g.lineup, spotNames = g.spots.map((s) => s.name);
  // NOW's total is the engine's own for this spot once the options are back (reopt.js spotOptions current.proj, in the spot's mode), so it compares with each option's.
  const nowProj = o?.current && Object.hasOwn(o.current, "proj") ? o.current.proj : sumOf(M, now, "proj", g.mode);
  const kept = M.keptMen?.[spotNames[0]] ?? [];
  const nowCard = `<div class="lbopt now"><div class="loh"><b>NOW</b><span class="muted">${now.filter((id) => poolOf(M).get(id)?.started).length} locked</span></div>${SLOTS.map((slot, i) => rowHtml(M, slot, now[i], { keep: { spots: spotNames, kept }, outIds: M.takeOut ?? [], no: noSet(L), mode: g.mode })).join("")}<div class="lbf"><span class="lp">${f1(nowProj)}</span><span>${money(sumOf(M, now, "salary", g.mode))}</span></div></div>`;
  const opts = !o ? '<div class="rs">Finding the best options…</div>' : o.options.map((x, n) => {
    const k = SLOTS.filter((_, i) => x.lineup[i] !== now[i]).length;
    return `<div class="lbopt"><div class="loh"><b>OPTION ${n + 1}</b><span class="muted">${k ? plural(k, "change", "changes") : "same as now"}</span><span class="grow"></span><button class="go sm" data-lsw="lbUse" data-n="${n}"${L.busy || !k ? " disabled" : ""}>Use this</button></div>${SLOTS.map((slot, i) => rowHtml(M, slot, x.lineup[i], { fresh: x.lineup[i] !== now[i], mode: g.mode })).join("")}<div class="lbf"><span class="lp">${f1(x.proj)}</span><span class="${(x.proj ?? 0) >= (nowProj ?? 0) ? "gr" : "red"}">${Number.isFinite(x.proj) && Number.isFinite(nowProj) ? signed(x.proj - nowProj, f1) : "—"}</span><span>${money(x.salary)}</span></div></div>`;
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
  return `${listsHtml(M, L)}${noRowHtml(M, L)}
<div class="lbtitle"><b>Your lineups</b><span class="muted">each lineup once, however many entries hold it</span><span class="grow"></span><button class="go" data-lsw="lbAll"${L.busy ? " disabled" : ""}>Re-optimize every lineup</button></div>
${open ? openHtml(open, M, L) : ""}
<div class="lbgrid">${rest.map((g) => cardHtml(g, M, L)).join("")}</div>
<div class="lbfoot"><b>${plural(nSpots, "lineup", "lineups")} changed · ${plural(chg.changed.length, "entry", "entries")}</b><span class="muted">changes stay here until you export</span><span class="grow"></span><button class="go" data-lsw="exportChanged"${chg.written ? "" : " disabled"}>Export changed entries (${chg.written})</button><button class="go ol2" data-lsw="exportAll"${M.exports.all.written ? "" : " disabled"}>Export all assigned entries (${M.exports.all.written})</button></div>`;
}

/** The clicks of this view; true when handled. c = { L, M, act, render, boardState, noApi } (noApi: the page's NO lists, no-picks.js). */
export async function byLineupClick(a, d, c) {
  const { L, M, act, render, boardState, noApi = null } = c;
  const lists = async (takeOut, atLeast) => afterLists(c, await act({ op: "lists", takeOut, atLeast }));
  switch (a) {
    // The late swap NO list (Adam 5:28 PM 11-19): the same list the Player list's late swap mode shows; an open lineup's options are asked again.
    case "lbNo": case "lbNoX": case "lbNoClear": case "lbNoRetry": {
      if (!noApi) return true;
      if (a === "lbNo") noApi.toggleIn(LATE, d.id); else if (a === "lbNoX") noApi.dropIn(LATE, d.id); else if (a === "lbNoClear") noApi.clearIn(LATE); else await noApi.load();
      await noApi.settled();
      if (L.openLu) await loadOptions(c, L.openLu); else render();
      return true;
    }
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
      // current: the lineup these options were worked out from (a pick on a changed lineup is refused, review F5); boardState: the Max % it is held to (F3)
      const j = await act({ op: "pickOption", spot: L.openLu, lineup: x.lineup, proven: x.proven, remove: M.takeOut ?? [], current: L.lbOpts.current?.lineup ?? null, ...boardState() }, { label: `Lineup ${L.openLu}` });
      if (j && !j.refused && !j.confirms?.length) { L.openLu = null; L.lbOpts = null; render(); }
      return true;
    }
    case "lbAll": {
      const spots = M.spots.filter((s) => !s.blank).map((s) => s.name);
      L.openLu = null; L.lbOpts = null; // an open lineup's options are worked out from what this run replaces (review F5)
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
  const j = await act({ op: "options", spot, count: 5, remove: (L.M ?? M).takeOut ?? [], ...boardState() }); // L.M: the lists as the last answer left them
  if (L.openLu !== spot) return;
  L.lbOpts = j?.options ?? { options: [], notes: [j?.refused ?? "The options could not be found."] };
  render();
}

/** After a change to the two lists (review F2 11-19): an open lineup's options were worked out from the old lists, so they are asked
 *  again; with no way to ask here (render or boardState not given) they are closed. j: the lists answer. */
async function afterLists(c, j) {
  const { L } = c;
  if (!j || j.refused || !L.openLu) return;
  L.lbOpts = null; // the old options leave the screen at once
  if (c.render && c.boardState) return void (await loadOptions(c, L.openLu));
  L.openLu = null;
}

/** A player picked in one of the two "+ add a player" boxes; true when handled. c = { L, M, act, render?, boardState? }. */
export async function byLineupChange(t, c) {
  const { L, M, act } = c;
  const kind = t.dataset.lswIn;
  if (!kind) return false;
  const opt = [...(t.list?.options ?? [])].find((o) => o.value === t.value);
  if (!opt) return true; // still typing: nothing picked yet
  const id = opt.dataset.id;
  t.value = ""; // picked once: the input and change events that follow find nothing
  if (kind === "out") { await afterLists(c, await act({ op: "lists", takeOut: [...new Set([...(M.takeOut ?? []), id])], atLeast: M.atLeast ?? {} })); return true; }
  const pct = Number(window.prompt(`Put ${opt.value} in at least what percent of entries?`, "40"));
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) { L.msg = { kind: "warn", text: "A percent from 1 to 100, please." }; return true; }
  await afterLists(c, await act({ op: "lists", takeOut: M.takeOut ?? [], atLeast: { ...(M.atLeast ?? {}), [id]: pct } }));
  return true;
}
