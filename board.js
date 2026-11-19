// The NBA board page: loads a slate from the API and draws the header, games strip, player table, Out chips and optimizer panel.
// Every figure is read from the slate file or its route as given; a missing one is shown as an em dash with a title, never zero.
import { paletteOf, teamColors } from "./teams.js";
import { assignColours } from "./colours.js";
import { sourceRows, sourcesHtml } from "./sources-panel.js";
import { checkFootHtml, hisPoolHtml, outPoolHtml } from "./board-check-foot.js";
import { esc, logo, tipWhen, tipMs, slateRefMs, shortTime, topStamps, keepFocus, remScale } from "./board-util.js";
import { createPanel } from "./panel.js";
import { initCard, figureSource } from "./card.js";
import { cardRoles } from "./card-role.js";
import { bumpPatch, delegateBumpClicks } from "./bump-control.js";
import { createEditors } from "./cell-editor.js";
import { askConfirm, CONFIRM } from "./confirm.js";
import { columnsControl, sortNote } from "./columns.js";
import { headHtml, rowHtml, SORT_KEYS, comparePlayers, minSourceOf, gapChipHtml } from "./player-table.js";
import { boxNote, absenceNote, freshBoxes } from "./box-note.js";
import { CHECK_MS, takeAnswer, applyHeld, createRefresher, followNewest, mergeFresh, outNamesOf, pickSlate, slateQuery, overrideKey, picksOnBoard, pullOf, rememberRows, rosterCleanup, statusLine } from "./slate-refresh.js";
import { pressSettle } from "./press-settle.js";
import { createPullNow, firstTipOf } from "./pull-now.js";
import { noFilters, filtersOn, filterPlayers, salaryRange, teamsOf } from "./filters.js";
import { limitPatch } from "./row-limits.js";
import { loadView, saveView, DEFAULT_SORT } from "./view-memory.js";
import { loadTheme, saveTheme, themeClasses } from "./theme.js";
import { createConsole } from "./console.js";
import { createLineupBar } from "./lineup-bar.js";
import { createBoardMarks } from "./board-marks.js";
import { confirmedByGame } from "./game-borders.js";
import { mountLateSwap } from "./lsw-main.js";
import { createOptStrip } from "./opt-strip.js";
import { createToast } from "./toast.js";
import { createSaves } from "./board-saves.js";
import { createFullScreen } from "./board-fullscreen.js";
import { topHtml, gamesHtml, headTitle as viewHeadTitle, chipsHtml, outMan, outsHtml } from "./board-views.js";

const $ = (id) => document.getElementById(id);
const TABS = ["ALL", "PG", "SG", "SF", "PF", "C", "G", "F"];
/** The slate's assigned colours for a team, {t1, t2}; the fixed table's colours if the team is not on the slate. */
const colourOf = (t) => (S.colours?.[t] ? { t1: S.colours[t].main, t2: S.colours[t].second } : teamColors(t));

const S = { slates: [], name: null, slate: null, players: [], byId: new Map(), picks: { locked: [], excluded: [] }, dropped: [], ...noFilters(), sort: { ...DEFAULT_SORT }, outOpen: false, held: new Map(), known: new Map(), outNames: new Set(), refreshGen: 0, topStale: false, consolePull: null, rosterDropped: [], upd: { updatedMs: null, failed: null, waiting: false, added: [], removed: [] } };
/** The picks as the board acts on them (slate-refresh.js picksOnBoard). */
const livePicks = () => picksOnBoard(S.picks, S.byId);
/** A man's name, on the slate or remembered from an earlier pull this page held; his id when never seen. */
const nameOf = (id) => S.byId.get(id)?.name ?? S.known.get(id)?.name ?? `DraftKings id ${id}`;

// Browser storage holds per-viewer conveniences only (theme, the optimizer's typed settings), the one use the storage
// rule allows; when it throws (private window, blocked site data) the page works without it and says so in the console.
const tryStore = (fn) => { try { return fn(); } catch (e) { console.warn("Browser storage unavailable:", e.message); return null; } };
const toast = createToast(); // the message beside the clicked control (toast.js)
const api = async (url, opts) => {
  const r = await fetch(url, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error?.message ?? `HTTP ${r.status}`), { code: body.error?.code });
  return body;
};
const dash = (title) => `<span class="miss" title="${esc(title)}">—</span>`;
/** A slate stamp in Eastern time; the slate's own date (from its name) settles the year TwoGun's stamps leave out. */
const when = (s) => tipWhen(S.name)(s);
// The picks and override saves (board-saves.js); settled() lets a build wait for picks and override saves in flight, since the server reads the saved locks and the saved overrides.
const saves = createSaves({ S, api, toast, renderRows: () => renderRows(), renderPick: () => renderPick(), renderDropNote: () => renderDropNote(), applyPlayers: (p) => applyPlayers(p) });
const { savePicks, saveOverride, settled } = saves;
// The player panel (card.js), docked on the right; it closes itself on Esc. A man's figures follow the board's copy of him (a man from the
// Out list has none and stays as he was opened).
const card = initCard({ root: document.body, dash, colourOf, picks: () => S.picks,
  figs: () => ({ source: figureSource(S.slate), asOf: when(topStamps(S.slate).board) }),
  current: (p) => S.byId.get(p.dk_id) ?? p, marks: (id) => boardMarks.of(id), newsState: () => boardMarks.newsState(), onDock: () => { fixTableWidth(); stickyHeights(); }, roles: cardRoles({ api: () => scenarioConsole, slate: () => S.name, toast }) });
new MutationObserver(() => { if (document.body.classList.contains("lsw-on")) card.close(); }).observe(document.body, { attributes: true, attributeFilter: ["class"] }); // Late swap lists entries, not names: the panel is for the Player list and the Console, so it closes when that screen opens
createOptStrip({ el: $("optstrip"), opt: $("opt"), onWorking: () => card.close() }); // the compact optimizer row over the table while the player panel is open (opt-strip.js)
// The optimizer panel (panel.js).
// Late swap mode lives in the panel; onLateSwap redraws the header switch and the table's slot pickers when it changes.
// onWork redraws the rows when the lineup on show changes (their in-lineup mark); onMode swaps in that mode's columns.
const panel = createPanel({ el: $("opt"), lineupsEl: $("lineups"), onView: (v) => setView(v), onTabs: () => renderTop(), isLineupsView: () => S.view === "lineups", api, toast, tryStore, dash, ctx: () => ({ name: S.name, byId: S.byId, outList: S.slate?.out ?? [], outNames: S.outNames, knownName: (id) => S.known.get(id)?.name ?? null, knownRow: (id) => S.known.get(id) ?? null, pull: pullOf(S.slate), refreshGen: S.refreshGen, players: S.players, picks: livePicks(), settled, ovKey: ovKeyOf(), colourOf }), onLateSwap: () => { drawTop(); applyFullScreen(); renderHead(); renderRows(); }, onWork: () => renderRows(), onMode: (m) => columns.setMode(m), onClearLocks: () => savePicks({ locked: [], excluded: livePicks().excluded }), onMemory: () => rememberView() });
// The table's own columns, ticked and ordered by Adam per mode (columns.js); the list's and the table's redraws keep each other.
const columns = columnsControl({ btn: $("colsBtn"), pop: $("colPop"), mode: panel.mode, tryStore, onChange: () => { if (S.slate) { renderHead(); fixTableWidth(); } } });
const shownCols = () => columns.keys({ lateSwap: Boolean(panel.lateSwap()) });
// The scenario console (console.js), the page's other view; each change there hands back the players' effective figures, as an override save does.
const scenarioConsole = createConsole({ el: $("console"), api, toast, colourOf: (t) => colourOf(t).t1, onPlayers: (players) => applyPlayers(players),
  news: { slateData: () => (S.slate ? { ...S.slate, players: S.players } : null), tips: () => { const ref = slateRefMs(S.name) ?? Date.now(); return { tip: (t) => shortTime(t, ref), tipAt: (t) => tipMs(t, ref) }; } }, // the lineup news strip and Status column (same inputs as the News tab)
  onWork: () => { boardMarks.refresh({ news: false }); lineupBar.newsOnly(); } });
// The console's word on each row (board-marks.js): the S chip, and his typed Min and DK/m TON with their undo chips; those cells write through the console.
const boardMarks = createBoardMarks({ api, slate: () => S.name, console: scenarioConsole, toast, pullAt: () => pullOf(S.slate).label, players: () => S.players, onChange: () => { if (!S.slate) return; card.badge(); if (formHasFocus()) { S.rowsLater = true; return; } renderRows(); }, noteEl: $("updline").insertAdjacentElement("beforebegin", Object.assign(document.createElement("div"), { hidden: true })) });
// The lineup bar above the list (lineup-bar.js): an Out or a confirmed start from the Monster, RotoWire and RotoGrinders pages applies itself through the console, with an undo X; a projected start is words only.
const lineupBar = createLineupBar({ api, slate: () => S.name, players: () => S.players, slateData: () => S.slate, tips: () => { const ref = slateRefMs(S.name) ?? Date.now(); return { tip: (t) => shortTime(t, ref), tipAt: (t) => tipMs(t, ref) }; }, console: scenarioConsole, toast, tryStore, tick: true, onLabel: (l) => { S.news = l; renderTop(); }, onModel: (m) => { const f = confirmedByGame(m); if (JSON.stringify(f) !== JSON.stringify(S.fives)) { S.fives = f; if (S.slate) renderGames(); } }, applyInPage: Boolean(globalThis.nbadfsSitePull) });
const applyFullScreen = createFullScreen({ panel, tryStore, stickyHeights: () => stickyHeights(), fixTableWidth: () => fixTableWidth() }); // Full screen button (board-fullscreen.js)
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
  const next = v === "lineups" ? v : "list"; // the News tab is gone (Adam 11-17): its news is the Console's All teams page
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
  saveView(tryStore, S.name, { tab: S.tab, q: S.q, game: S.game, pickFilter: S.pickFilter, teams: S.teams, minSal: S.minSal, maxSal: S.maxSal, sort: S.sort, ...panel.memory() });
}

mountLateSwap(); // the Late swap tab and screen (lsw-main.js)

// ---------- loading ----------
/** The slate's rows as the board holds them: each with his opponent's words. */
function boardRows(slate) {
  const home = new Map(slate.games.map((g) => [g.game, g.home]));
  return slate.players.map((p) => ({ ...p, oppText: p.opponent ? (home.get(p.game) === p.team ? "vs " : "@ ") + p.opponent : null }));
}
let loadGen = 0, loadsOpen = 0; // the newest load wins: an older one that comes back late is dropped; no refresh check runs while one is in flight
async function loadSlate(name, slates = null) {
  const gen = ++loadGen;
  loadsOpen++;
  try { await loadSlateNow(name, slates, gen); } finally { loadsOpen--; }
}
async function loadSlateNow(name, slates, gen) {
  await refresher.baseline(name);
  const [slate, picks] = await Promise.all([api(`/api/slate/${encodeURIComponent(name)}`), api(`/api/slate/${encodeURIComponent(name)}/picks`)]);
  if (gen !== loadGen) return; // superseded by a later pick
  if (slates) S.slates = slates; // the list is taken only once the slate it brings is in hand
  card.close();
  editors.drop();
  S.name = name; S.slate = slate; S.picks = { locked: picks.locked, excluded: picks.excluded }; S.dropped = picks.dropped ?? []; S.rosterDropped = [];
  S.players = boardRows(slate);
  S.byId = new Map(S.players.map((p) => [p.dk_id, p]));
  S.held = new Map(); S.known = new Map(); S.outNames = outNamesOf(slate); S.refreshGen++; S.topStale = false; S.consolePull = pullOf(slate).key;
  S.upd = { updatedMs: Date.now(), failed: S.upd.failed, added: [], removed: [] };
  const view = loadView(tryStore, name, { tabs: TABS, teams: teamsOf(S.players), games: slate.games.map((g) => g.game), sortKeys: SORT_KEYS });
  setFilters(view);
  S.sort = view.sort; S.outOpen = false; // the Out list is closed on every load (never restored)
  // One colour per team for this slate, chosen so no two teams' shades look alike (colours.js).
  const onSlate = [...S.players.map((p) => p.team), ...slate.games.flatMap((g) => [g.away, g.home])].filter(Boolean);
  S.colours = assignColours(onSlate, Object.fromEntries(onSlate.map((t) => [t, paletteOf(t)])));
  history.replaceState(null, "", slateQuery(name, S.slates, scenarioConsole.isOn(), location.pathname));
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
  renderSources();
  if (S.upd.updatedMs == null || !S.slate) { el.hidden = true; return; }
  const full = numbersLine();
  // Main view: only a real problem, one short line; the whole line lives under "Sources and pull times" (and in the hover).
  const short = S.upd.failed ? "Could not check for new numbers; may be stale" : S.upd.waiting ? "New numbers waiting; they go on when you finish" : "";
  el.hidden = !short;
  el.classList.toggle("stale", Boolean(S.upd.failed));
  el.textContent = short;
  el.title = full;
}
const numbersLine = () => (S.upd.updatedMs == null || !S.slate ? "" : statusLine({ ...S.upd, pull: pullOf(S.slate).label, consoleOpen: scenarioConsole.isOn() && S.consolePull !== pullOf(S.slate).key }));
/** The collapsed "Sources and pull times" list at the foot of the page: the stamps, projection source, numbers line and box score line. */
function renderSources() {
  const el = $("sources"), s = S.slate, bc = $("bcheck");
  const foot = checkFootHtml(s?.board_check) + hisPoolHtml(s?.his_in_pool) + outPoolHtml(s?.out_pool); // the board's self-check (G65): only what he must act on, at the foot of the Player list only (board.css hides it on the other tabs)
  bc.innerHTML = foot; bc.hidden = !foot; // the explaining note lines are never on the page (Adam 11-19); they stay in the API answer
  if (!s) { el.hidden = true; return; }
  const t = (raw) => when(raw) ?? null;
  const { board, injuries } = topStamps(s);
  const box = boxNote(s.box_freshness), missed = absenceNote(s.absence_state); // the missed-games line (server/boxes/absence.js) sits with the box score line at the foot
  el.hidden = false;
  el.innerHTML = sourcesHtml(sourceRows({ board: t(board), injuries: t(injuries), pulled: t(s.as_of?.pull_started), lock: t(s.lock), slate: s, numbers: numbersLine() }), [...(box.text ? [["Box scores", box.text, true]] : []), ...(missed.text ? [["Games missed", missed.text.replace(/^Games missed: /, ""), true]] : [])]);
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
  renderBoxNote();
  renderGames(); renderTeamChips(); renderRows(); renderOuts(); renderPick();
  panel.afterRoster(out); // the working lineup without who left; saved cards read again, always on the latest figures (Adam, 11-04)
  // The table holds a measured width; a man added or removed may change it. The console hides the table, and measures on the way back.
  if (changed && !scenarioConsole.isOn()) fixTableWidth();
  if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
  boardMarks.refresh(); // a new pull: TwoGun's flags may have moved; the lineup bar follows the console's new inputs below, so it never reads the old model
  scenarioConsole.onPull(S.name).then((ok) => { if (ok && S.slate) { S.consolePull = pullOf(S.slate).key; renderUpdLine(); } }).catch((e) => toast(`The console could not check the new pull: ${e.message}`, "err")).then(() => lineupBar.refresh()); // the console has the new pull, so its line stops asking to reopen it; his marks are sent over the new pull with no click (console.js onPull)
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
/** The forms a redraw would disturb: the team-limit and ownership-rule boxes, and a slot picker. A number box in a row is handled apart, row by row. */
const formHasFocus = () => Boolean(document.activeElement?.matches?.("#opt [data-ov], #opt [data-lr], select[data-lspin], .psel, .rpin, #console input.fin"));
const refresher = createRefresher({
  api, name: () => S.name, busy: () => panel.running() || formHasFocus() || press.pressing(), saves: saves.saveCount, apply: applyFresh,
  status: ({ failed, waiting = false }) => { S.upd = { ...S.upd, failed, waiting }; renderUpdLine(); },
  onBoxes: async (slate) => { // the box score line and its Data warnings entry, in step with the stored boxes between pulls (box-note.js freshBoxes); nothing on the site
    const f = await freshBoxes(S.slate, () => api("/api/boxes/freshness"));
    if (!f || slate !== S.name || !S.slate) return;
    S.slate = { ...S.slate, box_freshness: f };
    renderBoxNote(); drawTop();
  },
  onNews: () => Promise.all([scenarioConsole.onPull(S.name).catch((e) => toast(`The console could not read the new inputs: ${e.message}`, "err")).then(() => lineupBar.refresh()), boardMarks.refresh()]), // the console's inputs first, so the bar's chart order is from this read; a lineup-only update: the News tab and the S chips; the rows redraw for the chips only, and wait while a form has focus (boardMarks' onChange)
});
document.addEventListener("focusout", () => setTimeout(() => { if (S.rowsLater && S.slate && !formHasFocus()) { S.rowsLater = false; renderRows(); } }, 0)); // the redraw that waited for him to leave the form
/** Re-reads the slate list: a slate that appeared joins the menu, and the board moves to it when he was on the previous newest (slate-refresh.js followNewest); an older pick stays. */
let syncing = false;
async function syncSlates() {
  if (syncing || loadsOpen || !S.name) return;
  syncing = true;
  let what = "the slate list could not be read";
  try {
    const r = followNewest({ before: S.slates, fresh: (await api("/api/slates")).slates, showing: S.name });
    if (r.slates === S.slates) return;
    if (r.switchTo) {
      // Held while a build runs, a form or the slate menu has focus, late swap or the console is open; the list is kept as it was, so the next check tries again.
      if (panel.running() || formHasFocus() || document.activeElement?.id === "slateSel" || panel.lateSwap() || scenarioConsole.isOn()) return;
      what = `could not open ${r.switchTo}`;
      await loadSlate(r.switchTo, r.slates);
    } else { S.slates = r.slates; drawTop(); }
  } catch (e) { S.upd = { ...S.upd, failed: { ms: Date.now(), reason: `${what} (${e.message})` } }; renderUpdLine(); }
  finally { syncing = false; }
}
const checkAll = async () => { await syncSlates(); if (!loadsOpen) await refresher.tick(); };
const pullNow = createPullNow({ reload: () => checkAll(),runner: globalThis.nbadfsSitePull ?? null, firstTipMs: () => firstTipOf(S.players, slateRefMs(S.name) ?? Date.now()) }); // the header's Pull now (pull-now.js); new numbers land through the refresh above

// ---------- header ----------
/** The box score line lives under Sources and pull times and in Data warnings, nothing at the top; a box-score change only redraws the Sources list (the site, which has no box freshness, shows none). */
function renderBoxNote() {
  renderSources();
}
function renderTop() {
  const s = S.slate; if (!s) return;
  $("top").innerHTML = topHtml({ s, slates: S.slates, name: S.name, view: S.view, news: S.news, consoleOn: scenarioConsole.isOn(), panel, pullNow, theme, when });
}
function renderDropNote() {
  const el = $("dropnote");
  const d = [...S.dropped, ...S.rosterDropped];
  el.hidden = !d.length;
  el.innerHTML = d.length ? `${d.length} saved pick${d.length === 1 ? "" : "s"} no longer on this slate, removed` : "";
  el.title = d.join(", ");
}

// ---------- games strip ----------
// Numbers light up by tier (see highlight.js): game totals in house amber, team totals in the team's own colour.
function renderGames() {
  $("games").innerHTML = gamesHtml({ slateGames: S.slate.games, players: S.players, game: S.game, fives: S.fives, colourOf, when, dash });
  fitGames();
}

/** The game boxes fill the strip's full width: one row when every game fits at the box floor, else two rows with row 1 filled first (Adam 7:21 PM 11-18).
 *  Never a third row. GAME_MIN_REM is a box's content at its narrowest (tip, O/U, logo, code, spread, implied points), measured in the browser
 *  with the game CSS (board.css .game, .side): nothing cut at that width. GAP_REM is the strip's gap (board.css .games). */
const GAME_MIN_REM = 12.27, GAP_REM = 0.5;
function fitGames() {
  const el = $("games"), n = el.children.length;
  if (!n || !el.clientWidth) return;
  const px = remScale() * 16; // one rem in px at this root size
  const cap = Math.max(1, Math.floor((el.clientWidth + GAP_REM * px) / (GAME_MIN_REM * px + GAP_REM * px))); // most boxes one row holds at the floor
  const cols = n <= cap ? n : n <= 2 * cap ? cap : Math.ceil(n / 2); // row 1 filled first; past 2 rows the boxes would need to be narrower
  el.style.gridTemplateColumns = `repeat(${cols}, minmax(${GAME_MIN_REM}rem, 1fr))`;
}

// ---------- table ----------
function visible() {
  const rows = filterPlayers(S.players, S, S.picks);
  return rows.sort((a, b) => comparePlayers(a, b, S.sort, minSourceOf(S.slate)));
}
function renderHead() { $("thead").innerHTML = headHtml(shownCols(), S.sort, headTitle, minSourceOf(S.slate)); }
/** A season-figure column's tooltip (board-views.js). */
const headTitle = (c) => viewHeadTitle(S.slate, S.players, c);
function renderRows() {
  const rows = visible();
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
    $("tbody").innerHTML = rows.length ? rows.map((p) => rowHtml(p, keys, { minSource: minSourceOf(S.slate), dash, when, colourOf, lock, ex, L, inl, blocks, limits: panel.limits(), marks: boardMarks.of })).join("") : `<tr><td colspan="${keys.length}" class="nores">No players match.</td></tr>`;
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
  const root = document.documentElement.style, h = (el) => el?.getBoundingClientRect().height ?? 0, s = remScale();
  root.setProperty("--fbarh", `${$("fbar").offsetHeight}px`);
  const first = document.querySelector("#thead tr:last-child th:first-child");
  root.setProperty("--plleft", `${first?.classList.contains("ctl") ? Math.ceil(first.getBoundingClientRect().width) : 0}px`);
  root.setProperty("--luh", `${Math.ceil(h(document.querySelector("#opt .lu"))) + 4 * s}px`);
  root.scrollPaddingTop = `${Math.ceil(h($("fbar")) + h($("thead"))) + 4 * s}px`;
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
// The Locked / Excluded / Starred chips and Reset all overrides (board-views.js chipsHtml).
function renderChips() {
  $("chips").innerHTML = chipsHtml({ players: S.players, picks: S.picks, byId: S.byId, pickFilter: S.pickFilter, slate: S.slate });
  // The gap chip rides the team-chip row: the toolbar's first row has no room for it at 1920 (renderTeamChips rebuilds that row, and renderRows follows it).
  $("teamChips").querySelector(".gapchip")?.remove();
  $("teamChips").insertAdjacentHTML("afterbegin", gapChipHtml(S.players, S.pickFilter === "gap"));
}
/** The Out list (board-views.js outsHtml), closed on every load. */
function renderOuts() { $("outs").innerHTML = outsHtml({ out: S.slate.out ?? [], outOpen: S.outOpen, colourOf }); }
const renderPick = () => { panel.render(); card.refresh(); };
function renderAll() { renderTop(); renderDropNote(); renderBoxNote(); renderGames(); renderTabs(); renderTeamChips(); renderHead(); renderRows(); renderOuts(); renderPick(); }

function toggle(id, kind) {
  const other = kind === "locked" ? "excluded" : "locked";
  const live = livePicks(); // a save names only men on the slate: the server refuses any other
  const has = live[kind].includes(id);
  savePicks({ [kind]: has ? live[kind].filter((x) => x !== id) : [...live[kind], id], [other]: has ? live[other] : live[other].filter((x) => x !== id) });
  if (kind === "excluded" && !has) panel.dropMan(id); // an excluded man leaves the working lineup (a build would refuse him)
}

/** The figures a build scores from Adam's overrides, as one string: the panel compares it before and after a build to say
 *  "built before your last projection or ownership change" (stars leave it unchanged). */
function ovKeyOf() {
  return overrideKey(S.players);
}
/** Takes the override fields from the server's players onto the board's (keeping the season figures and the opponent text). */
function applyPlayers(players) {
  saves.countSave();
  const fresh = new Map((players ?? []).map((p) => [p.dk_id, p]));
  // His In or Out call can add or drop a man from the server's pool (out-pool.js): when the server's men are not the board's, the slate is read again instead of patched.
  if (S.name && fresh.size && (fresh.size !== S.byId.size || [...fresh.keys()].some((id) => !S.byId.has(id)))) { loadSlate(S.name); return; }
  const withAnswer = (p) => {
    const f = fresh.get(p.dk_id);
    if (!f) return p;
    return takeAnswer(p, f);
  };
  S.players = S.players.map(withAnswer);
  S.held = new Map([...S.held].map(([id, row]) => [id, row && withAnswer(row)])); // a row waiting on his box takes the answer too
  S.byId = new Map(S.players.map((p) => [p.dk_id, p]));
  renderRows(); renderPick();
  lineupBar.redraw(); // the News tab shows his applied minutes at once (it reads S.players, which this just updated)
  refreshCheck();
}
let checkTimer = null;
/** The foot's self-check follows a save or a console apply (G65): asked again a moment after the last one; nothing on the site, whose slate carries no check. */
function refreshCheck() {
  clearTimeout(checkTimer);
  if (!S.slate?.board_check) return;
  checkTimer = setTimeout(async () => {
    const name = S.name;
    try {
      const bc = await api(`/api/board-check/${encodeURIComponent(name)}`);
      if (name === S.name && S.slate) { S.slate = { ...S.slate, board_check: bc }; renderSources(); }
    } catch (e) { console.warn("The board self-check could not be refreshed:", e.message); }
  }, 1200);
}
// The typed Proj and Own boxes (cell-editor.js, standard A3).
const editors = createEditors({
  root: $("tbody"), rowOf: (id) => S.byId.get(id), toast, onClosed: () => press(() => setTimeout(flushHeld, 0)), limits: { current: (kind, id) => panel.limits()[id]?.[kind] ?? null, outcome: (kind, id, text) => panel.limitOutcome(kind, id, text) },
  save: (kind, id, v, settle) => (kind === "min" || kind === "max" ? (limitPatch($("tbody"), kind, id, v), panel.setLimit(kind, id, v, settle)) : kind === "cmin" || kind === "crate" ? boardMarks.setPin(id, kind === "cmin" ? "m" : "d", v) : saveOverride({ [kind]: { [id]: v } }, kind === "proj" ? "the projection" : "the ownership")),
});
// The thumbs pairs are redrawn with the rows, so one listener on the table body serves them all (bump-control.js).
delegateBumpClicks($("tbody"), { rowOf: (id) => S.byId.get(id), onBump: (id, stepsAt) => saveOverride(() => bumpPatch(id, stepsAt()), "the projection bump") });

// A click on a player row (Adam, 5:34 PM ET 2026-10-29): the man goes into the working lineup, or out when he is in it.
// Never on a control: the star, lock and exclude cells, the name (it opens his card), the reset, the thumbs cell, an
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
  const t = e.target.closest("[data-sort],[data-tab],[data-game],[data-dk-id],[data-out-i],[data-out-name],[data-lock],[data-excl],[data-unpick],[data-chip],[data-view],[data-theme],[data-star],[data-reset],[data-edit],[data-unmark],[data-fteam],[data-shade],#ovReset,#clearF,#notesBtn,#lsBtn,#csBtn,#outTog");
  if (!t) { const l = $("notesList"); if (l && !e.target.closest(".notes")) l.hidden = true; return; }
  const d = t.dataset;
  if (t.id === "notesBtn") { const l = $("notesList"); l.hidden = !l.hidden; }
  else if (d.view) { card.close(); if (scenarioConsole.isOn()) setConsole(false); setView(d.view); } // a tab leaves the console, so the bar shows where you are
  else if (t.id === "lsBtn") { setView("list"); panel.toggleLateSwap().then(fixTableWidth); }
  else if (t.id === "csBtn") setConsole(!scenarioConsole.isOn());
  else if (t.id === "outTog") { S.outOpen = !S.outOpen; renderOuts(); $("outTog")?.focus({ preventScroll: true }); }
  else if (d.shade) setTheme({ light: d.shade === "light" });
  else if (t.id === "clearF") { setFilters(noFilters()); renderGames(); renderTabs(); renderTeamChips(); renderRows(); }
  else if (d.fteam) { S.teams = S.teams.includes(d.fteam) ? S.teams.filter((x) => x !== d.fteam) : [...S.teams, d.fteam]; renderTeamChips(); renderRows(); }
  else if (d.sort) { S.sort = S.sort.key === d.sort ? { key: d.sort, dir: -S.sort.dir } : { key: d.sort, dir: d.sort === "name" ? 1 : -1 }; renderHead(); renderRows(); }
  else if (d.tab) { S.tab = d.tab; renderTabs(); renderRows(); }
  else if (d.game) { S.game = S.game === d.game ? null : d.game; renderGames(); renderRows(); }
  else if (d.dkId) { const man = S.byId.get(d.dkId); if (man) card.open(man); else toast("He is not in the slate on this page."); }
  else if (d.outI) card.open(outMan(S.players, S.slate.out[+d.outI]));
  else if (d.outName) { const o = (S.slate.out ?? []).find((x) => x.name === d.outName && x.team === d.outTeam), on = S.players.find((p) => p.name === d.outName && p.team === d.outTeam); if (o) card.open(outMan(S.players, o)); else if (on) card.open(on); else toast("He is not on this slate's Out list."); }
  else if (d.lock) toggle(d.lock, "locked");
  else if (d.excl) toggle(d.excl, "excluded");
  else if (d.unpick) { const live = livePicks(); savePicks({ locked: live.locked.filter((x) => x !== d.unpick), excluded: live.excluded.filter((x) => x !== d.unpick) }); }
  else if (d.chip) { S.pickFilter = S.pickFilter === d.chip ? null : d.chip; renderRows(); }
  else if (d.theme) setTheme({ dark: d.theme });
  else if (d.star) { const id = d.star; saveOverride(() => ({ stars: { [id]: !S.byId.get(id)?.starred } }), "the star"); }
  else if (d.reset) saveOverride({ reset: d.reset }, "the reset");
  else if (d.unmark) boardMarks.drop(d.id, d.unmark);
  else if (d.edit) editors.openNumber(t);
  else if (t.id === "ovReset") askConfirm(CONFIRM.resetAll, { ok: "Reset" }).then((yes) => { if (yes) saveOverride({ resetAll: true }, "the reset"); });
});
// A name that opens a card is a tab stop (role button); Enter or Space on it is the same click.
document.addEventListener("keydown", (e) => {
  if ((e.key !== "Enter" && e.key !== " ") || e.target.tagName === "BUTTON" || !e.target.matches?.("[role=button][data-dk-id],[role=button][data-out-name]")) return;
  e.preventDefault();
  e.target.click();
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
if (typeof ResizeObserver === "function") new ResizeObserver(() => fitGames()).observe($("games")); // the strip narrows when the player panel docks (R11), with no window resize to go on
if (typeof MutationObserver === "function") new MutationObserver(stickyHeights).observe($("opt"), { childList: true }); // the panel redraws its band: --luh follows it
let resizeTimer;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { fixTableWidth(); }, 150); }); // the game tiles refit through their own observer above
document.fonts?.ready.then(fixTableWidth);

const fail = (e) => { document.querySelector(".work").innerHTML = `<div class="fatal">Could not load the board: ${esc(e.message)}</div>`; };
(async () => {
  applyTheme();
  try {
    S.slates = (await api("/api/slates")).slates;
    if (!S.slates.length) throw new Error("No slates in the archive yet.");
    const query = new URLSearchParams(location.search), want = query.get("slate"), openConsole = query.get("view") === "console";
    await loadSlate(pickSlate(S.slates, want));
    if (openConsole) setConsole(true);
    setInterval(() => checkAll(), CHECK_MS);
  } catch (e) { fail(e); }
})();
