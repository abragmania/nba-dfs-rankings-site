// The Console's lineup news (Adam approved the mock-up 11-09): one slim strip above the tables (the team's starting five and who said it, the three newest lineup-news entries, the
// injury report) and, on every man, the "Status and latest note" cell. All of it is the News tab's own data and words: newsModel / teamModel and the page's FIVE_WORD, fiveSaid and
// feedRowHtml, never a second copy. Pure strings, tested in node. A figure the read does not have is a dash or a plain "not read", never a stand-in. Look: console.css (#console .cn, .sn).
import { esc } from "./board-util.js";
import { plain } from "./console-model.js";
import { newsModel, statusChip, timeLabel } from "./news-model.js";
import { FIVE_WORD, feedRowHtml, fiveSaid } from "./news-page.js";

const POS_ORDER = ["PG", "SG", "SF", "PF", "C", "G", "F"];
const dash = '<span class="nwd">—</span>';
const SHORT = { Questionable: "Q", Doubtful: "D", Probable: "P" };
const SHOWN_INJURIES = 5;

/**
 * One team's news from a read ({ slate (the board's slate with its rows), latest (the lineup read or null), nowMs, tips: { tip, tipAt } }):
 * { team, opp, feed (its 3 newest entries), byId, byName (by plain name), rows, day, hasRead, stale }, or null when the slate has no game row for it.
 */
export function teamNews(read, code) {
  if (!read) return null;
  const model = newsModel({ slate: read.slate, latest: read.latest, nowMs: read.nowMs, view: read.view ?? null, ...read.tips });
  const game = model.games.find((g) => g.away.code === code || g.home.code === code);
  if (!game) return null;
  const team = game.away.code === code ? game.away : game.home, opp = team === game.away ? game.home : game.away;
  const rows = [...team.starters, ...team.bench, ...team.outs];
  return {
    team, opp, rows, day: model.day, hasRead: model.hasRead, stale: model.stale,
    feed: model.log.filter((e) => e.team === code).slice(0, 3),
    byId: new Map(rows.filter((r) => r.id).map((r) => [r.id, r])), byName: new Map(rows.map((r) => [plain(r.name), r])),
  };
}

const chipHtml = (st, short = false) => ((st.cls === "ok" && st.word !== "Available") || st.word === "—" ? "" : `<span class="nwc ${st.cls}" title="${esc(st.word)}">${esc(short ? SHORT[st.word] ?? st.word : st.word)}</span>`);
const timeOf = (N, r) => (r?.noteAt != null ? timeLabel(r.noteAt, { day: N.day, precision: r.notePrecision, compact: true }) : null);
const rowOf = (N, p) => N?.byId.get(String(p.id)) ?? N?.byName.get(plain(p.name)) ?? null;

/**
 * The "Status and latest note" cell for a man of the console: his status chip (none when he is active), the newest report on him and its time. The time shows only beside a report.
 * With no read it is the board's own status word and nothing else; a man with neither shows a dash.
 */
export function noteCell(N, p) {
  const r = rowOf(N, p), st = r ? r.status : statusChip(p.status), at = timeOf(N, r);
  const note = r?.note ? `<span class="nt" title="${esc(r.note)}">${esc(r.note)}</span>` : "";
  const when = at ? `<time class="nwat">${esc(at)}</time>` : "";
  const chip = chipHtml(st.cls === "ok" && r?.note ? { word: "Available", cls: "ok" } : st); // a man with a report and no injury status reads "Available" beside it
  return `<span class="sn">${chip}${note}${when}${chip || note || when ? "" : dash}</span>`;
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
  const men = [...T.starters].sort((a, b) => posRank(a) - posRank(b)).map((r) => `<span><b>${esc(posOf(r))}</b>${esc(r.name)}${chipHtml(r.status, true)}</span>`).join("");
  const oppFive = N.opp.five, oppSaid = fiveSaid(oppFive, N.day).replace(/^ · /, ""), match = matchLine(five, T.starters, starterIds);
  const note = !N.hasRead ? "No lineup read yet: the fives are TwoGun's" : N.stale ? "The lineup read is too old to act on: the fives are TwoGun's" : "";
  return `<section><h3>Starting five <em class="${five.kind}">${FIVE_WORD[five.kind]}</em>${said ? `<em class="n">${esc(said)}</em>` : ""}</h3>`
    + `<div class="five">${men || dash}</div>`
    + (match || note ? `<div class="sub2">${[match, esc(note)].filter(Boolean).join(" &middot; ")}</div>` : "") // the comparison is about this team's five, so it sits under it
    + `<div class="sub2 opp">Opponent ${esc(N.opp.code)}: five <em class="${oppFive.kind}">${FIVE_WORD[oppFive.kind]}</em>${oppSaid ? esc(oppSaid) : ""}</div></section>`;
}

function feedSection(N) {
  const rows = N.feed.map(feedRowHtml).join("") || `<div class="ann none">No lineup news for ${esc(N.team.code)}.</div>`;
  return `<section><h3>Latest from the lineup news <em class="n">newest first</em><button class="lnk" type="button" data-go-news="1">All of it on the News tab &rsaquo;</button></h3>${rows}</section>`;
}

const INJURY_RANK = { ou: 0, db: 1, qu: 2, xx: 3, rt: 4, pr: 5 };
function injurySection(N) {
  const byRank = (a, b) => (INJURY_RANK[a.status.cls] ?? 3) - (INJURY_RANK[b.status.cls] ?? 3) || a.name.localeCompare(b.name);
  const list = N.rows.filter((r) => r.status.cls !== "ok" && r.status.word !== "—").sort(byRank);
  const shown = [...list.filter((r) => r.status.cls !== "ou"), ...list.filter((r) => r.status.cls === "ou")].slice(0, SHOWN_INJURIES).sort(byRank); // men still in doubt first: the Out list has the rest
  const counts = [];
  for (const r of list) { const w = r.status.word.toLowerCase(), hit = counts.find((c) => c.w === w); if (hit) hit.n++; else counts.push({ w, n: 1 }); }
  const row = (r) => { const at = timeOf(N, r); return `<div class="inj">${chipHtml(r.status)}<b title="${esc(r.name)}">${esc(r.name)}</b><span class="n"${r.note ? ` title="${esc(r.note)}"` : ""}>${r.note ? esc(r.note) : dash}</span><time>${at ? esc(at) : ""}</time></div>`; };
  const more = list.length > SHOWN_INJURIES ? `<div class="inj more"><span class="n">+${list.length - SHOWN_INJURIES} more on the News tab</span></div>` : "";
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
