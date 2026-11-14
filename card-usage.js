// The player card's usage section: the "Efficiency and role" chart (card-chart.js) with Career / This season tabs (Week /
// Month inside This season), the past-seasons table, and the sources line; plus the state that loads it from
// /api/player-usage apart from the game log, so the log shows first. Pieces the server is still fetching come back
// pending and are asked for again every POLL_MS, at most MAX_POLLS times; a failed read is asked for again, at most MAX_RETRIES times. A missing figure is a dash with its reason,
// never zero and never another season's or player's figure. DOM-free except fetchUsageHttp.
import { esc } from "./board-util.js";
import { chartParts, isNum, SMALL } from "./card-chart.js";
import { MONTHS, seasonLabel, fetchedAt } from "./gamerow.js";

export const POLL_MS = 6000;
export const MAX_POLLS = 25;
export const MAX_RETRIES = 3; // asks again for a failed read, per open card
const DAY = 86_400_000;
const PIECES = ["opener", "career", "view", "game_usage"];
const isPiece = (x) => Boolean(x && typeof x === "object" && (x.pending === true || typeof x.error === "string" || (x.value && typeof x.value === "object")));
export { fetchedAt }; // lives in gamerow.js (usgNote needs it too); one copy

/** The server's answer -> { state: "ok", data } or { state: "error", message }. */
export function readUsageResponse(status, ok, text) {
  let body, why = null;
  try { body = JSON.parse(text); } catch (e) { why = e.message; }
  if (!ok) return { state: "error", message: why ? `HTTP ${status}` : body?.error?.message ?? `HTTP ${status}` };
  if (why) return { state: "error", message: `the server sent unreadable usage figures (${why})` };
  if (!body || !Number.isInteger(body.season) || !body.league || typeof body.league !== "object" || !PIECES.every((k) => isPiece(body[k]))) return { state: "error", message: "the server sent unreadable usage figures" };
  if (body.game_usage.value && !Array.isArray(body.game_usage.value.games)) return { state: "error", message: "the server sent unreadable usage figures (the game-log USG% has no games list)" };
  return { state: "ok", data: body };
}

/** A new open card's id: 20 lowercase letters and digits. */
export const newCardId = () => Array.from({ length: 20 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

/** The usage state, DOM-free. fetchUsage(player, signal, cardId) -> Promise<{ status, ok, text }>; closeUsage(cardId)
 *  tells the server the card is gone, so it stops that card's player reads. schedule/cancel are the timer and makeId the
 *  card id (injectable for tests). One AbortController and one card id per open card, shared by its polls; a swap or
 *  close aborts it, drops any answer in flight and any poll, and sends the close call. */
export function createUsageState({ fetchUsage, closeUsage = () => {}, onChange = () => {}, schedule = setTimeout, cancel = clearTimeout, pollMs = POLL_MS, maxPolls = MAX_POLLS, maxRetries = MAX_RETRIES, makeId = newCardId }) {
  let usage = { state: "idle" }, ticket = 0, ctl = null, timer = null, polls = 0, retries = 0, cardId = null;
  const ui = { tab: "career", by: null };
  const stop = () => {
    ticket++;
    if (ctl) ctl.abort();
    ctl = null;
    if (timer !== null) cancel(timer);
    timer = null;
    if (cardId) {
      const id = cardId;
      cardId = null;
      // Best effort: if the close call fails, the server still drops the card after its idle time.
      Promise.resolve().then(() => closeUsage(id)).catch((e) => console.warn(`player card: the close call for card ${id} failed (${e?.message ?? e}); the server drops it once idle`));
    }
  };
  async function load(p, mine) {
    let next, transient = false; // transient: the server was unreachable or answered 5xx, so asking again can help
    try {
      const r = await fetchUsage(p, ctl?.signal, cardId);
      next = readUsageResponse(r.status, r.ok, r.text);
      transient = r.status >= 500;
    } catch (e) {
      next = { state: "error", message: `the board server could not be reached (${e.message})` };
      transient = true;
    }
    if (mine !== ticket) return;
    if (next.state === "error" && usage.state === "ok") usage = { ...usage, pollError: next.message, polling: false }; // keep what arrived
    else usage = next;
    if (usage.state === "ok" && next.state === "ok") {
      const more = next.data.pending && polls < maxPolls;
      usage = { ...usage, polling: more, gaveUp: next.data.pending && !more };
      if (more) { polls++; timer = schedule(() => { timer = null; load(p, mine); }, pollMs); }
    }
    // A transient failure (the whole read failing from the network or a 5xx, or game_usage alone failing with the
    // server's `transient: true` and no `retry_at`, with nothing else pending) is asked for again after pollMs, at most
    // maxRetries times per open card; `retrying` while one is scheduled, `retriesOut` once they are used up. A permanent
    // failure, or one with `retry_at` (Basketball-Reference has paused the app), is never retried.
    const gu = next.state === "ok" ? next.data.game_usage : null;
    const retryable = next.state === "error" ? transient : !next.data.pending && typeof gu.error === "string" && gu.transient === true && !gu.retry_at;
    usage = { ...usage, retrying: false, retriesOut: false };
    if (retryable && retries < maxRetries) {
      retries++;
      usage.retrying = true;
      timer = schedule(() => { timer = null; load(p, mine); }, pollMs);
    } else {
      if (retryable) usage.retriesOut = true;
      // A failed refresh that will not be retried leaves the log pending for good: the cells say so instead of waiting.
      if (next.state === "error" && usage.state === "ok" && usage.data.game_usage.pending) usage.gaveUp = true;
    }
    onChange();
  }
  return {
    get usage() { return usage; },
    ui,
    open(p) {
      stop();
      polls = 0;
      retries = 0;
      ui.by = null;
      usage = p ? { state: "loading" } : { state: "idle" };
      if (!p) return Promise.resolve();
      ctl = typeof AbortController === "function" ? new AbortController() : null;
      cardId = makeId();
      return load(p, ticket);
    },
    close() { stop(); usage = { state: "idle" }; },
  };
}

// ---------- models ----------
const leagueOf = (league, season, k) => { const x = league?.[season]?.[k]; return x && isNum(x.value) ? x.value : null; };
const perGame = (games, minutes) => (isNum(minutes) && games > 0 ? `${(minutes / games).toFixed(1)} min/g` : "minutes missing");

/** The career chart's model: one point per season (league basis DK/min, USG%), his career average, team changes. */
export function careerModel(data) {
  const c = data.career.value;
  const points = c.points.map((p) => ({
    label: p.label, tick: c.points.length > 9 ? p.label.slice(2) : p.label, games: p.games,
    sub: `${isNum(p.games) ? p.games : "?"} g, ${isNum(p.avg_minutes) ? `${p.avg_minutes.toFixed(1)} min/g` : "minutes missing"}`,
    dk: p.dk, usg: p.usg, lgDk: leagueOf(data.league, p.season, "dk"), lgUsg: leagueOf(data.league, p.season, "usg"), team: p.teams.join(" then "), dkNote: p.dk_note ?? null, gamesNote: p.games_note ?? null,
  }));
  const last = c.points[c.points.length - 1];
  return { points, avg: c.average, moves: c.moves, flatLeague: false, endWord: last && last.season === data.season ? "now" : "last" };
}

/** Week or month buckets with the empty periods between the first and last put back (games 0, every figure null), so a
 *  stretch without games is a gap in the line. Week labels are their Monday ("Oct 19"); months are "Oct". */
export function fillGaps(buckets, by) {
  if (!buckets.length) return [];
  const ms = (iso) => Date.parse(`${iso}T00:00:00Z`);
  const step = (t) => (by === "week" ? t + 7 * DAY : Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth() + 1, 1));
  const have = new Map(buckets.map((b) => [b.start, b]));
  const out = [];
  for (let t = ms(buckets[0].start), end = ms(buckets[buckets.length - 1].start); t <= end; t = step(t)) {
    const iso = new Date(t).toISOString().slice(0, 10), d = new Date(t);
    out.push(have.get(iso) ?? { label: by === "week" ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` : MONTHS[d.getUTCMonth()], start: iso, games: 0, minutes: null, dk_per_min: null, dk_per_min_league_basis: null, usg: null });
  }
  return out;
}

/** The first day of the week (Monday) or month a "YYYY-MM-DD" date falls in, as groupSeason keys its buckets. */
export function periodStart(date, by) {
  if (by === "month") return `${date.slice(0, 8)}01`;
  const t = Date.parse(`${date}T00:00:00Z`);
  return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
}

/** The This-season chart's model for "week" or "month": flat league line for that season, his season average, and a
 *  mid-season marker in the period of each team change (the server's view.moves, from Basketball-Reference's game log). */
export function seasonModel(data, by) {
  const v = data.view.value;
  const filled = fillGaps(v[by], by);
  const moves = (v.moves ?? []).map((m) => ({ index: filled.findIndex((b) => b.start === periodStart(m.date, by)), mid: true, team: m.team })).filter((m) => m.index >= 0);
  const points = filled.map((b) => ({
    label: by === "week" ? `Wk of ${b.label}` : `${b.label} ${b.start.slice(0, 4)}`, tick: b.label, games: b.games,
    sub: `${b.games} g, ${perGame(b.games, b.minutes)}`, dk: b.dk_per_min_league_basis, usg: b.usg,
    lgDk: leagueOf(data.league, v.season, "dk"), lgUsg: leagueOf(data.league, v.season, "usg"),
  }));
  return { points, avg: v.average, moves, flatLeague: true, endWord: v.last_season ? "end" : "now" };
}

/** The model for the tab on show, or { why } when it cannot be drawn. */
export function chartModel(data, ui) {
  if (ui.tab === "season") {
    if (data.view.pending) return { why: "This season's games are still loading." };
    if (data.view.error) return { why: `No season chart: ${data.view.error}` };
    const by = ui.by ?? data.view.value.by;
    return data.view.value[by].length ? seasonModel(data, by) : { why: `${data.view.value.label}: no games yet.` };
  }
  if (data.career.pending) return { why: "His career figures are still loading." };
  if (data.career.error) return { why: `No career chart: ${data.career.error}` };
  return data.career.value.points.length ? careerModel(data) : { why: "No seasons on record." };
}

// ---------- markup ----------
/** League lines absent, grouped by reason: "League DK pts/min line absent for 2004-05, 2005-06: reason". */
function leagueNotes(data, seasons) {
  const out = [];
  for (const [k, what] of [["dk", "DK pts/min"], ["usg", "USG%"]]) {
    const by = new Map();
    for (const s of seasons) {
      const x = data.league?.[s]?.[k];
      const why = !x ? "not asked for" : x.pending ? "still loading from Basketball-Reference" : x.error ?? (isNum(x.value) ? null : "no figure");
      if (why) by.set(why, [...(by.get(why) ?? []), seasonLabel(s)]);
    }
    for (const [why, list] of by) out.push(`League ${what} line absent for ${list.join(", ")}: ${why}.`);
  }
  return out;
}


/** The seasons table, newest season first (this season included, tagged "so far"); a traded season shows each team, then
 *  the combined row. DK/g and DK/min are full DraftKings scoring (double-double and triple-double bonuses counted). */
export function seasonsTable(data, dash) {
  const c = data.career.value;
  const heading = '<div class="sec ue-seasons">Seasons</div>';
  if (data.career.pending) return `${heading}<div class="cardmsg">Loading seasons from ESPN and Basketball-Reference…</div>`;
  if (!c) return `${heading}<div class="cardmsg err">No seasons table: ${esc(data.career.error ?? "no career figures in the answer")}</div>`;
  if (!c.seasons.length) return `${heading}<div class="cardmsg">No seasons table: no seasons on record.</div>`;
  const seasons = [...new Set(c.seasons.map((r) => r.season))].sort((a, b) => b - a);
  const cell = (v, dp, why) => (isNum(v) ? v.toFixed(dp) : dash(why));
  const espnWhy = (r) => (c.errors.espn ? `ESPN failed: ${c.errors.espn}` : r.dk_note ?? "ESPN has no totals for this row");
  const zeroWhy = (r) => (r.season === data.season ? "no games this season yet" : "no games in this row");
  const rows = seasons.flatMap((s) => c.seasons.filter((r) => r.season === s)).map((r) => {
    const tot = r.team === "TOT", now = r.season === data.season, none = isNum(r.games) && r.games === 0;
    return `<tr class="${[tot ? "tot" : "", now ? "now" : ""].join(" ").trim()}"><td class="ue-l">${esc(r.label ?? seasonLabel(r.season))}${now ? '<em class="sofar" title="This season is still being played">so far</em>' : ""}</td>`
      + `<td>${cell(r.games, 0, c.errors.espn ? `ESPN failed: ${c.errors.espn}` : "no games count")}</td>`
      + `<td>${cell(r.avg_minutes, 1, "no minutes for this row")}</td>`
      + `<td>${cell(r.dk_per_min, 2, none ? zeroWhy(r) : isNum(r.dk_per_game) ? "no minutes for this row" : espnWhy(r))}</td>`
      + `<td>${cell(r.usg, 1, c.errors.bbr ? `Basketball-Reference: ${c.errors.bbr}` : "Basketball-Reference has no USG% for this row")}</td>`
      + `<td class="k">${cell(r.dk_per_game, 2, none ? zeroWhy(r) : espnWhy(r))}</td>`
      + `<td class="ue-l tm"${tot ? ' title="All his teams that season, combined"' : ""}>${esc(r.team)}</td></tr>`;
  }).join("");
  return `${heading}<table class="log ue-tbl sst"><thead><tr><th class="l">Season</th><th title="Games played">GP</th><th title="Minutes per game">Min</th><th title="DK points per minute, full DraftKings scoring (bonuses included); the chart below uses the league basis">DK/min</th><th title="Usage rate, Basketball-Reference">USG%</th><th class="s" title="DK points per game, full DraftKings scoring (double-double and triple-double bonuses included)">DK/g</th><th class="l tm">Team</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const legend = () => {
  const key = (c) => `<svg width="22" height="10" viewBox="0 0 22 10"><line x1="1" x2="21" y1="5" y2="5" stroke="${c}" stroke-width="2"/><circle cx="11" cy="5" r="4" fill="${c}" stroke="var(--p)" stroke-width="2"/></svg>`;
  return `<div class="ue-lgd"><span>${key("var(--am)")}${key("var(--bl)")}Player</span><span><svg width="22" height="10" viewBox="0 0 22 10"><line x1="1" x2="21" y1="5" y2="5" stroke="var(--tx)" stroke-width="1.25" opacity=".6"/></svg>his avg</span>`
    + `<span><svg width="22" height="10" viewBox="0 0 22 10"><line x1="1" x2="21" y1="5" y2="5" stroke="var(--mu)" stroke-width="1.5" stroke-dasharray="5 4"/></svg>league avg</span>`
    + `<span><svg width="12" height="10" viewBox="0 0 12 10"><circle cx="6" cy="5" r="4" fill="var(--p)" stroke="var(--mu)" stroke-width="1.6"/></svg>under ${SMALL} games</span></div>`;
};

/** The section's markup for a usage state and the tab choice. ctx: { dash(title) }. */
export function usageHtml(p, usage, ui, { dash }) {
  const head = (tabs = "") => `<div class="ue"><div class="ue-hd"><b>Efficiency and role</b><span class="ue-grow"></span>${tabs}</div>`;
  const seasonsMsg = (m, err) => `<div class="sec ue-seasons">Seasons</div><div class="cardmsg${err ? " err" : ""}">${m}</div>`;
  if (usage.state === "idle" || usage.state === "loading") return `${seasonsMsg("Loading seasons from ESPN and Basketball-Reference…")}${head()}<div class="cardmsg">Loading usage figures from ESPN and Basketball-Reference…</div></div>`;
  if (usage.state === "error") return `${seasonsMsg(`No seasons table: ${esc(usage.message)}`, true)}${head()}<div class="cardmsg err">No usage figures for ${esc(p.name)}: ${esc(usage.message)}${usage.retrying ? `${/[.!?)]$/.test(usage.message) ? "" : "."} Trying again…` : ""}</div></div>`;
  const data = usage.data;
  const btn = (attr, val, on, text) => `<button ${attr}="${val}" class="${on ? "on" : ""}">${text}</button>`;
  const tabs = `<div class="ue-seg">${btn("data-ue-tab", "career", ui.tab === "career", "Career")}${btn("data-ue-tab", "season", ui.tab === "season", data.view.value?.last_season ? esc(data.view.value.label) : "This season")}</div>`;
  let tools = "";
  const v = data.view.value;
  if (ui.tab === "season" && v) {
    const by = ui.by ?? v.by;
    const days = data.opener.value?.date ? Math.round((Date.parse(data.today) - Date.parse(data.opener.value.date)) / DAY) : null;
    const note = v.last_season ? `${v.label} by ${by}: ${seasonLabel(data.season)} ${days === null || days < 0 ? "has not started" : `is ${days} day${days === 1 ? "" : "s"} old`}, too early to chart${data.opener.value && !data.opener.value.date ? " (ESPN lists no start date yet)" : ""}` : `${v.label}, grouped by ${by}`;
    tools = `<div class="ue-tools"><div class="ue-seg sm">${btn("data-ue-by", "week", by === "week", "Week")}${btn("data-ue-by", "month", by === "month", "Month")}</div><span class="ue-note">${esc(note)}</span></div>`;
  }
  const model = chartModel(data, ui);
  const seasons = model.why ? [] : ui.tab === "season" ? [v.season] : data.career.value.points.map((x) => x.season);
  const notes = model.why ? [] : leagueNotes(data, seasons);
  const errs = model.why ? null : ui.tab === "season" ? v.errors : data.career.value.errors;
  if (errs?.espn) notes.unshift(`DK pts/min missing: ESPN's ${ui.tab === "season" ? "game log" : "season totals"} could not be read (${errs.espn}).`);
  if (!model.why && ui.tab === "career") for (const x of model.points) if (x.dkNote && x.dk === null) notes.unshift(`DK pts/min missing for ${x.label}: ${x.dkNote}.`);
  if (errs?.bbr) notes.unshift(`USG% missing: Basketball-Reference's ${ui.tab === "season" ? "game log" : "player page"} could not be read (${errs.bbr}).`);
  if (!model.why && ui.tab === "career") for (const x of model.points) if (x.gamesNote) notes.unshift(`Games and minutes missing for ${x.gamesNote}.`);
  const bid = data.ids?.bbr;
  if (bid?.value && bid.name_only) notes.push(`Basketball-Reference player ${bid.value} was found by name only (${bid.source})${bid.checked ? " and kept because his Basketball-Reference career matches ESPN's" : ""}.`);
  else if (bid?.value && !/name and team/.test(bid.source ?? "")) notes.push(`Basketball-Reference player ${bid.value} comes from ${bid.source}.`);
  if (data.pending && usage.polling) notes.push("Some figures are still loading (Basketball-Reference pages come 4 seconds apart); the chart fills in as they arrive.");
  if (usage.gaveUp) notes.push("Some figures were still loading after several tries; close and reopen the card to try again.");
  if (usage.pollError) notes.push(`The last refresh failed: ${usage.pollError}`);
  const chart = model.why ? `<div class="cardmsg">${esc(model.why)}</div>` : `${legend()}<div class="ue-chart">${chartParts(model).svg}<div class="ue-tip" hidden></div></div>`;
  return `${seasonsTable(data, dash)}${head(tabs)}${tools}${chart}${notes.map((t) => `<div class="ue-warn">${esc(t)}</div>`).join("")}</div>`;
}

/** The browser's fetcher for the usage route; every poll of one open card sends its card id. */
export const fetchUsageHttp = async (p, signal, cardId) => {
  const r = await fetch(`/api/player-usage?name=${encodeURIComponent(p.name)}&team=${encodeURIComponent(p.team)}&card=${encodeURIComponent(cardId)}`, { signal });
  return { status: r.status, ok: r.ok, text: await r.text() };
};
/** Tells the server a card closed (or was swapped), so it stops that card's player reads. */
export const closeUsageHttp = (cardId) => fetch("/api/player-usage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ close: cardId }), keepalive: true });
