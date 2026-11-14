// The player panel (Layout A+C, Adam 11-13): docked on the right of the board when a player's name is clicked; the table shrinks beside it and
// stays live. Esc or its Close ends it, and the keyboard goes back where it was. Top to bottom: header (Lock / Exclude reuse the board's own
// data-lock / data-excl click path, so there is no second save path, with double-double and triple-double chance), Tonight and Stats figure
// tiles (card-tiles.js), his role and minutes block (card-role.js) beside his News in full, the last-10 bars, the whole season's game log (its own
// scroll box) from /api/player-log, then the seasons table and the efficiency chart (card-usage.js), and the figures' source and as-of time (optimizer
// standard A8), since a name in the lineup or the Out list may open a panel with no row beside it.
// Every missing figure is the board's dash with a reason; nothing is ever zero-filled or borrowed from another player.
// The state (which player, which log) lives in createCardState and the markup in cardHtml, both DOM-free so the swap
// rule is tested: opening a player shows Loading at once, and a log that arrives for a panel since closed or swapped is
// dropped (its request is also aborted).
import { esc, logo, ICON, statusBadge, focusSelector } from "./board-util.js";
import { gamesProblem, usgCell, usgNote, MONTHS } from "./gamerow.js";
import { createUsageState, usageHtml, chartModel, fetchUsageHttp, closeUsageHttp, fetchedAt } from "./card-usage.js";
import { wireChart } from "./card-chart.js";
import { cardTilesHtml, cardSourceHtml, newsHtml, barChartHtml, summarise, LAST_N } from "./card-tiles.js";

const prettyDate = (iso) => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso); return m ? `${MONTHS[+m[1] - 1]} ${+m[2]}` : iso; };
const mins = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** The server's answer -> the card's log state: { state: "ok", data } or { state: "error", message }. A 200 whose body
 *  is not JSON, or has no games list or source, is an error: the card never draws a log it cannot read. */
export function readLogResponse(status, ok, text) {
  let body, parseError = null;
  try {
    body = JSON.parse(text);
  } catch (e) {
    parseError = e.message;
  }
  if (!ok) {
    if (parseError) return { state: "error", message: `HTTP ${status} (its error could not be read: ${parseError})` };
    return { state: "error", message: body?.error?.message ?? `HTTP ${status}` };
  }
  if (parseError) return { state: "error", message: `the server sent an unreadable game log (${parseError})` };
  if (!body || !Array.isArray(body.games) || typeof body.source !== "string") return { state: "error", message: "the server sent an unreadable game log" };
  const why = gamesProblem(body.games);
  if (why) return { state: "error", message: `the server sent an unreadable game log (${why})` };
  return { state: "ok", data: body };
}

/** The card's state, DOM-free. fetchLog(player, signal) -> Promise<{ status, ok, text }>; onChange() is called after
 *  every change. Opening a player sets Loading and a new ticket before anything is drawn, so a swap never shows the
 *  previous player's games; an answer whose ticket is stale is dropped. */
export function createCardState({ fetchLog, onChange = () => {} }) {
  let player = null, log = { state: "idle" }, ticket = 0, ctl = null;
  const stop = () => { ticket++; if (ctl) ctl.abort(); ctl = null; };
  async function load(p, mine, signal) {
    let next;
    try {
      const r = await fetchLog(p, signal);
      next = readLogResponse(r.status, r.ok, r.text);
    } catch (e) {
      next = { state: "error", message: `the board server could not be reached (${e.message})` };
    }
    if (mine !== ticket) return; // the card was closed or swapped while this was in flight
    log = next;
    try {
      onChange();
    } catch (e) {
      // A log the card cannot draw becomes the error state, so the card never stays on Loading.
      log = { state: "error", message: `the game log could not be drawn (${e.message})` };
      onChange();
    }
  }
  return {
    get player() { return player; },
    get log() { return log; },
    /** Opens the card for a slate player, or swaps it when one is already open. Returns the load's promise. */
    open(p) {
      if (!p) return Promise.resolve();
      stop();
      const mine = ticket;
      ctl = typeof AbortController === "function" ? new AbortController() : null;
      player = p;
      log = { state: "loading" };
      onChange();
      return load(p, mine, ctl?.signal);
    },
    close() { stop(); player = null; log = { state: "idle" }; onChange(); },
  };
}

/** The source named under the card's figures, from what the slate file says its salary, projection and ownership
 *  came from: "TwoGun NBA board" for every TwoGun read, else the file's own words, else null. */
export function figureSource(slate) {
  const s = slate?.sources ?? {};
  const said = [s.salary, s.projection, s.proj_own].filter((t) => typeof t === "string" && !t.startsWith("none"));
  if (!said.length) return null;
  return said.some((t) => /board\.csv|board_row|get_nba|twogun/i.test(t)) ? "TwoGun NBA board" : said[0];
}

/** Swaps only the header's status badge inside its stable wrapper (a mark moved while the card is open); nothing else in the card is redrawn, so a role box being typed in stays. Returns whether a wrapper was found. */
export function setBadge(root, p, inj) {
  const slot = root.querySelector("[data-cbadge]");
  if (!slot) return false;
  slot.innerHTML = statusBadge(p, inj);
  return true;
}

/** The panel's markup for a player and log state. ctx: { dash(title), colourOf(team) -> {t1, t2}, picks: {locked, excluded},
 *  figs: {source, asOf} (the source line at the foot), usage (card-usage.js state; default idle), ui (its tab choice), roleSlot (draw the role block's slot),
 *  inj (the news ruling for his badge), news (his newest status card, shown whole in the News box) }.
 *  A man off the slate's player pool (the Out list: no dk_id) has no Lock or Exclude. */
export function cardHtml(p, log, { dash, colourOf, picks, figs = null, usage = { state: "idle" }, ui = { tab: "career", by: null }, roleSlot = false, inj = null, news = null, newsState = null }) {
  const pct = (v, why) => (typeof v === "number" ? v.toFixed(1) + "%" : dash(why));
  const header = () => {
    const c = colourOf(p.team), lk = picks.locked.includes(p.dk_id), ex = picks.excluded.includes(p.dk_id);
    const acts = p.dk_id == null ? "" : `<div class="acts"><button class="a-lk${lk ? " on" : ""}" data-lock="${esc(p.dk_id)}">${ICON.lock}${lk ? "Locked" : "Lock"}</button><button class="a-ex${ex ? " on" : ""}" data-excl="${esc(p.dk_id)}">${ICON.x}${ex ? "Excluded" : "Exclude"}</button></div>`;
    return `<div class="ch" style="--t1:${c.t1};--t2:${c.t2}">${logo(p.team, "xl")}<div class="id"><div class="l1"><span class="nm2" title="${esc(p.name)}">${esc(p.name)}</span><span data-cbadge>${statusBadge(p, inj)}</span></div>`
      + `<div class="l2"><span class="ptm">${esc(p.team)}${p.oppText ? ` ${esc(p.oppText)}` : ""}</span>${p.positions?.length ? `<span class="pos">${esc(p.positions.join("/"))}</span>` : ""}<span class="ddtd"><span title="Double-double chance">DD <b>${pct(p.dd_pct, "no double-double chance in this pull")}</b></span> · <span title="Triple-double chance">TD <b>${pct(p.td_pct, "no triple-double chance in this pull")}</b></span></span></div></div>`
      + acts
      + `<button class="close" data-card-close title="Close (Esc)"><kbd>ESC</kbd>&#10005;</button></div>`;
  };
  const logTable = (games) => `<table class="log"><thead><tr><th class="l">Date</th><th class="l">Opp</th><th class="l">Result</th><th>Min</th><th>Pts</th><th>Reb</th><th>Ast</th><th>3PM</th><th>Stl</th><th>Blk</th><th>TO</th><th title="Usage rate, Basketball-Reference game log">USG%</th><th class="s">DK</th></tr></thead><tbody>`
    + games.map((g) => `<tr><td class="d">${esc(prettyDate(g.date))}</td><td class="o">${esc(g.home_away)} ${esc(g.opp)}</td><td class="r ${g.result === "W" ? "w" : "l"}">${esc(g.result)} ${esc(g.score)}</td><td>${mins(g.min)}</td><td>${g.pts}</td><td>${g.reb}</td><td>${g.ast}</td><td>${g.fg3m}</td><td>${g.stl}</td><td>${g.blk}</td><td>${g.to}</td>${usgCell(g.date, usage, dash)}<td class="k">${g.dk.toFixed(2)}</td></tr>`).join("")
    + `</tbody></table>`;
  const lastTen = () => {
    if (log.state === "loading" || log.state === "idle") return `<div class="sec">Last 10 games</div><div class="cardmsg">Loading the game log…</div>`;
    if (log.state === "error") return `<div class="sec">Last 10 games</div><div class="cardmsg err">No game log for ${esc(p.name)}: ${esc(log.message)}</div>`;
    const games = log.data.games, recent = games.slice(0, LAST_N), s = summarise(recent); // the log is the whole season, newest first
    if (!s) return `<div class="sec">Last 10 games</div><div class="cardmsg">${esc(p.name)} has no regular-season games this season yet (${esc(log.data.source)} lists none).</div>`;
    return `<div class="psec"><h3>Last ${s.n === LAST_N ? LAST_N : s.n} game${s.n === 1 ? "" : "s"} (DK pts)</h3>${barChartHtml(recent)}</div>`
      + `<div class="sec">This season's games<span class="hint">${games.length} game${games.length === 1 ? "" : "s"}, newest first</span></div><div class="logscroll">${logTable(games)}</div>${usgNoteHtml(games)}`;
  };
  const usgNoteHtml = (games) => { const n = usgNote(games, usage); return n ? `<div class="ue-warn logwarn">${esc(n)}</div>` : ""; };
  const two = `<div class="two">${roleSlot ? `<div class="crole" data-crole></div>` : ""}${newsHtml(p, news, dash, newsState)}</div>`;
  return header() + `<div class="pbody">${cardTilesHtml(p, log, { dash, inj })}${two}${lastTen()}${usageHtml(p, usage, ui, { dash })}${cardSourceHtml(p, figs, dash)}</div>`;
}

const fetchLogHttp = async (p, signal) => {
  const r = await fetch(`/api/player-log?name=${encodeURIComponent(p.name)}&team=${encodeURIComponent(p.team)}`, { signal });
  return { status: r.status, ok: r.ok, text: await r.text() };
};

/** Whether an Escape key press closes the open panel. It does not while a confirm is up (Esc answers that), when something else already took the key,
 *  or in a text box of the page behind it (a cell editor's Esc cancels its edit); a box inside the panel closes it. Pure, tested. */
export function escapeCloses({ key, defaultPrevented = false, confirmOpen = false, inPanel = false, typing = false }) {
  return key === "Escape" && !defaultPrevented && !confirmOpen && (inPanel || !typing);
}

/** Wires the panel. ctx: { root (element the panel is added to), dash(title), colourOf(team), picks() -> {locked, excluded},
 *  figs() -> {source, asOf}, current(p) -> the player as the board holds him now (his figures follow an override),
 *  roles(p, slot) -> draws his role and minutes block (card-role.js) into the slot beside his news, when given,
 *  marks(id) -> the board's marks for him ({ inj, news }), onDock(open) -> called after the panel opens or closes (the page beside it changes width) }.
 *  Open: body gets "card-docked" and board.css makes room for the panel on the right; the page stays live and scrolls on its own. */
export function initCard({ root, dash, colourOf, picks, figs = () => null, current = (p) => p, roles = null, marks = () => null, newsState = () => null, onDock = () => {} }) {
  const el = document.createElement("aside");
  el.className = "card";
  el.id = "card";
  el.hidden = true;
  el.setAttribute("aria-label", "Player panel");
  root.append(el);
  let back = null; // what had the keyboard when the panel opened: the control, and how to find it again after a redraw
  let shown = null; // the dk_id (or name) on show, so a swap starts at the top and a redraw for the same man keeps his place
  const remember = () => {
    const a = document.activeElement;
    back = a && a !== document.body ? { el: a, sel: focusSelector(a) } : null;
  };
  const giveBack = () => {
    if (!back) return;
    const panel = document.getElementById("opt");
    const to = back.el.isConnected ? back.el : (back.sel && document.querySelector(back.sel)) || panel;
    if (to === panel) panel?.setAttribute("tabindex", "-1");
    to?.focus({ preventScroll: true });
    back = null;
  };
  // The panel's right:0 (board.css) is already measured from the inside edge of the page's scroll bar, so it needs no offset of its own.
  // His row in the table behind is lit while his panel is open. A style rule, not a class, so every redraw of the rows keeps it.
  const lit = document.createElement("style");
  root.append(lit);
  const mark = (p) => {
    const row = p && p.dk_id != null ? `tr[data-row="${CSS.escape(String(p.dk_id))}"]` : null;
    lit.textContent = row ? `${row} td{background-color:color-mix(in srgb,var(--am) 9%,transparent)!important}${row} td:first-child{box-shadow:inset 3px 0 var(--am)!important}` : "";
  };
  const render = () => {
    const p = state.player && current(state.player);
    const opening = Boolean(p) && el.hidden, closing = !p && !el.hidden;
    if (opening) remember();
    const inCard = el.contains(document.activeElement); // the log and the figures redraw it as they arrive: the keyboard stays in it
    const who = p ? String(p.dk_id ?? p.name) : null, same = who !== null && who === shown;
    // A redraw keeps where he was: the panel's scroll, the game log's own, and the control that had the keyboard.
    const held = { top: el.querySelector(".pbody")?.scrollTop ?? 0, log: el.querySelector(".logscroll")?.scrollTop ?? 0, sel: inCard ? focusSelector(document.activeElement) : null };
    el.hidden = !p;
    document.body.classList.toggle("card-docked", Boolean(p));
    shown = who;
    mark(p);
    const m = p ? marks(p.dk_id) : null;
    el.innerHTML = p ? cardHtml(p, state.log, { dash, colourOf, picks: picks(), figs: figs(), usage: usage.usage, ui: usage.ui, roleSlot: Boolean(roles), inj: m?.inj ?? null, news: m?.news ?? null, newsState: newsState() }) : "";
    if (p && roles) roles(p, el.querySelector("[data-crole]"));
    if (p && same) {
      const body = el.querySelector(".pbody");
      if (body) body.scrollTop = held.top;
      const log = el.querySelector(".logscroll");
      if (log) log.scrollTop = held.log;
    }
    if (opening || (p && inCard && same)) (held.sel && !opening && el.querySelector(held.sel) || el.querySelector("[data-card-close]"))?.focus({ preventScroll: true });
    if (!p) giveBack();
    if (opening || closing) onDock(Boolean(p));
    const box = el.querySelector(".ue-chart"); // the usage chart, when drawn: hook its crosshair and tooltip
    if (box) wireChart(box, chartModel(usage.usage.data, usage.ui));
  };
  const usage = createUsageState({ fetchUsage: fetchUsageHttp, closeUsage: closeUsageHttp, onChange: () => { if (state.player) render(); } });
  const state = createCardState({ fetchLog: fetchLogHttp, onChange: render });
  const close = () => { usage.close(); state.close(); };
  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-card-close]")) return close();
    const tab = e.target.closest("[data-ue-tab]"), by = e.target.closest("[data-ue-by]");
    if (tab) { usage.ui.tab = tab.dataset.ueTab; render(); }
    if (by) { usage.ui.by = by.dataset.ueBy; render(); }
  });
  document.addEventListener("keydown", (e) => {
    if (!state.player) return;
    const t = e.target, typing = Boolean(t?.matches?.("input, textarea, select, [contenteditable]"));
    if (escapeCloses({ key: e.key, defaultPrevented: e.defaultPrevented, confirmOpen: Boolean(document.querySelector(".cfm")), inPanel: el.contains(t), typing })) close();
  });
  return {
    /** Opens the panel for a slate player (swaps it when already open); the usage figures load beside the game log. */
    open(p) { if (!p) return; usage.open(p); state.open(p); },
    close,
    /** Redraws the header's Lock / Exclude state after picks change. */
    refresh() { if (state.player) render(); },
    /** A mark moved (the news-aware status): only the header badge and the News box are swapped, so a role box being typed in stays. */
    badge() {
      const p = state.player && current(state.player);
      if (!p) return;
      const m = marks(p.dk_id);
      setBadge(el, p, m?.inj ?? null);
      const box = el.querySelector("[data-cnews]");
      if (box) box.outerHTML = newsHtml(p, m?.news ?? null, dash, newsState());
    },
  };
}

