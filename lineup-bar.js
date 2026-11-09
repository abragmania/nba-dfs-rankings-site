// The lineup bar (Adam, 11-06; no buttons to press, Adam 11-07): above the player list, what the Monster and RotoWire lineup pages say that the console
// did not show. An Out, and a start from confirmed lineups, apply themselves through the console's role moves on the scenario the team is on (his marks
// kept; console-card.js autoApplyProposal) and reach the board by the console's own send; each shows as a note with an undo X. A projected start is
// information only. A change is applied once per proposal, recorded in the console's saved work, so a reload never applies one he undid. A check or a
// line of information can be hidden (remembered in this browser until its sources change). Shows nothing when there is nothing to say. The same code runs
// on the public site, from the published lineups-latest.json. barHtml, statusLine, newsRows and refusalText are DOM-free (tested in node). Look: lineup-bar.css.
import { esc } from "./board-util.js";
import { lastName } from "./console-model.js";
import { autoPlan, makeProposals } from "./lineup-proposals.js";

const TIME_FMT = { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" };
const timeText = (iso) => {
  const ms = Date.parse(iso ?? "");
  return Number.isNaN(ms) ? "time unknown" : `${new Date(ms).toLocaleTimeString("en-US", TIME_FMT)} ET`;
};
const KIND = { out: "OUT", starter: "START", news: "NEWS", conflict: "CHECK", unmatched: "CHECK", unknown: "CHECK" };
const usable = (b) => b?.state === "ok" && Array.isArray(b.men);
const noUrl = (s) => String(s ?? "").replace(/\s*https?:\/\/\S+/g, "").trim();

/** The sources behind a proposal, for its hover and its time line: "Monster (projected) 3:05 PM ET; RotoWire (confirmed) 3:05 PM ET". */
export function sourcesText(sources) {
  return sources.map((s) => `${s.label}${s.lineup ? ` (${s.lineup === "confirmed" ? "confirmed" : "projected"})` : ""}${s.detail ? `, ${s.detail}` : ""} ${timeText(s.at)}`).join("; ");
}

/** The one-line status of the read, or "" when everything was read. `read` is the route's answer { state, latest?, why? }. */
export function statusLine(read) {
  if (read?.state === "missing") return "Lineups: no lineup read yet";
  if (read?.state !== "ok") return `Lineups: the read cannot be used (${noUrl(read?.why ?? "unknown")})`;
  const l = read.latest;
  if (l.status === "failed") return `Lineups: ${noUrl(l.note ?? "the read failed")}`;
  const parts = [];
  let bad = false;
  for (const [key, label] of [["monster", "Monster"], ["rotowire", "RotoWire"]]) {
    const s = l.sources?.[key];
    if (s?.status === "ok") parts.push(`${label} ok`);
    else { bad = true; parts.push(`${label} not read (${noUrl(s?.note ?? "no answer")})`); }
  }
  const n = l.monster_news;
  if (n?.status === "ok") parts.push(`Monster news ${timeText(n.fetched_at)}`);
  else { bad = true; parts.push(`Monster news missing (${noUrl(n?.note ?? "no answer")})`); }
  const short = Object.values(l.teams ?? {}).filter((t) => usable(t.monster) !== usable(t.rotowire)).length;
  if (short && !bad) { bad = true; parts.push(`${short} team${short === 1 ? "" : "s"} missing a source's five`); }
  return bad ? `Lineups ${timeText(l.generated_at)}: ${parts.join("; ")}` : "";
}

/**
 * The words for a send that was refused: the cause once, the men listed. "nothing sent, because on CHA: A has no projection here (why); B has ..." becomes
 * "Not sent: no projection for A, B (why)". Anything else is said as it came, without the console's pointer sentence.
 */
export function refusalText(message) {
  const clean = String(message ?? "").replace(/\s*Open the console(?:'s Apply)? to see it all\.?\s*$/, "").replace(/\.$/, "");
  const m = /^nothing sent, because on \w+: (.*)$/.exec(clean);
  if (!m) return `Not sent: ${clean}`;
  const segs = m[1].split("; ").map((s) => /^(.+?) has no projection here \((.*)\)$/.exec(s));
  if (segs.some((x) => !x)) return `Not sent: ${m[1]}`;
  const groups = new Map();
  for (const [, who, why] of segs) {
    const reason = /^no (.+ season totals file) \(run node (\S+)\)$/.exec(why);
    const text = reason ? `${reason[1]} missing; run ${reason[2]}` : why;
    groups.set(text, [...(groups.get(text) ?? []), lastName(who)]);
  }
  return `Not sent: ${[...groups].map(([why, who]) => `no projection for ${who.join(", ")} (${why})`).join("; ")}`;
}

/** The one summary line the bar shows while the console is open (lineup-bar.css): "Lineup news: 2 applied, 3 for information, 1 check, 1 note · show". Pure. */
export function summaryHtml(bar, state = {}) {
  const n = (x) => (x ?? []).length, applied = n(bar.applied), info = n(bar.info), checks = n(bar.conflicts), notes = n(state.notes);
  const bits = [applied ? `${applied} applied` : "", info ? `${info} for information` : "", checks ? `${checks} check${checks === 1 ? "" : "s"}` : "", notes ? `${notes} note${notes === 1 ? "" : "s"}` : ""].filter(Boolean);
  return `<button type="button" class="lpsum" data-lp-sum aria-expanded="${state.open ? "true" : "false"}">Lineup news: ${bits.join(", ")} · ${state.open ? "hide" : "show"}</button>`;
}

/** The news entries the console holds, newest first: [{ team, key, entry }] for every applied, reverted or failed one (an undone one is gone from the bar). */
export function newsRows(view) {
  const rows = [];
  for (const [team, v] of Object.entries(view ?? {})) for (const [key, entry] of Object.entries(v.news ?? {})) if (entry.state !== "undone") rows.push({ team, key, entry });
  return rows.sort((a, b) => String(b.entry.at).localeCompare(String(a.entry.at)) || a.key.localeCompare(b.key));
}
/** A news key's kind: "out", "starter", or "news" for a key of neither shape (never guessed as a start). */
export const kindOf = (key) => (/^[^|]+\|[A-Z]{2,4}\|out\|[^|]+$/.test(key) ? "out" : /^[^|]+\|[A-Z]{2,4}\|starter(\|[^|]*)?$/.test(key) ? "starter" : "news");

/**
 * The bar's inner HTML, or "" when there is nothing to show (Adam, 11-07: nothing waits on a button). bar: { applied: newsRows, info: proposals shown as words
 * (a projected start), conflicts }; state: { notes: [text] }. An applied change is a note with an undo X; a failed one says why; info and checks can be hidden.
 */
export function barHtml(bar, state = {}) {
  const applied = bar.applied ?? [], info = bar.info ?? [], conflicts = bar.conflicts ?? [], notes = state.notes ?? [];
  if (!applied.length && !info.length && !conflicts.length && !notes.length) return "";
  const hide = (id, what) => `<button type="button" class="lpx" data-lp-dismiss="${esc(id)}" title="Hide this ${what}">&#10005;</button>`;
  const news = ({ team, key, entry }) => {
    const k = kindOf(key), failed = entry.state === "failed", reverted = entry.state === "reverted";
    const when = failed ? `not applied: ${esc(entry.why ?? "")}` : reverted ? "taken back with Ctrl+Z" : `applied by itself ${esc(timeText(entry.at))}`;
    // The X only on a live entry; a failed note can be hidden; a change taken back with Ctrl+Z has nothing left to undo.
    const end = failed ? hide(key, "note") : reverted ? "" : `<button type="button" class="lpx" data-lp-undo="${esc(key)}" data-team="${esc(team)}" title="Undo this change: the console goes back to how it was before it">&#10005;</button>`;
    return `<div class="lprow auto ${k}${failed ? " failed" : ""}${reverted ? " reverted" : ""}" data-lp="${esc(key)}"><span class="lpkind">${KIND[k]}</span><span class="lptext" title="${esc(entry.text)}">${esc(entry.text)}</span>`
      + `<span class="lptime">${when}</span>${end}</div>`;
  };
  const words = (r) => {
    const check = r.kind === "conflict" || r.kind === "unmatched" || r.kind === "unknown", where = check ? "" : sourcesText(r.sources);
    const why = check ? "" : r.nearApply ?? r.noApply ?? (r.kind === "starter" ? "projected, not confirmed: not applied" : "");
    return `<div class="lprow info ${check ? "conflict" : r.kind}" data-lp="${esc(r.id)}"><span class="lpkind">${check ? KIND[r.kind] : "INFO"}</span><span class="lptext"${where ? ` title="${esc(where)}"` : ""}>${esc(r.text)}</span><span class="lptime">${esc([why, where].filter(Boolean).join(" · "))}</span>${hide(r.id, check ? "check" : "line")}`
      + `${check && r.sides?.length ? `<div class="lpsides">${r.sides.map((x) => `<div>${esc(x)}</div>`).join("")}</div>` : ""}</div>`;
  };
  return `${notes.map((n) => `<div class="lpnote">${esc(n)}</div>`).join("")}${applied.map(news).join("")}${info.map(words).join("")}${conflicts.map(words).join("")}`;
}

/**
 * deps: { el, api(path), slate() -> the slate on show, players() -> its rows, console: { lineupView(slate), autoApplyProposal(slate, proposal), undoNews(team, key) },
 * toast(msg, kind), tryStore(fn), now() }. Returns { refresh(), newsOnly() }. refresh asks again for the lineup read, applies what is new and allowed, and redraws;
 * call it when the slate or its numbers change. newsOnly redraws the applied notes from the console; call it when his work moves.
 */
export function createLineupBar({ el, api, slate, players, console: cons, toast, tryStore, now = Date.now }) {
  const key = () => `nbaboard.lineupdismiss.${slate()}`;
  const readDismissed = () => { try { return JSON.parse(tryStore(() => localStorage.getItem(key())) ?? "{}") ?? {}; } catch (e) { console.warn("Lineup dismissals unreadable:", e.message); return {}; } };
  const state = { notes: [], open: false };
  let gen = 0, running = null, again = false, shown = { applied: [], info: [], conflicts: [] };

  function draw() {
    const dismissed = readDismissed(), keep = (sig) => (r) => dismissed[r.id ?? r.key] !== sig(r);
    const bar = { applied: shown.applied.filter(keep((r) => r.entry.sig + r.entry.state)), info: shown.info.filter(keep((r) => r.signature)), conflicts: shown.conflicts.filter(keep((r) => r.signature)) };
    const html = barHtml(bar, state);
    el.hidden = !html;
    el.innerHTML = html ? summaryHtml(bar, state) + html : "";
    el.classList.toggle("open", Boolean(state.open));
  }
  const settle = (notes, next = { applied: [], info: [], conflicts: [] }) => { shown = next; state.notes = notes.filter(Boolean); draw(); };

  async function once() {
    const mine = ++gen, name = slate();
    if (!name) { el.hidden = true; return; }
    let read;
    try { read = await api(`/api/slate/${encodeURIComponent(name)}/news-lineups`); } catch (e) {
      if (mine !== gen) return;
      console.warn("Lineup read unavailable:", e.message);
      return settle([`Lineups: the read could not be loaded (${noUrl(e.message)})`]);
    }
    if (mine !== gen) return;
    const line = statusLine(read);
    if (read.state !== "ok") return settle([line]);
    // The console's Tonight view is always loaded before anything is decided: who starts and who plays come only from it.
    const look = async () => {
      const view = await cons.lineupView(name);
      const result = makeProposals({ latest: read.latest, players: players(), view, nowMs: now() });
      return { view, result, plan: autoPlan(result, Object.fromEntries(Object.entries(view).map(([t, v]) => [t, v.news ?? {}]))) };
    };
    let seen;
    try {
      seen = await look();
      if (mine !== gen) return;
      for (const p of seen.plan.apply) await cons.autoApplyProposal(name, p); // each one saved with what it moved, so it is never applied twice
      if (seen.plan.apply.length) seen = await look();
    } catch (e) {
      if (mine !== gen) return;
      return settle([line, `Lineup news waits: the console could not load (${e.message})`]);
    }
    if (mine !== gen || name !== slate()) return;
    const stale = seen.result.stale ? `The lineup read is ${seen.result.stale.ageMin == null ? "of unknown age" : `${seen.result.stale.ageMin} minutes old`}; nothing from it is made by itself until the next pull.` : "";
    settle([line, stale], { applied: newsRows(seen.view), info: seen.plan.info, conflicts: seen.result.conflicts });
  }
  /** One look at a time, so a change is never applied twice; a call while one runs makes one more after it. */
  function refresh() {
    if (running) { again = true; return running; }
    running = (async () => {
      do { again = false; await once(); } while (again);
    })().finally(() => { running = null; });
    return running;
  }

  /** His work moved (Ctrl+Z among it): the applied notes follow the console's record at once, with no new read of the lineup pages and nothing applied. */
  async function newsOnly() {
    const name = slate();
    if (!name) return;
    try {
      const view = await cons.lineupView(name);
      if (name !== slate()) return;
      shown = { ...shown, applied: newsRows(view) };
      draw();
    } catch (e) {
      console.warn("Lineup notes not redrawn:", e.message); // the next look at the news says it on the bar
    }
  }

  el.addEventListener("click", async (e) => {
    if (e.target.closest("[data-lp-sum]")) { state.open = !state.open; return draw(); } // the one-line summary shown while the console is open
    const dismiss = e.target.closest("[data-lp-dismiss]"), undo = e.target.closest("[data-lp-undo]");
    if (dismiss) {
      const id = dismiss.dataset.lpDismiss, row = [...shown.info, ...shown.conflicts].find((r) => r.id === id), news = shown.applied.find((r) => r.key === id);
      const sig = row ? row.signature : news ? news.entry.sig + news.entry.state : null;
      if (sig === null) return;
      tryStore(() => localStorage.setItem(key(), JSON.stringify({ ...readDismissed(), [id]: sig })));
      return draw();
    }
    if (!undo) return;
    try {
      if (!cons.undoNews(undo.dataset.team, undo.dataset.lpUndo)) toast("That change was already taken back.", "notice");
    } catch (err) {
      toast(`Could not undo it: ${err.message}`, "err");
    }
    await refresh();
  });
  return { refresh, newsOnly };
}
