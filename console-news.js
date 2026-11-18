// The Console's lineup news (Adam approved the mock-up 11-09): one slim strip above the tables (the team's starting five and who said it, the three newest lineup-news entries, the
// injury report) and, on every man, a small status chip after his name (nameChip; Adam 2:02 PM 11-17 retired the "Status and latest note" column). All of it is the News tab's own data and words: newsModel / teamModel and the page's FIVE_WORD, fiveSaid and
// feedRowHtml, never a second copy. Pure strings, tested in node. A figure the read does not have is a dash or a plain "not read", never a stand-in. Look: console.css (#console .cn, .sn).
import { esc, nameOpen, outNameOpen } from "./board-util.js";
import { plain } from "./console-model.js";
import { newsModel, statusChip, timeLabel, etDay } from "./news-model.js";
import { FIVE_WORD, fiveSaid } from "./news-page.js";
import { makeProposals } from "./lineup-proposals.js";
import { newsFacts } from "./news-facts.js";
import { factRow } from "./console-all.js";

const POS_ORDER = ["PG", "SG", "SF", "PF", "C", "G", "F"];
const dash = '<span class="nwd">—</span>';
const SHORT = { Questionable: "Q", Doubtful: "D", Probable: "P" };
const SHOWN_INJURIES = 5;

/**
 * The whole slate's news from a read ({ slate, latest, nowMs, tips, view, dismissed: { id: signature } the conflicts he hid, notes: the read's own trouble in words }): { model (newsModel), F (news-facts.js
 * newsFacts: the cleaned facts, what was folded, conflicts held), notes (for the foot), problem (why conflicts could not be checked, or null) }. Reuses newsModel and makeProposals; reads nothing new (Adam 11-17).
 */
export function newsView(read) {
  const model = newsModel({ slate: read.slate, latest: read.latest, nowMs: read.nowMs, view: read.view ?? null, ...read.tips });
  let conflicts = [], problem = null;
  try {
    const res = makeProposals({ latest: read.latest, players: read.slate?.players, view: read.view ?? null, nowMs: read.nowMs });
    const hid = read.dismissed ?? {};
    conflicts = res.stale ? [] : res.conflicts.filter((r) => hid[r.id] !== r.signature); // a stale read shows nothing from it; a conflict he hid stays hidden until a source changes
  } catch (e) { problem = e.message; } // G62: said at the foot, never an empty list
  const F = newsFacts({ log: model.log, players: read.slate?.players, conflicts, latest: read.latest, nowMs: read.nowMs, day: model.day });
  return { model, F, notes: read.notes ?? [], problem };
}

/**
 * One team's news from a read (same as newsView's; V: its answer when the page has it already):
 * { team, opp, feed (its 3 newest facts), folded (vague notes folded for it), byId, byName (by plain name), rows, day, hasRead, stale }, or null when the slate has no game row for it.
 */
export function teamNews(read, code, V = null) {
  if (!read) return null;
  V ??= newsView(read);
  const model = V.model;
  const game = model.games.find((g) => g.away.code === code || g.home.code === code);
  if (!game) return null;
  const team = game.away.code === code ? game.away : game.home, opp = team === game.away ? game.home : game.away;
  const rows = [...team.starters, ...team.bench, ...team.outs];
  return {
    team, opp, rows, day: model.day, hasRead: model.hasRead, stale: model.stale,
    feed: V.F.facts.filter((f) => f.team === code).slice(0, 3), folded: V.F.folded.byTeam[code] ?? 0, checkedAt: model.asOf?.monster ?? null,
    byId: new Map(rows.filter((r) => r.id).map((r) => [r.id, r])), byName: new Map(rows.map((r) => [plain(r.name), r])),
  };
}

const chipHtml = (st, short = false) => ((st.cls === "ok" && st.word !== "Available") || st.word === "—" ? "" : `<span class="nwc ${st.cls}" title="${esc(st.word)}">${esc(short ? SHORT[st.word] ?? st.word : st.word)}</span>`);
const timeOf = (N, r) => (r?.noteAt != null ? timeLabel(r.noteAt, { day: N.day, precision: r.notePrecision, compact: true }) : null);
const rowOf = (N, p) => N?.byId.get(String(p.id)) ?? N?.byName.get(plain(p.name)) ?? null;

/**
 * The small chip after a man's name in the console's tables (Adam 2:02 PM 11-17, the Status column retired): his status in short (GTD, Q, D, P, or the word as written) with the newest report and its
 * time in the tooltip; an active man with a report from the slate's own day gets a "News" chip instead; nothing at all when there is neither. With no read: the board's status word alone.
 */
export function nameChip(N, p) {
  const r = rowOf(N, p), st = r ? r.status : statusChip(p.status), at = timeOf(N, r);
  const tip = [st.cls === "ok" ? null : st.word, r?.note ? `${r.note}${at ? ` (${at})` : ""}` : null].filter(Boolean).join(": ");
  if (st.cls !== "ok" && st.word !== "—") return `<span class="nwc nchip ${st.cls}" title="${esc(tip)}">${esc(SHORT[st.word] ?? st.word)}</span>`;
  const fresh = r?.note && r.noteAt != null && N?.day && etDay(r.noteAt) === N.day;
  return fresh ? `<span class="nwc nchip news" title="${esc(tip)}">News</span>` : "";
}
/** The note under a man in the Out list: his report and its time; "" when the read has none (his source line says why he is out). */
export function outNote(N, p) {
  const r = rowOf(N, p), at = timeOf(N, r);
  return r?.note ? `<span class="sn"><span class="nt" title="${esc(r.note)}">${esc(r.note)}</span>${at ? `<time class="nwat">${esc(at)}</time>` : ""}</span>` : "";
}

const posOf = (r) => (r.pos ?? "").split("/")[0];
const posRank = (r) => { const i = POS_ORDER.indexOf(posOf(r)); return i < 0 ? 99 : i; };

/** What the five says against the men starting in the console: "Matches the Starters below", or who differs; "" when the five is not a news five (TwoGun's own, or not comparable). */
function matchLine(five, starters, ids) {
  if (five.kind === "twogun" || five.kind === "uncompared") return "";
  const inFive = new Set(starters.map((r) => r.id)), here = new Set(ids.map(String));
  const missing = starters.filter((r) => !here.has(r.id)).map((r) => r.name);
  const extra = ids.filter((id) => !inFive.has(String(id)));
  if (!missing.length && !extra.length) return "<b>Matches</b> the Starters below";
  return missing.length ? `<b>Differs</b> from the Starters below: ${esc(missing.join(", "))} not starting here` : `<b>Differs</b> from the Starters below: ${extra.length} starting here ${extra.length === 1 ? "is" : "are"} not in the five`;
}

function fiveSection(N, starterIds) {
  const T = N.team, five = T.five, said = fiveSaid(five, N.day).replace(/^ · /, "");
  const men = [...T.starters].sort((a, b) => posRank(a) - posRank(b)).map((r) => `<span><b>${esc(posOf(r))}</b>${nameOpen(r.name, r.id)}${chipHtml(r.status, true)}</span>`).join("");
  const oppFive = N.opp.five, oppSaid = fiveSaid(oppFive, N.day).replace(/^ · /, ""), match = matchLine(five, T.starters, starterIds);
  const note = !N.hasRead ? "No lineup read yet: the fives are TwoGun's" : N.stale ? "The lineup read is too old to act on: the fives are TwoGun's" : "";
  return `<section><h3>Starting five <em class="${five.kind}">${FIVE_WORD[five.kind]}</em>${said ? `<em class="n">${esc(said)}</em>` : ""}</h3>`
    + `<div class="five">${men || dash}</div>`
    + (match || note ? `<div class="sub2">${[match, esc(note)].filter(Boolean).join(" &middot; ")}</div>` : "") // the comparison is about this team's five, so it sits under it
    + `<div class="sub2 opp">Opponent ${esc(N.opp.code)}: five <em class="${oppFive.kind}">${FIVE_WORD[oppFive.kind]}</em>${oppSaid ? esc(oppSaid) : ""}</div></section>`;
}

function feedSection(N) {
  const rows = N.feed.map((f) => factRow(f, { team: false, compact: true })).join("") || `<div class="ann none">No lineup news for ${esc(N.team.code)}.</div>`;
  const fold = N.folded ? `<div class="ca-fold">${N.folded} vague lineup-check note${N.folded === 1 ? "" : "s"} folded${N.checkedAt != null ? ` &middot; checked ${esc(timeLabel(N.checkedAt, { day: N.day }) ?? "")}` : ""}</div>` : "";
  return `<section class="ca-feed"><h3>Latest from the lineup news <em class="n">newest first</em><button class="lnk" type="button" data-go-all="1">All teams &rsaquo;</button></h3>${rows}${fold}</section>`;
}

const INJURY_RANK = { ou: 0, db: 1, qu: 2, xx: 3, rt: 4, pr: 5 };
function injurySection(N) {
  const byRank = (a, b) => (INJURY_RANK[a.status.cls] ?? 3) - (INJURY_RANK[b.status.cls] ?? 3) || a.name.localeCompare(b.name);
  const list = N.rows.filter((r) => r.status.cls !== "ok" && r.status.word !== "—").sort(byRank);
  const shown = [...list.filter((r) => r.status.cls !== "ou"), ...list.filter((r) => r.status.cls === "ou")].slice(0, SHOWN_INJURIES).sort(byRank); // men still in doubt first: the Out list has the rest
  const counts = [];
  for (const r of list) { const w = r.status.word.toLowerCase(), hit = counts.find((c) => c.w === w); if (hit) hit.n++; else counts.push({ w, n: 1 }); }
  const row = (r) => { const at = timeOf(N, r); return `<div class="inj">${chipHtml(r.status)}${r.id ? nameOpen(r.name, r.id, "b") : outNameOpen(r.name, N.team.code, "b")}<span class="n"${r.note ? ` title="${esc(r.note)}"` : ""}>${r.note ? esc(r.note) : dash}</span><time>${at ? esc(at) : ""}</time></div>`; };
  const more = list.length > SHOWN_INJURIES ? `<div class="inj more"><span class="n">+${list.length - SHOWN_INJURIES} more in Out / injured</span></div>` : "";
  return `<section><h3>Injury report${counts.length ? `<em class="n">${counts.map((c) => `${c.n} ${esc(c.w)}`).join(" &middot; ")}</em>` : ""}</h3>${shown.map(row).join("") || `<div class="inj none"><span class="n">Nobody on the injury report</span></div>`}${more}</section>`;
}

/**
 * The strip above the tables. news: { state: "ok" | "loading" | "fail", why, N (teamNews) }; undefined draws nothing (no news wired). starterIds: the men starting in the console now.
 * A read that failed, or a team with no game row, says so in one line; nothing is made up.
 */
export function stripHtml(news, starterIds = []) {
  if (!news) return "";
  const one = (words) => `<div class="cn one"><section><h3>Lineup news <em class="n">${esc(words)}</em></h3></section></div>`;
  if (news.state === "loading") return one("reading...");
  if (news.state === "fail") return one(`not read: ${news.why}`);
  if (!news.N) return one("not read: this team has no game row on the slate");
  return `<div class="cn">${fiveSection(news.N, starterIds)}${feedSection(news.N)}${injurySection(news.N)}</div>`;
}
