// The player panel's figure tiles, News box and last-10 bar chart (Adam's Layout A+C, 11-13). DOM-free strings, tested in node.
// Every figure is the board's own for him; a missing one is the board's dash with its reason, never zero and never another man's (RULES R1, G62).
import { esc, money, dec1, figSourceWord, hasHis, isoToEastern } from "./board-util.js";
import { minGapOf, gapTitle, minChg, dkTonight, noTonight } from "./player-table.js";
import { tgMin } from "./lineup-proposals.js";
import { outFor, isNum } from "./figures.js";
import { sgn, dcls } from "./console-model.js";
import { cardWord } from "./news-status.js";

export const LAST_N = 10; // the summary and bars cover this many of the most recent games; the log below lists them all

/** Last-N summary: average DK points, average minutes, DK points per minute, over the games given. Null for no games. */
export function summarise(games) {
  if (!games.length) return null;
  const dk = games.reduce((s, g) => s + g.dk, 0), min = games.reduce((s, g) => s + g.min, 0);
  return { n: games.length, dk: dk / games.length, min: min / games.length, perMin: min > 0 ? dk / min : null };
}

/** One tile: label, big value with its unit, and a small line under it (a missing figure passes its dash as `value` with no unit). */
const tile = (label, value, unit = "", sub = "", cls = "") => `<div class="tile"><small>${label}</small><b${cls ? ` class="${cls}"` : ""}>${value}${unit ? `<em>${unit}</em>` : ""}</b><span>${sub || "&nbsp;"}</span></div>`;

/** The game log's figures for the Stats tiles: { season, last } summaries, or { why } while the log is not in. */
function logFigures(log) {
  if (log.state === "ok") {
    const games = log.data.games; // newest first
    return games.length ? { season: summarise(games), last: summarise(games.slice(0, LAST_N)), n: games.length } : { why: "he has no regular-season games this season yet" };
  }
  return { why: log.state === "error" ? `no game log: ${log.message}` : "the game log is still loading" };
}

/** The two tile groups: Tonight (his board row) and Stats (season figures and the game log's averages).
 *  ctx: { dash(title), figs: {source, asOf}, inj: the news ruling or null }. */
export function cardTilesHtml(p, log, { dash, inj = null }) {
  const off = p.dk_id == null ? "he is on the Out list, not in this slate's player pool" : null;
  const num = (v, f, why) => (isNum(v) ? f(v) : dash(off ?? why));
  const src = (kind, v) => (isNum(v) ? figSourceWord(p, kind) : "");
  const sal = isNum(p.salary) ? money(p.salary) : p.salary_text ? esc(p.salary_text) : dash(off ?? "no salary in this slate file");
  const tg = tgMin(p), ton = dkTonight(p), out = outFor(p, { engine: true });
  const status = inj?.word ?? p.injury_status ?? "";
  const tonight = [
    tile("Sal", sal),
    tile("Proj", num(p.projection, (v) => v.toFixed(1), p.proj_note ?? "no projection in this pull"), isNum(p.projection) ? "DK pts" : "", src("proj", p.projection)),
    tile("Val", num(p.value, (v) => v.toFixed(2), "no value in this pull"), isNum(p.value) ? "x" : ""),
    tile("Own", num(p.proj_own, (v) => v.toFixed(1), "no projected ownership in this pull"), isNum(p.proj_own) ? "%" : ""),
    tile("Min", num(p.minutes, dec1, "no projected minutes in this pull"), isNum(p.minutes) ? "min" : "", src("min", p.minutes)),
    tile("TG Min", num(tg, dec1, "no TwoGun minutes in this pull"), isNum(tg) ? "min" : ""),
    tile("DK/min Tonight", ton === null ? dash(off ?? noTonight(p)) : ton.toFixed(2), ton === null ? "" : "DK/min"),
    tile("Out", out ? "Yes" : "No", "", esc(p.his === "out" ? "you put him Out" : p.his === "in" ? "you put him In" : status), out ? "rd" : ""),
  ].join("");
  const gap = minGapOf(p);
  const gapHtml = gap ? `<div class="tgap" title="${esc(gapTitle(gap))}">⚠ ${esc(gap.word ?? "Ours")} ${dec1(gap.ours)} vs TwoGun ${dec1(gap.tg)}: a ${dec1(gap.gap)}-minute gap. Check his role before using him.</div>` : "";
  const lf = logFigures(log), chg = minChg(p);
  const fromLog = (f, unit, sub) => (lf.why ? tile(f.label, dash(lf.why)) : f.value === null ? tile(f.label, dash(f.why), "", sub) : tile(f.label, f.value, unit, sub));
  const season = p.dk_per_min;
  const stats = [
    tile("DK/min Season", num(season, (v) => v.toFixed(2), p.dk_per_min_note ?? "no DK points per minute from the server"), isNum(season) ? "DK/min" : "", p.dk_per_min_tag ? (p.dk_per_min_tag === "LY" ? "last season's figure" : `${esc(p.dk_per_min_tag)} sample`) : lf.why ? "" : `avg, ${lf.n} game${lf.n === 1 ? "" : "s"}`),
    fromLog({ label: "Avg DK pts", value: lf.season?.dk.toFixed(1) }, "pts", lf.last ? `last ${lf.last.n}: ${lf.last.dk.toFixed(1)}` : ""),
    tile("Usage %", num(p.usage, (v) => v.toFixed(1), p.usage_note ?? "no usage rate from the server"), isNum(p.usage) ? "%" : ""),
    tile("Usual Min", num(p.min_usual, dec1, p.min_usual_note ?? "no usual minutes for him in this slate"), isNum(p.min_usual) ? "min" : "", lf.last ? `last ${lf.last.n}: ${lf.last.min.toFixed(1)}` : ""),
    tile("Min vs Usual", chg === null ? dash(p.min_usual_note ?? "needs both Min and Usual") : sgn(chg), chg === null ? "" : "min", chg === null ? "" : "vs usual", chg === null ? "" : dcls(chg) === "up" ? "gr" : dcls(chg) === "dn" ? "rd" : ""),
    fromLog({ label: "Avg min", value: lf.season?.min.toFixed(1) }, "min", "season"),
    fromLog(lf.last?.perMin == null && !lf.why ? { label: "Avg DK/m", value: null, why: "no minutes in these games" } : { label: "Avg DK/m", value: lf.last?.perMin.toFixed(2) }, "DK/min", lf.last ? `last ${lf.last.n}` : ""),
    fromLog({ label: "Games", value: lf.n }, "", "played"),
  ].join("");
  return `<div class="psec"><h3>Tonight</h3><div class="tiles">${tonight}</div>${gapHtml}</div><div class="psec"><h3>Stats</h3><div class="tiles">${stats}</div></div>`;
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
  const tg = p.injury_status ? `<div><span class="pill">${esc(p.injury_status)}</span><small>TwoGun injury report</small></div>` : "";
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
