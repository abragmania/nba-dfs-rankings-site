// The player panel's numbers table (summary line and a rows-by-time-frames table), News box and last-10 bar chart (Adam's Layout A+C, 11-13). DOM-free strings, tested in node.
// Every figure is the board's own for him; a missing one is the board's dash with its reason, never zero and never another man's (RULES R1, G62).
import { esc, money, dec1, figSourceWord, hasHis, isoToEastern } from "./board-util.js";
import { minGapOf, gapTitle, minChg, dkTonight, noTonight } from "./player-table.js";
import { tgMin } from "./lineup-proposals.js";
import { isNum } from "./figures.js";
import { sgn, dcls } from "./console-model.js";
import { cardWord } from "./news-status.js";

export const LAST_N = 10; // the summary and bars cover this many of the most recent games; the log below lists them all

/** Last-N summary: average DK points, average minutes, DK points per minute, over the games given. Null for no games. */
export function summarise(games) {
  if (!games.length) return null;
  const dk = games.reduce((s, g) => s + g.dk, 0), min = games.reduce((s, g) => s + g.min, 0);
  return { n: games.length, dk: dk / games.length, min: min / games.length, perMin: min > 0 ? dk / min : null };
}

/** The game log's figures for the Stats tiles: { season, last } summaries, or { why } while the log is not in. */
function logFigures(log) {
  if (log.state === "ok") {
    const games = log.data.games; // newest first
    return games.length ? { season: summarise(games), last: summarise(games.slice(0, LAST_N)), n: games.length } : { why: "he has no regular-season games this season yet" };
  }
  return { why: log.state === "error" ? `no game log: ${log.message}` : "the game log is still loading" };
}

/** One table cell: a figure (or its dash) and an optional small tag after it. */
const cell = (v, extra = "", cls = "") => `<td${cls ? ` class="${cls}"` : ""}>${v}${extra}</td>`;

/** The summary line's pairs, label small and quiet, value after it. */
const pair = (label, v) => `<span class="cs-p"><small>${label}</small> <b>${v}</b></span>`;

/** TwoGun's own projection: its tg_projection, or the board's projection when TwoGun's is the figure on show (never his typed number as TwoGun's). */
const tgProj = (p) => ("tg_projection" in p ? p.tg_projection : figSourceWord(p, "proj") === "TwoGun" ? p.projection : null);

/** The panel's numbers (Adam 11-17): one summary line (salary, value, own, usage, games) over one table, like things in a row and one time frame in a column:
 *  rows DK pts / Minutes / DK/min, columns Ours (the board's own figure; headed by whose it is), TwoGun, Season, Last 10, and Usual (a figure on the Minutes row only).
 *  ctx: { dash(title) }. */
export function cardTilesHtml(p, log, { dash }) {
  const off = p.dk_id == null ? "he is on the Out list, not in this slate's player pool" : null;
  const num = (v, f, why) => (isNum(v) ? f(v) : dash(off ?? why));
  const sal = isNum(p.salary) ? money(p.salary) : p.salary_text ? esc(p.salary_text) : dash(off ?? "no salary in this slate file");
  const lf = logFigures(log), tg = tgMin(p), ton = dkTonight(p), tgp = tgProj(p), chg = minChg(p);
  const line = [pair("Salary", sal), pair("Value", num(p.value, (v) => `${v.toFixed(2)}x`, "no value in this pull")), pair("Own", num(p.proj_own, (v) => `${v.toFixed(1)}%`, "no projected ownership in this pull")),
    pair("Usage", num(p.usage, (v) => `${v.toFixed(1)}%`, p.usage_note ?? "no usage rate from the server")), pair("Games", lf.why ? dash(lf.why) : String(lf.n))].join("");
  const pw = isNum(p.projection) ? figSourceWord(p, "proj") : "", mw = isNum(p.minutes) ? figSourceWord(p, "min") : "";
  const head = pw || mw || "Tonight";
  const fromLog = (v) => (lf.why ? dash(lf.why) : v === null || v === undefined ? dash("no minutes in these games") : v);
  const dkpts = [
    cell(num(p.projection, (v) => v.toFixed(1), p.proj_note ?? "no projection in this pull"), "", "cur"),
    cell(num(tgp, (v) => v.toFixed(1), "no TwoGun projection in this pull")),
    cell(fromLog(lf.season?.dk.toFixed(1))),
    cell(fromLog(lf.last?.dk.toFixed(1))), "<td></td>"].join("");
  const usual = isNum(p.min_usual) ? dec1(p.min_usual) : dash(off ?? p.min_usual_note ?? "no usual minutes for him in this slate");
  const diff = chg === null ? "" : ` <i class="${dcls(chg)}" title="Min vs Usual: tonight's minutes minus his usual">${sgn(chg)}</i>`;
  const minutes = [
    cell(num(p.minutes, dec1, "no projected minutes in this pull"), mw && mw !== head ? `<sup title="${esc(mw)} minutes">${esc(mw)}</sup>` : "", "cur"),
    cell(num(tg, dec1, "no TwoGun minutes in this pull")),
    cell(fromLog(lf.season?.min.toFixed(1))),
    cell(fromLog(lf.last?.min.toFixed(1))),
    cell(usual, isNum(p.min_usual) ? diff : "")].join("");
  const tgRate = isNum(tgp) && isNum(tg) && tg > 0 ? tgp / tg : null;
  const tgWhy = !isNum(tgp) ? "no TwoGun projection in this pull, so no TwoGun DK/min" : !isNum(tg) ? "no TwoGun minutes in this pull, so no TwoGun DK/min" : "on 0 TwoGun minutes, so no TwoGun DK/min";
  const tag = p.dk_per_min_tag ? esc(p.dk_per_min_tag) : "";
  const tagTitle = p.dk_per_min_tag === "LY" ? "last season's figure" : `${tag} sample`;
  const rate = [
    cell(ton === null ? dash(off ?? noTonight(p)) : ton.toFixed(2), "", "cur"),
    cell(tgRate === null ? dash(tgWhy) : tgRate.toFixed(2)),
    cell(num(p.dk_per_min, (v) => v.toFixed(2), p.dk_per_min_note ?? "no DK points per minute from the server"), isNum(p.dk_per_min) && tag ? `<sup title="${tagTitle}">${tag}</sup>` : ""),
    cell(lf.why ? dash(lf.why) : lf.last?.perMin == null ? dash("no minutes in these games") : lf.last.perMin.toFixed(2)), "<td></td>"].join("");
  const gap = minGapOf(p);
  const gapHtml = gap ? `<div class="tgap" title="${esc(gapTitle(gap))}">⚠ ${esc(gap.word ?? "Ours")} ${dec1(gap.ours)} vs TwoGun ${dec1(gap.tg)}: a ${dec1(gap.gap)}-minute gap. Check his role before using him.</div>` : "";
  return `<div class="psec cstats"><h3>Numbers</h3><div class="cs-line">${line}</div><table class="cs-tbl"><thead><tr><th></th><th class="cur">${esc(head)}</th><th>TwoGun</th><th>Season</th><th>${lf.last ? `Last ${lf.last.n}` : "Last 10"}</th><th>Usual</th></tr></thead><tbody><tr><th>DK pts</th>${dkpts}</tr><tr><th>Minutes</th>${minutes}</tr><tr><th>DK/min</th>${rate}</tr></tbody></table>${gapHtml}</div>`;
}

/** The source line at the foot of the panel: whose figures the Tonight tiles are, as of when, and whether his own changes are in them. */
export function cardSourceHtml(p, figs, dash) {
  const yours = (hasHis(p) ? " Proj and Own include your changes." : "") + (p.his_in_note ? ` ${esc(p.his_in_note)}` : "");
  return `<div class="psrc">Source: ${figs?.source ? esc(figs.source) : dash("no source in this slate file")}, as of ${figs?.asOf ? esc(figs.asOf) : dash("no board time in this slate file")}.${yours}</div>`;
}

/** The News box: his newest status card in full (never cut short), with its word and time, under "Basketball Monster news". With no card: the reason when the lineup/news read
 *  was not usable (state: { ok } | { stale, ageMin } | { failed, why } | null for not read yet), else "No news for him in this pull"; TwoGun's injury word, when he has one, is
 *  shown only on its own and labelled "TwoGun injury report", never under the Monster label.
 *  news: { label, body, at } from board-marks. */
export function newsHtml(p, news, dash, state = null) {
  const head = `<h3>News</h3>`;
  const wrap = (inner) => `<div data-cnews>${head}<div class="news">${inner}</div></div>`;
  if (news) {
    const word = cardWord(news) ?? news.label ?? null;
    const time = news.at ? isoToEastern(news.at) ?? news.at : null; // raw here, escaped once where it is written
    const body = news.body ? `<div class="nbody">${esc(news.body)}</div>` : `<div class="nbody mu">The news card carries no text.</div>`;
    return wrap(`${word ? `<span class="pill">${esc(word)}</span>` : ""}<small>${time ? `${esc(time)} - ` : ""}Basketball Monster news</small>${body}`);
  }
  const why = state?.failed ? `lineup news could not be read: ${state.why}` : state?.stale ? `lineup news is ${state.ageMin ?? "an unknown number of"} min old, so it is not used` : state === null ? "lineup news has not been read yet" : "";
  const tg = ""; // TwoGun's injury status is never shown (Adam 11-19): the card's news is our own feeds'
  if (why) return wrap(`${dash(why)} <span class="mu">${esc(why)}</span>${tg}`);
  return wrap(tg || `<span class="mu" title="no news card and no injury status for him in this pull">No news for him in this pull.</span>`);
}

/** The last-N bar chart: DK points per game, oldest on the left, bars tall by points, bars at or above his average in green. */
export function barChartHtml(games) {
  const pts = games.map((g) => g.dk).reverse();
  if (!pts.length) return "";
  const hi = Math.max(...pts), avg = pts.reduce((s, v) => s + v, 0) / pts.length;
  return `<div class="chart" role="img" aria-label="DK points in his last ${pts.length} games, oldest first">${pts.map((v) => `<div class="bar" title="${v.toFixed(2)} DK pts"><span>${Number.isInteger(v) ? v : v.toFixed(1)}</span><i class="${v >= avg ? "hi" : ""}" style="height:${hi > 0 ? Math.max(2, (v / hi) * 100).toFixed(1) : 2}%"></i></div>`).join("")}</div>`;
}
