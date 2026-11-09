// The Lineups tab (Adam, 2026-11-04, mock-up Version 1): the lineups of the last build and the saved lineups side by side in one
// full-width screen, with a summary strip, a "This build" / "Saved" switch, Filter by player, sort, the exposure table on the
// left and the cards in as many columns as fit. A saved lineup has everything a built one has: the same exposure table, You vs
// field, Filter, sort, swap buttons and download, plus the mode filter. Everything here is pure (markup strings and lists);
// panel.js draws it and handles its clicks. A card row is the shared one (card-row.js) with the team logo leading, the team's
// tint, the slot as small muted text and a CORR chip on a game stack (corr.js).
import { esc, money, isoToEastern } from "./board-util.js";
import { SLOTS } from "./slots.js";
import { cardRowHtml, capLine, totals, lineupTag, isOutNow } from "./card-row.js";
import { gameStacks } from "./corr.js";
import { exposureRows, exposureHtml, setKey, savedKey, savedKeys, builtFigures } from "./lineups-list.js";
import { swapButtonHtml, swapPanelHtml, swapOptions, lineupStarted } from "./swap-list.js";
import { buildMessage } from "./build-progress.js";
import { compareHtml, freshCompare } from "./lineups-compare.js";
import { NAME_MAX, savedLetterOf } from "./saved-panel.js";
import { HINT } from "./cell-editor.js";
import { MAX_SPOTS } from "./spot-name.js";

export const SORTS = [["proj", "Projection", "Most projected points first"], ["sal", "Salary", "Most salary used first"], ["own", "Ownership", "Lowest total ownership first"], ["new", "Newest", "Newest first (a build's own order)"]];
export const MODE_FILTERS = ["All", "Cash", "GPP"];

/** The tab's own state: view null means "this build when there is one, else saved". */
export const freshLt = () => ({ view: null, show: "cards", q: "", sort: "proj", mode: "All", men: [], spot: "All", replace: false });

// ---- spots (Adam's contest entries; spots.json on the server): a saved lineup holds none, one or several ----
const SPOT_COLOURS = ["#7ee787", "#79c0ff", "#d2a8ff", "#f778ba", "#56d4dd", "#b6e354", "#9ea8ff", "#e6edf3"]; // eight, so a card's spots never share one
// A spots object is replaced, never changed in place, so its sorted names and each name's place are worked out once per object.
const byName = new Intl.Collator("en", { numeric: true }).compare, sortedCache = new WeakMap();
const sortedOf = (spots) => {
  if (!spots || typeof spots !== "object") return { names: [], at: new Map() };
  let s = sortedCache.get(spots);
  if (!s) { const names = Object.keys(spots).sort(byName); s = { names, at: new Map(names.map((n, i) => [n, i])) }; sortedCache.set(spots, s); }
  return s;
};
const spotNames = (spots) => sortedOf(spots).names;
const spotColour = (name, spots) => SPOT_COLOURS[(sortedOf(spots).at.get(name) ?? 0) % SPOT_COLOURS.length];
/** The spots a saved lineup holds, in name order. */
export const heldSpots = (spots, id) => spotNames(spots).filter((n) => spots[n]?.lineup_id === String(id));
/** The next unused "GPP #n". */
export function nextGppName(spots) {
  let n = 1;
  while (Object.hasOwn(spots ?? {}, `GPP #${n}`)) n++;
  return `GPP #${n}`;
}
/** A saved lineup's name as its card shows it: the name Adam gave it, else "Lineup A" by the letter of its place saved (as on main). */
export const savedLabel = (l, names, saved) => names?.[l.id] ?? `Lineup ${savedLetterOf(l, saved)}`;

/** Who holds a spot now, in words, for the menu. */
function holderText(spots, name, id, saved, names) {
  const hold = spots[name]?.lineup_id;
  if (hold == null) return "empty";
  if (String(hold) === String(id)) return "this lineup";
  const l = saved.find((x) => String(x.id) === String(hold));
  return l ? savedLabel(l, names, saved) : "a deleted lineup";
}

const normName = (n) => String(n ?? "").trim().toLowerCase();
/** The names on the slate's out list (men who are Out leave the slate's players and appear only there, with no dk_id). */
export const outNameSet = (outList) => new Set((outList ?? []).map((o) => normName(o?.name)).filter(Boolean));
/** The same from the page's context: the slate's out list, and the Set of Out names the board keeps (slate-refresh.js outNamesOf). */
export const outNamesOfCtx = (c) => new Set([...outNameSet(c.outList), ...[...(c.outNames ?? [])].map(normName)]);

/** The men of a lineup who cannot play tonight (Adam's ruling): Out, or no longer on the board. Questionable does not count. Each
 *  is { name, why }. men: slate players, or { dk_id, stale, name?, out? } stubs for a man who left the players (his name kept with
 *  the saved lineup; out when the slate's out list names him). */
export function unavailableMen(men) {
  return men.filter((p) => p && (p.stale || String(p.injury_status ?? "").trim().toLowerCase() === "out"))
    .map((p) => (!p.stale ? { name: p.name, why: "Out" }
      : p.name ? { name: p.name, why: p.out ? "Out" : "off the board" } : { name: `a man off the board (id ${p.dk_id})`, why: "off the board", unnamed: true }));
}
/** One unavailable man in words: "Name is Out", "Name is off the board". */
export const unavailableLabel = (b) => (b.unnamed ? b.name : `${b.name} is ${b.why === "Out" ? "Out" : "off the board"}`);
const badTag = (men) => { const bad = unavailableMen(men); return bad.length ? `<div class="lt-bad" title="This lineup holds a man who cannot play">${bad.map((b) => esc(unavailableLabel(b))).join(" · ")}</div>` : ""; };

function spotMenuHtml(e, { spots, saved, names, warn, text }) {
  const id = esc(e.id);
  const alert = warn?.id === String(e.id) ? `<div class="spwarn">${warn.names.map((n) => esc(n)).join(", ")}. Give <b>${esc(warn.spot)}</b> to this lineup anyway?<span><button data-op="spotforce" data-id="${id}" data-spot="${esc(warn.spot)}">Assign anyway</button><button data-op="spotcancel">Cancel</button></span></div>` : "";
  const rows = spotNames(spots).map((n) => {
    const mine = spots[n]?.lineup_id === String(e.id), empty = spots[n]?.lineup_id === null;
    return `<span class="spr"><button class="spm${mine ? " mine" : ""}" data-op="spotset" data-id="${id}" data-spot="${esc(n)}" title="${mine ? "Take this spot off this lineup" : "Give this spot to this lineup"}"><i style="color:${spotColour(n, spots)}">${mine ? "✓" : "●"}</i><b>${esc(n)}</b><em>${esc(holderText(spots, n, e.id, saved, names))}</em></button>`
      + (empty ? `<button class="spx" data-op="spotdrop" data-spot="${esc(n)}" title="Remove the empty spot ${esc(n)}">×</button>` : "") + `</span>`;
  }).join("");
  // The list scrolls inside the menu; the ways to make a new spot stay under it, always in view (lineups-panel.js placeSpotMenu). At
  // MAX_SPOTS the slate holds as many spots as the server takes, so no new one is offered, only a line saying so.
  const full = Object.keys(spots ?? {}).length >= MAX_SPOTS, gpp = nextGppName(spots);
  const add = full ? `<div class="spnone spfull">Spot limit reached (${MAX_SPOTS}). Remove an empty spot to add one.</div>`
    : `<button class="spm new" data-op="spotset" data-id="${id}" data-spot="${esc(gpp)}">+ new <b>${esc(gpp)}</b></button>`
      + (Object.hasOwn(spots, "Cash") ? "" : `<button class="spm new" data-op="spotset" data-id="${id}" data-spot="Cash">+ new <b>Cash</b></button>`)
      + `<div class="spadd"><input data-spotname="${id}" maxlength="40" placeholder="or type a name" value="${esc(text?.id === String(e.id) ? text.text : "")}" autocomplete="off"><button data-op="spotadd" data-id="${id}">Add</button></div>`;
  return `<div class="spmenu">${alert}<div class="splist">${rows || `<div class="spnone">No spots yet.</div>`}</div><div class="spfoot">${add}</div></div>`;
}

const spotChipHtml = (e, ctx) => {
  if (!ctx.ready) return ""; // the spots have not been read: unknown, so no chip and no menu
  const held = heldSpots(ctx.spots, e.id);
  const tags = held.length ? held.map((n) => `<span class="spt" style="--sc:${spotColour(n, ctx.spots)}">${esc(n)}</span>`).join("") : `<span class="spt none">No spot</span>`;
  // A swapped lineup that is not saved cannot take a spot: the spot file keeps the saved men.
  if (e.swapped) return `<span class="spw"><span class="spchip locked" title="Save this lineup first: a spot holds a saved lineup">${tags}<i>Save first</i></span></span>`;
  return `<span class="spw"><button class="spchip${ctx.spotMenu === e.id ? " on" : ""}" data-op="spotmenu" data-id="${esc(e.id)}" title="Spots (your contest entries) this lineup holds; click to change">${tags}<i>▾</i></button>${ctx.spotMenu === e.id ? spotMenuHtml(e, ctx) : ""}</span>`;
};

/** Saved lineups after the spot filter: "All", "None" (holds no spot) or a spot's name. */
export const bySpot = (list, spots, filter) => (filter === "All" || filter == null ? list : list.filter((e) => (filter === "None" ? heldSpots(spots, e.id).length === 0 : spots?.[filter]?.lineup_id === String(e.id))));

const stampET = (iso) => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? `${new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET` : null;
};

/** The two lists the tab switches between, each entry { key, kind, ids, mode, ... } (key "b:<index>" or "s:<saved id>"). */
export function entriesOf(P) {
  // The slate's latest build (P.builds holds one: a new build replaces the last); a lineup's key names its build and its place in it.
  const build = (P.builds ?? []).flatMap((b) => b.lineups.map((l, i) => ({ key: `b:${b.id}:${i}`, kind: "build", bid: b.id, b, i, n: i + 1, total: b.lineups.length, ids: l.ids, mode: b.mode, builtAt: b.built_at })));
  const saved = [...(P.saved ?? [])].reverse().map((l) => {
    const base = l.orig ?? l.slots; // the men as saved: the names kept with the lineup line up with these ids
    return { key: `s:${l.id}`, kind: "saved", id: l.id, n: l.id, l, ids: l.slots, nameById: new Map(base.map((id, i) => [id, l.names?.[i] ?? null])), mode: l.mode, savedAt: l.saved_at, swapped: l.swapped === true, stale: l.stale === true, legal: l.legal, reasons: l.reasons };
  });
  return { build, saved };
}

export const viewOf = (P, lists) => P.lt.view ?? (lists.build.length ? "build" : "saved");

/** Seats an entry's men as the card draws them and takes its totals. men[k] is a slate player or a { dk_id, stale } stub. */
export function prep(e, { byId, seat, outNames = new Set(), knownName = null }) {
  // A man who left the slate's players is a stub that keeps the name saved with the lineup (or the one the board remembers), and is
  // Out when the slate's out list names him.
  const stub = (id) => { const name = e.nameById?.get(id) ?? knownName?.(id) ?? null; return { dk_id: id, stale: true, name, out: name != null && outNames.has(normName(name)) }; };
  const men = seat(e.ids.map((id) => byId.get(id) ?? stub(id))).men;
  return { ...e, men, t: totals(men.map((p) => (p?.stale ? null : p))) };
}

/** Sorts by a total, a missing one last; "new" and anything unknown keeps the order given. A new array. */
export function sortEntries(list, key) {
  const f = { proj: (x) => x.t.projection, sal: (x) => x.t.salary, own: (x) => x.t.own }[key];
  if (!f) return [...list];
  const dir = key === "own" ? 1 : -1;
  return [...list].sort((a, b) => {
    const x = f(a), y = f(b);
    return (x == null) - (y == null) || (x == null ? 0 : dir * (x - y));
  });
}

/** Filter by player (any man whose name holds the text), by the exposure table's man, and (saved) by mode. */
export function filterEntries(list, { q = "", men = [], mode = "All" }, useMode) {
  const text = q.trim().toLowerCase();
  return list.filter((e) => (!useMode || mode === "All" || e.mode === mode)
    && men.every((m) => e.ids.includes(m)) // the men filtered: only lineups holding every one of them (an AND)
    && (!text || e.men.some((p) => String(p?.name ?? "").toLowerCase().includes(text))));
}

const range = (vals, f) => {
  const v = vals.filter((x) => typeof x === "number");
  if (!v.length) return null;
  const lo = Math.min(...v), hi = Math.max(...v);
  return f(lo) === f(hi) ? f(lo) : `${f(lo)} to ${f(hi)}`;
};

/** The strip's cells as [label, value-or-null] for the lineups shown. */
export function summaryCells(list, { view }) {
  const n = list.length;
  const avg = n && list.every((e) => e.t.own != null) ? `${Math.round(list.reduce((t, e) => t + e.t.own, 0) / n)}%` : null;
  const cells = [["Lineups", String(n)], ["Projection", range(list.map((e) => e.t.projection), (v) => v.toFixed(1))], ["Salary", range(list.map((e) => e.t.salary), money)], ["Avg total ownership (8 men)", avg]];
  if (view === "build") {
    const latest = Math.max(...list.map((e) => e.builtAt).filter(Number.isFinite));
    return [...cells, ["Builds", String(new Set(list.map((e) => e.bid)).size)], ["Modes", [...new Set(list.map((e) => e.mode))].join(", ") || null], ["Latest", Number.isFinite(latest) ? isoToEastern(new Date(latest).toISOString()) : null]];
  }
  const dates = list.map((e) => Date.parse(e.savedAt)).filter(Number.isFinite);
  const day = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  const modes = ["GPP", "Cash"].map((m) => [m, list.filter((e) => e.mode === m).length]).filter(([, c]) => c).map(([m, c]) => `${c} ${m}`).join(", ");
  return [...cells, ["Saved", dates.length ? (day(Math.min(...dates)) === day(Math.max(...dates)) ? day(dates[0]) : `${day(Math.min(...dates))} to ${day(Math.max(...dates))}`) : null], ["Modes", modes || null]];
}

const summaryHtml = (cells, dash) => `<div class="lt-sum">${cells.map(([l, v]) => `<div><small>${esc(l)}</small><b>${v == null ? dash(`no ${l.toLowerCase()} to show`) : esc(v)}</b></div>`).join("")}</div>`;

function cardHtml(e, { byId, dash, colourOf, swap, locked, savedSet, names, edit, spots, spotMenu, saved, spotWarn, spotsReady, spotText, tagOf, live }) {
  const spotCtx = { spots, spotMenu, saved, names, warn: spotWarn, ready: spotsReady, text: spotText };
  // The red banner reads the board now: a built card holds its men as built, so a man who went Out since is found by his live row.
  const bannerMen = e.kind === "build" && live ? e.men.map((p) => (p && !p.stale ? (live.get(p.dk_id) ?? { dk_id: p.dk_id, stale: true, name: p.name }) : p)) : e.men;
  const open = swap.open?.key === e.key ? swap.open.id : null;
  const stacks = e.mode === "GPP" ? gameStacks(e.men) : new Map(); // game stacks are a GPP idea: a Cash lineup shows no CORR chip (Adam)
  const rows = SLOTS.map((s, k) => {
    const p = e.men[k], lk = e.kind === "build" && locked.has(p?.dk_id), tag = tagOf(e.kind, p);
    return cardRowHtml({ slot: s, p, dash, colourOf, lead: "logo", cls: `lr${lk ? " locked" : ""}${tag ? " gonetag" : ""}`, note: [lk ? "locked" : "", tag ?? ""].filter(Boolean).join(" · "), corr: stacks.get(p?.dk_id) ?? null, ctl: swapButtonHtml(p, e.key, swap.ctx, open, lineupStarted(e.men, swap.ctx)) })
      + (open && p?.dk_id === open ? swapPanelHtml(swapOptions(e.ids, open, swap.ctx), e.key, dash) : "");
  }).join("");
  const foot = capLine(e.men.map((p) => (p?.stale ? null : p)), { dash, short: true });
  if (e.kind === "build") {
    const isSaved = savedSet.has(savedKey(e.mode, e.ids));
    const at = `data-b="${esc(e.bid)}" data-i="${e.i}"`;
    const btns = `<button class="sm" data-op="lscard" ${at} title="Start late swap from this lineup">Late swap</button>${isSaved ? `<button class="sm on" disabled>Saved ✓</button>` : `<button class="sm" data-op="savecard" ${at}>Save</button>`}<button class="sm x" data-op="discard" ${at} title="Take this lineup off the list">Discard</button>`;
    return `<div class="lc${isSaved ? " savedc" : ""}"><div class="lch"><span>Lineup ${e.n}${sameTag(e)}</span><span class="lcb">${btns}</span></div>${badTag(bannerMen)}${rows}${foot}</div>`;
  }
  const at = stampET(e.savedAt);
  const name = names?.[e.id], dflt = `Lineup ${savedLetterOf(e.l, saved)}`;
  const title = edit?.id === e.id
    ? `<input class="lt-name" data-svname="${esc(e.id)}" maxlength="${NAME_MAX}" value="${esc(edit.text)}" placeholder="${esc(dflt)}" aria-label="Name this lineup" autocomplete="off">`
    : `<span>${esc(name ?? dflt)}</span><button class="rn" data-op="svrename" data-id="${esc(e.id)}" title="Rename this lineup">✎</button>`;
  const btns = `<button class="sm" data-op="lssaved" data-id="${esc(e.id)}" title="Start late swap from this lineup">Late swap</button><button class="sm" data-op="load" data-id="${esc(e.id)}" title="Make it the working lineup">Load</button>`
    + (e.swapped ? `<button class="sm" data-op="savesw" data-id="${esc(e.id)}" title="Save this swapped lineup as a new saved lineup">Save</button>` : "")
    + `<button class="sm" data-op="ltdl" data-k="${esc(e.key)}" title="Download this lineup for DraftKings">Download</button><button class="sm x" data-op="del" data-id="${esc(e.id)}">Delete</button>`;
  const heldNow = heldSpots(spots, e.id);
  const note = e.swapped ? `<div class="lt-sw">Swapped on this page only; it is not saved until you press Save.${spotsReady && heldNow.length ? ` ${esc(heldNow.join(", "))} still ${heldNow.length === 1 ? "has" : "have"} the saved men, not this swap.` : ""}</div>` : "";
  const ill = e.legal === false ? `<div class="lt-sw ill" title="${esc((e.reasons ?? []).join(" "))}">${e.stale ? "Off this slate" : "Not legal now"}</div>` : "";
  return `<div class="lc svc${e.swapped ? " swapped" : ""}"><div class="lch"><span class="lt-title">${title}</span><span class="lcb">${btns}</span></div>${edit?.id === e.id ? `<div class="lt-sw ed-hint">${HINT}</div>` : ""}<div class="lt-at"><span class="md${e.mode === "Cash" ? " cash" : ""}">${esc(e.mode)}</span>${sameTag(e)} <span class="lt-time">${at ? `Saved ${esc(at)}` : dash("no time on this saved lineup")}</span>${spotChipHtml(e, spotCtx)}</div>${badTag(bannerMen)}${note}${ill}${rows}${foot}</div>`;
}

/** "same as Cash 1" on a GPP lineup that holds exactly a Cash lineup's men. */
const sameTag = (e) => (e.same ? ` <span class="lt-same" title="This GPP lineup holds exactly the men of ${esc(e.same)}">same as ${esc(e.same)}</span>` : "");

/** The time a build was made, in Eastern ("5:43 PM ET"). */
export const builtAtText = (ms) => (Number.isFinite(ms) ? isoToEastern(new Date(ms).toISOString()) : null) ?? "time unknown";

/** The lineups Compare is given, each with a label no other has: "Lineup 1, Cash 9:18 PM ET", and where two builds made in the same
 *  minute give the same label, the build's number (oldest build first) is added: "Lineup 1, Cash 9:18 PM ET, build 2". */
export function compareLineups(shown, P) {
  const order = [...(P.builds ?? [])].sort((a, b) => (a.built_at ?? 0) - (b.built_at ?? 0) || String(a.id).localeCompare(String(b.id))).map((b) => b.id);
  const base = shown.map((e) => (e.kind === "saved" ? savedLabel(e.l, P.svNames, P.saved) : `Lineup ${e.n}, ${e.mode} ${builtAtText(e.builtAt)}`));
  const count = new Map();
  for (const n of base) count.set(n, (count.get(n) ?? 0) + 1);
  return shown.map((e, i) => ({ key: e.key, name: e.kind === "build" && count.get(base[i]) > 1 ? `${base[i]}, build ${order.indexOf(e.bid) + 1}` : base[i], mode: e.mode, men: e.men, same: e.same }));
}

/** A build's header over its cards: "Cash, 10 lineups, 5:43 PM ET", then what only that build knows: its note, how many men it skipped,
 *  the pull it was built on when the board has a newer one, and a mark when the server does not hold it; with the buttons that
 *  download it alone (the lineups shown, with their count) and remove it. */
function buildHeadHtml(e, { pull, shownN }) {
  const b = e.b, at = builtAtText(e.builtAt);
  const stale = b.stamps?.pullAt?.key != null && pull?.key != null && b.stamps.pullAt.key !== pull.key ? `Built on the ${esc(b.stamps.pullAt.label ?? "earlier")} pull` : "";
  const bits = [b.note ? `<span class="lt-bn" title="${esc(b.note)}">${esc(b.note.length > 90 ? b.note.slice(0, 89) + "…" : b.note)}</span>` : "",
    b.skipped?.length ? `<span class="lt-bs" title="${esc(b.skipped.map((s) => `${s.name ?? s.dk_id ?? "?"}${s.why ? ` (${s.why})` : ""}`).join(", "))}">${b.skipped.length} ${b.skipped.length === 1 ? "man" : "men"} skipped</span>` : "",
    stale ? `<span class="lt-bp">${stale}</span>` : "", b.notKept ? `<span class="lt-bk" title="The server did not take this build; it is here until the page is closed">not kept on the server</span>` : ""].filter(Boolean).join("");
  return `<div class="lt-bh"><b>${esc(e.mode)}, ${e.total} lineup${e.total === 1 ? "" : "s"}, ${esc(at)}</b>${bits}<button class="sm lt-bdl" data-op="bdl" data-b="${esc(e.bid)}"${shownN ? "" : " disabled"} title="Download only this build's lineups for DraftKings">Download (${shownN})</button><button class="sm x" data-op="bremove" data-b="${esc(e.bid)}" title="Remove this build and its ${e.total} lineups from Recently generated (saved lineups stay)">Remove build</button></div>`;
}

/** The rows a view draws from: a build's own men over the board (builtFigures), or the board itself for the saved lineups. */
export const figuresOf = (P, c, view) => (view === "build" ? builtFigures([...(P.builds ?? [])].reverse().flatMap((b) => b.lineups), c.byId) : c.byId);

/** What the tab shows: the view, every lineup of it (`all`), those in the mode filter (`inMode`, which the exposure table and
 *  the strip count) and those on show after Filter by player and sort (`shown`, which the CSV and the cards follow). */
export function viewModel(P, c, seat) {
  const lists = entriesOf(P), view = viewOf(P, lists);
  const outNames = outNamesOfCtx(c);
  // A recently generated build is frozen: its cards draw the men that build answered with (builtFigures of that build alone), and
  // only a status tag reads live. Saved lineups always draw the board as it is now (Adam, 11-04).
  const own = new Map((P.builds ?? []).map((b) => [b.id, builtFigures(b.lineups, c.byId)]));
  const all = (view === "build" ? lists.build : lists.saved).map((e) => prep(e, { byId: e.kind === "build" ? own.get(e.bid) : c.byId, seat, outNames, knownName: c.knownName }));
  // A GPP lineup that holds exactly the men of a Cash one is marked ("same as Cash 1"), never hidden: it would read as a bug otherwise.
  for (const e of all) {
    if (e.mode !== "GPP") continue;
    const x = all.find((y) => y.mode === "Cash" && setKey(y.ids) === setKey(e.ids));
    if (x) e.same = x.kind === "build" ? `Cash ${x.n}` : `Cash ${savedLabel(x.l, P.svNames, P.saved)}`;
  }
  const inMode = bySpot(filterEntries(all, { mode: P.lt.mode }, true), P.spots, view === "saved" && P.spotsReady ? P.lt.spot : "All");
  const sorted = sortEntries(filterEntries(inMode, { q: P.lt.q, men: P.lt.men ?? [] }, false), P.lt.sort);
  // Builds stay newest first whatever the sort: the sort orders the lineups inside each build.
  const at = new Map((P.builds ?? []).map((b, i) => [b.id, i]));
  const shown = view === "build" ? [...sorted].sort((a, b) => at.get(a.bid) - at.get(b.bid)) : sorted;
  return { lists, view, all, inMode, shown };
}

/** The filtered men as chips (each with its own ×), the count of lineups holding all of them, and Clear all. "" with nobody filtered. */
function filterChipsHtml(men, figures, shownN, totalN) {
  if (!men.length) return "";
  const chips = men.map((id) => `<span class="lt-chip"><b>${esc(figures.get(id)?.name ?? `DraftKings id ${id}`)}</b><button data-op="menoff" data-man="${esc(id)}" title="Take ${esc(figures.get(id)?.name ?? id)} out of the filter" aria-label="Remove from the filter">×</button></span>`).join("");
  return `<div class="lt-chips"><em>Holding all of</em>${chips}<span class="lt-count">${shownN} of ${totalN} lineup${totalN === 1 ? "" : "s"}</span><button class="ol sm lt-clear" data-op="menclear">Clear all</button></div>`;
}

/**
 * The whole tab. P: the panel state (results, saved, lt, mode, expSort, expPos, swap, running, build, ls, svNames).
 * c: { byId, picks, colourOf, name }; env: { dash, seat, swapCtx }.
 */
export function lineupsTabHtml(P, c, { dash, seat, swapCtx, notes = "" }) {
  const { lists, view, all, inMode, shown } = viewModel(P, c, seat);
  const run = P.running ? (() => { const m = buildMessage(P.build); return `<div class="lt-run lt-build"><span class="gomsg${m.err ? " err" : ""}">${esc(m.text)}</span>${P.build?.shown ? `<button class="ol stop" data-op="stop"${P.build.stopping ? " disabled" : ""}>Stop</button>` : ""}</div>`; })() : "";
  if (P.ls) return `${run}<div class="lt-empty">Late swap mode is on; its lineups are on the Player list tab. <button class="ol sm" data-op="lsoff" title="Leave late swap mode (the same as the Pin slots button in the header)">Turn late swap mode off</button><button class="ol sm" data-view="list">Back to the player list</button></div>`;
  const savedSet = savedKeys((P.saved ?? []).filter((l) => !l.swapped));
  const tab = (v, label, n) => `<button class="${v === view ? "on" : ""}" data-op="ltview" data-v="${v}">${label} <b>${n}</b></button>`;
  const readErr = view === "saved" && (P.savedError || !P.savedReady);
  const showBtn = (v, label) => `<button class="${(P.lt.show ?? "cards") === v ? "on" : ""}" data-op="ltshow" data-v="${v}">${label}</button>`;
  const top = `<div class="lt-bar"><span class="lt-tabs">${tab("build", "Recently generated", lists.build.length)}${tab("saved", "Saved", lists.saved.length)}</span>`
    + `<span class="lt-tabs lt-show" title="Cards, or every lineup side by side">${showBtn("cards", "Cards")}${showBtn("compare", "Compare")}</span>`
    + `<input class="search lt-q" data-lt="q" placeholder="Filter by player..." value="${esc(P.lt.q)}" autocomplete="off" aria-label="Filter lineups by player">`
    // Compare has its own sort (every heading); the cards' sort buttons are not drawn there, so there is one set of sort controls.
    + ((P.lt.show ?? "cards") === "compare" ? "" : `<span class="lt-sort"><em>Sort</em>${SORTS.map(([k, l, t]) => `<button class="${P.lt.sort === k ? "on" : ""}" data-op="ltsort" data-s="${k}" title="${esc(t)}">${l}</button>`).join("")}</span>`)
    + `<span class="lt-sort"><em>Mode</em>${MODE_FILTERS.map((m) => `<button class="${P.lt.mode === m ? "on" : ""}" data-op="ltmode" data-m="${m}">${m}</button>`).join("")}</span>`
    + (view === "saved" ? (P.spotsReady
      ? `<span class="lt-sort lt-spotf"><em>Spot</em><span class="lt-spotbtns">${[["All", "All"], ["None", "Unassigned"], ...spotNames(P.spots).map((n) => [n, n])].map(([k, l]) => `<button class="${P.lt.spot === k ? "on" : ""}" data-op="ltspot" data-s="${esc(k)}">${esc(l)}</button>`).join("")}</span><span class="lt-spotn" aria-hidden="true"></span></span>`
        + `<span class="lt-sort lt-order"><button class="on-order" data-op="assignorder" title="Give the saved lineups shown, in this order, the GPP spots in turn (GPP #1, GPP #2 ...); Cash is left alone">Assign in order</button><label title="Also give spots that already hold a lineup, and place lineups that already hold a spot"><input type="checkbox" data-op="orderreplace"${P.lt.replace ? " checked" : ""}> Replace current</label></span>`
      : `<span class="lt-sw${P.spotsError ? " ill" : ""}">${P.spotsError ? `Could not read the spots: ${esc(P.spotsError)}. Click anywhere here to try again.` : "Reading the spots"}</span>`) : "")
    + `</div>`;
  const dl = `<button class="ol lt-dl" data-op="ltcsv"${shown.length ? "" : " disabled"} title="A plain CSV of player ids in the slots, in this order, with no entry ids. DraftKings cannot use it to change entries already entered; for that, use Export on the Late swap screen.">Download player IDs only${shown.length ? ` (${shown.length})` : ""}</button>`;
  // Save all (Recently generated only): every lineup shown, in one save; the ones already saved are counted, not saved twice.
  const nNew = view === "build" ? shown.filter((e) => !savedSet.has(savedKey(e.mode, e.ids))).length : 0;
  const saveAll = view === "build" ? `<button class="ol lt-dl lt-saveall" data-op="saveall"${nNew ? "" : " disabled"} title="${nNew ? "Save every lineup shown (the ones already saved are skipped)" : "Every lineup shown is already saved"}">Save all${nNew ? ` (${nNew})` : ""}</button>` : "";
  const strip = summaryHtml(summaryCells(inMode, { view }), dash);
  let body;
  // A failed read beside builds made on this page says so: the list may be missing builds the server holds.
  const readNote = view === "build" && P.buildsError && all.length ? `<div class="lt-sw ill">Could not read the recently generated lineups from the server: ${esc(P.buildsError)}. Builds made earlier may be missing here. Click anywhere here to try again.</div>` : "";
  const buildsErr = view === "build" && (P.buildsError || !P.buildsReady) && !all.length;
  if (readErr) body = `<div class="lt-empty">${P.savedError ? `Could not read the saved lineups: ${esc(P.savedError)}. Click anywhere here to try again.` : "Reading the saved lineups"}</div>`;
  else if (buildsErr) body = `<div class="lt-empty">${P.buildsError ? `Could not read the recently generated lineups: ${esc(P.buildsError)}. Click anywhere here to try again.` : "Reading the recently generated lineups"}</div>`;
  else if (!all.length) body = `<div class="lt-empty">${view === "build" ? "No lineups generated yet on this slate. Build from the Player list tab." : "No saved lineups for this slate yet."}</div>`;
  else {
    const figures = figuresOf(P, c, view);
    // What has become of a man since: the live board decides. A built card holds his earlier row, so "now Out" means he was not
    // Out when it was built; a saved card has no earlier row, so the live status alone says Out (Adam, 11-04).
    const live = (p) => lineupTag(p, c.byId, c.outNames);
    const tagOf = (kind, p) => (kind === "saved" && isOutNow(p) ? "now Out" : live(p));
    // The exposure table counts the lineups shown (after the player filter), so clicking Filter on the next man narrows it further.
    const men = P.lt.men ?? [];
    const rows = exposureRows(shown.map((e) => e.ids), figures);
    const sort = shown.length === 1 && P.expSort.key === "diff" ? { key: "pct", dir: -1 } : P.expSort;
    // You vs field and Diff are GPP figures: a list of Cash lineups alone does not show them.
    const ex = shown.length ? exposureHtml(rows, sort, dash, men, P.expPos, shown.length > 1 && shown.some((e) => e.mode === "GPP")) : "";
    const ctx = { byId: figures, live: c.byId, tagOf, spotText: P.spotText ?? null, dash, colourOf: c.colourOf, swap: { ctx: swapCtx, open: P.swap ?? null }, locked: new Set(c.picks.locked), savedSet, names: P.svNames, edit: P.svEdit, spots: P.spots ?? {}, spotMenu: P.spotMenu ?? null, saved: P.saved ?? [], spotWarn: P.spotWarn ?? null, spotsReady: P.spotsReady === true };
    const counted = men.length ? `${shown.length} of ${inMode.length} lineup${inMode.length === 1 ? "" : "s"} holding all ${men.length === 1 ? "of him" : `${men.length} men`}` : `${inMode.length} lineup${inMode.length === 1 ? "" : "s"}`;
    const none = men.length
      ? `<div class="lt-empty">No lineup holds all of ${men.map((id) => esc(figures.get(id)?.name ?? id)).join(", ")}. <button class="ol sm lt-clear" data-op="menclear">Clear all</button></div>`
      : `<div class="lt-empty">No lineup matches this filter.</div>`;
    let lastBuild = null;
    const shownIn = new Map();
    for (const e of shown) if (e.kind === "build") shownIn.set(e.bid, (shownIn.get(e.bid) ?? 0) + 1);
    const cards = shown.map((e) => {
      const head = e.kind === "build" && e.bid !== lastBuild ? buildHeadHtml(e, { pull: c.pull, shownN: shownIn.get(e.bid) ?? 0 }) : "";
      lastBuild = e.bid;
      return head + cardHtml(e, ctx);
    }).join("");
    const chips = filterChipsHtml(men, figures, shown.length, inMode.length);
    if (P.lt.show === "compare") {
      // Compare lays the same filtered lineups side by side (lineups-compare.js); nothing shown says so, with Clear all in view.
      const cmp = compareLineups(shown, P);
      body = chips + (shown.length ? compareHtml(cmp, P.cmp ?? freshCompare(), { dash }) : `<div class="lt-body"><div class="lt-cards">${none}</div></div>`);
    } else {
      body = `${chips}<div class="lt-body"><div class="lt-ex"><div class="lt-exh">Exposure · ${view === "build" ? "recently generated" : "saved"} · ${counted}</div>${ex}</div>`
        + `<div class="lt-cards">${shown.length ? cards : none}</div></div>`;
    }
  }
  // The build's own notes and stale warnings sit at the top of This build; the spot move offer after a swapped save sits on Saved.
  const mv = view === "saved" && P.spotMove ? (() => {
    const old = P.saved.find((l) => String(l.id) === String(P.spotMove.fromId));
    return `<div class="lt-run"><span>${esc(P.spotMove.spots.join(", "))} ${P.spotMove.spots.length === 1 ? "is" : "are"} still on the old lineup${old ? ` (${esc(savedLabel(old, P.svNames, P.saved))})` : ""}.</span><button class="ol sm" data-op="spotmove">Move ${esc(P.spotMove.spots.join(", "))} to the new one</button><button class="ol sm" data-op="spotmovex">Leave ${P.spotMove.spots.length === 1 ? "it" : "them"}</button></div>`;
  })() : "";
  // The download sits on the summary strip's row, where the spots and filters beside the switch cannot push it.
  const ow = view === "saved" && P.orderWarn ? `<div class="spwarn lt-ordwarn"><b>${P.orderWarn.bad.length} lineup${P.orderWarn.bad.length === 1 ? "" : "s"} hold${P.orderWarn.bad.length === 1 ? "s" : ""} a man who cannot play:</b><ul>${P.orderWarn.bad.map((b) => `<li>${esc(b.label)}: ${b.names.map(esc).join(", ")}</li>`).join("")}</ul><span><button data-op="orderforce">Assign anyway</button><button data-op="orderskip">Skip those</button><button data-op="ordercancel">Cancel</button></span></div>` : "";
  const undo = view === "saved" && P.spotUndo ? `<div class="lt-run"><span>${esc(P.spotUndo.text)}</span><button class="ol sm" data-op="orderundo">Undo</button><button class="ol sm" data-op="orderokay">Keep</button></div>` : "";
  // The panel's notes and stale warnings belong to the last build made on this page in the panel's mode, not to every build below.
  const noted = notes ? `<div class="lt-notes"><em>The last ${esc(P.mode)} build made on this page:</em>${notes}</div>` : "";
  return `${run}${view === "build" ? readNote + noted : ow + undo + mv}<div class="lt-top">${strip}<span class="lt-acts">${saveAll}${dl}</span></div>${top}${body}`;
}
