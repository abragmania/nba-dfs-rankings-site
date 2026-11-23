// The Log tab (Adam 6:05 PM 11-21): every projection-related change on the slate, newest first, with a search, team chips and a By filter. Its own tab right after Scenario (board.js wires the
// button and ?view=log). It reads GET /api/slate/<slate>/change-log (server/slate/change-log.js) on show, on a slate change and after each new pull; the markup and filters are log-view.js.
// Nothing here writes. On the public site the same route answers from the baked log (site-src/static-api.js).
import { esc } from "./board-util.js";
import { barHtml, tableHtml, footHtml, footLines, filterRows, chipTeams } from "./log-view.js";

/** Draws the table and foot for the filters on show; the bar is drawn once per load, so the search box keeps its focus. */
function drawBody(c) {
  const all = c.data?.rows ?? [], rows = filterRows(all, { q: c.q, teams: c.on, by: c.by }), d = c.data ?? {};
  c.el.querySelector(".lg-body").innerHTML = tableHtml(rows, rows[0]?.at ?? null);
  c.el.querySelector(".lg-foot").outerHTML = footHtml(footLines({ shown: rows.length, total: d.total ?? filterRows(all).length, bad: d.bad ?? 0, repeats: d.repeats ?? 0, older: d.older ?? 0, marks: all.filter((r) => r.kind === "start" || r.kind === "roster"), state: d.state, writeProblem: d.write_problem ?? null }));
  for (const b of c.el.querySelectorAll("[data-lgteam]")) b.classList.toggle("on", b.dataset.lgteam === "" ? !c.on.size : c.on.has(b.dataset.lgteam));
  for (const b of c.el.querySelectorAll("[data-lgby]")) b.classList.toggle("on", b.dataset.lgby === c.by);
}

function render(c) {
  if (!c.shown) return;
  if (c.err) { c.el.innerHTML = `<div class="lg-panel"><div class="lg-empty">The Log could not load: ${esc(c.err)}</div></div>`; return; }
  if (!c.data) { c.el.innerHTML = `<div class="lg-panel"><div class="lg-empty">Loading ${esc(c.slate ?? "")}...</div></div>`; return; }
  const hadFocus = document.activeElement?.id === "lgSearch";
  c.el.innerHTML = `<div class="lg-panel">${barHtml({ q: c.q, teams: chipTeams(c.teams(), c.data.rows), on: c.on, by: c.by })}<div class="lg-body"></div><div class="lg-foot"></div></div>`;
  drawBody(c);
  if (hadFocus) { const s = c.el.querySelector("#lgSearch"); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
}

async function load(c) {
  const slate = c.slate;
  try {
    const data = await c.api(`/api/slate/${encodeURIComponent(slate)}/change-log`);
    if (slate !== c.slate) return;
    Object.assign(c, { data, err: null });
  } catch (e) { if (slate === c.slate) Object.assign(c, { err: e.message }); }
  render(c);
}

/** deps: { el, api (the board's fetch helper), teams () -> the slate's team codes, onToggle(open) (the board's tab bar and the others' state) }. Returns { toggle(open?), close(), isOn(), setSlate(slate), refresh() }. */
export function createLogTab({ el, api, teams = () => [], onToggle = () => {} }) {
  const c = { el, api, teams, shown: false, slate: null, data: null, err: null, q: "", on: new Set(), by: "all" };
  el.addEventListener("input", (e) => { if (e.target.id === "lgSearch") { c.q = e.target.value; drawBody(c); } });
  el.addEventListener("click", (e) => {
    const t = e.target.closest("[data-lgteam],[data-lgby]");
    if (!t) return;
    if (t.dataset.lgby) c.by = t.dataset.lgby;
    else if (t.dataset.lgteam === "") c.on.clear();
    else if (c.on.has(t.dataset.lgteam)) c.on.delete(t.dataset.lgteam); else c.on.add(t.dataset.lgteam);
    drawBody(c);
  });
  const setOpen = (open) => {
    if (open === c.shown) return;
    c.shown = open;
    el.hidden = !open;
    document.body.classList.toggle("log-on", open);
    const q = new URLSearchParams(location.search);
    if (open) q.set("view", "log"); else if (q.get("view") === "log") q.delete("view");
    history.replaceState(null, "", `?${q}`);
    onToggle(open);
    if (open) { render(c); load(c); }
  };
  return {
    toggle: (open = !c.shown) => setOpen(open),
    close: () => setOpen(false),
    isOn: () => c.shown,
    setSlate(slate) { if (slate === c.slate) return; Object.assign(c, { slate, data: null, err: null }); c.on.clear(); if (c.shown) { render(c); load(c); } },
    refresh: () => (c.shown ? load(c) : Promise.resolve()),
  };
}
