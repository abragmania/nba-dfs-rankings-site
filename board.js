// The NBA board page: loads a slate from the API and draws the header, games strip, player table, Out chips and optimizer panel.
// Every figure is read from the slate file or its route as given; a missing one is shown as an em dash with a title, never zero.
import { paletteOf, teamColors } from "./teams.js";
import { assignColours } from "./colours.js";
import { esc, logo, tipWhen, isoToEastern, ICON, topStamps, keepFocus } from "./board-util.js";
import { createPanel, fullScreenPref } from "./panel.js";
import { tiers, notes } from "./highlight.js";
import { initCard, figureSource } from "./card.js";
import { cardRoles } from "./card-role.js";
import { bumpPatch, delegateBumpClicks } from "./bump-control.js";
import { createEditors } from "./cell-editor.js";
import { askConfirm, CONFIRM } from "./confirm.js";
import { columnsControl, sortNote } from "./columns.js";
import { headHtml, rowHtml, SORT_KEYS, comparePlayers, hasResettable } from "./player-table.js";
import { pullChipHtml, pullNoteHtml } from "./pull-note.js";
import { CHECK_MS, applyHeld, createRefresher, mergeFresh, outNamesOf, overrideKey, picksOnBoard, pullOf, rememberRows, rosterCleanup, statusLine } from "./slate-refresh.js";
import { pressSettle } from "./press-settle.js";
import { createPullNow } from "./pull-now.js";
import { noFilters, filtersOn, filterPlayers, salaryRange, teamsOf } from "./filters.js";
import { limitPatch } from "./row-limits.js";
import { loadView, saveView, DEFAULT_SORT } from "./view-memory.js";
import { loadTheme, saveTheme, themeClasses, themeHtml } from "./theme.js";
import { createConsole } from "./console.js";
import { createLineupBar } from "./lineup-bar.js";
import { createBoardMarks } from "./board-marks.js";
import { mountLateSwap } from "./lsw-main.js";

const $ = (id) => document.getElementById(id);
const TABS = ["ALL", "PG", "SG", "SF", "PF", "C", "G", "F"];
const SINGLE = ["PG", "SG", "SF", "PF", "C"];
/** The slate's assigned colours for a team, {t1, t2}; the fixed table's colours if the team is not on the slate. */
const colourOf = (t) => (S.colours?.[t] ? { t1: S.colours[t].main, t2: S.colours[t].second } : teamColors(t));

const S = { slates: [], name: null, slate: null, players: [], byId: new Map(), picks: { locked: [], excluded: [] }, dropped: [], ...noFilters(), sort: { ...DEFAULT_SORT }, outOpen: true, held: new Map(), known: new Map(), outNames: new Set(), refreshGen: 0, topStale: false, consolePull: null, rosterDropped: [], upd: { updatedMs: null, failed: null, waiting: false, added: [], removed: [] } };
/** The picks as the board acts on them (slate-refresh.js picksOnBoard). */
const livePicks = () => picksOnBoard(S.picks, S.byId);
/** A man's name, on the slate or remembered from an earlier pull this page held; his id when never seen. */
const nameOf = (id) => S.byId.get(id)?.name ?? S.known.get(id)?.name ?? `DraftKings id ${id}`;

// Browser storage holds per-viewer conveniences only (theme, the optimizer's typed settings), the one use the storage
// rule allows; when it throws (private window, blocked site data) the page works without it and says so in the console.
const tryStore = (fn) => { try { return fn(); } catch (e) { console.warn("Browser storage unavailable:", e.message); return null; } };
// A message sits beside the control just clicked (the row, slot or button), amber for a notice and red only for an error
// (kind "err"); with no clicked control on the page it sits at the bottom. It ends by itself after 4 seconds.
let lastClick = null; // { el, rect, sel }: the clicked control, where it was, and a selector to find it again after a redraw
document.addEventListener("click", (e) => {
  if (e.target.closest?.(".cfm")) return; // a confirm's answer: the message that follows belongs beside the control that asked
  const el = e.target.closest?.("tr[data-row], .slot, .lslot, .lr, button, .gorun") ?? null;
  if (!el) { lastClick = null; return; }
  const key = ["data-row", "data-lock", "data-op", "data-i", "data-id"].filter((k) => el.hasAttribute(k)).map((k) => `[${k}="${CSS.escape(el.getAttribute(k))}"]`).join("");
  lastClick = { el, rect: el.getBoundingClientRect(), sel: key ? `${el.tagName.toLowerCase()}${key}` : null };
}, true);
const toast = (msg, kind = "notice") => {
  const t = $("toast");
  t.textContent = msg; t.className = `toast${kind === "err" ? " err" : ""}`; t.style.cssText = ""; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 4000);
  if (document.body.classList.contains("lineups-on")) return; // on the Lineups tab a message sits at the bottom, over no switch, filter or button
  const z = parseFloat(getComputedStyle(document.body).zoom) || 1; // 1 now that the page has no zoom; kept so rects stay in screen pixels if one returns
  const W = window.innerWidth / z, H = window.innerHeight / z;
  const live = lastClick && (lastClick.el.isConnected ? lastClick.el : lastClick.sel ? document.querySelector(lastClick.sel) : null);
  const r = live ? live.getBoundingClientRect() : lastClick?.rect;
  if (!r || !r.width || r.bottom < 0 || r.top > window.innerHeight) return; // no control on screen: the bottom position
  const a = { left: r.left / z, top: r.top / z, bottom: r.bottom / z };
  const h = t.offsetHeight, w = Math.min(t.offsetWidth, W - 24);
  const top = a.bottom + 4 + h > H - 8 ? Math.max(8, a.top - h - 4) : a.bottom + 4;
  t.style.cssText = `left:${Math.max(12, Math.min(a.left + 16, W - w - 12))}px;top:${top}px;bottom:auto;transform:none`;
};
const api = async (url, opts) => {
  const r = await fetch(url, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error?.message ?? `HTTP ${r.status}`), { code: body.error?.code });
  return body;
};
const dash = (title) => `<span class="miss" title="${esc(title)}">—</span>`;
/** A slate stamp in Eastern time; the slate's own date (from its name) settles the year TwoGun's stamps leave out. */
const when = (s) => tipWhen(S.name)(s);
// The player card (card.js); it closes itself on Esc. A man's header figures follow the board's copy of him (a man from the
// Out list has none and stays as he was opened).
const card = initCard({ root: document.querySelector(".work"), dash, colourOf, picks: () => S.picks,
  figs: () => ({ source: figureSource(S.slate), asOf: when(topStamps(S.slate).board) }),
  current: (p) => S.byId.get(p.dk_id) ?? p, roles: cardRoles({ api: () => scenarioConsole, slate: () => S.name, toast }) });
// The optimizer panel (panel.js); settled() lets a build wait for picks and override saves in flight, since the server
// reads the saved locks and the saved overrides.
// Late swap mode lives in the panel; onLateSwap redraws the header switch and the table's slot pickers when it changes.
// onWork redraws the rows when the lineup on show changes (their in-lineup mark); onMode swaps in that mode's columns.
const panel = createPanel({ el: $("opt"), lineupsEl: $("lineups"), onView: (v) => setView(v), onTabs: () => renderTop(), isLineupsView: () => S.view === "lineups", api, toast, tryStore, dash, ctx: () => ({ name: S.name, byId: S.byId, outList: S.slate?.out ?? [], outNames: S.outNames, knownName: (id) => S.known.get(id)?.name ?? null, knownRow: (id) => S.known.get(id) ?? null, pull: pullOf(S.slate), refreshGen: S.refreshGen, players: S.players, picks: livePicks(), settled, ovKey: ovKeyOf(), colourOf }), onLateSwap: () => { drawTop(); applyFullScreen(); renderHead(); renderRows(); }, onWork: () => renderRows(), onMode: (m) => columns.setMode(m), onClearLocks: () => savePicks({ locked: [], excluded: livePicks().excluded }), onMemory: () => rememberView() });
// The table's own columns, ticked and ordered by Adam per mode (columns.js); the list's and the table's redraws keep each other.
const columns = columnsControl({ btn: $("colsBtn"), pop: $("colPop"), mode: panel.mode, tryStore, onChange: () => { if (S.slate) { renderHead(); fixTableWidth(); } } });
const shownCols = () => columns.keys({ lateSwap: Boolean(panel.lateSwap()) });
// The scenario console (console.js), the page's other view; Apply hands back the players' effective figures, as an override save does.
const scenarioConsole = createConsole({ el: $("console"), api, toast, colourOf: (t) => colourOf(t).t1, onPlayers: (players) => applyPlayers(players), onWork: () => { boardMarks.refresh({ news: false }); lineupBar.newsOnly(); } });
// The console's word on each row (board-marks.js): the S chip, and his typed Min and DK/m TON with their undo chips; those cells write through the console.
const boardMarks = createBoardMarks({ api, slate: () => S.name, console: scenarioConsole, toast, pullAt: () => pullOf(S.slate).label, onChange: () => { if (S.slate) renderRows(); }, noteEl: $("lineupbar").insertAdjacentElement("beforebegin", Object.assign(document.createElement("div"), { hidden: true })) });
// The lineup bar above the list (lineup-bar.js): an Out or a confirmed start from the Monster and RotoWire pages applies itself through the console, with an undo X; a projected start is words only.
const lineupBar = createLineupBar({ el: $("lineupbar"), api, slate: () => S.name, players: () => S.players, console: scenarioConsole, toast, tryStore });
// Full screen (Player list header): hides the optimizer panel so the table takes the width. Remembered per viewer; under 900 px
// wide with nothing stored it starts on. Pin slots (late swap) needs the panel, so the button and the hiding step aside then.
const FS_KEY = "nbaboard.fullscreen";
let fullScreen = fullScreenPref(tryStore(() => localStorage.getItem(FS_KEY)), window.innerWidth);
const fsBtn = document.createElement("button");
fsBtn.className = "chip"; fsBtn.id = "fsBtn"; fsBtn.type = "button";
$("colsBtn").closest(".colsw").before(fsBtn);
function applyFullScreen() {
  const on = fullScreen && !panel.lateSwap();
  document.body.classList.toggle("fs-list", on);
  fsBtn.hidden = Boolean(panel.lateSwap());
  fsBtn.textContent = fullScreen ? "Show optimizer" : "Full screen";
  fsBtn.setAttribute("aria-pressed", String(fullScreen));
  stickyHeights();
}
fsBtn.addEventListener("click", () => {
  fullScreen = !fullScreen;
  tryStore(() => localStorage.setItem(FS_KEY, fullScreen ? "1" : "0"));
  applyFullScreen();
});
applyFullScreen();
/** Shows the console or the board. The board's table holds a measured width, so it is measured again on the way back. */
function setConsole(open) {
  document.body.classList.toggle("console-on", open);
  const q = new URLSearchParams(location.search);
  if (open) q.set("view", "console"); else q.delete("view");
  history.replaceState(null, "", `?${q}`);
  if (open) { S.consolePull = pullOf(S.slate).key; scenarioConsole.show(S.name); } else { scenarioConsole.hide(); fixTableWidth(); }
  renderTop();
  renderUpdLine();
}

/** The page's two tabs: the player list (with the working lineup and Build) and the Lineups tab (the built and saved lineups). */
function setView(v) {
  const next = v === "lineups" ? "lineups" : "list";
  if (next === (S.view ?? "list")) return; // clicking the tab already on show does nothing
  S.scroll = { ...S.scroll, [S.view ?? "list"]: window.scrollY }; // each tab keeps its own place
  S.view = next;
  document.body.classList.toggle("lineups-on", next === "lineups");
  $("lineups").hidden = next !== "lineups";
  renderTop();
  if (next === "list") fixTableWidth();
  window.scrollTo(0, S.scroll?.[next] ?? 0);
}

// ---------- theme ----------
let theme = loadTheme(tryStore);
function applyTheme() { for (const [cls, on] of Object.entries(themeClasses(theme))) document.body.classList.toggle(cls, on); }
function setTheme(change) { theme = { ...theme, ...change }; applyTheme(); saveTheme(tryStore, theme); renderTop(); }

// ---------- what the page remembers (standard A9) ----------
let measuring = false; // fixTableWidth clears the filters for a moment: that is never a choice to remember
function rememberView() {
  if (!S.name || measuring) return;
  saveView(tryStore, S.name, { tab: S.tab, q: S.q, game: S.game, pickFilter: S.pickFilter, teams: S.teams, minSal: S.minSal, maxSal: S.maxSal, sort: S.sort, outOpen: S.outOpen, ...panel.memory() });
}

mountLateSwap(); // the Late swap tab and screen (lsw-main.js)

// ---------- loading ----------
/** The slate's rows as the board holds them: each with his opponent's words. */
function boardRows(slate) {
  const home = new Map(slate.games.map((g) => [g.game, g.home]));
  return slate.players.map((p) => ({ ...p, oppText: p.opponent ? (home.get(p.game) === p.team ? "vs " : "@ ") + p.opponent : null }));
}
async function loadSlate(name) {
  await refresher.baseline(name);
  const [slate, picks] = await Promise.all([api(`/api/slate/${encodeURIComponent(name)}`), api(`/api/slate/${encodeURIComponent(name)}/picks`)]);
  card.close();
  editors.drop();
  S.name = name; S.slate = slate; S.picks = { locked: picks.locked, excluded: picks.excluded }; S.dropped = picks.dropped ?? []; S.rosterDropped = [];
  S.players = boardRows(slate);
  S.byId = new Map(S.players.map((p) => [p.dk_id, p]));
  S.held = new Map(); S.known = new Map(); S.outNames = outNamesOf(slate); S.refreshGen++; S.topStale = false; S.consolePull = pullOf(slate).key;
  S.upd = { updatedMs: Date.now(), failed: S.upd.failed, added: [], removed: [] };
  const view = loadView(tryStore, name, { tabs: TABS, teams: teamsOf(S.players), games: slate.games.map((g) => g.game), sortKeys: SORT_KEYS });
  setFilters(view);
  S.sort = view.sort; S.outOpen = view.outOpen;
  // One colour per team for this slate, chosen so no two teams' shades look alike (colours.js).
  const onSlate = [...S.players.map((p) => p.team), ...slate.games.flatMap((g) => [g.away, g.home])].filter(Boolean);
  S.colours = assignColours(onSlate, Object.fromEntries(onSlate.map((t) => [t, paletteOf(t)])));
  history.replaceState(null, "", `?slate=${encodeURIComponent(name)}${scenarioConsole.isOn() ? "&view=console" : ""}`);
  panel.setSlate(name, view);
  scenarioConsole.setSlate(name);
  renderAll();
  renderUpdLine();
  fixTableWidth();
  lineupBar.refresh(); boardMarks.refresh();
}

// ---------- the numbers refreshing by themselves (slate-refresh.js) ----------
// A new pull updates figures in place on the slate on show; never a page reload. S.players and S.slate change, and nothing else: filters, the sort, picks, the panel's
// settings and lineups, and the console's work are other state, so they stand. The row with an open box waits until he leaves it.
function renderUpdLine() {
  const el = $("updline");
  if (S.upd.updatedMs == null) { el.hidden = true; return; }
  const pull = pullOf(S.slate);
  el.hidden = false;
  el.classList.toggle("stale", Boolean(S.upd.failed));
  el.textContent = statusLine({ ...S.upd, pull: pull.label, consoleOpen: scenarioConsole.isOn() && S.consolePull !== pull.key });
}
/** What names men, against the rows now (slate-refresh.js rosterCleanup): a man off the slate leaves the picks and the working lineup, named; a filter on a team or game gone ends. */
function settleRoster() {
  const out = rosterCleanup({
    byId: S.byId, picks: S.picks, ...panel.rosterInput(), filters: { teams: S.teams, game: S.game }, nameOf,
    teamsOn: teamsOf(S.players), gamesOn: S.slate.games.map((g) => g.game),
  });
  // S.picks stays as saved: the server's file still holds a man off the slate, and if he comes back both agree he is locked. livePicks reads them.
  S.rosterDropped = out.dropped; S.teams = out.filters.teams; S.game = out.filters.game;
  renderDropNote();
  return out;
}
/** Draws the header without closing what is open in it: a slate dropdown with the keyboard waits until he leaves it; an open Data warnings list stays open. */
function drawTop() {
  if (document.activeElement?.id === "slateSel") { S.topStale = true; return; }
  const notesOpen = $("notesList")?.hidden === false;
  keepFocus($("top"), renderTop);
  if (notesOpen && $("notesList")) $("notesList").hidden = false;
}
function applyFresh(slate) {
  const { scrollX: x, scrollY: y } = window;
  panel.beforeRoster();
  const { players, held, added, removed } = mergeFresh(S.players, boardRows(slate), editors.openId());
  S.known = rememberRows(S.known, S.players);
  S.slate = slate; S.players = players; S.held = held; S.refreshGen++;
  S.byId = new Map(S.players.map((p) => [p.dk_id, p]));
  S.outNames = outNamesOf(slate);
  const changed = added.length || removed.length;
  S.upd = { ...S.upd, updatedMs: Date.now(), added: changed ? added : S.upd.added, removed: changed ? removed : S.upd.removed };
  const onSlate = [...S.players.map((p) => p.team), ...slate.games.flatMap((g) => [g.away, g.home])].filter(Boolean);
  if (onSlate.some((t) => !S.colours?.[t])) S.colours = assignColours(onSlate, Object.fromEntries(onSlate.map((t) => [t, paletteOf(t)])));
  const out = settleRoster();
  drawTop();
  renderGames(); renderTeamChips(); renderRows(); renderOuts(); renderPick();
  panel.afterRoster(out); // the working lineup without who left; saved cards read again, always on the latest figures (Adam, 11-04)
  // The table holds a measured width; a man added or removed may change it. The console hides the table, and measures on the way back.
  if (changed && !scenarioConsole.isOn()) fixTableWidth();
  if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
  lineupBar.refresh(); boardMarks.refresh(); // a new pull: the lineup read and TwoGun's flags may both have moved
  scenarioConsole.onPull(S.name).then((ok) => { if (ok && S.slate) { S.consolePull = pullOf(S.slate).key; renderUpdLine(); } }).catch((e) => toast(`The console could not check the new pull: ${e.message}`, "err")); // the console has the new pull, so its line stops asking to reopen it; his marks are sent over the new pull with no click (console.js onPull)
}
/** He has left the box: the row that waited takes its new figures, and whatever named a man it dropped follows. */
function flushHeld() {
  if (!S.held.size || editors.openId()) return;
  const { scrollX: x, scrollY: y } = window;
  S.known = rememberRows(S.known, S.players);
  S.players = applyHeld(S.players, S.held);
  S.held = new Map();
  S.byId = new Map(S.players.map((p) => [p.dk_id, p]));
  const out = settleRoster();
  renderTeamChips(); renderRows(); renderPick();
  panel.afterRoster(out);
  if (!scenarioConsole.isOn()) fixTableWidth();
  if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
}
const press = pressSettle();
/** The forms a redraw would disturb: the team-limit and low-owned boxes, and a slot picker. A number box in a row is handled apart, row by row. */
const formHasFocus = () => Boolean(document.activeElement?.matches?.("#opt [data-ov], #opt [data-lr], select[data-lspin], .psel, .rpin"));
const refresher = createRefresher({
  api, name: () => S.name, busy: () => panel.running() || formHasFocus() || press.pressing(), saves: () => ovSaves, apply: applyFresh,
  status: ({ failed, waiting = false }) => { S.upd = { ...S.upd, failed, waiting }; renderUpdLine(); },
});
const pullNow = createPullNow({ reload: () => refresher.tick(), runner: globalThis.nbadfsSitePull ?? null }); // the header's Pull now (pull-now.js); new numbers land through the refresh above

// ---------- header ----------
function slateLabel(name) {
  const m = name.match(/^(\d{4})-(\d{2})-(\d{2})-(.+)$/);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return `${day} · ${m[4][0].toUpperCase()}${m[4].slice(1)}`;
}
function noteLists() {
  const f = (x) => (typeof x === "string" ? x : JSON.stringify(x));
  return { conflicts: (S.slate.conflicts ?? []).map(f), missing: (S.slate.missing ?? []).map(f) };
}
function renderTop() {
  const s = S.slate; if (!s) return;
  const { board, injuries, injuriesAbsent } = topStamps(s);
  const stamp = (label, raw, why, cls = "", absent = false) => { const t = when(raw); return `<span class="${cls}">${label} <b>${t ? esc(t) : absent ? `<span class="miss" title="${esc(why)}">missing</span>` : dash(why)}</b></span>`; };
  const n = noteLists(); const count = n.conflicts.length + n.missing.length;
  const list = (h, a) => (a.length ? `<h4>${h}</h4><ul>${a.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");
  $("top").innerHTML = `<div class="brand"><span class="mk"></span>NBA_BOARD<small>dk classic</small></div>
<select class="slate" id="slateSel">${S.slates.map((x) => `<option value="${esc(x.slate)}"${x.slate === S.name ? " selected" : ""}>${esc(slateLabel(x.slate))}${x.slate === S.name ? ` · ${s.games.length} game${s.games.length === 1 ? "" : "s"}` : ""}</option>`).join("")}</select>
<span class="vtabs"><button data-view="list" class="${S.view === "lineups" ? "" : "on"}">Player list</button><button data-view="lineups" class="${S.view === "lineups" ? "on" : ""}">Lineups${panel.builtCount() ? ` <b>${panel.builtCount()}</b>` : ""}</button></span>
<div class="stamps">${stamp("Board", board, "no board time in this slate file")}${stamp("Injuries", injuries, injuriesAbsent ? "the TwoGun board row carries no injury report time" : "no injury report time in this slate file", "", injuriesAbsent)}${stamp("Pulled", s.as_of?.pull_started, "no pull time in this slate file")}${stamp("Lock", s.lock, "no lock time in this slate file", "lock")}</div>
${count ? `<div class="notes"><button id="notesBtn" title="${count} data warning${count === 1 ? "" : "s"} on this slate">Data warnings</button><div class="list" id="notesList" hidden>${list("Conflicts", n.conflicts)}${list("Missing", n.missing)}</div></div>` : ""}
${pullNow.html()}<button id="csBtn" class="lsw csw${scenarioConsole.isOn() ? " on" : ""}" title="${scenarioConsole.isOn() ? "Back to the board" : "Scenario console: minutes and usage when men sit"}">Console</button>
<button id="lsBtn" class="lsw${panel.lateSwap() ? " on" : ""}" title="${panel.lateSwap() ? "Leave late swap mode" : "Late swap: men whose game has started stay in their slot; pin others to a slot and fill the open ones"}"${panel.running() ? " disabled" : ""}>${ICON.lock} Pin slots</button>
${themeHtml(theme)}`;
}
function renderDropNote() {
  const el = $("dropnote");
  const d = [...S.dropped, ...S.rosterDropped];
  el.hidden = !d.length;
  el.innerHTML = d.length ? `${d.length} saved pick${d.length === 1 ? " is" : "s are"} no longer on this slate and ${d.length === 1 ? "was" : "were"} removed (${d.map(esc).join(", ")}).` : "";
}

// ---------- games strip ----------
// Numbers light up by tier (see highlight.js): game totals in house amber, team totals in the team's own colour.
function renderGames() {
  const games = [...S.slate.games].sort((a, b) => String(a.tip).localeCompare(String(b.tip)) || a.game.localeCompare(b.game));
  const gameTotals = games.map((g) => (typeof g.total === "number" ? g.total : null));
  const gt = tiers(gameTotals), gn = notes(gameTotals, "game total");
  const flat = games.flatMap((g, gi) => [g.away, g.home].map((t) => ({ gi, t })));
  const implied = flat.map(({ gi, t }) => (typeof games[gi].implied?.[t] === "number" ? games[gi].implied[t] : null));
  const it = tiers(implied), inotes = notes(implied, "team total");
  const side = (g, t, k) => {
    const ip = implied[k]; const fav = g.favourite === t; const sp = g.spread; const c = colourOf(t);
    const note = typeof sp !== "number" || !g.favourite ? "" : (fav ? "" : "+") + (fav ? sp : Math.abs(sp)).toFixed(1);
    return `<div class="side${fav ? " fav" : ""}" style="--t1:${c.t1}">${logo(t, "lg")}<b class="code">${esc(t)}</b><small class="spr" title="${fav ? "Favourite" : "Underdog"}">${esc(note)}</small>${ip === null ? `<span class="ip">${dash("no implied points in this slate file")}</span>` : `<span class="ip t-${it[k]}" style="--tc:${c.t1}"${inotes[k] ? ` title="${esc(inotes[k])}"` : ""}>${ip.toFixed(1)}</span>`}</div>`;
  };
  $("games").innerHTML = games.map((g, gi) => `<div class="game${S.game === g.game ? " sel" : ""}" data-game="${esc(g.game)}"><div class="gh"><span class="tip">${esc(when(g.tip) ?? "—")}</span><span class="tot">O/U ${gameTotals[gi] === null ? dash("no total in this slate file") : `<b class="t-${gt[gi]}" style="--tc:var(--am)"${gn[gi] ? ` title="${esc(gn[gi])}"` : ""}>${gameTotals[gi].toFixed(1)}</b>`}</span></div>${side(g, g.away, gi * 2)}${side(g, g.home, gi * 2 + 1)}</div>`).join("");
  fitGames();
}

/** The game tiles in as few rows as fit, split evenly (11 games on one row where the page is wide; 6 and 5 where it holds only 8). */
const GAME_MIN = 205;
function fitGames() {
  const el = $("games"), n = el.children.length;
  if (!n || !el.clientWidth) return;
  const fit = Math.max(1, Math.floor((el.clientWidth + 8) / (GAME_MIN + 8))), cols = Math.ceil(n / Math.ceil(n / fit));
  el.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 236px))`;
}

// ---------- table ----------
const posTag = (p) => {
  if (!SINGLE.includes(S.tab)) return p.positions.join("/");
  const rest = p.positions.filter((x) => x !== S.tab);
  return rest.length ? "+" + rest.join("/") : "";
};
function visible() {
  const rows = filterPlayers(S.players, S, S.picks);
  return rows.sort((a, b) => comparePlayers(a, b, S.sort));
}
function renderHead() { $("thead").innerHTML = headHtml(shownCols(), S.sort, headTitle); }
/** A season-figure column's tooltip: its basis, then this season's as-of time (and last season's when an LY figure shows). */
function headTitle(c) {
  const f = S.slate?.season_figures?.[c.key];
  const at = (m) => (m?.as_of ? `as of ${new Date(m.as_of).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}, ${isoToEastern(m.as_of) ?? m.as_of}` : `not loaded${m?.error ? ` (${m.error})` : ""}`);
  if (c.key === "min_usual") return S.slate?.min_usual_pull ? `${c.head}, from the board row of the ${S.slate.min_usual_pull} pull (TwoGun NBA board)` : c.head;
  if (!f) return c.head;
  const ly = S.players.some((p) => p[c.key + "_tag"] === "LY");
  return `${c.head}, Basketball-Reference, ${at(f.this_season)}${ly ? `; 2025-26 figures (LY) ${at(f.last_season)}` : ""}`;
}
function renderRows() {
  const rows = visible();
  const mx = (k) => Math.max(0, ...S.players.map((p) => p[k]).filter((v) => typeof v === "number"));
  const mn = (k) => Math.min(...S.players.map((p) => p[k]).filter((v) => typeof v === "number"));
  const vmin = mn("value"), vmax = mx("value"), omax = mx("proj_own");
  const lock = new Set(S.picks.locked), ex = new Set(S.picks.excluded);
  const keys = shownCols();
  // Late swap mode: each row's slot picker takes the lock button's place; a started man outside the working lineup cannot
  // be added, so his row is dimmed. Outside it a click on the row puts the man in the working lineup or takes him out
  // (the row click below); the men in the lineup on show wear the in-lineup mark.
  const L = panel.lateSwap();
  const inl = L ? null : panel.inLineup();
  const blocks = panel.blocked(); // who cannot go in now (A18); null, so nobody greyed, while that is not known
  renderChips();
  renderFilterMarks();
  rememberView();
  stickyHeights();
  $("cnt").textContent = `${rows.length} player${rows.length === 1 ? "" : "s"}${sortNote(keys, S.sort)}`;
  // A keyboard user keeps his place, and an open box what he typed: the rows redraw on every pick, save and answer from the server.
  editors.around(() => keepFocus($("tbody"), () => {
    $("tbody").innerHTML = rows.length ? rows.map((p) => rowHtml(p, keys, { dash, when, colourOf, tag: posTag(p), lock, ex, L, inl, blocks, vmin, vmax, omax, limits: panel.limits(), marks: boardMarks.of })).join("") : `<tr><td colspan="${keys.length}" class="nores">No players match.</td></tr>`;
  }));
}
// The table is only as wide as its content, so its width would follow the visible rows and the optimizer beside it would
// slide on every filter. After the unfiltered render, measure the table and hold that width for the slate.
function fixTableWidth() {
  if (!S.slate) return;
  const keep = Object.fromEntries(Object.keys(noFilters()).map((k) => [k, S[k]]));
  const table = $("tbody").closest("table");
  table.style.width = "";
  measuring = true;
  Object.assign(S, noFilters());
  renderRows();
  table.style.width = table.offsetWidth + "px";
  Object.assign(S, keep);
  measuring = false;
  renderRows();
}
/** The table header sits under the filter bar, whose height follows its wrapped chips. The page's scroll padding is the tallest
 *  sticky stack over the table, the bar and header, so a table control taking the keyboard never lands under them (A15). The lineup
 *  band stacks over the optimizer's own column: --luh is its height, which the controls below it use as scroll-margin-top (board.css). */
function stickyHeights() {
  const root = document.documentElement.style, h = (el) => el?.getBoundingClientRect().height ?? 0;
  root.setProperty("--fbarh", `${$("fbar").offsetHeight}px`);
  const first = document.querySelector("#thead th:first-child");
  root.setProperty("--plleft", `${first?.classList.contains("ctl") ? Math.ceil(first.getBoundingClientRect().width) : 0}px`);
  root.setProperty("--luh", `${Math.ceil(h(document.querySelector("#opt .lu"))) + 4}px`);
  root.scrollPaddingTop = `${Math.ceil(h($("fbar")) + h($("thead"))) + 4}px`;
}
/** Sets every filter and the boxes that show them; the caller redraws. */
function setFilters(f) {
  Object.assign(S, f);
  $("search").value = f.q;
  $("minSal").value = f.minSal;
  $("maxSal").value = f.maxSal;
}
/** The team chips (B4): any number on at once; none on means every team. */
function renderTeamChips() {
  keepFocus($("teamChips"), () => {
    $("teamChips").innerHTML = teamsOf(S.players).map((t) => `<button class="chip tchip${S.teams.includes(t) ? " on" : ""}" data-fteam="${esc(t)}">${logo(t, "xs")}${esc(t)}</button>`).join("");
  });
}
/** The salary boxes' marks and Clear filters (B5), which is off with nothing to clear. */
function renderFilterMarks() {
  const { bad } = salaryRange(S.minSal, S.maxSal);
  for (const [id, why] of [["minSal", bad.min], ["maxSal", bad.max]]) { $(id).classList.toggle("bad", Boolean(why)); $(id).title = why ?? ""; }
  $("clearF").disabled = !filtersOn(S);
}
function renderTabs() { $("tabs").innerHTML = TABS.map((t) => `<button data-tab="${t}" class="${t === S.tab ? "on" : ""}">${t}</button>`).join(""); }
// Locked / Excluded / Starred filter chips with their counts (only men still on the slate are counted); 0 is dim but
// clickable. Then "Reset all overrides" (A6): it clears typed numbers, bumps and applied minutes, never stars or notes (NFL D72), so it is
// disabled while no row has any, and it asks first (the click below).
function renderChips() {
  const n = (k) => (k === "starred" ? S.players.filter((p) => p.starred).length : S.picks[k].filter((id) => S.byId.has(id)).length);
  const nOvr = S.players.filter(hasResettable).length;
  $("chips").innerHTML = [["locked", "Locked"], ["excluded", "Excluded"], ["starred", "Starred"]].map(([k, label]) => `<button data-chip="${k}" class="chip ${k}${S.pickFilter === k ? " on" : ""}${n(k) ? "" : " zero"}" title="${S.pickFilter === k ? "Show everyone again" : `Show only ${label.toLowerCase()} players`}">${label} <b>${n(k)}</b></button>`).join("")
    + `<button id="ovReset" class="chip ovr${nOvr ? "" : " zero"}"${nOvr ? ` title="${nOvr} ${nOvr === 1 ? "man has" : "men have"} a typed number, a bump or applied minutes on this slate"` : ` disabled title="No typed numbers, bumps or applied minutes on this slate"`}>Reset all overrides</button>`
    + pullChipHtml(S.slate?.pull_changes, S.players, S.pickFilter === "changed");
  renderPullNote();
}
/** Changed since the last pull: the banner, until he dismisses this pull's. The dismissal is a per-viewer convenience, in browser storage, and a newer pull brings the banner back. */
const pullNoteKey = () => `nbaboard.pullnote.${S.name}`;
function renderPullNote() {
  const html = pullNoteHtml(S.slate?.pull_changes, S.players, { dismissed: tryStore(() => localStorage.getItem(pullNoteKey())), filterOn: S.pickFilter === "changed" });
  $("pullnote").hidden = !html;
  $("pullnote").innerHTML = html;
}
/** A man from the Out list as the card opens him: on the slate's player pool when he is there, else only what the list says. */
function outMan(o) {
  const on = S.players.find((p) => p.name === o.name && p.team === o.team);
  return on ?? { dk_id: null, name: o.name, team: o.team, positions: [], injury_status: o.status ?? "Out", salary_text: o.salary_text ?? null };
}
function renderOuts() {
  const out = S.slate.out ?? [];
  $("outs").innerHTML = out.length ? `<button class="oh2" id="outTog" aria-expanded="${S.outOpen}" title="${S.outOpen ? "Hide" : "Show"} the Out list">Out ${S.outOpen ? "▾" : `(${out.length}) ▸`}</button>${!S.outOpen ? "" : out.map((o, i) => `<span class="o" title="${esc([o.reason, o.usual_minutes != null ? `usual minutes ${o.usual_minutes}` : null].filter(Boolean).join(" · "))}">${logo(o.team, "xs")}<button class="oname" data-out-i="${i}" title="Open ${esc(o.name)}'s card">${esc(o.name)}</button>${o.salary_text ? `<em>${esc(o.salary_text)}</em>` : ""}<i>${esc((o.status ?? "OUT").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()))}</i></span>`).join("")}` : ""; // the strip folds (C2); stored uppercase; shown "Out", "Doubtful" like the injury chips
}
const renderPick = () => { panel.render(); card.refresh(); };
function renderAll() { renderTop(); renderDropNote(); renderGames(); renderTabs(); renderTeamChips(); renderHead(); renderRows(); renderOuts(); renderPick(); }

// ---------- picks ----------
// Saves go out one at a time, in order, so quick clicks cannot reach the server out of order. After a failed save the
// page reloads the picks from the server (the saved file is the truth) instead of restoring an older local copy.
let saveQueue = Promise.resolve();
/** One promise for "the picks and override saves now queued", the same object until either queue gains a link, so the
 *  panel's until-unchanged wait (picksSettled) covers both: a build reads the saved locks and the saved overrides. */
let settledOf = [], settledP = Promise.resolve();
function settled() {
  if (settledOf[0] !== saveQueue || settledOf[1] !== ovQueue) { settledOf = [saveQueue, ovQueue]; settledP = Promise.all(settledOf); }
  return settledP;
}
function savePicks(next) {
  S.picks = next; renderRows(); renderPick();
  const name = S.name, body = JSON.stringify(next);
  saveQueue = saveQueue.then(async () => {
    try {
      await api(`/api/slate/${encodeURIComponent(name)}/picks`, { method: "POST", headers: { "content-type": "application/json" }, body });
      if ((S.dropped.length || S.rosterDropped.length) && name === S.name) { S.dropped = []; S.rosterDropped = []; renderDropNote(); }
    } catch (e) {
      toast(`Could not save picks: ${e.message}`, "err");
      try {
        const saved = await api(`/api/slate/${encodeURIComponent(name)}/picks`);
        if (name === S.name) { S.picks = { locked: saved.locked, excluded: saved.excluded }; renderRows(); renderPick(); }
      } catch (e2) { toast(`Could not reload picks: ${e2.message}`, "err"); }
    }
  });
}
function toggle(id, kind) {
  const other = kind === "locked" ? "excluded" : "locked";
  const live = livePicks(); // a save names only men on the slate: the server refuses any other
  const has = live[kind].includes(id);
  savePicks({ [kind]: has ? live[kind].filter((x) => x !== id) : [...live[kind], id], [other]: has ? live[other] : live[other].filter((x) => x !== id) });
  if (kind === "excluded" && !has) panel.dropMan(id); // an excluded man leaves the working lineup (a build would refuse him)
}

// ---------- overrides (Adam, 5:20 PM ET 2026-10-29; server/slate/overrides.js) ----------
// Every write goes to the server, one at a time and in order, and the page redraws from the players it answers (the saved
// file is the truth). A refused write shows its sentence and redraws the rows as they were. `body` may be a function, worked
// out when the request is sent (a star toggle reads the star the previous answer left, so a double-click toggles twice).
let ovQueue = Promise.resolve();
let ovSaves = 0; // moves with every override write and its answer, so a refresh fetched across one is not drawn over it
const OV_KEYS = ["projection", "value", "proj_own", "base", "ovr", "starred", "note", "minutes", "base_minutes"];
function saveOverride(body, what) {
  const name = S.name;
  ovSaves++;
  const run = ovQueue.then(async () => {
    try {
      // The slate changed while this waited its turn. A worked-out body reads the slate on show, so it cannot be sent; a plain
      // one goes to the slate it was made on (the address below), so what was typed is never lost.
      if (name !== S.name && typeof body === "function") { toast("Not saved: the slate changed."); return false; }
      const sent = typeof body === "function" ? body() : body;
      const out = await api(`/api/slate/${encodeURIComponent(name)}/overrides`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sent) });
      if (name === S.name) applyPlayers(out.players);
      return true;
    } catch (e) {
      toast(`Could not save ${what}: ${e.message}`, "err");
      if (name === S.name) renderRows();
      return false;
    }
  });
  ovQueue = run;
  return run;
}
/** The figures a build scores from Adam's overrides, as one string: the panel compares it before and after a build to say
 *  "built before your last projection or ownership change" (stars and notes leave it unchanged). */
function ovKeyOf() {
  return overrideKey(S.players);
}
/** Takes the override fields from the server's players onto the board's (keeping the season figures and the opponent text). */
function applyPlayers(players) {
  ovSaves++;
  const fresh = new Map((players ?? []).map((p) => [p.dk_id, p]));
  const withAnswer = (p) => {
    const f = fresh.get(p.dk_id);
    if (!f) return p;
    const next = { ...p };
    for (const k of OV_KEYS) { if (k in f) next[k] = f[k]; else delete next[k]; }
    return next;
  };
  S.players = S.players.map(withAnswer);
  S.held = new Map([...S.held].map(([id, row]) => [id, row && withAnswer(row)])); // a row waiting on his box takes the answer too
  S.byId = new Map(S.players.map((p) => [p.dk_id, p]));
  renderRows(); renderPick();
}
// The typed Proj and Own boxes and the note box (cell-editor.js, standard A3).
const editors = createEditors({
  root: $("tbody"), rowOf: (id) => S.byId.get(id), toast, onClosed: () => press(() => setTimeout(flushHeld, 0)), limits: { current: (kind, id) => panel.limits()[id]?.[kind] ?? null, outcome: (kind, id, text) => panel.limitOutcome(kind, id, text) },
  save: (kind, id, v, settle) => (kind === "min" || kind === "max" ? (limitPatch($("tbody"), kind, id, v), panel.setLimit(kind, id, v, settle)) : kind === "cmin" || kind === "crate" ? boardMarks.setPin(id, kind === "cmin" ? "m" : "d", v) : kind === "note" ? saveOverride({ notes: { [id]: v } }, "the note") : saveOverride({ [kind]: { [id]: v } }, kind === "proj" ? "the projection" : "the ownership")),
});
// The thumbs pairs are redrawn with the rows, so one listener on the table body serves them all (bump-control.js).
delegateBumpClicks($("tbody"), { rowOf: (id) => S.byId.get(id), onBump: (id, stepsAt) => saveOverride(() => bumpPatch(id, stepsAt()), "the projection bump") });

// A click on a player row (Adam, 5:34 PM ET 2026-10-29): the man goes into the working lineup, or out when he is in it.
// Never on a control: the star, lock and exclude cells, the name (it opens his card), the note and reset, the thumbs cell, an
// editable figure, or an open editor. Not on a greyed row (A18), and not on the press that closed an editor (it only closes
// it). In late swap mode a row click does nothing new (the mode's slot pickers pin men).
const ROW_CONTROLS = "td.ctl, td.bmp, td.lim, button, input, select, a, [data-edit], .ovt, .bump-ctl";
$("tbody").addEventListener("click", (e) => {
  if (panel.lateSwap() || e.target.closest(ROW_CONTROLS) || editors.closedByPress()) return;
  const tr = e.target.closest("tr[data-row]");
  if (tr && !tr.classList.contains("blk") && getSelection?.().isCollapsed !== false) panel.rowClick(tr.dataset.row); // a drag to select text is not a pick
});

// ---------- events ----------
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-sort],[data-tab],[data-game],[data-dk-id],[data-out-i],[data-lock],[data-excl],[data-unpick],[data-chip],[data-view],[data-theme],[data-star],[data-note],[data-reset],[data-edit],[data-unmark],[data-fteam],[data-shade],#ovReset,#clearF,#notesBtn,#lsBtn,#csBtn,#outTog,#pullDismiss");
  if (!t) { const l = $("notesList"); if (l && !e.target.closest(".notes")) l.hidden = true; return; }
  const d = t.dataset;
  if (t.id === "notesBtn") { const l = $("notesList"); l.hidden = !l.hidden; }
  else if (d.view) setView(d.view);
  else if (t.id === "lsBtn") { setView("list"); panel.toggleLateSwap().then(fixTableWidth); }
  else if (t.id === "csBtn") setConsole(!scenarioConsole.isOn());
  else if (t.id === "pullDismiss") { tryStore(() => localStorage.setItem(pullNoteKey(), S.slate.pull_changes.pull)); renderPullNote(); }
  else if (t.id === "outTog") { S.outOpen = !S.outOpen; renderOuts(); rememberView(); $("outTog")?.focus({ preventScroll: true }); }
  else if (d.shade) setTheme({ light: d.shade === "light" });
  else if (t.id === "clearF") { setFilters(noFilters()); renderGames(); renderTabs(); renderTeamChips(); renderRows(); }
  else if (d.fteam) { S.teams = S.teams.includes(d.fteam) ? S.teams.filter((x) => x !== d.fteam) : [...S.teams, d.fteam]; renderTeamChips(); renderRows(); }
  else if (d.sort) { S.sort = S.sort.key === d.sort ? { key: d.sort, dir: -S.sort.dir } : { key: d.sort, dir: d.sort === "name" ? 1 : -1 }; renderHead(); renderRows(); }
  else if (d.tab) { S.tab = d.tab; renderTabs(); renderRows(); }
  else if (d.game) { S.game = S.game === d.game ? null : d.game; renderGames(); renderRows(); }
  else if (d.dkId) { const man = S.byId.get(d.dkId); if (man) card.open(man); else toast("He is not in the slate on this page."); }
  else if (d.outI) card.open(outMan(S.slate.out[+d.outI]));
  else if (d.lock) toggle(d.lock, "locked");
  else if (d.excl) toggle(d.excl, "excluded");
  else if (d.unpick) { const live = livePicks(); savePicks({ locked: live.locked.filter((x) => x !== d.unpick), excluded: live.excluded.filter((x) => x !== d.unpick) }); }
  else if (d.chip) { S.pickFilter = S.pickFilter === d.chip ? null : d.chip; renderRows(); }
  else if (d.theme) setTheme({ dark: d.theme });
  else if (d.star) { const id = d.star; saveOverride(() => ({ stars: { [id]: !S.byId.get(id)?.starred } }), "the star"); }
  else if (d.note) editors.openNote(t);
  else if (d.reset) saveOverride({ reset: d.reset }, "the reset");
  else if (d.unmark) boardMarks.drop(d.id, d.unmark);
  else if (d.edit) editors.openNumber(t);
  else if (t.id === "ovReset") askConfirm(CONFIRM.resetAll, { ok: "Reset" }).then((yes) => { if (yes) saveOverride({ resetAll: true }, "the reset"); });
});
document.addEventListener("focusout", (e) => {
  if (e.target.id !== "slateSel" || !S.topStale) return;
  S.topStale = false;
  setTimeout(() => keepFocus($("top"), renderTop), 0); // never while the event that ended the focus is still out
});
document.addEventListener("change", (e) => {
  if (e.target.id === "slateSel") loadSlate(e.target.value).catch(fail);
  // A slot picker (table row or panel slot) in late swap mode: pin that man to the chosen slot.
  else if (e.target.dataset?.lspin) { const { lspin } = e.target.dataset, to = e.target.value === "" ? null : +e.target.value; e.target.blur(); panel.pin(lspin, to); } // "—" unpins; the choice made, the picker lets go, so it cannot hold off new numbers
});
$("search").addEventListener("input", (e) => { S.q = e.target.value; renderRows(); });
$("minSal").addEventListener("input", (e) => { S.minSal = e.target.value; renderRows(); });
$("maxSal").addEventListener("input", (e) => { S.maxSal = e.target.value; renderRows(); });
if (typeof ResizeObserver === "function") new ResizeObserver(stickyHeights).observe($("fbar"));
if (typeof MutationObserver === "function") new MutationObserver(stickyHeights).observe($("opt"), { childList: true }); // the panel redraws its band: --luh follows it
let resizeTimer;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { fixTableWidth(); fitGames(); }, 150); });
document.fonts?.ready.then(fixTableWidth);

const fail = (e) => { document.querySelector(".work").innerHTML = `<div class="fatal">Could not load the board: ${esc(e.message)}</div>`; };
(async () => {
  applyTheme();
  try {
    S.slates = (await api("/api/slates")).slates;
    if (!S.slates.length) throw new Error("No slates in the archive yet.");
    const query = new URLSearchParams(location.search), want = query.get("slate"), openConsole = query.get("view") === "console";
    await loadSlate(S.slates.some((x) => x.slate === want) ? want : S.slates[0].slate);
    if (openConsole) setConsole(true);
    setInterval(() => refresher.tick(), CHECK_MS);
  } catch (e) { fail(e); }
})();
