// The scenario console: a keyboard-driven view of the board page for the slate on show. Every number comes from console-engine.js over
// the inputs route; his work saves to the slate's scenarios.json as he goes. Nothing reaches the board until Apply. This file holds the
// shared state, drawing and loading; console-moves.js, console-keys.js and console-applybox.js act on the state.
import { esc } from "./board-util.js";
import { buildModel, recordOf, refreshTeams, tableName } from "./console-model.js";
import { barHtml, pickerHtml, sideHtml, slateHtml, sourceHtml, teamHtml } from "./console-render.js";
import { firstPlaying, pushHist } from "./console-moves.js";
import { HINT, cmdHint, focusCell, onClick, onFocusIn, onFocusOut, onKey, tintCompare } from "./console-keys.js";
import { lanesHtml } from "./console-lanes.js";
import { wireDrag, layoutPref, saveLayout, cardApi } from "./console-card.js";

const KEYS = `<span><kbd>Arrows</kbd><b>move</b></span><span><kbd>type</kbd><b>overwrite</b></span><span><kbd>Enter</kbd><kbd>Tab</kbd><b>commit + move</b></span><span><kbd>Esc</kbd><b>cancel</b></span><span><kbd>=</kbd><kbd>-</kbd><b>small step</b> <kbd>+</kbd><kbd>_</kbd><b>big</b></span><span><kbd>Del</kbd><b>clear pin</b></span><span><kbd>O</kbd><b>out</b></span><span><kbd>Ctrl+Z</kbd><kbd>Ctrl+Y</kbd><b>undo redo</b></span><span><kbd>G</kbd><b>command</b></span><span><kbd>S</kbd><b>slate</b></span><span><kbd>H</kbd><kbd>T</kbd><kbd>[</kbd><kbd>]</kbd><b>scenario</b></span><span><kbd>Alt+1-9</kbd><kbd>&lt;</kbd><kbd>&gt;</kbd><b>team</b></span><span><kbd>A</kbd><b>apply</b></span><span><kbd>R</kbd><b>reverse</b></span><span class="legend"><span><i style="background:var(--cdf)"></i>default</span><span><i style="background:var(--cmv)"></i>moved</span><span><i style="background:var(--cpin)"></i>pinned</span></span>`;
const USAGE_RETRY_MS = 20_000;
const USAGE_RETRIES = 6;

/** A team's bar colour. On the light page a pale colour would vanish, so it is darkened to read. */
function barColour(c, team) {
  const colour = c.colourOf(team);
  if (!document.body.classList.contains("light")) return colour;
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
  if (!m) return colour;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? `color-mix(in srgb, ${colour} 45%, #000)` : colour;
}

function drawBar(c) {
  const failed = Object.values(c.saveErrs);
  const errLine = failed.length ? `<div class="row err">${esc(failed.join(" "))}</div>` : "";
  c.E("bar").innerHTML = errLine + barHtml(c.model, c.G, c.applied);
}

/** The sweep scrolls inside its panel, cut to whole rows above the key bar, so no part-row shows and its heading stays. */
function sizeSweep(c) {
  const box = c.el.querySelector(".sweepx");
  if (!box) return;
  const row = box.querySelector("tbody tr"), head = box.querySelector("thead");
  if (!row || !head) return;
  const z = parseFloat(getComputedStyle(document.body).zoom) || 1;
  const room = c.el.querySelector(".keys").getBoundingClientRect().top - box.getBoundingClientRect().top - 6;
  const headH = head.getBoundingClientRect().height, rowH = row.getBoundingClientRect().height;
  box.style.maxHeight = `${(Math.max(3, Math.floor((room - headH) / rowH)) * rowH + headH) / z}px`;
  box.style.scrollPaddingTop = `${headH / z}px`;
}

/** The team table's name column fits the slate's longest name, so nothing shifts between teams. */
function setNameWidth(c) {
  const longest = Math.max(10, ...Object.values(c.model.TEAMS).flatMap((T) => T.pl.map((p) => tableName(T, p).length + (p.pos ? p.pos.length + 2 : 0))));
  c.el.style.setProperty("--namew", `${longest}ch`);
}

function render(c) {
  const G = c.G;
  if (c.loadError || !c.model || !G.cur) return;
  const colour = (t) => barColour(c, t);
  c.E("picker").innerHTML = pickerHtml(c.model, G, colour, c.inputs.games);
  drawBar(c);
  c.el.querySelector(".shell").classList.toggle("sweepv", G.view === "slate");
  c.el.querySelector(".shell").classList.toggle("lanesv", G.view === "team" && G.layout === "b");
  if (G.view === "slate") c.E("app").innerHTML = slateHtml(c.model, G, colour);
  else if (G.layout === "b") c.E("app").innerHTML = lanesHtml(c.model, G, G.cur, colour(G.cur)); // sets G.rows in lane order
  else {
    G.rows = c.model.TEAMS[G.cur].pl.map((p) => ({ team: G.cur, id: p.id }));
    c.E("app").innerHTML = teamHtml(c.model, G, G.cur, colour(G.cur));
  }
  if (G.rows.length && !G.rows.some((x) => x.team === G.focus.team && x.id === G.focus.id)) G.focus = { team: G.rows[0].team, id: G.rows[0].id, k: G.focus.k };
  c.E("side").innerHTML = sideHtml(c.model, G, colour);
  sizeSweep(c);
  tintCompare(c);
  if (document.activeElement?.id !== "cmd") focusCell(c);
}

/** Console trouble stays in the console: the board underneath is never written over. */
function showError(c, message) {
  c.loadError = message;
  c.model = null;
  for (const id of ["picker", "bar", "side", "srcs"]) c.E(id).innerHTML = "";
  c.E("app").innerHTML = `<div class="fatalc">The console could not load, so nothing here can be trusted or saved: ${esc(message)}</div>`;
}

function takeInputs(c, out) {
  c.inputs = out.inputs;
  c.applied = out.scenarios.applied;
  c.E("srcs").innerHTML = sourceHtml(c.inputs);
}

/** The slate's work loaded, shown or not (the player card asks for it): one load at a time per slate, a second ask waiting on the first. */
function ensure(c, name) {
  if (c.model && c.slate === name) return Promise.resolve();
  if (c.loading?.name === name) return c.loading.p;
  const p = load(c, name).finally(() => { if (c.loading?.p === p) c.loading = null; });
  c.loading = { name, p };
  return p;
}

async function load(c, name) {
  clearTimeout(c.usageTimer);
  Object.assign(c, { slate: name, loadError: null, model: null, usageTries: 0, saveErrs: {} });
  c.E("app").innerHTML = `<div class="dimc fatalc">Loading ${esc(name)}...</div>`;
  try {
    const out = await c.api(`/api/slate/${encodeURIComponent(name)}/console`);
    if (name !== c.slate) return;
    takeInputs(c, out);
    c.model = buildModel(c.inputs, out.scenarios.teams, out.scenarios.applied?.keys);
    c.lastSaved = {};
    for (const code of Object.keys(c.model.ST)) c.lastSaved[code] = JSON.stringify(recordOf(c.model.ST[code]));
    const G = c.G, first = Object.keys(c.model.TEAMS)[0] ?? null;
    Object.assign(G, { cur: first, view: "team", editing: false, modal: null, pick: null, roleMoves: null, hist: [], hi: -1, focus: first ? { team: first, id: firstPlaying(c, first), k: "m" } : null });
    if (!first) return showError(c, "This slate has no games.");
    pushHist(c, "Start");
    setNameWidth(c);
    render(c);
    watchUsage(c);
  } catch (e) {
    if (name === c.slate) showError(c, e.message);
  }
}

/** New inputs on the work on show: his pins stay and the numbers move. Comes on every show, and while the usage table is loading. */
async function refresh(c) {
  const name = c.slate;
  try {
    const out = await c.api(`/api/slate/${encodeURIComponent(name)}/console`);
    if (name !== c.slate || !c.model) return;
    takeInputs(c, out);
    refreshTeams(c.model, c.inputs);
    setNameWidth(c);
    if (c.on && !c.G.editing && !c.G.modal) render(c);
  } catch (e) {
    c.E("cmdhint").textContent = `Could not refresh the inputs: ${e.message}`;
  }
}

function watchUsage(c) {
  clearTimeout(c.usageTimer);
  if (c.inputs?.usage.state !== "loading" || c.usageTries >= USAGE_RETRIES) return;
  c.usageTries++;
  c.usageTimer = setTimeout(async () => { await refresh(c); watchUsage(c); }, USAGE_RETRY_MS);
}

const SHELL = `<div id="picker"></div><div id="cmdbar"><span class="pr">&gt;</span><input id="cmd" placeholder="press G, then type a move" autocomplete="off" spellcheck="false"><span id="cmdhint">${esc(HINT)}</span><div class="grow"></div><div id="srcs"></div></div><div id="bar"></div><div class="shell"><div id="app"></div><div id="side"></div></div><div class="keys">${KEYS}</div><div id="applybox" hidden></div>`;

/** deps: { el, api, toast, colourOf(team) -> css colour, onPlayers(players) }. show() never rejects: its trouble goes to showError. */
export function createConsole({ el, api, toast, colourOf, onPlayers }) {
  el.innerHTML = SHELL;
  const c = {
    el, api, toast, colourOf, onPlayers, on: false, slate: null, inputs: null, model: null, applied: null, loadError: null, lastSaved: {}, saveErrs: {}, saveQueue: Promise.resolve(), usageTimer: null, usageTries: 0,
    E: (id) => el.querySelector(`#${id}`),
    G: { cur: null, view: "team", layout: layoutPref(), pick: null, roleMoves: null, focus: null, hist: [], hi: -1, editing: false, rows: [], modal: null },
    setLayout: (v) => { c.G.layout = v === "b" ? "b" : "a"; c.G.pick = null; saveLayout(c.G.layout); if (c.G.view !== "team") c.G.view = "team"; render(c); },
    render: () => render(c), drawBar: () => drawBar(c), focusCell: () => focusCell(c),
    updateSide: () => { c.E("side").innerHTML = sideHtml(c.model, c.G, (t) => barColour(c, t)); },
  };
  if (typeof window !== "undefined") window.consoleState = c.G; // what the key-driving test reads
  document.addEventListener("keydown", (e) => onKey(c, e));
  el.addEventListener("focusin", (e) => onFocusIn(c, e));
  el.addEventListener("focusout", (e) => onFocusOut(c, e));
  el.addEventListener("click", (e) => onClick(c, e));
  wireDrag(c);
  c.E("cmd").addEventListener("input", () => cmdHint(c));
  window.addEventListener("resize", () => { if (c.on) sizeSweep(c); });
  // A click on the page's header (the look, the late swap switch) takes the keyboard away: it comes back to the last cell. The slate box keeps its own.
  document.addEventListener("click", (e) => {
    if (!c.on || !c.model || c.G.modal || el.contains(e.target) || e.target.closest?.("select")) return;
    if (e.target.closest?.("[data-shade],[data-theme]")) render(c); else focusCell(c);
  });
  return {
    /** The slate on show changed. Nothing loads until the console is opened. */
    setSlate(name) {
      if (name === c.slate) return;
      Object.assign(c, { slate: name, model: null, inputs: null, loadError: null });
      clearTimeout(c.usageTimer);
      if (c.on) load(c, name);
    },
    show(name) {
      c.on = true;
      el.hidden = false;
      if (name !== c.slate || !c.model) return ensure(c, name);
      try {
        render(c);
      } catch (e) {
        showError(c, e.message);
        return Promise.resolve();
      }
      return refresh(c);
    },
    hide() { c.on = false; el.hidden = true; c.G.modal = null; c.E("applybox").hidden = true; },
    isOn: () => c.on,
    /** The player card's reads and writes on the same work (console-card.js). */
    ...cardApi(c, (name) => ensure(c, name)),
  };
}
