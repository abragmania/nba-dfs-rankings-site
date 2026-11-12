// The News tab's markup (news-model.js has the data; lineup-bar.js owns the clicks and the proposals' rows): the games in slate order, the two teams of a game side by side, each
// team's five, bench and Out men, one line a man; and the sticky log on the right, newest first, filterable to a team. Pure strings, tested in node. Look: lineup-bar.css (nw-).
// teamHtml, gamesHtml and logHtml take their model and return their HTML, so the Console can reuse them without a second copy.
import { esc, logo } from "./board-util.js";
import { teamColors } from "./teams.js";
import { timeLabel } from "./news-model.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const dash = '<span class="nwd">—</span>';
const f1 = (v) => (isNum(v) ? v.toFixed(1) : null);
/** A moment as the log shows it, "7:06 PM" (Eastern); "—" for none. */
export const timeText = (ms) => timeLabel(ms) ?? "—";

const deltaHtml = (d) => {
  if (!d) return "";
  const bit = (x, unit, digits) => (x ? `<b class="${x.to > x.from ? "up" : "dn"}">${x.to > x.from ? "▲" : "▼"}${Math.abs(x.to - x.from).toFixed(digits)}${unit}</b>` : "");
  return [bit(d.min, "m", 1), bit(d.proj, "p", 1)].filter(Boolean).join(" ");
};

function playerRow(r, day) {
  const tg = r.out ? (isNum(r.usual) ? `<s title="usual minutes">${f1(r.usual)}</s>` : dash) : f1(r.tg) ?? dash;
  const when = timeLabel(r.noteAt, { day, precision: r.notePrecision }), whenShort = timeLabel(r.noteAt, { day, precision: r.notePrecision, compact: true });
  const title = [r.note, when ? `reported ${when}${r.notePrecision === "day" ? "" : " ET"}` : ""].filter(Boolean).join(" · ");
  return `<div class="nwr${r.out ? " out" : ""}"><span class="nwn" title="${esc(r.name)}">${esc(r.name)}</span><span class="nwp">${esc(r.pos ?? "") || dash}</span><span class="nws">${esc(r.salary ?? "") || dash}</span>`
    + `<span class="nwc ${r.status.cls}" title="${esc(r.status.word)}">${esc(r.status.word)}</span><span class="nwt" title="${esc(title)}">${r.note || when ? `<span class="nwtx">${esc(r.note ?? "")}</span>${when ? `<time class="nwat">${esc(whenShort)}</time>` : ""}` : dash}</span><span class="nwm">${tg}</span>`
    + `<span class="nwm nwo">${f1(r.ours) ?? dash}</span><span class="nwk">${r.mark ? `<i>${esc(r.mark)}</i>` : ""}</span><span class="nwl">${deltaHtml(r.delta)}</span></div>`;
}

export const FIVE_WORD = { confirmed: "Confirmed", expected: "Expected", disagree: "Sources disagree", uncompared: "Fives not compared", twogun: "TwoGun's five" };
/** Who said a team's five and when each source was read, as the header words (" · Monster + RotoWire as of 4:41 PM"); "" when no source. The Console's news strip reuses it. */
export function fiveSaid(five, day = null) {
  // Who said it and when each source was read (the pages carry no announced time): one time when they match, else each; a source with no read time shows a dash.
  const times = five.by.map((n) => timeLabel(five.at?.[n], { day })), same = times.every((t) => t === times[0]);
  const named = five.by.length ? (same ? `${five.by.join(" + ")} as of ${times[0] ?? "—"}` : five.by.map((n, i) => `${n} as of ${times[i] ?? "—"}`).join(" + ")) : "";
  return five.kind === "uncompared" ? ` · ${named}: a man has no id on the slate, so the fives could not be compared` : five.kind === "disagree" ? ` · ${named}; ${five.differs.join(" + ")} differ${five.differs.length === 1 ? "s" : ""}` : named ? ` · ${named}` : "";
}
/** One team as its block (header, five, bench, Out): teamHtml(teamModel(...), "away"|"home"|"", selectedCode). The Console reuses it, as it does logHtml and gamesHtml, with no second copy. */
export function teamHtml(T, side, sel) {
  const five = T.five, day = T.day ?? null;
  const by = fiveSaid(five, day);
  const q = T.counts.questionable, A = T.asOf ?? {};
  // The last-pull column names the pull once, in its head, so no row needs its own time.
  const sinceHead = Number.isFinite(A.pullPrev) ? `Since ${timeLabel(A.pullPrev, { day, compact: true })}` : "Last pull";
  const sinceTitle = Number.isFinite(A.pullPrev) ? `Change since the ${timeLabel(A.pullPrev, { day })} ET pull (now the ${timeLabel(A.pullNow, { day }) ?? "—"} ET pull)` : "Change since the last pull";
  const col = teamColors(T.code);
  const unmatched = five.unmatched?.length ? `<div class="nwr none"><span class="nwt">Not on this slate: ${esc(five.unmatched.join(", "))}</span></div>` : "";
  return `<div class="nwteam${sel === T.code ? " sel" : ""}" data-team="${esc(T.code)}" style="--t1:${esc(col.t1)}"><div class="nwth" data-nw-team="${esc(T.code)}" title="Show only ${esc(T.code)} in the log">${logo(T.code, "xs")}<b>${esc(T.code)}</b><span class="nwside">${side}</span><span class="nwgrow"></span>`
    + `<span class="nwcnt">${T.counts.onSlate} on slate · ${T.counts.out} out${q ? ` · ${q} questionable` : ""}</span></div>`
    + `<div class="nwch"><span>Player</span><span>Pos</span><span>Salary</span><span>Status</span><span>Injury note</span><span class="r" title="TwoGun minutes">TG</span><span class="r">Ours</span><span>Mark</span><span title="${esc(sinceTitle)}">${esc(sinceHead)}</span></div>`
    + `<div class="nwsec"><span>Starting five</span><em class="${five.kind}">${FIVE_WORD[five.kind]}${esc(by)}</em></div>${T.starters.map((r) => playerRow(r, day)).join("")}${unmatched}`
    + `<div class="nwsec"><span>Bench</span></div>${T.bench.map((r) => playerRow(r, day)).join("")}`
    + `<div class="nwsec o"><span>Out</span><em class="n">usual minutes struck</em></div>${T.outs.length ? T.outs.map((r) => playerRow(r, day)).join("") : `<div class="nwr none">${dash}</div>`}</div>`;
}

/** The games, in the slate's order; a warning line for any team that has players or Out men but no game row. */
export function gamesHtml(model, sel = null) {
  const orphans = model.orphans?.length
    ? `<div class="nwnote warn">${model.orphans.map((o) => `${esc(o.team)} (${o.players} player${o.players === 1 ? "" : "s"}, ${o.outs} out)`).join(", ")}: on the slate with no game row, so not shown here.</div>` : "";
  if (!model.games.length) return `${orphans}<div class="lpempty">This slate has no games.</div>`;
  return orphans + model.games.map((g) => `<section class="nwgame"><div class="nwgh"><b>${esc(g.game.replace("@", " @ "))}</b><span class="nwtip">${esc(g.tip ?? "—")}</span>${g.status ? `<span class="nwgs">${g.status}</span>` : ""}<span class="nwgrow"></span><span class="nwln">${esc(g.line ?? "")}</span></div>`
    + `<div class="nwpair">${teamHtml(g.away, "away", sel)}${teamHtml(g.home, "home", sel)}</div></section>`).join("");
}

const KIND_WORD = { IN: ["AVAIL", "Available: the report says he is playing"] };
/** A feed entry as one log row (its own time label, a dash when the card has none). */
export function feedRowHtml(e) {
  const word = KIND_WORD[e.kind]; // "IN" beside a man's injury reads as a contradiction: the chip says Available
  return `<div class="lprow le feed" data-team="${esc(e.team)}"><span class="lt">${esc(e.time ?? "—")}</span><span class="lsr">${esc(e.src)}</span><span class="lpkind k-${e.kind}"${word ? ` title="${word[1]}"` : ""}>${word ? word[0] : e.kind}</span><span class="ltm">${esc(e.team)}</span>`
    + `<span class="ltx" title="${esc(e.title ?? e.text)}">${announceHtml(e.text)}</span><span class="lef${e.flag ? " fl" : ""}" title="${esc(e.effectTitle ?? e.effect)}">${effectHtml(e.effect)}</span><span class="lxx"></span></div>`;
}

/** The lead words a log announcement may begin with, and the colour class of each (lineup-bar.css .aw): START green, Out red, Bench grey, Questionable / Doubtful amber, any other plain. */
const LEADS = { START: "st", Out: "out", Bench: "bn", Questionable: "q", Doubtful: "q", Probable: "x", Playing: "x", Note: "x", "G League": "x" };
/** An announcement as markup: "START: A, B · Bench: C" gives each lead word its colour; text with no lead word is shown as written. Escaped. */
export function announceHtml(text) {
  return String(text ?? "").split(" · ").map((seg) => {
    const m = /^(\w+(?: \w+)?): (.*)$/.exec(seg);
    return m && LEADS[m[1]] ? `<b class="aw aw-${LEADS[m[1]]}">${m[1]}:</b> ${esc(m[2])}` : esc(seg);
  }).join('<span class="aw-dot"> · </span>');
}
/** A "what it did" text as markup: ▲ green, ▼ red. Escaped. */
export function effectHtml(text) {
  return esc(text ?? "").replace(/▲/g, '<i class="up">▲</i>').replace(/▼/g, '<i class="dn">▼</i>');
}

/**
 * The log panel: the proposals' rows that need Adam first (CHECK, failed, notes), then every other row, the proposals' and the feed's, newest first (a row with no time last).
 * proposals: [{ needs, at, sortAt, team, html }] from lineup-bar.js (their own markup, with their X); feed: feedEntries. team: the filter (null for all); a row with no team shows
 * under any filter only when it needs Adam. `count` is the number of items shown with no filter: the tab says the same number.
 */
export function logHtml({ feed, proposals, team = null, teams = [] }) {
  const keep = (t, needs) => !team || t === team || (needs && !t);
  const need = proposals.filter((p) => p.needs && keep(p.team, true)).map((p) => p.html);
  const when = (ms) => (Number.isFinite(ms) ? ms : -Infinity);
  const rest = [...proposals.filter((p) => !p.needs && keep(p.team, false)).map((p) => ({ at: when(p.sortAt ?? p.at), html: p.html })), ...feed.filter((e) => keep(e.team, false)).map((e) => ({ at: when(e.at), html: feedRowHtml(e) }))]
    .sort((a, b) => b.at - a.at).map((x) => x.html);
  const n = need.length + rest.length;
  const chips = ["ALL", ...teams].map((t) => `<button type="button" class="nwchip${(t === "ALL" ? !team : t === team) ? " on" : ""}" data-nw-team="${t === "ALL" ? "" : esc(t)}">${esc(t)}</button>`).join("");
  return `<aside class="nwlog"><div class="nwlh"><b>Injuries, changes and announcements</b><span class="nwmu">newest first · ${team ? `${esc(team)} only` : "all teams"} · ${n} item${n === 1 ? "" : "s"}</span></div>`
    + `<div class="nwchips">${chips}</div><div class="nwlc"><span>Time</span><span>Source</span><span>Type</span><span>Team</span><span>What was announced</span><span>What it did</span><span></span></div>`
    + `<div class="nwlrows">${need.join("")}${rest.join("") || (need.length ? "" : '<div class="lpempty">No lineup news right now.</div>')}</div>`
    + `<div class="nwlf"><span class="fl">⚠️</span> = TwoGun hasn't reacted to this report yet</div></aside>`;
}

/** The whole page: a quiet line when the lineup read is too old or missing, the games, the log. */
export function newsPageHtml({ model, proposals, team = null }) {
  const teams = [...new Set([...model.games.flatMap((g) => [g.away.code, g.home.code]), ...(model.orphans ?? []).map((o) => o.team)])].sort();
  const note = !model.hasRead ? "No lineup read yet: the starting fives are TwoGun's and no lineup news is proposed."
    : model.stale ? "The lineup read is too old to act on: the starting fives are TwoGun's and nothing is proposed from it." : "";
  return `${note ? `<div class="nwnote">${esc(note)}</div>` : ""}<div class="nw"><main class="nwmain">${gamesHtml(model, team)}</main>${logHtml({ feed: model.log, proposals, team, teams })}</div>`;
}
