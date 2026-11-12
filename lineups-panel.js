// The Lineups tab's controller (the markup is lineups-tab.js): draws the tab into the panel's second element, and handles its
// clicks, its filter box, the swap on a built or a saved lineup, the spots and the downloads. The panel's own steps (render, the
// CSV writer, the seat, late swap, the build notes) come in as `own`, so this file never imports panel.js back.
import { keepFocus } from "./board-util.js";
import { lineupRefusals, isOutNow } from "./card-row.js";
import { lineupsTabHtml, viewModel, builtAtText, viewOf, entriesOf, unavailableMen, unavailableLabel, savedLabel, heldSpots, outNamesOfCtx, SORTS, MODE_FILTERS, nextLtSort } from "./lineups-tab.js";
import { swapContext, swapOptions, swapIds } from "./swap-list.js";
import { savedCall, saveBatch, savedClick, savedNameInput } from "./saved-panel.js";
import { cleanSpotName } from "./spot-name.js";
import { planInOrder, orderSummary } from "./assign-order.js";
import { compareClick, freshCompare } from "./lineups-compare.js";
import { keepRecent, compactRow, toRecord, fromRecord, mergeBuilds, withoutLineup } from "./recent-builds.js";

/** Draws the tab (nothing when the page has no tab element, as in the panel's own tests). */
export function renderTab(X, c, own) {
  const el = X.lel;
  if (!el) return;
  const seat = (men) => own.lateSwapSeat(men);
  const key = `${X.P.lt?.view ?? ""}|${X.P.lt?.show ?? "cards"}`; // the same list as last time: its boxes keep their place
  // The boxes are sized before their scroll is put back: a box with no height limit yet has nothing to scroll.
  keepScroll(el, X.tabScrollKey === key, () => keepFocus(el, () => { el.innerHTML = lineupsTabHtml(X.P, c, { dash: X.dash, seat, swapCtx: swapContext(c, own.lateSwapSeat), notes: own.notesHtml(X.P, c) }); sizeBoxes(el); }));
  X.tabScrollKey = key;
  placeSpotMenu(el);
  spotCount(el);
  if (el.addEventListener && !countHooked.has(el)) { countHooked.add(el); el.addEventListener("scroll", (e) => { if (e.target?.classList?.contains("lt-spotbtns")) spotCount(el); }, true); }
  refit(el);
  sized.add(el);
  if (!resizeHooked && typeof window !== "undefined" && window.addEventListener) { resizeHooked = true; window.addEventListener("resize", () => sized.forEach((x) => { sizeBoxes(x); placeSpotMenu(x); spotCount(x); })); }
}
const sized = new Set(); // the tab elements drawn, sized again when the window changes size
let resizeHooked = false;

/** The tab's own scrolling boxes (the cards, the exposure table and Compare's tables, lineups.css): a redraw (a swap, a Save, a
 *  refresh) keeps where each was, as the player card does (card.js); `same` false (another view) starts them at the top. */
const SCROLL_BOXES = [".lt-cards", ".lt-ex", ".cp-scroll"];
/** Scrolling boxes with a height of their own (lineups.css; sizeBoxes must not set one): a redraw keeps where each was, and another
 *  view starts each with its active button in view (showActive). The Spot filter's two rows of buttons. */
const HELD_BOXES = [".lt-spotbtns"];

/** Scrolls a held box, inside itself only, so its active (.on) button is in view. Browser only. */
export function showActive(box) {
  const on = box?.querySelector?.("button.on");
  if (!on?.getBoundingClientRect || !box.getBoundingClientRect) return;
  const b = box.getBoundingClientRect(), o = on.getBoundingClientRect();
  if (o.top < b.top || o.bottom > b.bottom) box.scrollTop += o.top - b.top - Math.max(0, (b.height - o.height) / 2);
}

/** The Spot filter's count beside its box: how many of the spots' buttons are in view from the top down to the last one fully shown
 *  ("63 of 150"), nothing when they all fit, so a cue shows that more sit below without a scrollbar. Browser only. */
export function spotCount(el) {
  for (const box of el.querySelectorAll?.(".lt-spotbtns") ?? []) {
    const note = box.parentElement?.querySelector(".lt-spotn");
    if (!note || !box.getBoundingClientRect) continue;
    const btns = [...box.querySelectorAll("button")].slice(2); // All and Unassigned are not spots
    const edge = box.getBoundingClientRect().bottom + 1;
    const seen = btns.filter((x) => x.getBoundingClientRect().bottom <= edge).length;
    note.textContent = box.scrollHeight > box.clientHeight + 1 ? `${seen} of ${btns.length}` : "";
  }
}
const countHooked = new WeakSet();

/** The most height a scrolling box may take, its top `docTop` px down the page on a screen `viewH` px tall: the room left below its
 *  top, so at the top of the page the whole box is on screen. A box so far down that less than `least` is left (Compare's lower
 *  tables) takes a screen less two gaps, and is reached by scrolling the page. */
export function boxHeight(docTop, viewH, { gap = 12, least = 320 } = {}) {
  const room = Math.floor(viewH - docTop - gap);
  return room >= least ? room : Math.max(least, viewH - 2 * gap);
}

/** Sizes each scrolling box to the screen (boxHeight), in page order, as sizing one moves those under it. Below 600px wide the
 *  boxes do not scroll (lineups.css) and keep no limit. Browser only. */
export function sizeBoxes(el) {
  if (typeof window === "undefined" || !el.querySelectorAll) return;
  const wide = window.matchMedia?.("(min-width:600px)").matches ?? true;
  for (const b of el.querySelectorAll(SCROLL_BOXES.join(","))) {
    b.style.maxHeight = wide ? `${boxHeight(b.getBoundingClientRect().top + window.scrollY, window.innerHeight)}px` : "";
  }
}

/** Where an open spot menu goes: below its chip, or above it when there is less room below than the menu needs and more above.
 *  roomTop and roomBottom are the edges of what can be seen (the cards box within the screen); the menu's own list scrolls inside
 *  the height returned, so its new-spot rows and name box under the list stay in view. */
export function menuPlacement({ anchorTop, anchorBottom, roomTop, roomBottom, need, gap = 6, least = 140 }) {
  const below = roomBottom - anchorBottom - gap, above = anchorTop - roomTop - gap;
  const up = need > below && above > below;
  return { up, maxHeight: Math.max(least, Math.floor(up ? above : below)) };
}

/** Places the open spot menu (menuPlacement) and brings the whole of it into view. Browser only. */
export function placeSpotMenu(el) {
  const m = el.querySelector?.(".spmenu");
  if (!m?.getBoundingClientRect || typeof window === "undefined") return;
  m.classList.remove("up");
  m.style.maxHeight = "";
  const a = m.parentElement.getBoundingClientRect(), box = m.closest(".lt-cards")?.getBoundingClientRect();
  const p = menuPlacement({ anchorTop: a.top, anchorBottom: a.bottom, roomTop: Math.max(0, box?.top ?? 0), roomBottom: Math.min(window.innerHeight, box?.bottom ?? window.innerHeight), need: m.getBoundingClientRect().height });
  m.classList.toggle("up", p.up);
  m.style.maxHeight = `${p.maxHeight}px`;
  // The list opens at the card's own spot, scrolled inside the list only.
  const list = m.querySelector(".splist"), mine = list?.querySelector(".spm.mine");
  if (mine && list.getBoundingClientRect) list.scrollTop = Math.max(0, mine.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop - 4);
  m.scrollIntoView?.({ block: "nearest" });
}
export function keepScroll(el, same, draw) {
  const held = SCROLL_BOXES.map((s) => el.querySelector?.(s)?.scrollTop ?? 0), kept = HELD_BOXES.map((s) => el.querySelector?.(s)?.scrollTop ?? 0);
  draw();
  HELD_BOXES.forEach((s, i) => { const box = el.querySelector?.(s); if (!box) return; if (!same) showActive(box); else if (kept[i]) box.scrollTop = kept[i]; });
  if (!same) return;
  SCROLL_BOXES.forEach((s, i) => { const box = el.querySelector?.(s); if (box && held[i]) box.scrollTop = held[i]; });
}

/** A row whose whole name does not fit shows the first name as an initial ("O. Okongwu"), so the last name and the chips always
 *  show; a row that fits keeps the whole name. Measured after the draw, in the browser only. Returns how many it shortened. Every
 *  name is measured before any is changed: a change between two measures makes the browser lay the page out again, which at 150
 *  cards (1,200 names) took about 200 ms a draw. Each name's box is its own grid cell, so shortening one never moves another. */
export function fitNames(el) {
  const names = [...(el.querySelectorAll?.(".crow .pn[data-short]") ?? [])].filter((b) => b.textContent !== b.dataset.short);
  const cut = names.filter((b) => isCut(b));
  for (const b of cut) b.textContent = b.dataset.short;
  return cut.length;
}

/** True when the text of a name is wider than its box (the ellipsis is showing). scrollWidth is a whole number, so a name 0.4px too
 *  wide reads as fitting; the text's own width, measured with a range, is exact. */
export function isCut(b) {
  if (b.scrollWidth > b.clientWidth) return true;
  if (typeof document === "undefined" || !b.getBoundingClientRect) return false;
  const r = document.createRange();
  r.selectNodeContents(b);
  return r.getBoundingClientRect().width > b.getBoundingClientRect().width + 0.05;
}

// The page's fonts arrive in pieces (a weight is fetched when the first text in it is drawn), so a name measured right after a draw
// can change width a moment later: measure again when the fonts are ready, when any font finishes loading, and on the next frame.
const fitted = new Set();
let hooked = false;
export function refit(el) {
  fitNames(el);
  fitted.add(el);
  if (typeof document === "undefined") return;
  document.fonts?.ready.then(() => fitNames(el));
  if (!hooked && document.fonts?.addEventListener) { hooked = true; document.fonts.addEventListener("loadingdone", () => fitted.forEach((x) => fitNames(x))); }
  globalThis.requestAnimationFrame?.(() => fitNames(el));
}

const buildOf = (P, bid) => (P.builds ?? []).find((b) => b.id === bid);
/** The ids of the lineup a key names ("b:<build id>:<index>" built, "s:<saved id>" saved), or undefined. */
const idsOf = (P, key) => { const [kind, a, i] = key.split(":"); return kind === "b" ? buildOf(P, a)?.lineups[+i]?.ids : P.saved.find((l) => String(l.id) === a)?.slots; };

/** A card's own name, for a message that names it: a built lineup by its build's mode and time ("Cash 5:43 PM ET, Lineup 3"). */
const labelOf = (X, e) => (e?.kind === "saved" ? savedLabel(e.l, X.P.svNames, X.P.saved) : `${e?.mode} build of ${builtAtText(e?.builtAt)}, Lineup ${e?.n}`);

function download(X, entries, own) {
  const c = X.ctx();
  // A man a new pull took off the slate, or newly Out, or already Out when the lineup was built, is named before anything else is
  // checked: a built lineup by its frozen men against the board now (lineupRefusals) and the board's own Out status, a saved one by
  // the board now (savedRefusal). The file is named from what it holds, never from the panel's mode.
  const part = entries.every((e) => e.kind === "saved") ? "saved" : [...new Set(entries.map((e) => (e.kind === "saved" ? "saved" : e.mode)))].join("-");
  for (const e of entries) {
    const l = e.kind === "build" ? buildOf(X.P, e.bid)?.lineups[e.i] : null;
    const named = e.kind === "build" ? lineupRefusals(l?.men ?? l?.slots ?? [], c.byId, c.outNames) : [];
    const out = e.kind === "build" ? e.ids.map((id) => c.byId.get(id)).filter((p) => isOutNow(p) && !named.some((w) => w.startsWith(p.name))).map((p) => `${p.name} is Out`) : [];
    const words = [...named, ...out];
    const refused = e.kind === "build" ? (words.length ? `${labelOf(X, e)}: ${words.join(", ")}.` : null) : own.savedRefusal(e.l, c.byId, c.knownName);
    if (refused) return X.toast(`DK file not written. ${refused}`, "err");
  }
  const out = own.dkCsv(entries.map((e) => e.ids.map((id) => c.byId.get(id) ?? null)));
  // The file's problems count the lineups in the file; the message names the card Adam sees.
  if (!out.ok) return X.toast(`DK file not written. ${out.problems[0].replace(/^Lineup (\d+):/, (m, n) => `${labelOf(X, entries[+n - 1])}:`)}`, "err");
  own.saveFile(out.text, `${c.name}-${part}-${entries.length}lineups.csv`);
}

/** A swap's Use: the options are worked out again now (a game may have tipped since the tab drew), then the man goes in. A
 *  saved lineup changes on the page only (`swapped`, with the men as saved kept in `orig`); Save keeps it as a new saved lineup. */
function swapUse(X, key, inId, own) {
  const { P } = X, open = P.swap, ids = idsOf(P, key);
  const o = ids && open?.key === key ? swapOptions(ids, open.id, swapContext(X.ctx(), own.lateSwapSeat)) : null;
  P.swap = null;
  if (!o?.options.some((x) => x.p.dk_id === inId)) { X.toast("That swap is no longer legal; pick again."); return own.render(X); }
  const next = swapIds(o, inId);
  if (key[0] === "b") {
    // The lineup's frozen men are rebuilt with it: the men who stay keep the rows the build answered with, the man swapped in is
    // his row on the board now (frozen from here), so the card, the totals and the DK file check all follow the new men. The
    // build is kept again with the swap.
    const [, bid, idx] = key.split(":"), i = +idx, b = buildOf(P, bid), live = X.ctx().byId;
    const frozen = new Map((b.lineups[i].men ?? []).map((m) => [m.dk_id, m]));
    updateBuild(X, { ...b, lineups: b.lineups.map((l, j) => (j === i ? { ids: next, men: next.map((id) => frozen.get(id) ?? compactRow(live.get(id))) } : l)) }, own);
  } else P.saved = P.saved.map((l) => (String(l.id) === key.slice(2) ? { ...l, orig: l.orig ?? l.slots, slots: next, swapped: true } : l));
  own.render(X);
  X.onWork();
}

/** Compare's state with its ticks taken off (they are places in the list, which shift when a lineup or a build goes). */
const noPicks = (cmp) => (cmp ? { ...cmp, picks: [] } : cmp);

/** The panel on the mode of the lineup acted on (Late swap from a Cash card builds in Cash). */
function inModeOf(X, mode) {
  if (!mode || X.P.mode === mode) return;
  X.P.mode = mode;
  X.onMode(mode);
  X.onMemory();
}

// ---------- the latest build (kept per slate on the server, slate/builds.js) ----------
/** Reads the slate's builds (only while that slate is still on show). A build made here whose write has not landed stays in front.
 *  Until a read succeeds the list is unknown, never "none". */
export function readBuildsFor(X, name, own) {
  const { P } = X;
  const read = X.api(`/api/slate/${encodeURIComponent(name)}/builds`)
    .then((out) => { if (name === X.ctx().name) { Object.assign(P, { builds: mergeBuilds(P.builds ?? [], out.builds.map(fromRecord)), buildsReady: true, buildsError: null }); own.render(X); } })
    .catch((e) => { if (name === X.ctx().name) { Object.assign(P, { buildsReady: false, buildsError: e.message }); own.render(X); } })
    .finally(() => { if (P.buildsReading === read) P.buildsReading = null; });
  P.buildsReading = read;
  return read;
}

/** A panel click after a failed read of the builds tries it again. */
export function retryBuilds(X, own) {
  if (X.P.buildsError && !X.P.buildsReading && X.ctx().name) readBuildsFor(X, X.ctx().name, own);
}

/** Sends one change of the builds for the slate it was made on, behind the earlier ones of that slate. The page already shows it;
 *  a write that fails says so, and the build stays on the page for the time being. A write the server refused because it holds
 *  a newer build (NEWER_BUILD: made in another window), or no longer holds this one (NO_BUILD), reads the server's build back, so
 *  the page shows the newer one. */
const REPLACED = new Set(["NEWER_BUILD", "NO_BUILD"]);
function sendBuild(X, slate, body, own) {
  const { P } = X;
  const run = (P.buildQueue ?? Promise.resolve()).then(() => X.api(`/api/slate/${encodeURIComponent(slate)}/builds`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  const settled = run.then(() => ({}), (error) => ({ error }));
  P.buildQueue = settled;
  // A failed write is told whichever slate is showing now; the mark on the build's header is only for the slate on show.
  settled.then(({ error }) => {
    if (!error) return;
    const here = slate === X.ctx().name, id = body.put?.id;
    if (here && REPLACED.has(error.code)) {
      X.toast("This build was replaced by a newer one; the page now shows it.");
      if (id != null) P.builds = (P.builds ?? []).filter((x) => x.id !== id);
      P.swap = null;
      P.cmp = noPicks(P.cmp);
      readBuildsFor(X, slate, own);
      return;
    }
    X.toast(`Could not keep the build${here ? "" : ` on ${slate}`} on the server: ${error.message}`, "err");
    if (here && id != null && P.builds?.some((x) => x.id === id)) { P.builds = P.builds.map((x) => (x.id === id ? { ...x, notKept: true } : x)); X.redraw?.(); }
  });
}

/** A finished build replaces the build on the page (the latest of each mode stays: Cash and GPP builds never wipe each other) and on the server. It never
 *  touches the saved lineups: only Save does (savedClick). */
export function keepBuild(X, b, own) {
  X.P.builds = keepRecent([b, ...(X.P.builds ?? []).filter((x) => x.id !== b.id)]);
  sendBuild(X, X.ctx().name, { put: toRecord(b) }, own);
}
function updateBuild(X, b, own) {
  X.P.builds = X.P.builds.map((x) => (x.id === b.id ? b : x));
  sendBuild(X, X.ctx().name, { put: toRecord(b) }, own);
}
function dropBuild(X, id, own) {
  X.P.builds = X.P.builds.filter((x) => x.id !== id);
  sendBuild(X, X.ctx().name, { remove: id }, own);
}

// ---------- spots ----------
/** Reads the slate's spots from the server (only while that slate is still on show). Until a read succeeds the spots are unknown:
 *  no chips, no menu, never "none". */
export async function readSpotsFor(X, name, own) {
  const { P } = X;
  const read = X.api(`/api/slate/${encodeURIComponent(name)}/spots`)
    .then((out) => { if (name === X.ctx().name) { Object.assign(P, { spots: out.spots ?? {}, uploaded: out.uploaded ?? null, uploadEntries: out.entries ?? null, spotsReady: true, spotsError: null }); own.render(X); } })
    .catch((e) => { if (name === X.ctx().name) { Object.assign(P, { spotsReady: false, spotsError: e.message }); own.render(X); } })
    .finally(() => { if (P.spotsReading === read) P.spotsReading = null; });
  P.spotsReading = read;
  return read;
}

/** A panel click after a failed read of the spots tries it again. */
export function retrySpots(X, own) {
  if (X.P.spotsError && !X.P.spotsReading && X.ctx().name) readSpotsFor(X, X.ctx().name, own);
}

const EMPTY_SPOT = { lineup_id: null, slots: null, assigned_at: null };

/** Sends one spot change for the slate it was made on, behind the earlier ones of that slate (a new slate starts a new queue, so
 *  an old slate's answer never lands on the new one). The page has already shown the change; the server's file answers after, and
 *  only the last answer in the queue is drawn. A refused or failed write is read back from the server, never guessed. */
function sendSpot(X, slate, body, own, { onOk = null } = {}) {
  const { P } = X, gen = P.spotGen ?? 0;
  P.spotPending = (P.spotPending ?? 0) + 1;
  const run = (P.spotQueue ?? Promise.resolve()).then(() => X.api(`/api/slate/${encodeURIComponent(slate)}/spots`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  const settled = run.then((out) => ({ out }), (error) => ({ error }));
  P.spotQueue = settled;
  settled.then(({ out, error }) => {
    if (error && slate !== X.ctx().name) { X.toast(`Could not change the spot on ${slate}: ${error.message}`, "err"); return; } // the page has moved on, but the write still failed
    if (gen !== (P.spotGen ?? 0) || slate !== X.ctx().name) return;
    P.spotPending -= 1;
    if (error) {
      if (body.restore) P.spotUndo = null; // an undo that cannot be done is gone
      const moved = error.code === "SPOT_MOVED" || error.code === "SPOTS_CHANGED";
      X.toast(body.bulk && moved ? "The spots changed since this page read them; nothing was assigned. The page shows them as they are now."
        : body.restore && moved ? "The spots changed since that assignment; nothing was undone."
          : error.code === "SPOT_MOVED" ? "That spot moved to another lineup; the page shows where it is now." : `Could not change the spot: ${error.message}`, "err");
      return readSpotsFor(X, slate, own);
    }
    if (P.spotPending === 0) { P.spots = out.spots; own.render(X); }
    onOk?.(out);
  });
}

/** The plan Assign in order would carry out now, over the lineups shown in the order shown (the Saved view only). */
function orderPlan(X, own, skip = new Set()) {
  const { P } = X, m = viewModel(P, X.ctx(), (men) => own.lateSwapSeat(men));
  if (m.view !== "saved") return null;
  return { plan: planInOrder({ lineups: m.shown.map((e) => ({ id: e.id, swapped: e.swapped, mode: e.mode })), spots: P.spots, replace: P.lt.replace, skip, uploaded: P.uploaded ?? [] }), byId: new Map(m.shown.map((e) => [String(e.id), e])) };
}

/** Assign in order (Adam, 2026-11-04): the saved lineups shown take the GPP spots in turn, in one all-or-nothing call, with Undo.
 *  A lineup holding a man who is Out or off the board stops it before anything is sent: the alert lists them, and Adam assigns
 *  anyway or skips those. `confirmedAll`: he said assign anyway. */
async function assignInOrder(X, own, { skip = new Set(), confirmedAll = false } = {}) {
  const { P } = X, slate = X.ctx().name;
  if (!P.spotsReady) return;
  // The spots are read again first, behind every change still on its way, so the plan is made on what the server holds now (Cash set a moment ago, a
  // spot the late swap screen holds): never on a list the page read earlier.
  try { await P.spotQueue; } catch (e) { console.warn("A spot change failed before Assign in order:", e.message); } // its own failure was already said by sendSpot
  await readSpotsFor(X, slate, own);
  if (slate !== X.ctx().name || !P.spotsReady) return;
  if (P.uploaded === null) { X.toast("Assign in order waited: the late swap screen's state could not be read, so the spots holding the uploaded lineups are unknown.", "err"); return; }
  const got = orderPlan(X, own, skip);
  if (!got) return;
  const { plan, byId } = got;
  P.orderWarn = null;
  if (!plan.assignments.length) {
    const words = plan.skippedSwapped.length ? "a swapped lineup must be saved first."
      : plan.cashLeft.length && plan.cashLeft.length === got.byId.size ? "the lineups shown are Cash lineups, and Cash lineups are never put on GPP spots."
        : plan.keptUploaded.length ? `${plan.keptUploaded.join(", ")} still ${plan.keptUploaded.length === 1 ? "holds" : "hold"} the lineup from the uploaded DraftKings file; tick Replace current to give ${plan.keptUploaded.length === 1 ? "it" : "them"} a saved lineup.`
          : "every lineup shown already holds a spot, or no GPP spot is free (tick Replace current to give them anyway).";
    X.toast(`Nothing to assign: ${words} Save lineups first on the Recently generated tab, or upload your DraftKings entries file on the Late swap screen to get spots.`);
    return own.render(X);
  }
  const bad = plan.assignments.map((a) => ({ id: a.lineupId, e: byId.get(a.lineupId) })).map(({ id, e }) => ({ id, label: labelOf(X, e), men: unavailableMen(e.men) })).filter((b) => b.men.length);
  if (bad.length && !confirmedAll) { P.orderWarn = { bad: bad.map((b) => ({ id: b.id, label: b.label, names: b.men.map(unavailableLabel) })) }; return own.render(X); }
  const before = P.spots;
  P.spotUndo = null; P.spotMenu = null; P.spotWarn = null;
  const body = { bulk: { assignments: plan.assignments.map((a) => ({ spot: a.spot, lineup_id: a.lineupId })), expect: Object.fromEntries(plan.assignments.map((a) => [a.spot, before[a.spot]?.lineup_id ?? null])), confirmed: bad.map((b) => b.id) } };
  // The banner (with Undo) says what was done, so no message repeats it.
  sendSpot(X, X.ctx().name, body, own, { onOk: (out) => { P.spotUndo = { before, after: out.spots, text: orderSummary(plan, { entries: P.uploadEntries ?? null, spotCount: Object.keys(out.spots).filter((n) => !/^cash/i.test(n)).length }) }; own.render(X); } });
  own.render(X);
}

/** One click, no question (Adam, 2026-11-04): the spot goes to this lineup at once (from whichever lineup held it), or comes off it
 *  when it already holds it. The one exception is a lineup holding a man who is Out or off the board: an alert names him and one
 *  more click (spotforce) assigns. A swapped lineup that is not saved cannot take a spot. The saved lineup itself is never changed. */
function spotSet(X, id, spot, own, { force = false, confirmed = false } = {}) {
  const { P } = X, before = P.spots ?? {}, l = P.saved.find((x) => String(x.id) === String(id)), slate = X.ctx().name;
  if (!P.spotsReady) return;
  const mine = !force && before[spot]?.lineup_id === String(id);
  if (!mine && !l) return;
  if (!mine && l.swapped) { X.toast("Save this lineup first: a spot holds a saved lineup."); return; }
  let warned = false;
  if (!mine) {
    const c = X.ctx(), out = outNamesOfCtx(c);
    const base = l.orig ?? l.slots; // the names kept with the lineup line up with the men as saved
    const men = l.slots.map((x) => c.byId.get(x) ?? { dk_id: x, stale: true, name: l.names?.[base.indexOf(x)] ?? null });
    men.forEach((m) => { if (m.stale && m.name) m.out = out.has(String(m.name).trim().toLowerCase()); });
    const bad = unavailableMen(men);
    if (bad.length) {
      if (!confirmed) {
        P.spotWarn = { id: String(id), spot, names: bad.map(unavailableLabel) };
        P.spotMenu = String(id);
        own.render(X);
        return;
      }
      warned = true;
    }
  }
  P.spotWarn = null;
  P.spotMenu = null;
  P.spotText = null;
  P.spotUndo = null; // a single change ends the offer to undo the last Assign in order
  // Taking a spot another lineup holds says so and can be undone with the same Undo bar Assign in order uses.
  const prior = !mine && before[spot]?.lineup_id != null && before[spot].lineup_id !== String(id) ? P.saved.find((x) => String(x.id) === before[spot].lineup_id) : null;
  const tookFrom = prior ? savedLabel(prior, P.svNames, P.saved) : before[spot]?.lineup_id != null && !mine && before[spot].lineup_id !== String(id) ? "a deleted lineup" : null;
  P.spots = { ...before, [spot]: mine ? { ...EMPTY_SPOT } : { lineup_id: String(id), slots: [...l.slots], assigned_at: new Date().toISOString() } };
  own.render(X);
  const body = mine ? { release: spot, lineup_id: String(id) } : { assign: { spot, lineup_id: String(id), ...(warned ? { confirmed: true } : {}) } };
  sendSpot(X, slate, body, own, tookFrom ? { onOk: (out) => { P.spotUndo = { before, after: out.spots, text: `${spot} was ${tookFrom}'s; it now holds ${savedLabel(l, P.svNames, P.saved)}, and ${tookFrom} has no spot there.` }; own.render(X); } } : {});
}

/** Save on a swapped saved card: the swap becomes a new saved lineup and the old card goes back to its saved men. A spot the old
 *  lineup holds stays on it (the spot file keeps the saved men); the page says so and offers a one-click move, never moves it itself. */
async function saveSwapped(X, id, own) {
  const { P } = X, l = P.saved.find((x) => String(x.id) === String(id)), slate = X.ctx().name;
  if (!l) return;
  const had = new Set(P.saved.map((x) => String(x.id))), held = heldSpots(P.spots, l.id);
  const took = await savedCall(X, { slots: l.slots, mode: l.mode }, "save the lineup", own);
  if (!took || X.ctx().name !== slate) return; // a refused save leaves the swap as it is; the page moved to another slate while the save was out: nothing here belongs to the new one
  const made = P.saved.find((x) => !had.has(String(x.id)));
  if (!P.saved.some((x) => String(x.id) === String(l.id))) return; // the old card is gone from the list
  // Nothing new was stored (the swap equals a lineup already saved, as the toast said): the card goes back to the men it has saved, so it agrees with the file.
  P.saved = P.saved.map((x) => (String(x.id) === String(l.id) ? { ...x, slots: x.orig ?? x.slots, orig: undefined, swapped: false } : x));
  if (made && held.length) {
    P.spotMove = { fromId: String(l.id), toId: String(made.id), spots: held };
    X.toast(`${held.join(", ")} ${held.length === 1 ? "is" : "are"} still on the old lineup.`);
  }
  own.render(X);
}

/** Assign in order from a click: a failure is said, never left as an unhandled promise. */
function runOrder(X, own, opts) {
  assignInOrder(X, own, opts).catch((e) => { console.warn("Assign in order failed:", e.message); X.toast(`Assign in order failed: ${e.message}`, "err"); });
}

/** True when the click was one of the tab's. */
export function tabClick(X, d, own) {
  const { P } = X;
  const redraw = () => own.render(X);
  switch (d.op) {
    case "assignorder": runOrder(X, own); return true;
    case "orderreplace": P.lt.replace = !P.lt.replace; redraw(); return true;
    case "orderforce": runOrder(X, own, { confirmedAll: true }); return true;
    case "orderskip": runOrder(X, own, { skip: new Set((P.orderWarn?.bad ?? []).map((b) => b.id)) }); return true;
    case "ordercancel": P.orderWarn = null; redraw(); return true;
    case "lsoff": own.lateSwapOff(X); return true; // the way out of late swap mode, where the message says the tab is hidden
    case "orderokay": P.spotUndo = null; redraw(); return true;
    case "orderundo": {
      const u = P.spotUndo;
      if (!u) return true;
      P.spotUndo = null;
      sendSpot(X, X.ctx().name, { restore: { spots: u.before, expect: u.after } }, own, { onOk: () => X.toast("Undone on the Lineups tab: its spots are back as they were. The Late swap screen asks before it takes anything back.") });
      redraw();
      return true;
    }
    case "spotmenu": if (!P.spotsReady) return true; P.spotMenu = P.spotMenu === d.id ? null : d.id; P.spotWarn = null; P.spotText = null; redraw(); return true;
    case "spotset": spotSet(X, d.id, d.spot, own); return true;
    case "spotforce": spotSet(X, d.id, d.spot, own, { confirmed: true }); return true;
    case "spotcancel": P.spotWarn = null; redraw(); return true;
    case "spotadd": {
      const name = cleanSpotName((X.lel ?? X.el).querySelector?.(`[data-spotname="${CSS.escape(d.id)}"]`)?.value);
      if (name) spotSet(X, d.id, name, own, { force: true }); else X.toast("Type a spot name of 1 to 40 characters.");
      return true;
    }
    case "spotdrop": { // an empty spot's name goes
      if (!P.spotsReady || P.spots?.[d.spot]?.lineup_id !== null) return true;
      P.spots = Object.fromEntries(Object.entries(P.spots).filter(([n]) => n !== d.spot));
      redraw();
      sendSpot(X, X.ctx().name, { remove: d.spot }, own);
      return true;
    }
    case "spotmove": { // after a swapped save: the spots go to the new lineup, because Adam said so
      const mv = P.spotMove;
      P.spotMove = null;
      if (mv) mv.spots.forEach((s) => spotSet(X, mv.toId, s, own, { force: true }));
      redraw();
      return true;
    }
    case "spotmovex": P.spotMove = null; redraw(); return true;
    case "ltspot": P.lt.spot = d.s; redraw(); return true;
    case "ltview": P.lt = { ...P.lt, view: d.v, men: [] }; P.swap = null; redraw(); return true;
    case "opentab": P.lt = { ...P.lt, view: "build", men: [] }; redraw(); X.onView("lineups"); return true; // the panel's "N lineups built: open Lineups"
    case "bremove": {
      const b = buildOf(P, d.b);
      if (!b) return true;
      X.confirm(`Remove this build of ${b.lineups.length} lineup${b.lineups.length === 1 ? "" : "s"} from Recently generated? Saved lineups stay.`, { ok: "Remove" }).then((yes) => { if (yes) { P.swap = null; P.cmp = noPicks(P.cmp); dropBuild(X, b.id, own); own.render(X); X.onWork(); } });
      return true;
    }
    case "discard": { // takes the lineup off its build; a build with none left goes. The lineups after it shift, so Compare's ticks (by place) go.
      const b = buildOf(P, d.b), nb = b && withoutLineup(b, +d.i);
      if (!b) return true;
      P.swap = null;
      P.cmp = noPicks(P.cmp);
      if (nb) updateBuild(X, nb, own); else dropBuild(X, b.id, own);
      redraw(); X.onWork();
      return true;
    }
    // Save keeps the lineup in the mode of the build it came from, not the mode the panel is on now.
    case "savecard": { const b = buildOf(P, d.b), ids = b?.lineups[+d.i]?.ids; if (ids) savedClick(X, { op: "save" }, { ...own, saveIds: () => ids, saveMode: () => b.mode }); return true; }
    case "lscard": { // late swap from this lineup's men as the board has them now, in the lineup's own mode
      const b = buildOf(P, d.b), ids = b?.lineups[+d.i]?.ids, c = X.ctx();
      if (ids) { inModeOf(X, b.mode); own.lateSwapFrom(X, own.lateSwapSeat(ids.map((id) => c.byId.get(id) ?? { dk_id: id, stale: true })).men); }
      return true;
    }
    case "bdl": { // one build alone: its lineups shown, so another build's Out man cannot block this file
      const m = viewModel(P, X.ctx(), (men) => own.lateSwapSeat(men));
      const mine = m.shown.filter((e) => e.kind === "build" && e.bid === d.b);
      if (mine.length) download(X, mine, own);
      return true;
    }
    case "ltshow": P.lt.show = d.v === "compare" ? "compare" : "cards"; P.swap = null; redraw(); return true;
    case "cmp": P.cmp = compareClick(d, P.cmp ?? freshCompare()); redraw(); return true; // the Compare view's own controls (lineups-compare.js)
    case "menoff": P.lt.men = (P.lt.men ?? []).filter((x) => x !== d.man); redraw(); return true;
    case "ltgray": P.lt.gray = P.lt.gray !== true; redraw(); return true; // quick on/off, off on reload (Adam, 11-11)
    case "menclear": P.lt.men = []; redraw(); return true;
    case "ltsort": if (SORTS.some(([k]) => k === d.s)) Object.assign(P.lt, nextLtSort(P.lt, d.s)); redraw(); return true;
    case "ltmode": if (MODE_FILTERS.includes(d.m)) P.lt.mode = d.m; redraw(); return true;
    // Each Filter click adds a man (only lineups holding all of them show); clicking a filtered man again takes him out.
    case "expfilter": P.lt.men = (P.lt.men ?? []).includes(d.man) ? P.lt.men.filter((x) => x !== d.man) : [...(P.lt.men ?? []), d.man]; redraw(); return true;
    case "swap": P.swap = P.swap?.key === d.k && P.swap.id === d.id ? null : { key: d.k, id: d.id }; redraw(); return true;
    case "swapuse": swapUse(X, d.k, d.in, own); return true;
    case "ltcsv": { const m = viewModel(P, X.ctx(), (men) => own.lateSwapSeat(men)); download(X, m.shown, own); return true; }
    case "ltdl": { const m = viewModel(P, X.ctx(), (men) => own.lateSwapSeat(men)); const e = m.all.find((x) => x.key === d.k); if (e) download(X, [e], own); return true; }
    case "savesw": saveSwapped(X, d.id, own); return true;
    case "saveall": {
      const items = viewModel(P, X.ctx(), (men) => own.lateSwapSeat(men)).shown.filter((e) => e.kind === "build").map((e) => ({ slots: e.ids, mode: e.mode }));
      if (items.length) saveBatch(X, items, own);
      return true;
    }
    case "lssaved": {
      const l = P.saved.find((x) => String(x.id) === d.id), c = X.ctx();
      if (l) inModeOf(X, l.mode);
      if (l) own.lateSwapFrom(X, own.lateSwapSeat(l.slots.map((id) => c.byId.get(id) ?? { dk_id: id, stale: true })).men);
      return true;
    }
  }
  return false;
}

/** The filter box's typing; true when `el` is it. */
export function tabInput(X, el, own) {
  if (savedNameInput(X, el)) return true; // a saved lineup's name box
  if (el.dataset?.spotname != null) { X.P.spotText = { id: String(el.dataset.spotname), text: el.value }; return true; } // a typed spot name survives a redraw (a refresh, a message)
  if (el.dataset?.lt !== "q") return false;
  X.P.lt.q = el.value;
  own.render(X);
  return true;
}
