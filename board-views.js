// The board page's markup builders: each takes what it draws and returns html; board.js puts it on the page. Moved out of board.js
// unchanged (file split, 11-17). Every figure is read as given; a missing one is shown as an em dash with a title, never zero.
import { tiers, notes } from "./highlight.js";
import { esc, logo, isoToEastern, ICON, topStamps } from "./board-util.js";
import { badgeHtml } from "./sources-panel.js";
import { noteLists as dataNotes, warningCount } from "./box-note.js";
import { hasResettable } from "./player-table.js";
import { pullChipHtml } from "./pull-note.js";
import { borderStyle } from "./game-borders.js";
import { themeHtml } from "./theme.js";

export function slateLabel(name) {
  const m = name.match(/^(\d{4})-(\d{2})-(\d{2})-(.+)$/);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return `${day} · ${m[4][0].toUpperCase()}${m[4].slice(1)}`;
}

/** The header: slate menu, tabs, data-warning list, Pull now, Console, Pin slots and theme. `panel` and `pullNow` are the page's own. */
export function topHtml({ s, slates, name, view, news, consoleOn, panel, pullNow, theme, when }) {
  const { injuries, injuriesAbsent } = topStamps(s);
  const badges = badgeHtml({ injuriesMissing: injuriesAbsent && !when(injuries), projProblem: s.proj_problem ?? "" });
  const n = dataNotes(s); const count = warningCount(n);
  const list = (h, a) => (a.length ? `<h4>${h}</h4><ul>${a.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");
  return `<div class="brand"><span class="mk"></span>NBA_BOARD<small>dk classic</small></div>
<select class="slate" id="slateSel">${slates.map((x) => `<option value="${esc(x.slate)}"${x.slate === name ? " selected" : ""}>${esc(slateLabel(x.slate))}${x.slate === name ? ` · ${s.games.length} game${s.games.length === 1 ? "" : "s"}` : ""}</option>`).join("")}</select>
<span class="vtabs"><button data-view="list" class="${view === "lineups" || consoleOn ? "" : "on"}">Player list</button><button data-view="lineups" class="${view === "lineups" && !consoleOn ? "on" : ""}">Lineups${panel.builtCount() ? ` <b>${panel.builtCount()}</b>` : ""}</button><button id="csBtn" class="${consoleOn ? "on" : ""}${news?.need ? " need" : ""}" title="${news?.need ? "Lineup news that needs your look (open the Console: All teams)" : consoleOn ? "Back to the board" : "Scenario console: minutes and usage when men sit, and tonight's lineup news"}">Console${news?.n ? ` <b>${news.n}</b>` : ""}</button></span>
${badges ? `<div class="stamps">${badges}</div>` : ""}
${count ? `<div class="notes"><button id="notesBtn" title="${count} data warning${count === 1 ? "" : "s"} on this slate">Data warnings</button><div class="list" id="notesList" hidden>${list("Conflicts", n.conflicts)}${list("Missing", n.missing)}${list("Box scores", n.boxes)}</div></div>` : ""}
${pullNow.html()}
<button id="lsBtn" class="lsw${panel.lateSwap() ? " on" : ""}" title="${panel.lateSwap() ? "Leave late swap mode" : "Late swap: men whose game has started stay in their slot; pin others to a slot and fill the open ones"}"${panel.running() ? " disabled" : ""}>${ICON.lock} Pin slots</button>
${themeHtml(theme)}`;
}

/** The games strip (numbers light up by tier, see highlight.js: game totals in house amber, team totals in the team's own colour). */
export function gamesHtml({ slateGames, players, game, fives, colourOf, when, dash }) {
  const games = [...slateGames].sort((a, b) => String(a.tip).localeCompare(String(b.tip)) || a.game.localeCompare(b.game));
  const gameTotals = games.map((g) => (typeof g.total === "number" ? g.total : null));
  const gt = tiers(gameTotals), gn = notes(gameTotals, "game total");
  const flat = games.flatMap((g, gi) => [g.away, g.home].map((t) => ({ gi, t })));
  const implied = flat.map(({ gi, t }) => (typeof games[gi].implied?.[t] === "number" ? games[gi].implied[t] : null));
  const it = tiers(implied), inotes = notes(implied, "team total");
  // Back-to-back (Adam 11-14): the team code's colour says it, orange on the second night, blue when the team plays again tomorrow; the flags ride every man (server/slate/back-to-back.js).
  const restOf = (t) => { const m = players.find((p) => p.team === t); return m?.rest_b2b2nd ? { cls: " b2b2", title: `${t} played last night: second night of a back-to-back` } : m?.rest_plays_tomorrow ? { cls: " b2b1", title: `${t} plays again tomorrow: first night of a back-to-back` } : { cls: "", title: "" }; };
  const side = (g, t, k) => {
    const ip = implied[k]; const fav = g.favourite === t; const sp = g.spread; const c = colourOf(t); const rest = restOf(t);
    const note = typeof sp !== "number" || !g.favourite ? "" : (fav ? "" : "+") + (fav ? sp : Math.abs(sp)).toFixed(1);
    return `<div class="side${fav ? " fav" : ""}" style="--t1:${c.t1}">${logo(t, "lg")}<b class="code${rest.cls}"${rest.title ? ` title="${esc(rest.title)}"` : ""}>${esc(t)}</b><small class="spr" title="${fav ? "Favourite" : "Underdog"}">${esc(note)}</small>${ip === null ? `<span class="ip">${dash("no implied points in this slate file")}</span>` : `<span class="ip t-${it[k]}" style="--tc:${c.t1}"${inotes[k] ? ` title="${esc(inotes[k])}"` : ""}>${ip.toFixed(1)}</span>`}</div>`;
  };
  const bd = (g) => { const s = borderStyle(fives?.[g.game]); return s ? ` cf" style="${s}` : ""; }; // thin green/yellow border halves from the News tab's confirmed fives
  return games.map((g, gi) => `<div class="game${game === g.game ? " sel" : ""}${bd(g)}" data-game="${esc(g.game)}"><div class="gh"><span class="tip">${esc(when(g.tip) ?? "—")}</span><span class="tot">O/U ${gameTotals[gi] === null ? dash("no total in this slate file") : `<b class="t-${gt[gi]}" style="--tc:var(--am)"${gn[gi] ? ` title="${esc(gn[gi])}"` : ""}>${gameTotals[gi].toFixed(1)}</b>`}</span></div>${side(g, g.away, gi * 2)}${side(g, g.home, gi * 2 + 1)}</div>`).join("");
}

/** A season-figure column's tooltip: its basis, then this season's as-of time (and last season's when an LY figure shows). */
export function headTitle(slate, players, c) {
  const f = slate?.season_figures?.[c.key];
  const at = (m) => (m?.as_of ? `as of ${new Date(m.as_of).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}, ${isoToEastern(m.as_of) ?? m.as_of}` : `not loaded${m?.error ? ` (${m.error})` : ""}`);
  if (c.key === "min_usual") return slate?.min_usual_pull ? `${c.head}, from the board row of the ${slate.min_usual_pull} pull (TwoGun NBA board)` : c.head;
  if (!f) return c.head;
  const ly = players.some((p) => p[c.key + "_tag"] === "LY");
  return `${c.head}, Basketball-Reference, ${at(f.this_season)}${ly ? `; 2025-26 figures (LY) ${at(f.last_season)}` : ""}`;
}

/** Locked / Excluded / Starred filter chips with their counts (only men still on the slate are counted); 0 is dim but
 *  clickable. Then "Reset all overrides" (A6): it clears typed numbers, bumps and console minutes, never stars (NFL D72), so it is
 *  disabled while no row has any, and it asks first (the click in board.js). Then the pull-changes chip. */
export function chipsHtml({ players, picks, byId, pickFilter, slate }) {
  const n = (k) => (k === "starred" ? players.filter((p) => p.starred).length : picks[k].filter((id) => byId.has(id)).length);
  const nOvr = players.filter(hasResettable).length;
  return [["locked", "Locked"], ["excluded", "Excluded"], ["starred", "Starred"]].map(([k, label]) => `<button data-chip="${k}" class="chip ${k}${pickFilter === k ? " on" : ""}${n(k) ? "" : " zero"}" title="${pickFilter === k ? "Show everyone again" : `Show only ${label.toLowerCase()} players`}">${label} <b>${n(k)}</b></button>`).join("")
    + `<button id="ovReset" class="chip ovr${nOvr ? "" : " zero"}"${nOvr ? ` title="${nOvr} ${nOvr === 1 ? "man has" : "men have"} a projection, ownership or bump typed on the board"` : ` disabled title="Nothing typed on the board to reset"`}>Reset all overrides</button>`
    + pullChipHtml(slate?.pull_changes, players, pickFilter === "changed");
}

/** A man from the Out list as the card opens him: on the slate's player pool when he is there, else only what the list says. */
export function outMan(players, o) {
  const on = players.find((p) => p.name === o.name && p.team === o.team);
  if (on) return o.absence && !on.absence ? { ...on, absence: o.absence } : on;
  return { dk_id: null, name: o.name, team: o.team, positions: [], injury_status: o.status ?? "Out", salary_text: o.salary_text ?? null, his_in_note: o.his_in_note ?? null, absence: o.absence ?? null };
}
/** A salary in dollars from the Out entry: its number when it has one, else the "$4.4K" text; 0 when neither reads. */
const outSalary = (o) => {
  if (Number.isFinite(o.salary)) return o.salary;
  const m = /^\$?\s*([\d.,]+)\s*(k?)$/i.exec(String(o.salary_text ?? "").trim());
  const n = m ? parseFloat(m[1].replace(/,/g, "")) : NaN;
  return Number.isFinite(n) ? Math.round(n * (m[2] ? 1000 : 1)) : 0;
};
/** The Out list, closed on every load (a per-visit open): one line per team, the teams with the most usual minutes out first, the men by salary; each man keeps his index into slate.out for the click. */
export function outsHtml({ out, outOpen, colourOf }) {
  if (!out.length) return "";
  const teams = new Map();
  out.forEach((o, i) => { if (!teams.has(o.team)) teams.set(o.team, []); teams.get(o.team).push({ o, i }); });
  const mins = (men) => men.reduce((t, { o }) => t + (Number.isFinite(o.usual_minutes) ? o.usual_minutes : 0), 0);
  const lines = [...teams].sort((x, y) => mins(y[1]) - mins(x[1]) || String(x[0]).localeCompare(String(y[0]))).map(([team, men]) => {
    const items = men.sort((x, y) => outSalary(y.o) - outSalary(x.o) || x.i - y.i).map(({ o, i }) => {
      const st = String(o.status ?? "OUT").toUpperCase(), word = st === "OUT" || st === "O" ? "" : ` <i>${esc(st.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()))}</i>`;
      return `<span class="o" title="${esc([o.reason, o.usual_minutes != null ? `usual minutes ${o.usual_minutes}` : null].filter(Boolean).join(" · "))}"><button class="oname" data-out-i="${i}" title="Open ${esc(o.name)}'s card">${esc(o.name)}</button>${o.salary_text ? ` <em>${esc(o.salary_text)}</em>` : ""}${word}</span>`;
    }).join('<span class="osep"> · </span>');
    return `<div class="otm"><span class="otc" style="color:${esc(colourOf(team).t1)}">${logo(team, "xs")}${esc(team)}</span><span class="oit">${items}</span></div>`;
  }).join("");
  return `<button class="oh2" id="outTog" aria-expanded="${outOpen}" title="${outOpen ? "Hide" : "Show"} the Out list">Out ${outOpen ? "▾" : `(${out.length}) ▸`}</button>${outOpen ? `<div class="olist">${lines}</div>` : ""}`; // the strip folds (C2); stored uppercase; shown "Doubtful" and the like only when not plain Out
}
