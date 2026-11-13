// The player card: a modal over the page when a player's name is clicked (optimizer standard C3). Esc, its Close or a click outside ends it, and the keyboard goes back where it was.
// Header (Lock / Exclude reuse the board's own data-lock / data-excl click path, so there is no second save path), the
// two figures his board row does not show (double-double and triple-double chance), the last-10 summary with a
// sparkline, the whole season's game log (in its own scroll box) from /api/player-log, then the seasons table and the
// efficiency chart (card-usage.js). One column, in that order. On the board, his role and minutes block (card-role.js) sits under the header. The header carries Sal, Proj, Own with their source and
// as-of time (optimizer standard A8), since a name in the lineup or the Out list may open a card with no row beside it.
// Every missing figure is the board's dash with a reason; nothing is ever zero-filled or borrowed from another player.
// The state (which player, which log) lives in createCardState and the markup in cardHtml, both DOM-free so the swap
// rule is tested: opening a player shows Loading at once, and a log that arrives for a card since closed or swapped is
// dropped (its request is also aborted).
import { esc, money, dec1, logo, isoToEastern, ICON, statusBadge, focusSelector, figSourceWord, hasHis } from "./board-util.js";
import { gamesProblem, usgCell, usgNote, MONTHS } from "./gamerow.js";
import { createUsageState, usageHtml, chartModel, fetchUsageHttp, closeUsageHttp, fetchedAt } from "./card-usage.js";
import { wireChart } from "./card-chart.js";
import { minGapOf, gapTitle } from "./player-table.js";

const prettyDate = (iso) => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso); return m ? `${MONTHS[+m[1] - 1]} ${+m[2]}` : iso; };
const LAST_N = 10; // the summary and sparkline cover this many of the most recent games; the log below lists them all
const mins = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** Last-10 summary: average DK points, average minutes, DK points per minute, over the games given. Null for no games. */
export function summarise(games) {
  if (!games.length) return null;
  const dk = games.reduce((s, g) => s + g.dk, 0), min = games.reduce((s, g) => s + g.min, 0);
  return { n: games.length, dk: dk / games.length, min: min / games.length, perMin: min > 0 ? dk / min : null };
}

/** A small inline SVG of DK points, oldest game on the left, with a dashed line at the average. */
export function sparkline(games) {
  const pts = games.map((g) => g.dk).reverse();
  if (!pts.length) return "";
  const W = 170, H = 34, pad = 4;
  const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
  const x = (i) => (pts.length === 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (pts.length - 1));
  const y = (v) => H - pad - ((v - lo) / span) * (H - 2 * pad);
  const avg = y(pts.reduce((s, v) => s + v, 0) / pts.length);
  const line = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = pts.length - 1;
  return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><line x1="${pad}" x2="${W - pad}" y1="${avg.toFixed(1)}" y2="${avg.toFixed(1)}" stroke="#ffb00066" stroke-dasharray="3 3"/>${pts.length > 1 ? `<polyline points="${line}" fill="none" stroke="var(--am)" stroke-width="1.8" stroke-linejoin="round"/>` : ""}<circle cx="${x(last).toFixed(1)}" cy="${y(pts[last]).toFixed(1)}" r="3.2" fill="var(--am)"/></svg>`;
}

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

/** The header's figures line: Sal, Proj, Min, Own, then their source and as-of time. Own and Proj follow Adam's typed
 *  numbers and bumps, and say so. figs: { source, asOf } (a null one is the board's dash). */
export function cardFiguresHtml(p, figs, dash) {
  const off = p.dk_id == null ? "he is on the Out list, not in this slate's player pool" : null;
  const num = (v, f, why) => (typeof v === "number" ? f(v) : dash(off ?? why));
  const sal = typeof p.salary === "number" ? money(p.salary) : p.salary_text ? esc(p.salary_text) : dash(off ?? "no salary in this slate file");
  const yours = (hasHis(p) ? " Proj and Own include your changes." : "") + (p.his_in_note ? ` ${esc(p.his_in_note)}` : "");
  const item = (label, html, src = "") => `<span>${label} <b>${html}</b>${src ? ` <small class="cfsrc">${src}</small>` : ""}</span>`;
  const srcOf = (kind, v) => (typeof v === "number" ? figSourceWord(p, kind) : "");
  const gap = minGapOf(p), gapHtml = gap ? `<span class="cfgap" title="${esc(gapTitle(gap))}">⚠ ${esc(gap.word ?? "Ours")} ${dec1(gap.ours)} vs TwoGun ${dec1(gap.tg)}</span>` : "";
  return `<div class="cfig"><div class="cfn">${item("Sal", sal)}${item("Proj", num(p.projection, dec1, "no projection in this pull"), srcOf("proj", p.projection))}${item("Min", num(p.minutes, dec1, "no projected minutes in this pull"), srcOf("min", p.minutes))}${gapHtml}${item("Own", num(p.proj_own, (v) => v.toFixed(1) + "%", "no projected ownership in this pull"))}</div>`
    + `<div class="cfs">Source: ${figs?.source ? esc(figs.source) : dash("no source in this slate file")}, as of ${figs?.asOf ? esc(figs.asOf) : dash("no board time in this slate file")}.${yours}</div></div>`;
}

/** Swaps only the header's status badge inside its stable wrapper (a mark moved while the card is open); nothing else in the card is redrawn, so a role box being typed in stays. Returns whether a wrapper was found. */
export function setBadge(root, p, inj) {
  const slot = root.querySelector("[data-cbadge]");
  if (!slot) return false;
  slot.innerHTML = statusBadge(p, inj);
  return true;
}

/** The card's markup for a player and log state. ctx: { dash(title), colourOf(team) -> {t1, t2}, picks: {locked, excluded},
 *  figs: {source, asOf} (the header's figures line), usage (card-usage.js state; default idle), ui (its tab choice) }.
 *  A man off the slate's player pool (the Out list: no dk_id) has no Lock or Exclude. */
export function cardHtml(p, log, { dash, colourOf, picks, figs = null, usage = { state: "idle" }, ui = { tab: "career", by: null }, roleSlot = false, inj = null }) {
  const pct = (v, why) => (typeof v === "number" ? v.toFixed(1) + "%" : dash(why));
  const header = () => {
    const c = colourOf(p.team), lk = picks.locked.includes(p.dk_id), ex = picks.excluded.includes(p.dk_id);
    const acts = p.dk_id == null ? "" : `<div class="acts"><button class="a-lk${lk ? " on" : ""}" data-lock="${esc(p.dk_id)}">${ICON.lock}${lk ? "Locked" : "Lock"}</button><button class="a-ex${ex ? " on" : ""}" data-excl="${esc(p.dk_id)}">${ICON.x}${ex ? "Excluded" : "Exclude"}</button></div>`;
    return `<div class="ch" style="--t1:${c.t1};--t2:${c.t2}">${logo(p.team, "xl")}<div class="id"><div class="l1"><span class="nm2" title="${esc(p.name)}">${esc(p.name)}</span><span data-cbadge>${statusBadge(p, inj)}</span></div>`
      + `<div class="l2">${p.positions?.length ? `<span class="pos">${esc(p.positions.join("/"))}</span>` : ""}<span class="ddtd"><span title="Double-double chance">DD <b>${pct(p.dd_pct, "no double-double chance in this pull")}</b></span> · <span title="Triple-double chance">TD <b>${pct(p.td_pct, "no triple-double chance in this pull")}</b></span></span></div></div>`
      + acts
      + `<button class="close" data-card-close title="Close (Esc)"><kbd>ESC</kbd>&#10005;</button>${cardFiguresHtml(p, figs, dash)}</div>`;
  };
  const logTable = (games) => `<table class="log"><thead><tr><th class="l">Date</th><th class="l">Opp</th><th class="l">Result</th><th>Min</th><th>Pts</th><th>Reb</th><th>Ast</th><th>3PM</th><th>Stl</th><th>Blk</th><th>TO</th><th title="Usage rate, Basketball-Reference game log">USG%</th><th class="s">DK</th></tr></thead><tbody>`
    + games.map((g) => `<tr><td class="d">${esc(prettyDate(g.date))}</td><td class="o">${esc(g.home_away)} ${esc(g.opp)}</td><td class="r ${g.result === "W" ? "w" : "l"}">${esc(g.result)} ${esc(g.score)}</td><td>${mins(g.min)}</td><td>${g.pts}</td><td>${g.reb}</td><td>${g.ast}</td><td>${g.fg3m}</td><td>${g.stl}</td><td>${g.blk}</td><td>${g.to}</td>${usgCell(g.date, usage, dash)}<td class="k">${g.dk.toFixed(2)}</td></tr>`).join("")
    + `</tbody></table>`;
  const lastTen = () => {
    if (log.state === "loading" || log.state === "idle") return `<div class="sec">Last 10 games</div><div class="cardmsg">Loading the game log…</div>`;
    if (log.state === "error") return `<div class="sec">Last 10 games</div><div class="cardmsg err">No game log for ${esc(p.name)}: ${esc(log.message)}</div>`;
    const games = log.data.games, recent = games.slice(0, LAST_N), s = summarise(recent); // the log is the whole season, newest first
    if (!s) return `<div class="sec">Last 10 games</div><div class="cardmsg">${esc(p.name)} has no regular-season games this season yet (${esc(log.data.source)} lists none).</div>`;
    return `<div class="sec">Last ${s.n === LAST_N ? LAST_N : s.n} game${s.n === 1 ? "" : "s"}</div><div class="avgrow"><div class="avg"><span><small>Avg DK</small><b>${s.dk.toFixed(1)}</b></span><span><small>Min</small><b>${s.min.toFixed(1)}</b></span><span><small>DK / min</small><b>${s.perMin == null ? dash("no minutes in these games") : s.perMin.toFixed(2)}</b></span></div><span class="sparkbox">${sparkline(recent)}</span></div>`
      + `<div class="sec">This season's games<span class="hint">${games.length} game${games.length === 1 ? "" : "s"}, newest first</span></div><div class="logscroll">${logTable(games)}</div>${usgNoteHtml(games)}`;
  };
  const usgNoteHtml = (games) => { const n = usgNote(games, usage); return n ? `<div class="ue-warn logwarn">${esc(n)}</div>` : ""; };
  return header() + (roleSlot ? `<div class="crole" data-crole></div>` : "") + lastTen() + usageHtml(p, usage, ui, { dash });
}

const fetchLogHttp = async (p, signal) => {
  const r = await fetch(`/api/player-log?name=${encodeURIComponent(p.name)}&team=${encodeURIComponent(p.team)}`, { signal });
  return { status: r.status, ok: r.ok, text: await r.text() };
};

/** The card's max-height in its own (zoomed) CSS pixels, from screen-pixel measures: the room runs from where its top is
 *  (never above its 12 CSS px offset) to the lower of the screen bottom and `colBottom`, less a 12 CSS px margin. Floor 240.
 *  Pure, tested. */
export function cardMaxHeight({ top, colBottom, viewHeight, zoom }) {
  const gap = 12 * zoom;
  return Math.max(240, Math.floor((Math.min(viewHeight, colBottom) - Math.max(top, gap) - gap) / zoom));
}

/** Caps the open card so its bottom never passes the bottom of the screen and its top (the header with Close) stays on
 *  screen. Under the wide-screen body zoom the rectangles and the viewport are in screen pixels while max-height is in the
 *  zoomed box's own, so the zoom is read as rect width / layout width. view: the window. */
export function fitCard(el, view = window) {
  if (el.hidden) return;
  const r = el.getBoundingClientRect(), z = el.offsetWidth ? r.width / el.offsetWidth : 1;
  el.style.maxHeight = `${cardMaxHeight({ top: r.top, colBottom: Infinity, viewHeight: view.innerHeight, zoom: z })}px`;
}

/** The card's left edge in its own (zoomed) CSS pixels: the optimizer column's, pulled in so the whole card stays on screen. Pure, tested. */
export const cardLeft = ({ panelLeft, cardWidth, viewWidth, zoom }) => Math.max(12, Math.floor(Math.min(panelLeft, viewWidth - cardWidth - 12 * zoom) / zoom));

/** Wires the card. ctx: { root (element the card is added to), dash(title), colourOf(team), picks() -> {locked, excluded},
 *  figs() -> {source, asOf}, current(p) -> the player as the board holds him now (his figures follow an override),
 *  roles(p, slot) -> draws his role and minutes block (card-role.js) into the slot under the header, when given }. */
export function initCard({ root, dash, colourOf, picks, figs = () => null, current = (p) => p, roles = null, marks = () => null }) {
  const el = document.createElement("div");
  el.className = "card";
  el.id = "card";
  el.hidden = true;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  const bg = document.createElement("div");
  bg.className = "cardbg";
  bg.hidden = true;
  root.append(bg, el);
  let back = null; // what had the keyboard when the card opened: the control, and how to find it again after a redraw
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
  const place = () => {
    if (el.hidden) return;
    const r = el.getBoundingClientRect(), z = el.offsetWidth ? r.width / el.offsetWidth : 1;
    const panel = document.getElementById("opt")?.getBoundingClientRect();
    // The panel column is hidden on the Console and Late swap screens: the card then sits at the right edge of the window.
    if (panel?.width) el.style.left = `${cardLeft({ panelLeft: panel.left, cardWidth: r.width, viewWidth: window.innerWidth, zoom: z })}px`;
    else el.style.left = `${cardLeft({ panelLeft: window.innerWidth, cardWidth: r.width, viewWidth: window.innerWidth, zoom: z })}px`;
    fitCard(el);
  };
  const render = () => {
    const p = state.player && current(state.player);
    const opening = Boolean(p) && el.hidden;
    if (opening) remember();
    const inCard = el.contains(document.activeElement); // the log and the figures redraw it as they arrive: the keyboard stays in it
    // A redraw keeps where he was: the card's scroll, the game log's own, and the control that had the keyboard.
    const held = { top: el.scrollTop, log: el.querySelector(".logscroll")?.scrollTop ?? 0, sel: inCard ? focusSelector(document.activeElement) : null };
    el.hidden = !p;
    bg.hidden = !p;
    document.body.classList.toggle("noscroll", Boolean(p)); // the page behind stays where it is
    el.innerHTML = p ? cardHtml(p, state.log, { dash, colourOf, picks: picks(), figs: figs(), usage: usage.usage, ui: usage.ui, roleSlot: Boolean(roles), inj: marks(p.dk_id)?.inj ?? null }) : "";
    if (p && roles) roles(p, el.querySelector("[data-crole]"));
    place();
    if (p && !opening) {
      el.scrollTop = held.top;
      const log = el.querySelector(".logscroll");
      if (log) log.scrollTop = held.log;
    }
    if (opening || (p && inCard)) (held.sel && !opening && el.querySelector(held.sel) || el.querySelector("[data-card-close]"))?.focus({ preventScroll: true });
    if (!p) giveBack();
    const box = el.querySelector(".ue-chart"); // the usage chart, when drawn: hook its crosshair and tooltip
    if (box) wireChart(box, chartModel(usage.usage.data, usage.ui));
  };
  const usage = createUsageState({ fetchUsage: fetchUsageHttp, closeUsage: closeUsageHttp, onChange: () => { if (state.player) render(); } });
  const state = createCardState({ fetchLog: fetchLogHttp, onChange: render });
  const close = () => { usage.close(); state.close(); };
  bg.addEventListener("click", close);
  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-card-close]")) return close();
    const tab = e.target.closest("[data-ue-tab]"), by = e.target.closest("[data-ue-by]");
    if (tab) { usage.ui.tab = tab.dataset.ueTab; render(); }
    if (by) { usage.ui.by = by.dataset.ueBy; render(); }
  });
  document.addEventListener("keydown", (e) => {
    if (!state.player) return;
    if (e.key === "Escape") return close();
    if (e.key !== "Tab" || document.querySelector(".cfm")) return;
    // Tab goes round inside the open card, as the confirm's does.
    e.preventDefault();
    const list = [...el.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!list.length) return;
    list[(list.indexOf(document.activeElement) + (e.shiftKey ? list.length - 1 : 1)) % list.length].focus();
  });
  window.addEventListener("resize", place, { passive: true });
  return {
    /** Opens the card for a slate player (swaps it when already open); the usage figures load beside the game log. */
    open(p) { if (!p) return; usage.open(p); state.open(p); },
    close,
    /** Redraws the header's Lock / Exclude state after picks change. */
    refresh() { if (state.player) render(); },
    /** A mark moved (the news-aware status): only the header badge is swapped. */
    badge() { const p = state.player && current(state.player); if (p) setBadge(el, p, marks(p.dk_id)?.inj ?? null); },
  };
}
