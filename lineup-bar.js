// The lineup news (Adam, 11-06; no buttons to press, 11-07; its own tab, 11-09): what the Monster and RotoWire lineup pages say that the console
// did not show, as the rows of the News tab. An Out, and a start from confirmed lineups, apply themselves through the console's role moves on the scenario the team is on (his marks
// kept; console-card.js autoApplyProposal) and reach the board by the console's own send; each shows as a note with an undo X. A projected start is
// information only. A change is applied once per proposal, recorded in the console's saved work, so a reload never applies one he undid. A check or a
// line of information can be hidden (remembered in this browser until its sources change). Says nothing when there is nothing to say, or when the read is too old to act on.
// The tab's label is "News" with the count, amber while anything needs Adam (newsLabel); nothing opens over the page. The same code runs
// on the public site, from the published lineups-latest.json. barHtml, statusLine, newsRows and refusalText are DOM-free (tested in node). Look: lineup-bar.css.
import { esc } from "./board-util.js";
import { lastName } from "./console-model.js";
import { autoPlan, makeProposals, staleOf } from "./lineup-proposals.js";
import { newsModel, timeLabel } from "./news-model.js";
import { newsPageHtml } from "./news-page.js";

const TIME_FMT = { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" };
const timeText = (iso) => {
  const ms = Date.parse(iso ?? "");
  return Number.isNaN(ms) ? "time unknown" : `${new Date(ms).toLocaleTimeString("en-US", TIME_FMT)} ET`;
};
const KIND = { out: "OUT", starter: "START", news: "NEWS", conflict: "CHECK", unmatched: "CHECK", unknown: "CHECK" };
const usable = (b) => b?.state === "ok" && Array.isArray(b.men);
const noUrl = (s) => String(s ?? "").replace(/\s*https?:\/\/\S+/g, "").trim();

/** The sources behind a proposal, for its hover and its time line: "Monster (projected) as of 3:05 PM ET; RotoWire (confirmed) as of 3:05 PM ET" (a read time, marked as one). */
export function sourcesText(sources) {
  return sources.map((s) => `${s.label}${s.lineup ? ` (${s.lineup === "confirmed" ? "confirmed" : "projected"})` : ""}${s.detail ? `, ${s.detail}` : ""} ${Number.isNaN(Date.parse(s.at ?? "")) ? "no read time" : `as of ${timeText(s.at)}`}`).join("; "); // the lineup pages carry no announced time: it is when they were read
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

/**
 * The News tab's label (board.js): `n` the items in the log (the proposals' rows and `feedCount` reports), `need` true while anything needs Adam: a CHECK row, a change that failed, a note about the read. The tab reads
 * "News 4" and turns amber on need; with nothing it is plain "News". Pure.
 */
export function newsLabel(bar, state = {}, feedCount = 0) {
  const n = (x) => (x ?? []).length, failed = (bar.applied ?? []).filter((r) => r?.entry?.state === "failed").length;
  const check = n(bar.conflicts) + failed + n(state.notes);
  return { n: n(bar.applied) + n(bar.info) + n(bar.conflicts) + n(state.notes) + feedCount, check, need: check > 0 };
}

/** The news entries the console holds, newest first: [{ team, key, entry }] for every applied, reverted or failed one (an undone one is gone from the bar). */
export function newsRows(view) {
  const rows = [];
  for (const [team, v] of Object.entries(view ?? {})) for (const [key, entry] of Object.entries(v.news ?? {})) if (entry.state !== "undone") rows.push({ team, key, entry });
  return rows.sort((a, b) => String(b.entry.at).localeCompare(String(a.entry.at)) || a.key.localeCompare(b.key));
}
/** A news key's kind: "out", "starter", or "news" for a key of neither shape (never guessed as a start). */
export const kindOf = (key) => (/^[^|]+\|[A-Z]{2,4}\|out\|[^|]+$/.test(key) ? "out" : /^[^|]+\|[A-Z]{2,4}\|starter(\|[^|]*)?$/.test(key) ? "starter" : "news");

/** "Monster + RotoWire: Man A STARTS" -> { who: "Mon + Roto", text: "Man A STARTS" }: the source goes in its own column (as the mock-up has it), not in the sentence. No prefix: who is null. */
const SHORT = { Monster: "Mon", RotoWire: "Roto" };
export function splitSource(text) {
  const m = /^((?:Monster|RotoWire)(?: \+ (?:Monster|RotoWire))*): /.exec(String(text ?? ""));
  return m ? { who: m[1].split(" + ").map((x) => SHORT[x]).join(" + "), text: text.slice(m[0].length) } : { who: null, text };
}

/**
 * The proposals as log rows, [{ needs, at, sortAt, team, html }] (the News tab puts them in its log beside the feed, news-page.js): what needs Adam first (a note about the read, a CHECK
 * row, a failed change), then applied changes, then lines of information. bar: { applied: newsRows, info: proposals shown as words (a projected start), conflicts }; state: { notes:
 * [text], readAt: ms, day: the slate's Eastern date }. An applied change is a row with an undo X and the time the app applied it; a failed one says why; info and checks can be hidden
 * and show a dash for time (the lineup pages carry only the time they were read, which the row says in its words as "as of"); `sortAt` orders the row among the reports without
 * showing as a time.
 */
export function proposalRows(bar, state = {}) {
  const applied = bar.applied ?? [], info = bar.info ?? [], conflicts = bar.conflicts ?? [], notes = state.notes ?? [];
  const hide = (id, what) => `<button type="button" class="lpx" data-lp-dismiss="${esc(id)}" title="Hide this ${what}">&#10005;</button>`;
  const ms = (iso) => { const v = Date.parse(iso ?? ""); return Number.isNaN(v) ? null : v; };
  const clock = (at) => timeLabel(at, { day: state.day ?? null, log: true }) ?? "—";
  const row = (cls, o) => `<div class="lprow le ${cls}"${o.key ? ` data-lp="${esc(o.key)}"` : ""}><span class="lt">${esc(clock(o.at))}</span><span class="lsr">${esc(o.src)}</span>`
    + `<span class="lpkind k-${o.kind}">${o.kind}</span><span class="ltm">${esc(o.team ?? "—")}</span><span class="ltx"${o.title ? ` title="${esc(o.title)}"` : ""}>${esc(o.text)}</span><span class="lef" title="${esc(o.effect)}">${esc(o.effect)}</span><span class="lxx">${o.x}</span>${o.sides ?? ""}</div>`;
  const news = ({ team, key, entry }) => {
    const k = kindOf(key), failed = entry.state === "failed", reverted = entry.state === "reverted", at = ms(entry.at), sp = splitSource(entry.text);
    const when = failed ? `not applied: ${entry.why ?? ""}` : reverted ? "taken back with Ctrl+Z" : `applied by itself ${timeText(entry.at)}`;
    // The X only on a live entry; a failed note can be hidden; a change taken back with Ctrl+Z has nothing left to undo.
    const x = failed ? hide(key, "note") : reverted ? "" : `<button type="button" class="lpx" data-lp-undo="${esc(key)}" data-team="${esc(team)}" title="Undo this change: the console goes back to how it was before it">&#10005;</button>`;
    return { needs: failed, at, sortAt: at, team, html: row(`auto ${k}${failed ? " failed" : ""}${reverted ? " reverted" : ""}`, { key, at, src: sp.who ?? "Auto", kind: KIND[k], team, text: sp.text, title: entry.text, effect: when, x }) };
  };
  const words = (r) => {
    const check = r.kind === "conflict" || r.kind === "unmatched" || r.kind === "unknown", where = check ? "" : sourcesText(r.sources);
    const why = check ? "" : r.nearApply ?? r.noApply ?? ""; // the text already says projected or confirmed: that is not repeated on every row
    const sortAt = check ? state.readAt ?? null : Math.max(...r.sources.map((s) => ms(s.at) ?? 0)) || null;
    const sides = check && r.sides?.length ? `<div class="lpsides">${r.sides.map((x) => `<div>${esc(x)}</div>`).join("")}</div>` : "";
    const sp = splitSource(r.text);
    return { needs: check, at: null, sortAt, team: r.team, html: row(`info ${check ? "conflict" : r.kind}`, { key: r.id, at: null, src: check ? "Check" : sp.who ?? r.sources.map((s) => SHORT[s.label] ?? s.label).join(" + "), kind: check ? KIND[r.kind] : "INFO", team: r.team, text: check ? r.text : sp.text, title: where, effect: [why, where].filter(Boolean).join(" · "), x: hide(r.id, check ? "check" : "line"), sides }) };
  };
  const note = (n) => ({ needs: true, at: null, sortAt: null, team: null, html: row("lpnote", { at: null, src: "Read", kind: "NOTE", team: null, text: n, effect: "", x: "" }) });
  return [...notes.map(note), ...conflicts.map(words), ...applied.map(news), ...info.map(words)];
}

/** The proposals' rows as HTML, what needs a look first; "" when there are none (flat, for tests and anything that wants them without the page). */
export function barHtml(bar, state = {}) {
  const rows = proposalRows(bar, state);
  return [...rows.filter((r) => r.needs), ...rows.filter((r) => !r.needs)].map((r) => r.html).join("");
}

/**
 * deps: { el, api(path), slate() -> the slate on show, players() -> its rows, console: { lineupView(slate), autoApplyProposal(slate, proposal), undoNews(team, key) },
 * toast(msg, kind), tryStore(fn), now() }. Returns { refresh(), newsOnly() }. refresh asks again for the lineup read, applies what is new and allowed, and redraws;
 * call it when the slate or its numbers change. newsOnly redraws the applied notes from the console; call it when his work moves.
 */
export function createLineupBar({ el, api, slate, players, slateData = () => null, tips = () => ({}), console: cons, toast, tryStore, now = Date.now, onLabel = () => {}, tick = false }) {
  const key = () => `nbaboard.lineupdismiss.${slate()}`;
  const readDismissed = () => { try { return JSON.parse(tryStore(() => localStorage.getItem(key())) ?? "{}") ?? {}; } catch (e) { console.warn("Lineup dismissals unreadable:", e.message); return {}; } };
  const state = { notes: [], team: null }; // team: the log filtered to one team (a click on a team header or a chip)
  const ctx = { latest: null, nowMs: now(), localAt: now(), view: null, slate: null }; // the lineup read, the server clock when it was read (and the browser's then: the clock moves on from there) and the console view the page is drawn from
  let label = { n: 0, check: 0, need: false }; // what the News tab says (newsLabel); onLabel hears each change
  let staleFlag = false; // a read too old to act on shows nothing from it (STALE_MIN, the same test that stops anything being made by itself); draw re-asks staleOf as the clock moves
  let gen = 0, running = null, again = false, shown = { applied: [], info: [], conflicts: [] };

  function draw() {
    // Another slate on show: nothing of the last one is drawn. The read's age keeps running between pulls (the server's clock at the read, plus the time since).
    if (ctx.slate && ctx.slate !== slate()) { Object.assign(ctx, { latest: null, view: null, slate: null }); shown = { applied: [], info: [], conflicts: [] }; state.notes = []; state.team = null; staleFlag = false; }
    const clockMs = ctx.nowMs + (now() - ctx.localAt), stale = ctx.latest ? Boolean(staleOf(ctx.latest, clockMs)) : staleFlag;
    const dismissed = readDismissed(), keep = (sig) => (r) => dismissed[r.id ?? r.key] !== sig(r);
    const all = { applied: shown.applied.filter(keep((r) => r.entry.sig + r.entry.state)), info: shown.info.filter(keep((r) => r.signature)), conflicts: shown.conflicts.filter(keep((r) => r.signature)) };
    // A stale read hides everything that came from it, but a change that failed is not part of the read: it needs Adam, so it stays.
    const bar = stale ? { applied: all.applied.filter((r) => r.entry.state === "failed"), info: [], conflicts: [] } : all;
    const shownState = stale ? { ...state, notes: [] } : state;
    const data = slateData();
    let model = null;
    const keepScroll = el.querySelector?.('.nwlrows')?.scrollTop ?? 0;
    if (!data) el.innerHTML = '<div class="lpempty">No slate on show.</div>';
    else {
      model = newsModel({ slate: { ...data, players: players() }, latest: ctx.latest, nowMs: clockMs, view: ctx.view, ...tips() }); // players(): the board's own rows, with his applied minutes
      el.innerHTML = newsPageHtml({ model, proposals: proposalRows(bar, { ...shownState, readAt: Date.parse(ctx.latest?.generated_at ?? ""), day: model.day }), team: state.team });
      const box = el.querySelector?.('.nwlrows');
      if (box) box.scrollTop = keepScroll;
    }
    label = newsLabel(bar, shownState, model?.log.length ?? 0);
    onLabel(label);
  }
  const settle = (notes, next = { applied: [], info: [], conflicts: [] }, old = false) => { staleFlag = old; shown = next; state.notes = notes.filter(Boolean); draw(); };

  async function once() {
    const mine = ++gen, name = slate();
    if (!name) { settle([]); return; }
    let read;
    try { read = await api(`/api/slate/${encodeURIComponent(name)}/news-lineups`); } catch (e) {
      if (mine !== gen) return;
      console.warn("Lineup read unavailable:", e.message);
      ctx.latest = null;
      return settle([`Lineups: the read could not be loaded (${noUrl(e.message)})`]);
    }
    if (mine !== gen) return;
    ctx.latest = read.state === "ok" ? read.latest : null;
    ctx.nowMs = Number.isFinite(read.now_ms) ? read.now_ms : now();
    ctx.localAt = now();
    ctx.slate = name;
    const line = statusLine(read);
    if (read.state !== "ok") return settle([line]);
    // The console's Tonight view is always loaded before anything is decided: who starts and who plays come only from it.
    const look = async () => {
      const view = await cons.lineupView(name);
      const result = makeProposals({ latest: read.latest, players: players(), view, nowMs: Number.isFinite(read.now_ms) ? read.now_ms : now() });
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
    ctx.view = seen.view;
    // A read over STALE_MIN minutes old (or of unknown age) says nothing in the default view: no line, no box. Nothing from it was made by itself.
    settle([line], { applied: newsRows(seen.view), info: seen.plan.info, conflicts: seen.result.conflicts }, Boolean(seen.result.stale));
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
      ctx.view = view;
      shown = { ...shown, applied: newsRows(view) };
      draw();
    } catch (e) {
      console.warn("Lineup notes not redrawn:", e.message); // the next look at the news says it on the bar
    }
  }

  el.addEventListener("click", async (e) => {
    const pickTeam = e.target.closest("[data-nw-team]");
    if (pickTeam) { const t = pickTeam.dataset.nwTeam || null; state.team = t === state.team ? null : t; return draw(); } // a team header or chip: the log shows that team only; again: all
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
  if (tick) { const h = setInterval(draw, 60_000); h.unref?.(); } // the read's age and the games' status move on with the clock between pulls
  return { refresh, newsOnly, redraw: draw, label: () => label };
}
