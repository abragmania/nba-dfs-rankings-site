// The NBA board page: loads a slate from the API and draws the header, games strip, player table, Out chips and optimizer panel.
// Every figure is read from the slate file or its route as given; a missing one is shown as an em dash with a title, never zero.
import { paletteOf, teamColors } from "./teams.js";
import { assignColours } from "./colours.js";
import { sourceRows, sourcesHtml } from "./sources-panel.js";
import { checkFootHtml, hisPoolHtml, outPoolHtml } from "./board-check-foot.js";
import { shownPicks } from "./excluded.js";
import { esc, logo, tipWhen, tipMs, slateRefMs, shortTime, topStamps, keepFocus, remScale } from "./board-util.js";
import { createPanel } from "./panel.js";
import { initCard, figureSource } from "./card.js";
import { cardRoles } from "./card-role.js";
import { stepMinutes } from "./min-step.js";
import { bumpPatch } from "./bump-control.js";
import { bumpOf } from "./instant-overrides.js";
import { createRowPatch } from "./row-patch.js";
import { inPoolView, DEFAULT_POOL_VIEW, POOL_VIEWS, withoutOldFilter } from "./pool-view.js";
import { createPickClicks } from "./pick-clicks.js";
import { fitGameStrip } from "./games-fit.js";
import { createEditors } from "./cell-editor.js";
import { askConfirm, CONFIRM } from "./confirm.js";
import { columnsControl, sortNote } from "./columns.js";
import { headHtml, rowHtml, SORT_KEYS, comparePlayers, minSourceOf, gapChipHtml } from "./player-table.js";
import { boxNote, absenceNote, freshBoxes } from "./box-note.js";
import { CHECK_MS, takeAnswer, applyHeld, createRefresher, followNewest, mergeFresh, outNamesOf, pickSlate, slateQuery, overrideKey, picksOnBoard, pullOf, rememberRows, rosterCleanup, statusLine } from "./slate-refresh.js";
import { pressSettle } from "./press-settle.js";
import { createPullNow, firstTipOf } from "./pull-now.js";
import { noFilters, filtersOn, filterPlayers, salaryRange, teamsOf, actsOnMan, clearSearch } from "./filters.js";
import { limitPatch } from "./row-limits.js";
import { loadView, saveView, DEFAULT_SORT } from "./view-memory.js";
import { loadTheme, saveTheme, themeClasses } from "./theme.js";
import { createConsole } from "./console.js";
import { createScenarioTab } from "./scenario-tab.js";
import { createLineupBar } from "./lineup-bar.js";
import { createBoardMarks } from "./board-marks.js";
import { confirmedByGame } from "./game-borders.js";
import { mountLateSwap, lateSwapNoChanged } from "./lsw-main.js";
import { createOptStrip } from "./opt-strip.js";
import { createToast } from "./toast.js";
import { createSaves, picksByMode, carriedLine, troubleLine, footOf, PICK_MODES, marksLines } from "./board-saves.js";
import { workCarriedLine } from "./work-panel.js";
import { createFullScreen } from "./board-fullscreen.js";
import { topHtml, gamesHtml, headTitle as viewHeadTitle, chipsHtml } from "./board-views.js";
import { createNoPicks, noChipHtml, combineSettled, LATE } from "./no-picks.js";
import { createWaitParts, sendHold, waitToBuild } from "./build-progress.js";

const $ = (id) => document.getElementById(id);
const TABS = ["ALL", "PG", "SG", "SF", "PF", "C", "G", "F"];
/** The slate's assigned colours for a team, {t1, t2}; the fixed table's colours if the team is not on the slate. */
const colourOf = (t) => (S.colours?.[t] ? { t1: S.colours[t].main, t2: S.colours[t].second } : teamColors(t));

const S = { slates: [], name: null, slate: null, players: [], byId: new Map(), picks: { Cash: { locked: [], excluded: [] }, GPP: { locked: [], excluded: [] } }, picksFoot: null, dropped: [], ...noFilters(), sort: { ...DEFAULT_SORT }, outOpen: false, poolView: DEFAULT_POOL_VIEW /* In every time the page opens (pool-view.js) */, held: new Map(), known: new Map(), outNames: new Set(), refreshGen: 0, topStale: false, consolePull: null, rosterDropped: [], upd: { updatedMs: null, failed: null, waiting: false, added: [], removed: [] } };
/** The picks as the board acts on them (slate-refresh.js picksOnBoard): the optimizer's open mode's own (Adam 11-14, 11-19, 11-20: Cash and
 *  GPP keep separate locks and excludes), so the Player list, the card, the panel and every click show and change that mode's only. */
const livePicks = () => picksOnBoard(S.picks[panel.mode()], S.byId);
/** The foot rows for what is still carried from before Cash and GPP were kept apart: picks and the working lineup (none once each mode has saved its own). */
const carriedRows = () => [["Picks", [carriedLine(S.picksFoot?.carried), troubleLine(S.picksFoot, "locks and excludes")]], ["Working lineup", [workCarriedLine(panel.workFoot()?.carried), troubleLine(panel.workFoot(), "working lineup")]], ["Thumbs and stars", marksLines(S.slate?.marks)]].map(([k, v]) => [k, v.filter(Boolean).join(" "), v[1] !== ""]).filter(([, v]) => v); // an unreadable or emptied mode in red (review 11-20)
/** Both modes' saved lists in one, for naming the men a new pull took off the slate (settleRoster). */
const allSaved = () => ({ locked: [...new Set(PICK_MODES.flatMap((m) => S.picks[m].locked))], excluded: [...new Set(PICK_MODES.flatMap((m) => S.picks[m].excluded))] });
/** What the Player list shows: his saved picks plus the men not playing tonight, excluded as a derived state (excluded.js, Adam 11-19: nobody leaves the pool). Saves always send livePicks. */
const shown = () => shownPicks(livePicks(), S.players);
/** A man's name, on the slate or remembered from an earlier pull this page held; his id when never seen. */
const nameOf = (id) => S.byId.get(id)?.name ?? S.known.get(id)?.name ?? `DraftKings id ${id}`;

// Browser storage holds per-viewer conveniences only (theme, the optimizer's typed settings), the one use the storage
// rule allows; when it throws (private window, blocked site data) the page works without it and says so in the console.
const tryStore = (fn) => { try { return fn(); } catch (e) { console.warn("Browser storage unavailable:", e.message); return null; } };
const toast = createToast(); // the message beside the clicked control (toast.js)
const api = async (url, opts) => {
  const r = await fetch(url, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error?.message ?? `HTTP ${r.status}`), { code: body.error?.code, status: r.status }); // status: a refusal (4xx) is told from an unknown outcome (board-saves.js)
  return body;
};
const dash = (title) => `<span class="miss" title="${esc(title)}">—</span>`;
/** A slate stamp in Eastern time; the slate's own date (from its name) settles the year TwoGun's stamps leave out. */
const when = (s) => tipWhen(S.name)(s);
// The picks and override saves (board-saves.js); settled() lets a build wait for picks and override saves in flight, since the server reads the saved locks and the saved overrides.
const saves = createSaves({ S, api, toast, mode: () => panel.mode(), renderRows: () => renderRows(), renderPick: () => renderPick(), renderDropNote: () => renderDropNote(), renderCarried: () => renderSources(), applyPlayers: (p) => applyPlayers(p), over: (row) => boardMarks.over(row) /* his typed minutes on their way, on a copy (instant-pins.js) */, reread: async (n) => { const s = await api(`/api/slate/${encodeURIComponent(n)}`); if (n === S.name) applyPlayers(s.players); } });
const { savePicks, saveOverride } = saves;
// The NO list (no-picks.js, Adam 11-19): per mode, apart from his picks; a build waits for its saves too, since the server reads the saved list.
const noPicks = createNoPicks({ api, toast, slate: () => S.name, mode: () => (panel.lateSwap() ? LATE : panel.mode()), onChange: () => { if (S.slate) renderRows(); lateSwapNoChanged(); }, nameOf: (id) => nameOf(id) });
// A build waits for his typed minutes too (review 11-21 F3): the line hands off what is waiting at once (boardMarks.flush), then the console's send carries it (scenarioConsole.idle). Each part is named, so a wait that runs out says what has not landed (build-progress.js).
const waitParts = createWaitParts([["your locks, excludes and board changes", saves.settled], ["the NO list", noPicks.settled], ["your typed minutes", () => boardMarks.flush()], ["the console's send to the board", () => scenarioConsole.idle()]]);
const settled = waitParts.settled, sendHoldNow = () => sendHold(scenarioConsole.syncState());
/** The late swap screens' wait (lsw-main.js): every save lands first; check (a re-optimize) also waits for the console's send as a build does, and throws the refusal or his No. */
async function allSettled({ check = false } = {}) {
  const r = await waitToBuild({ settled, open: waitParts.open, hold: check ? sendHoldNow : undefined });
  if (!r || !check) return;
  if (r.refuse) throw new Error(r.refuse.replace("Nothing was built", "Nothing was re-optimized"));
  if (!(await askConfirm(r.words.replace("Build without it?", "Re-optimize without it?"), { ok: "Re-optimize without it", cancelFirst: true }))) throw new Error("Nothing was re-optimized: your change has not reached the board yet.");
}
// The player panel (card.js), docked on the right; it closes itself on Esc. A man's figures follow the board's copy of him (a man from the
// Out list has none and stays as he was opened).
const card = initCard({ root: document.body, dash, colourOf, picks: () => shown(),
  figs: () => ({ source: figureSource(S.slate), asOf: when(topStamps(S.slate).board) }),
  current: (p) => S.byId.get(p.dk_id) ?? p, marks: (id) => boardMarks.of(id), newsState: () => boardMarks.newsState(), onDock: () => { fixTableWidth(); stickyHeights(); }, roles: cardRoles({ api: () => scenarioConsole, slate: () => S.name, toast }) });
new MutationObserver(() => { if (document.body.classList.contains("lsw-on")) card.close(); }).observe(document.body, { attributes: true, attributeFilter: ["class"] }); // Late swap lists entries, not names: the panel is for the Player list and the Console, so it closes when that screen opens
createOptStrip({ el: $("optstrip"), opt: $("opt"), onWorking: () => card.close() }); // the compact optimizer row over the table while the player panel is open (opt-strip.js)
// The optimizer panel (panel.js).
// Late swap mode lives in the panel; onLateSwap redraws the header switch and the table's slot pickers when it changes.
// onWork redraws the rows when the lineup on show changes (their in-lineup mark); onMode swaps in that mode's columns.
const panel = createPanel({ el: $("opt"), lineupsEl: $("lineups"), onView: (v) => setView(v), onTabs: () => renderTop(), isLineupsView: () => S.view === "lineups", api, toast, tryStore, dash, ctx: () => ({ name: S.name, byId: S.byId, outList: [], outNames: S.outNames, knownName: (id) => S.known.get(id)?.name ?? null, knownRow: (id) => S.known.get(id) ?? null, pull: pullOf(S.slate), refreshGen: S.refreshGen, players: S.players, picks: livePicks(), settled, unsettled: waitParts.open, sendHold: sendHoldNow, ovKey: ovKeyOf(), colourOf, no: noPicks.ids(panel.mode()) /* the open build mode's list, never the late swap list */, noMode: panel.mode(), picksOf: (m) => picksOnBoard(S.picks[m], S.byId), noOf: (m) => noPicks.ids(m) /* one mode's own: a build and an other-mode card read these (review 11-20) */ }), onLateSwap: () => { drawTop(); applyFullScreen(); renderHead(); renderRows(); }, onWork: () => { renderRows(); if (JSON.stringify(carriedRows()) !== S.carriedShown) renderSources(); }, onMode: (m) => { columns.setMode(m); if (S.slate) { saves.restack(); renderRows(); renderPick(); renderSources(); panel.render(); card.refresh(); } } /* the mode's own locks and excludes show (livePicks), and its own thumbs and stars (board-saves.js overlay; Adam 1:24 PM 11-20): the rows, the chips' Starred count and the Lineups tab's star strip */, onClearLocks: () => savePicks({ locked: [], excluded: livePicks().excluded }), onMemory: () => rememberView() });
// The table's own columns, ticked and ordered by Adam per mode (columns.js); the list's and the table's redraws keep each other.
const columns = columnsControl({ btn: $("colsBtn"), pop: $("colPop"), mode: panel.mode, tryStore, onChange: () => { if (S.slate) { renderHead(); fixTableWidth(); } } });
const shownCols = () => columns.keys({ lateSwap: Boolean(panel.lateSwap()) });
// The scenario console (console.js), the page's other view; each change there hands back the players' effective figures, as an override save does.
const scenarioConsole = createConsole({ el: $("console"), api, toast, colourOf: (t) => colourOf(t).t1, onPlayers: (players) => applyPlayers(players),
  news: { slateData: () => (S.slate ? { ...S.slate, players: S.players } : null), tips: () => { const ref = slateRefMs(S.name) ?? Date.now(); return { tip: (t) => shortTime(t, ref), tipAt: (t) => tipMs(t, ref) }; } }, // the lineup news strip and Status column (same inputs as the News tab)
  onWork: () => { boardMarks.refresh({ news: false }); lineupBar.newsOnly(); } });
// The console's word on each row (board-marks.js): the S chip, and his typed Min and DK/m TON with their undo chips; those cells write through the console.
const boardMarks = createBoardMarks({ api, slate: () => S.name, console: scenarioConsole, toast, reload: () => loadSlate(S.name), pullAt: () => pullOf(S.slate).label, players: () => S.players, restack: () => saves.restack(), onChange: () => { if (!S.slate) return; card.badge(); if (formHasFocus()) { S.rowsLater = true; return; } renderRows(); if (panel.swapOpen()) panel.render(); /* an open swap panel's marks and Use follow a guess starting or ending (round 2, item 3) */ }, noteEl: $("updline").insertAdjacentElement("beforebegin", Object.assign(document.createElement("div"), { hidden: true })) });
// The lineup bar above the list (lineup-bar.js): an Out or a confirmed start from the Monster, RotoWire and RotoGrinders pages applies itself through the console, with an undo X; a projected start is words only.
const lineupBar = createLineupBar({ api, slate: () => S.name, players: () => S.players, slateData: () => S.slate, tips: () => { const ref = slateRefMs(S.name) ?? Date.now(); return { tip: (t) => shortTime(t, ref), tipAt: (t) => tipMs(t, ref) }; }, console: scenarioConsole, toast, tryStore, tick: true, onLabel: (l) => { S.news = l; renderTop(); }, onModel: (m) => { const f = confirmedByGame(m); if (JSON.stringify(f) !== JSON.stringify(S.fives)) { S.fives = f; if (S.slate) renderGames(); } }, applyInPage: Boolean(globalThis.nbadfsSitePull) });
const applyFullScreen = createFullScreen({ panel, tryStore, stickyHeights: () => stickyHeights(), fixTableWidth: () => fixTableWidth() }); // Full screen button (board-fullscreen.js)
const scenarioTab = createScenarioTab({ el: $("scenario"), api, toast });
function setScenario(open) {
  if (open && scenarioConsole.isOn()) setConsole(false);
  document.body.classList.toggle("scenario-on", open);
  const q = new URLSearchParams(location.search);
  if (open) q.set("view", "scenario"); else if (q.get("view") === "scenario") q.delete("view");
  history.replaceState(null, "", `?${q}`);
  if (open) scenarioTab.show(S.name); else { scenarioTab.hide(); fixTableWidth(); }
  renderTop();
}
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

mountLateSwap({ noPicks: { ...noPicks, settled: allSettled } }); // the Late swap tab and screen (lsw-main.js); it shows and saves the same late swap NO list, and its re-optimize waits for every save and his typed minutes (review 11-21 F3)

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
  // The picks are read only once every picks save on its way has landed (review 11-21 F2): a read taken across one would show the lists from before his click.
  for (let q = saves.settled(); ; q = saves.settled()) { await q; if (q === saves.settled()) break; }
  const [slate, picks] = await Promise.all([api(`/api/slate/${encodeURIComponent(name)}`), api(`/api/slate/${encodeURIComponent(name)}/picks`)]);
  if (gen !== loadGen) return; // superseded by a later pick
  const another = name !== S.name, left = S.name; // a reload of the slate on show keeps his typed numbers on their way (review 11-21 F1)
  if (another && left) { // his typed numbers go to the slate they were made on and its send ends there before the switch (round 2, item 2); at most the build's cap
    const late = await waitToBuild({ settled: combineSettled(() => boardMarks.flush(), () => scenarioConsole.idle()) });
    if (gen !== loadGen) return;
    if (late) toast(`Your typed numbers on ${left} had not reached the board when the slate changed; they are saved, and go to the board when you open ${left} again.`, "err");
  }
  if (slates) S.slates = slates; // the list is taken only once the slate it brings is in hand
  card.close();
  editors.drop();
  if (another) boardMarks.reset(); // his typed numbers still on their way belong to the slate he left (instant-pins.js)
  S.name = name; S.slate = slate; S.picks = saves.picksFromRead(name, picksByMode(picks), another ? null : S.picks); /* a mode with a save still on its way keeps the page's lists (round 2, item 9) */ S.picksFoot = footOf(picks); S.dropped = picks.dropped ?? []; S.rosterDropped = [];
  S.players = saves.overlay(boardRows(slate)); // his changes still on their way show over the server's rows (board-saves.js)
  S.byId = new Map(S.players.map((p) => [p.dk_id, p]));
  S.held = new Map(); S.known = new Map(); S.outNames = outNamesOf(slate); S.refreshGen++; S.topStale = false; S.consolePull = pullOf(slate).key;
  S.upd = { updatedMs: Date.now(), failed: S.upd.failed, added: [], removed: [] };
  const view = loadView(tryStore, name, { tabs: TABS, teams: teamsOf(S.players), games: slate.games.map((g) => g.game), sortKeys: SORT_KEYS });
  setFilters(withoutOldFilter(view)); // the old Excluded chip's remembered filter is the Out view now (pool-view.js)
  S.sort = view.sort; S.outOpen = false; // the Out list is closed on every load (never restored)
  // One colour per team for this slate, chosen so no two teams' shades look alike (colours.js).
  const onSlate = [...S.players.map((p) => p.team), ...slate.games.flatMap((g) => [g.away, g.home])].filter(Boolean);
  S.colours = assignColours(onSlate, Object.fromEntries(onSlate.map((t) => [t, paletteOf(t)])));
  history.replaceState(null, "", slateQuery(name, S.slates, scenarioConsole.isOn(), location.pathname));
  panel.setSlate(name, view);
  scenarioConsole.setSlate(name);
  scenarioTab.setSlate(name);
  renderAll();
  renderUpdLine();
  fixTableWidth();
  lineupBar.refresh(); noPicks.load(name);
  boardMarks.refresh().then(() => { if (S.name === name && !scenarioConsole.isOn()) fixTableWidth(); }); // the S chips widen the Player column: measured again with them, so the In and Out views hold one width
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
  const carried = carriedRows(); // his locks, excludes and working lineup from before Cash and GPP were kept apart, counted (G62) at the foot (G64)
  S.carriedShown = JSON.stringify(carried);
  el.innerHTML = sourcesHtml(sourceRows({ board: t(board), injuries: t(injuries), pulled: t(s.as_of?.pull_started), lock: t(s.lock), slate: s, numbers: numbersLine() }), [...(box.text ? [["Box scores", box.text, true]] : []), ...(missed.text ? [["Games missed", missed.text.replace(/^Games missed: /, ""), true]] : []), ...carried]);
}
/** What names men, against the rows now (slate-refresh.js rosterCleanup): a man off the slate leaves the picks and the working lineup, named; a filter on a team or game gone ends. */
function settleRoster() {
  const out = rosterCleanup({
    byId: S.byId, picks: allSaved(), ...panel.rosterInput(), filters: { teams: S.teams, game: S.game }, nameOf,
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
  const { players, held, added, removed } = mergeFresh(saves.bare(S.players), boardRows(slate), editors.openId()); // the server's rows under his pending guesses (board-saves.js), laid over again below
  S.known = rememberRows(S.known, S.players);
  S.slate = slate; S.players = saves.overlay(players); S.held = held; S.refreshGen++;
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
  scenarioTab.refresh();
}
/** He has left the box: the row that waited takes its new figures, and whatever named a man it dropped follows. */
function flushHeld() {
  if (!S.held.size || editors.openId()) return;
  const { scrollX: x, scrollY: y } = window;
  S.known = rememberRows(S.known, S.players);
  S.players = saves.overlay(applyHeld(saves.bare(S.players), S.held));
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
  $("top").innerHTML = topHtml({ s, slates: S.slates, name: S.name, view: S.view, news: S.news, consoleOn: scenarioConsole.isOn(), scenarioOn: scenarioTab.isOn(), panel, pullNow, theme, when });
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
  fitGameStrip($("games")); // games-fit.js
}

// ---------- table ----------
function visible() {
  const sp = shown(), rows = inPoolView(filterPlayers(S.players, S, sp), S.poolView, sp); // the In / Out / All view, then the filters inside it (pool-view.js)
  return rows.sort((a, b) => comparePlayers(a, b, S.sort, minSourceOf(S.slate)));
}
function renderHead() { $("thead").innerHTML = headHtml(shownCols(), S.sort, headTitle, minSourceOf(S.slate)); }
/** A season-figure column's tooltip (board-views.js). */
const headTitle = (c) => viewHeadTitle(S.slate, S.players, c);
function renderRows() {
  const rows = visible();
  const sp = shown(), lock = new Set(sp.locked), ex = new Set(sp.excluded);
  const keys = shownCols();
  // Late swap mode: each row's slot picker takes the lock button's place; a started man outside the working lineup cannot
  // be added, so his row is dimmed. Outside it a click on the row puts the man in the working lineup or takes him out
  // (the row click below); the men in the lineup on show wear the in-lineup mark.
  const L = panel.lateSwap();
  const inl = L ? null : panel.inLineup();
  const blocks = panel.blocked(); // who cannot go in now (A18); null, so nobody greyed, while that is not known
  const no = new Set(noPicks.ids()); // the open list's NO men (the build mode's, or the late swap list in late swap): pink row and tag (no-picks.js)
  renderChips();
  renderFilterMarks();
  rememberView();
  stickyHeights();
  $("cnt").textContent = `${rows.length} player${rows.length === 1 ? "" : "s"}${sortNote(keys, S.sort)}`;
  // A keyboard user keeps his place, and an open box what he typed: the rows redraw on every pick, save and answer from the server, only the rows whose markup changed (row-patch.js).
  const x = { minSource: minSourceOf(S.slate), dash, when, colourOf, lock, ex, L, inl, blocks, limits: panel.limits(), marks: boardMarks.of, no, picksUnknown: livePicks().unreadable ?? null };
  editors.around(() => keepFocus($("tbody"), () => rowPatch.draw(rows.map((p) => ({ id: String(p.dk_id), html: rowHtml(p, keys, x) })), `<tr><td colspan="${keys.length}" class="nores">No players match.</td></tr>`)));
}
const rowPatch = createRowPatch($("tbody"));
// The table is only as wide as its content, so its width would follow the visible rows and the optimizer beside it would
// slide on every filter. After the unfiltered render, measure the table and hold that width for the slate.
function fixTableWidth() {
  if (!S.slate) return;
  const keep = Object.fromEntries(Object.keys(noFilters()).map((k) => [k, S[k]]));
  const table = $("tbody").closest("table");
  table.style.width = "";
  measuring = true;
  const view = S.poolView;
  Object.assign(S, noFilters(), { poolView: "all" }); // measured with every man, the Out men too, so no view moves the optimizer
  renderRows();
  S.poolView = view;
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
// The Locked chip, the In / Out / All switch, the Starred chip and Reset all overrides (board-views.js chipsHtml); written only when they changed, so a click redraws no more than it must.
function renderChips() {
  const html = chipsHtml({ players: S.players, picks: shown(), byId: S.byId, pickFilter: S.pickFilter, slate: S.slate, view: S.poolView, mode: panel.mode() });
  if (S.chipsShown !== html || !$("chips").firstChild) keepFocus($("chips"), () => { $("chips").innerHTML = html; S.chipsShown = html; });
  // The gap chip rides the team-chip row: the toolbar's first row has no room for it at 1920 (renderTeamChips rebuilds that row, and renderRows follows it).
  // The NO chip sits beside the Min gap alert (Adam 11-19), loud and red, naming the open mode's NO men.
  const gap = gapChipHtml(S.players, S.pickFilter === "gap"), noc = noChipHtml({ mode: panel.lateSwap() ? LATE : panel.mode(), ids: noPicks.ids(), nameOf, error: noPicks.error() }), tc = $("teamChips");
  if (S.tcShown === gap + noc && tc.querySelector(".gapchip")) return;
  tc.querySelector(".gapchip")?.remove(); tc.querySelector(".nochip")?.remove();
  tc.insertAdjacentHTML("afterbegin", gap + noc); S.tcShown = gap + noc;
}
/** A NO click on a row: on or off for the open list. A locked NO man is still used, with no note (Adam 6:16 and 6:19 PM 11-19). */
function toggleNo(id) {
  noPicks.toggle(id);
}
/** The old Out list section: never filled (TwoGun's Out list is never read, Adam 11-19). */
function renderOuts() { $("outs").innerHTML = ""; } // TwoGun's Out list is never read or shown (Adam 11-19): every man is in the Player list, an Out man in its Excluded section
const renderPick = () => { panel.render(); card.refresh(); };
function renderAll() { renderTop(); renderDropNote(); renderBoxNote(); renderGames(); renderTabs(); renderTeamChips(); renderHead(); renderRows(); renderOuts(); renderPick(); }

// Lock, Exclude and un-pick clicks, with the In / Out / All toast (pick-clicks.js).
const picks = createPickClicks({ S, api, toast, livePicks, shown, savePicks, panel, loadSlate: (n) => loadSlate(n) });

/** The figures a build scores from Adam's overrides, as one string: the panel compares it before and after a build to say
 *  "built before your last projection or ownership change" (stars leave it unchanged). */
function ovKeyOf() {
  return overrideKey(S.players);
}
/** Takes the override fields from the server's players onto the board's (keeping the season figures and the opponent text). */
function applyPlayers(players) {
  saves.countSave();
  const a = saves.answerRows(players, takeAnswer); // the server's rows with the answer taken (never a guess), then his changes still on their way over them (board-saves.js)
  // An answer with no player list is an unknown outcome, never "nobody" (review 11-21 F11): the slate is read again and the toast says so.
  if (a.kind === "unknown") { toast("The server's answer held no player list, so the slate is read again to show what it holds.", "err"); if (S.name) loadSlate(S.name).catch((e) => toast(`The slate could not be read again (${e.message}); what the server holds is not shown.`, "err")); return; }
  // His In or Out call can add or drop a man from the server's pool (out-pool.js): when the server's men are not the board's, the slate is read again instead of patched.
  if (a.kind === "reload") { if (S.name) loadSlate(S.name).catch((e) => toast(`The slate could not be read again (${e.message}); what the server holds is not shown.`, "err")); return; }
  S.players = a.rows;
  S.held = new Map([...S.held].map(([id, row]) => [id, row && (a.fresh.has(row.dk_id) ? takeAnswer(row, a.fresh.get(row.dk_id)) : row)])); // a row waiting on his box takes the answer too
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
/** A - or + press in a Min cell: the shown whole minute moved by one, kept as his typed minutes like a typed number (boardMarks.setPin, the same path as the Min box). */
function stepRowMinutes(id, dir) {
  const p = S.byId.get(id), v = p ? stepMinutes(p.minutes, dir) : null;
  if (v === null) { toast("There is no minutes figure to step from; click the cell and type his minutes.", "err"); return; }
  boardMarks.setPin(id, "m", v);
}
// The typed Proj and Own boxes (cell-editor.js, standard A3).
const editors = createEditors({
  root: $("tbody"), rowOf: (id) => S.byId.get(id), toast, onClosed: () => press(() => setTimeout(flushHeld, 0)), limits: { current: (kind, id) => panel.limits()[id]?.[kind] ?? null, outcome: (kind, id, text) => panel.limitOutcome(kind, id, text) },
  save: (kind, id, v, settle) => (kind === "min" || kind === "max" ? (limitPatch($("tbody"), kind, id, v), rowPatch.forget(id), panel.setLimit(kind, id, v, settle)) : kind === "cmin" || kind === "crate" ? boardMarks.setPin(id, kind === "cmin" ? "m" : "d", v) : saveOverride({ [kind]: { [id]: v } }, kind === "proj" ? "the projection" : "the ownership")),
});
// The thumbs pairs: one listener on the table body serves them all. A press works its steps out from the row as shown and shows them at once (instant-overrides.js bumpOf), so quick presses stack.
$("tbody").addEventListener("click", (e) => { const btn = e.target.closest?.(".bump-ctl .bump-btn"); const b = btn && !btn.disabled ? bumpOf(btn.dataset.action, S.byId.get(btn.dataset.id)) : null; if (b) { dropSearch(); saveOverride(bumpPatch(b.id, b.steps), "the projection bump"); } });
$("tbody").addEventListener("change", (e) => rowPatch.forget(e.target.closest?.("tr[data-row]")?.dataset.row)); // a slot picker changed by hand is drawn fresh next time

// A click on a player row (Adam, 5:34 PM ET 2026-10-29): the man goes into the working lineup, or out when he is in it.
// Never on a control: the star, lock and exclude cells, the name (it opens his card), the reset, the thumbs cell, an
// editable figure, or an open editor. Not on a greyed row (A18), and not on the press that closed an editor (it only closes
// it). In late swap mode a row click does nothing new (the mode's slot pickers pin men).
const ROW_CONTROLS = "td.ctl, td.bmp, td.lim, button, input, select, a, [data-edit], .ovt, .bump-ctl";
$("tbody").addEventListener("click", (e) => {
  if (panel.lateSwap() || e.target.closest(ROW_CONTROLS) || editors.closedByPress()) return;
  const tr = e.target.closest("tr[data-row]");
  if (tr && !tr.classList.contains("blk") && getSelection?.().isCollapsed !== false) { const id = tr.dataset.row; dropSearch(); panel.rowClick(id); } // a drag to select text is not a pick
});

// ---------- events ----------
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-sort],[data-tab],[data-game],[data-dk-id],[data-out-i],[data-out-name],[data-lock],[data-excl],[data-unpick],[data-chip],[data-view],[data-theme],[data-star],[data-reset],[data-edit],[data-unmark],[data-mrestore],[data-mstep],[data-fteam],[data-shade],[data-no],[data-nox],[data-noclear],[data-noretry],[data-pview],#ovReset,#clearF,#notesBtn,#lsBtn,#csBtn,#snBtn,#outTog");
  if (!t) { const l = $("notesList"); if (l && !e.target.closest(".notes")) l.hidden = true; return; }
  const d = t.dataset;
  if (actsOnMan(d)) dropSearch(); // lock, NO, exclude, star: the search box empties (Adam 11-14)
  if (t.id === "notesBtn") { const l = $("notesList"); l.hidden = !l.hidden; }
  else if (d.view) { card.close(); if (scenarioConsole.isOn()) setConsole(false); if (scenarioTab.isOn()) setScenario(false); setView(d.view); } // a tab leaves the console, so the bar shows where you are
  else if (t.id === "lsBtn") { if (scenarioTab.isOn()) setScenario(false); setView("list"); panel.toggleLateSwap().then(fixTableWidth); }
  else if (t.id === "csBtn") { if (scenarioTab.isOn()) setScenario(false); setConsole(!scenarioConsole.isOn()); }
  else if (t.id === "snBtn") { card.close(); setScenario(!scenarioTab.isOn()); }
  else if (d.pview) { if (POOL_VIEWS.includes(d.pview) && S.poolView !== d.pview) { S.poolView = d.pview; renderRows(); } } // In / Out / All (pool-view.js)
  else if (t.id === "outTog") { S.outOpen = !S.outOpen; renderOuts(); $("outTog")?.focus({ preventScroll: true }); }
  else if (d.shade) setTheme({ light: d.shade === "light" });
  else if (t.id === "clearF") { setFilters(noFilters()); renderGames(); renderTabs(); renderTeamChips(); renderRows(); }
  else if (d.fteam) { S.teams = S.teams.includes(d.fteam) ? S.teams.filter((x) => x !== d.fteam) : [...S.teams, d.fteam]; renderTeamChips(); renderRows(); }
  else if (d.sort) { S.sort = S.sort.key === d.sort ? { key: d.sort, dir: -S.sort.dir } : { key: d.sort, dir: d.sort === "name" ? 1 : -1 }; renderHead(); renderRows(); }
  else if (d.tab) { S.tab = d.tab; renderTabs(); renderRows(); }
  else if (d.game) { S.game = S.game === d.game ? null : d.game; renderGames(); renderRows(); }
  else if (d.dkId) { const man = S.byId.get(d.dkId); if (man) card.open(man); else toast("He is not in the slate on this page."); }
  else if (d.outName) { const on = S.players.find((p) => p.name === d.outName && p.team === d.outTeam); if (on) card.open(on); else toast("He is not on this slate."); }
  else if (d.no) toggleNo(d.no);
  else if (d.nox) noPicks.drop(d.nox);
  else if (t.hasAttribute("data-noclear")) noPicks.clear();
  else if (t.hasAttribute("data-noretry")) noPicks.load();
  else if (d.lock) picks.toggle(d.lock, "locked");
  else if (d.excl) picks.toggle(d.excl, "excluded");
  else if (d.unpick) picks.unpick(d.unpick);
  else if (d.chip) { S.pickFilter = S.pickFilter === d.chip ? null : d.chip; renderRows(); }
  else if (d.theme) setTheme({ dark: d.theme });
  else if (d.star) saveOverride({ stars: { [d.star]: !S.byId.get(d.star)?.starred } }, "the star"); // from the star as shown (instant-overrides.js): a second click turns it back
  else if (d.reset) saveOverride({ reset: d.reset }, "the reset");
  else if (d.mstep) { if (t.closest("#tbody")) stepRowMinutes(d.id, Number(d.mstep)); } // the - and + in a player list Min cell (min-step.js); the console's and the card's own handlers take theirs
  else if (d.unmark) boardMarks.drop(d.id, d.unmark);
  else if (d.mrestore) boardMarks.restore(d.mrestore); // his typed minutes a role change set aside, back in use (Adam 9:46 AM 11-20)
  else if (d.edit) editors.openNumber(t);
  else if (t.id === "ovReset") { const mode = panel.mode(); askConfirm(CONFIRM.resetAll, { ok: "Reset" }).then((yes) => { if (yes) saveOverride({ resetAll: true }, "the reset", mode); }); } // the mode at the click: its thumbs are the ones cleared, whatever is on show once he answers
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
/** An act on a man empties the search box and shows the full list (Adam 11-14; filters.js clearSearch). */
function dropSearch() { clearSearch(S, $("search"), renderRows); }
$("search").addEventListener("input", (e) => { S.q = e.target.value; renderRows(); });
$("minSal").addEventListener("input", (e) => { S.minSal = e.target.value; renderRows(); });
$("maxSal").addEventListener("input", (e) => { S.maxSal = e.target.value; renderRows(); });
if (typeof ResizeObserver === "function") new ResizeObserver(stickyHeights).observe($("fbar"));
if (typeof ResizeObserver === "function") new ResizeObserver(() => fitGameStrip($("games"))).observe($("games")); // the strip narrows when the player panel docks (R11), with no window resize to go on
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
    else if (query.get("view") === "scenario") setScenario(true);
    setInterval(() => checkAll(), CHECK_MS);
  } catch (e) { fail(e); }
})();
