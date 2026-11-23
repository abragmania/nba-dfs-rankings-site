// The Scenario tab (Adam 11-19 4:51-5:15 PM ET: "a 'scenario' tab that literally just shows me what the changes would be in our model(s)", Min, Usage and DK/min editable before Save and Arm;
// 1:37-1:38 PM 11-20: a what-if may name who starts, armed by default, the right one used automatically by the lineup). Layout A of the 11-19 mock-ups, his pick. Its own tab beside Player list,
// Lineups and Console (board.js wires the button). It reads the Console's inputs and his saved work (GET /console) and his what-ifs (GET /whatifs); the numbers are whatif-model.js (the Console's
// engine), the live arm word whatif-rule.js (the server's own rule). Nothing here writes the board: Save and Arm write data/slates/<slate>/whatifs.json only, and the news pass decides.
// On the public site the same routes run in the visitor's browser and his saves stay there (site-src/static-api.js).
import { esc } from "./board-util.js";
import { boardTeam, runWhatIf, setEdit, emptyEdits, whatIfName, whatifId, editCount, MAX_SITTERS } from "./whatif-model.js";
import { teamVerdicts, feedOutsFor, fiveFor, teamTipped } from "./whatif-rule.js";
import { chipName } from "./console-model.js";
import { barHtml, savedHtml, summaryHtml, fullHtml, rippleHtml, footHtml } from "./scenario-view.js";

const ET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const etTime = (iso) => { const ms = Date.parse(iso ?? ""); return Number.isFinite(ms) ? ET.format(ms).replace(/[  ]/g, " ") : "an unknown time"; };
const post = (c, path, body) => c.api(`/api/slate/${encodeURIComponent(c.slate)}/whatifs${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** The slate's teams in tip order, each with its opponent. */
const teamsOf = (inputs) => (inputs.games ?? []).flatMap((g) => [{ code: g.away, opp: g.home }, { code: g.home, opp: g.away }]).filter((t) => inputs.teams?.[t.code]);
/** Whether this page is the public site (its root carries is-site, as the Console reads it), or a server that has no word of its own and no usage table (round 2, finding 7). */
const onSite = (c) => (typeof document !== "undefined" && document.documentElement?.classList?.contains("is-site") === true) || (!c.status?.updated_at && c.inputs?.usage?.state === "off");
const savedList = (c, team) => c.whatifs?.teams?.[team]?.whatifs ?? [];
const curId = (G) => whatifId(G.outs, G.starts);
const draftKey = (G) => `${G.team}|${curId(G)}`;

/** The what-if on show: his unsaved draft, else the saved one with these men, else a new one (armed by default, Adam 1:38 PM 11-20) carrying the edits on show before. */
function working(c) {
  const G = c.G, saved = savedList(c, G.team).find((w) => w.id === curId(G));
  const w = G.drafts[draftKey(G)] ?? (saved ? { edits: saved.edits, stamps: saved.stamps ?? { m: {} }, armed: saved.armed } : { edits: G.carry?.edits ?? emptyEdits(), stamps: G.carry?.stamps ?? { m: {} }, armed: true });
  return { ...w, starts: G.starts, saved: saved ?? null };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const dirty = (w) => !w.saved || !same(w.edits, w.saved.edits) || w.armed !== w.saved.armed;

/** The Save button's words. */
function saveOf(c, w, name) {
  if (!c.G.outs.length) return { label: "Save", disabled: true, title: "Pick a man who sits first" };
  if (w.saved && !dirty(w)) return { label: "Saved", disabled: true, title: `${name} is saved as it is` };
  return { label: w.saved ? `Save “${name}”` : `Save as “${name}”`, disabled: false, title: "Saved on this slate; nothing goes on the board until it is armed and its conditions hold" };
}

/** The foot's lines (G64): what index 0 and 1 are, the arm words now and the news pass's last, and every count of what is not shown. */
function footLines(c, bt, res, w) {
  const G = c.G, T = bt.T, nm = (id) => T.byId[id]?.name ?? id, input = c.inputs.teams[G.team];
  const outs0 = bt.S.outs.map(nm), lines = [`Index 0 is our engine on ${G.team} as the board holds it now (Out: ${outs0.length ? outs0.join(", ") : "nobody"}); index 1 is the same engine with ${res.sitters.length ? res.sitters.map(nm).join(", ") : "nobody more"} Out${G.starts.length ? `, ${G.starts.map(nm).join(", ")} starting` : ""} and your edits (${editCount(w.edits)}). Nothing here changes the board until a what-if is armed and its conditions hold: its men ruled Out by our feeds and its starters in the confirmed five; of several that fit, the one with the most conditions.`];
  const list = savedList(c, G.team);
  if (list.length) {
    // finding 11: the app's own word (its news pass and the send after each save) is the authority; this page's reading of the same rule is an estimate
    const said = c.status?.teams?.[G.team] ?? {}, site = onSite(c);
    if (site) lines.push("The public site never sends what-ifs to the board: what you save here stays in this browser, and the app's words below are as Adam's app last said them.");
    if (c.status?.problem) lines.push(`The app's words could not be read: ${c.status.problem}.`);
    for (const x of list) if (said[x.id]) lines.push(`The app, ${etTime(said[x.id].at)}: ${said[x.id].text}.`);
    for (const v of teamVerdicts({ list, T, S: bt.S, feeds: feedOutsFor(input, bt.S), five: fiveFor(input), tipped: teamTipped(c.inputs, G.team), hisAt: c.scen?.teams?.[G.team]?.his_at ?? null, usageReady: site || c.inputs.usage?.state === "ready" })) lines.push(`This page's estimate: ${v.text}.`);
  }
  if (res.hidden) lines.push(`${res.hidden} ${res.hidden === 1 ? "man" : "men"} on 0 minutes both ways ${res.hidden === 1 ? "is" : "are"} not listed.`);
  if (res.summary.proj_missing) lines.push(`${res.summary.proj_missing} projection${res.summary.proj_missing === 1 ? " is" : "s are"} missing on one side or the other, so the team's points leave ${res.summary.proj_missing === 1 ? "it" : "them"} out.`);
  if (res.already.length) lines.push(`Already Out on the board, so nothing changes for: ${res.already.map(nm).join(", ")}.`);
  if (res.gone.length) lines.push(`No longer on the team: ${res.gone.length} of its men.`);
  if (res.r1.roles_note) lines.push(`Engine, index 1: ${res.r1.roles_note.replace(/\s*\n+\s*/g, "; ")}`);
  if (w.saved?.base?.pull && w.saved.base.pull !== c.inputs.basis?.pull) lines.push(`Saved on the ${w.saved.base.pull} pull; the numbers above are this pull's (${c.inputs.basis?.pull ?? "unknown"}).`);
  return lines;
}

/** The page. */
function render(c) {
  if (!c.on) return;
  if (c.err) { c.el.innerHTML = `<div class="sn-panel"><div class="sn-empty">The Scenario tab could not load: ${esc(c.err)}</div></div>`; return; }
  if (!c.inputs) { c.el.innerHTML = `<div class="sn-panel"><div class="sn-empty">Loading ${esc(c.slate ?? "")}...</div></div>`; return; }
  const G = c.G, teams = teamsOf(c.inputs);
  if (!teams.some((t) => t.code === G.team)) Object.assign(G, { team: teams[0]?.code ?? null, outs: [], starts: [] });
  if (!G.team) { c.el.innerHTML = `<div class="sn-panel"><div class="sn-empty">This slate has no teams.</div></div>`; return; }
  const bt = boardTeam(c.inputs, c.scen, G.team), w = working(c), res = runWhatIf(bt, G.outs, w), T = bt.T;
  c.last = res;
  const playing = res.r0.rows.filter((r) => !r.out && r.min > 0).sort((a, b) => b.min - a.min).map((r) => ({ id: r.id, name: r.p.name, pos: r.p.pos }));
  const startMen = res.r1.rows.filter((r) => !r.out && !G.starts.includes(r.id)).sort((a, b) => (b.min ?? 0) - (a.min ?? 0)).map((r) => ({ id: r.id, name: r.p.name, pos: r.p.pos }));
  const name = whatIfName(T, res.sitters, G.starts), list = savedList(c, G.team);
  const bar = barHtml({ teams, team: G.team, men: playing, outs: G.outs, adding: G.adding, starts: G.starts, startMen, nameOf: (id) => chipName(T, T.byId[id]), view: G.view, armed: w.armed, save: saveOf(c, w, name), many: G.outs.length > 1 });
  const saved = savedHtml(list.map((x) => ({ ...x, last: c.status?.teams?.[G.team]?.[x.id] ?? null, ...(x.id === G.confirmDrop ? { name: `Delete ${x.name}?` } : {}) })), w.saved?.id ?? null);
  const body = G.outs.length ? `${summaryHtml(G.team, res.summary)}${G.view === "ripple" ? rippleHtml(res.rows) : fullHtml(res.rows)}` : `<div class="sn-empty">Pick a man who sits, under WHAT IF, to see where his minutes and usage go.</div>`;
  const focus = document.activeElement?.closest?.("#scenario [data-sn]") ? { sn: document.activeElement.dataset.sn, k: document.activeElement.dataset.k, id: document.activeElement.dataset.id } : null;
  c.el.innerHTML = `<div class="sn-panel">${bar}${saved}${body}${footHtml(G.outs.length ? footLines(c, bt, res, w) : [])}</div>`;
  if (focus?.sn === "edit") c.el.querySelector(`input[data-sn="edit"][data-k="${focus.k}"][data-id="${CSS.escape(focus.id ?? "")}"]`)?.focus();
}

/** One typed box: his edit on the draft, the numbers worked again at once. Text equal to what the engine shows is no edit. */
function commitEdit(c, input) {
  const G = c.G, { k, id } = input.dataset, row = c.last?.rows.find((r) => r.id === id), w = working(c);
  const shown = { m: row?.min1, u: row?.usg1, d: row?.rate1 }[k], dp = k === "d" ? 2 : 1;
  if (!Object.hasOwn(w.edits[k] ?? {}, id) && typeof shown === "number" && input.value.trim() === shown.toFixed(dp)) return;
  if (Object.hasOwn(w.edits[k] ?? {}, id) && input.value.trim() !== "" && Number(input.value) === w.edits[k][id]) return; // the same number again keeps its first stamp
  const e = setEdit(w, k, id, input.value, { nowIso: new Date().toISOString(), role: row?.role1 });
  if (!e.ok) { c.toast(e.why, "err"); input.value = typeof shown === "number" ? shown.toFixed(dp) : ""; return; }
  G.drafts[draftKey(G)] = { edits: e.edits, stamps: e.stamps, armed: w.armed };
  render(c);
}

/** The men picked change: the edits on show come along to a what-if with no work of its own yet. */
function moveTo(c, outs, starts) {
  const G = c.G, w = working(c);
  G.carry = { edits: w.edits, stamps: w.stamps };
  Object.assign(G, { outs, starts: starts.filter((id) => !outs.includes(id)), adding: false, confirmDrop: null });
}

/** A write's answer: his what-ifs and the app's words taken, and what the send after it did said beside the button (the money review's finding 3); the board's numbers read again. */
async function took(c, out, said) {
  Object.assign(c, { whatifs: out.whatifs, status: out.status ?? c.status });
  c.toast(`${said}${out.stripped ? ` (${out.stripped} edit${out.stripped === 1 ? "" : "s"} on its own sitters taken off)` : ""}. Board: ${out.send?.note ?? "no answer"}.`, out.send?.status === "failed" ? "err" : undefined);
  await load(c);
}

async function save(c) {
  const G = c.G, bt = boardTeam(c.inputs, c.scen, G.team), T = bt.T, w = working(c), res = runWhatIf(bt, G.outs, w);
  if (!res.sitters.length) return c.toast("Every man picked is Out on the board already, so there is nothing to save.", "err");
  const picked = G.outs.filter((id) => T.byId[id]); // finding 4: every man he picked is a condition; the numbers use only the men not Out already
  const edits = Object.fromEntries(Object.entries(w.edits).map(([k, sec]) => [k, Object.fromEntries(Object.entries(sec).filter(([id]) => !picked.includes(id)))])); // finding 6: no number on a man it sits
  const body = { team: G.team, whatif: { outs: picked, starts: G.starts, names: picked.map((id) => T.byId[id].name), name: whatIfName(T, picked, G.starts), edits, stamps: w.stamps, armed: w.armed, base: { outs: [...bt.S.outs], pull: c.inputs.basis?.pull ?? null } } };
  const out = await post(c, "", body);
  delete G.drafts[draftKey(G)];
  await took(c, out, `Saved ${body.whatif.name}${w.armed ? ", armed" : ""}`);
}

async function arm(c) {
  const G = c.G, w = working(c);
  if (!w.saved || !same(w.edits, w.saved.edits)) { G.drafts[draftKey(G)] = { edits: w.edits, stamps: w.stamps, armed: !w.armed }; return; } // unsaved work: the switch is saved with it
  const out = await post(c, "/arm", { team: G.team, id: w.saved.id, armed: !w.armed });
  delete G.drafts[draftKey(G)];
  await took(c, out, `${w.saved.name} ${w.armed ? "disarmed" : "armed"}`);
}

async function drop(c, id) {
  const G = c.G;
  if (G.confirmDrop !== id) { G.confirmDrop = id; return; }
  G.confirmDrop = null;
  const out = await post(c, "/delete", { team: G.team, id });
  Object.keys(G.drafts).filter((k) => k === `${G.team}|${id}`).forEach((k) => delete G.drafts[k]);
  await took(c, out, "Deleted");
}

/** A click on the tab's buttons. */
async function onClick(c, e) {
  const b = e.target.closest?.("button[data-sn]");
  if (!b || b.disabled || !c.inputs) return;
  const G = c.G, d = b.dataset;
  try {
    if (d.sn === "view") G.view = d.v;
    else if (d.sn === "add") G.adding = true;
    else if (d.sn === "unwho") moveTo(c, G.outs.filter((_, i) => i !== Number(d.i)), G.starts);
    else if (d.sn === "unstart") moveTo(c, G.outs, G.starts.filter((_, i) => i !== Number(d.i)));
    else if (d.sn === "load") { const w = savedList(c, G.team).find((x) => x.id === d.id); if (w) Object.assign(G, { outs: [...w.outs], starts: [...(w.starts ?? [])], adding: false, confirmDrop: null }); }
    else if (d.sn === "drop") await drop(c, d.id);
    else if (d.sn === "arm") await arm(c);
    else if (d.sn === "save") await save(c);
  } catch (err) { c.toast(`Not saved: ${err.message}`, "err"); }
  render(c);
}

/** A change in the tab's pickers and boxes. */
function onChange(c, e) {
  const t = e.target, G = c.G, d = t.dataset ?? {};
  if (!c.inputs || !d.sn) return;
  if (d.sn === "edit") return commitEdit(c, t);
  if (d.sn === "team") Object.assign(G, { team: t.value, outs: [], starts: [], adding: false, carry: null, confirmDrop: null });
  else if (d.sn === "who") { const outs = [...G.outs]; if (t.value) outs[Number(d.i)] = t.value; else outs.splice(Number(d.i), 1); moveTo(c, [...new Set(outs.filter(Boolean))].slice(0, MAX_SITTERS), G.starts); }
  else if (d.sn === "start" && t.value) moveTo(c, G.outs, [...G.starts, t.value]);
  render(c);
}

/** Reads the Console's inputs and his work, and his what-ifs; what he has on show and his drafts stay. */
async function load(c) {
  const name = c.slate;
  try {
    const [con, wi] = await Promise.all([c.api(`/api/slate/${encodeURIComponent(name)}/console`), c.api(`/api/slate/${encodeURIComponent(name)}/whatifs`)]);
    if (name !== c.slate) return;
    Object.assign(c, { inputs: con.inputs, scen: con.scenarios, whatifs: wi.whatifs, status: wi.status ?? null, err: null });
  } catch (e) { if (name === c.slate) c.err = e.message; }
  render(c);
}

/** deps: { el, api (the board's fetch helper), toast (message, kind) }. Returns { show(slate), hide(), isOn(), setSlate(slate), refresh() }. */
export function createScenarioTab({ el, api, toast }) {
  const c = { el, api, toast, on: false, slate: null, inputs: null, scen: null, whatifs: null, err: null, last: null, G: { team: null, outs: [], starts: [], adding: false, view: "full", drafts: {}, carry: null, confirmDrop: null } };
  el.addEventListener("click", (e) => { onClick(c, e); });
  el.addEventListener("change", (e) => onChange(c, e));
  el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches?.("input.sn-in")) { e.preventDefault(); commitEdit(c, e.target); } });
  return {
    show(slate) { c.on = true; el.hidden = false; if (slate !== c.slate || !c.inputs) { c.slate = slate; c.inputs = null; } render(c); return load(c); },
    hide() { c.on = false; el.hidden = true; },
    isOn: () => c.on,
    setSlate(slate) { if (slate === c.slate) return; Object.assign(c, { slate, inputs: null, scen: null, whatifs: null, err: null }); c.G = { ...c.G, team: null, outs: [], starts: [], drafts: {}, carry: null }; if (c.on) load(c); },
    refresh: () => (c.on ? load(c) : Promise.resolve()),
  };
}
