// The console's screen (Adam, 11-07: plain and readable, light, the team always obvious): a header with the team's logo, name, opponent and
// tip; a team switcher with logos; then the Starters (the men starting, a position on every row), the Bench in rotation order and the men
// Out, each row with his minutes, DK/min, projection, TwoGun's minutes and projection, the basis of his minutes, an S toggle and an Out toggle, and an undo chip on every
// mark he made. A side column holds the team total, the notes and which minutes feed the optimizer. Pure strings, tested in node.
import { oursUse } from "./console-ours.js";
import { valuePer1k } from "./figures.js";
import { recentOf, RECENT_GAMES } from "./tiers.js";
import { esc, logo, nameOpen, consoleNameOpen, mrChip } from "./board-util.js";
import { calc, outPinsNote } from "./console-model.js";
import { stepHtml, wholeText } from "./min-step.js";
import { whatifLoadHtml } from "./console-whatif.js";
import { keyOf, outsOf, RATE_USAGE_SHARE } from "./console-engine.js";
import { marksOf, liveText } from "./console-marks.js";
import { MINUTE_SOURCES, SOURCE_LABEL, defaultSourceOf } from "./depth-chart.js";
import { syncWords } from "./console-auto.js";
import { nameChip, outNote, stripHtml } from "./console-news.js";
import { absenceRow } from "./absence-view.js";
import { chartModel, chartHtml, sourcesNote } from "./console-chart.js";

export const TEAM_NAMES = {
  ATL: "Atlanta Hawks", BKN: "Brooklyn Nets", BOS: "Boston Celtics", CHA: "Charlotte Hornets", CHI: "Chicago Bulls", CLE: "Cleveland Cavaliers",
  DAL: "Dallas Mavericks", DEN: "Denver Nuggets", DET: "Detroit Pistons", GSW: "Golden State Warriors", HOU: "Houston Rockets", IND: "Indiana Pacers",
  LAC: "LA Clippers", LAL: "Los Angeles Lakers", MEM: "Memphis Grizzlies", MIA: "Miami Heat", MIL: "Milwaukee Bucks", MIN: "Minnesota Timberwolves",
  NOP: "New Orleans Pelicans", NYK: "New York Knicks", OKC: "Oklahoma City Thunder", ORL: "Orlando Magic", PHI: "Philadelphia 76ers", PHX: "Phoenix Suns",
  POR: "Portland Trail Blazers", SAC: "Sacramento Kings", SAS: "San Antonio Spurs", TOR: "Toronto Raptors", UTA: "Utah Jazz", WAS: "Washington Wizards",
};
const POS_ORDER = ["PG", "SG", "SF", "PF", "C", "G", "F"];
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const f1 = (x) => (isNum(x) ? (Math.round(x * 10) / 10).toFixed(1) : null);
const f2 = (x) => (isNum(x) ? x.toFixed(2) : null);
const miss = (why) => `<span class="cmiss" title="${esc(why)}">—</span>`;
const pos0 = (p) => (typeof p.pos === "string" ? p.pos.split("/")[0] : "");
const posRank = (p) => { const i = POS_ORDER.indexOf(pos0(p)); return i < 0 ? 99 : i; };

/** An undo chip: drops one mark; its text is the live figure, its hover says so. */
const ET_FLIP = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
/** The role chip's words: the role, and for a flip the news made, " · 5:22 PM" (ET) from its entry's time; nothing added when there is none (item 3, 11-21). Pure. */
export const flipText = (mark, base) => (mark?.news && mark.at && Number.isFinite(Date.parse(mark.at)) ? `${base} · ${ET_FLIP.format(new Date(mark.at))}` : base);
/** One usage cell of the Out list: "23.4%", or a dash with the reason when unknown, never 0 (item 2, 11-21). Pure. */
export function outUsage(p) {
  const v = isNum(p.usg_usual) ? p.usg_usual : isNum(p.usg) ? p.usg : null;
  return v === null ? `<span class="ousg cmiss" title="${esc(`no usage figure: ${p.missing?.usg ?? "missing"}`)}">—</span>` : `<span class="ousg" title="His usage %">${v.toFixed(1)}%</span>`;
}
const chip = (team, id, kind, mark, text) => `<button class="rv" type="button" data-undo="${kind}" data-id="${esc(id)}" data-team="${esc(team)}" title="${esc(`${mark.news ? `From the lineup news (${mark.news}). ` : ""}${liveText(kind, mark)}. Click to drop ${mark.news ? "it" : "your mark"}`)}">&#8634; ${esc(text)}</button>`;

const SUFFIX = /^(?:jr\.?|sr\.?|ii|iii|iv|v)$/i;
const lastName = (n) => { const w = String(n ?? "").trim().split(/\s+/); while (w.length > 1 && SUFFIX.test(w.at(-1))) w.pop(); return w.at(-1) ?? ""; };
const poss = (n) => (/s$/i.test(n) ? `${n}'` : `${n}'s`);
const ROLE_SHORT = { starter: "Starts", bench_plus: "Bench+", bench: "Bench" };
const MINUS = "−";

/**
 * The Basis column's short words (Adam 2:02 PM 11-17: short words and the key number, one line): { text, delta } from the engine's label (tiers.js entry label, console-tier.js typed and override kinds);
 * delta is the fill, trim or cap that moved him ("+1.4 fill", "−0.8 trim"), "" when none. null for no label. Pure.
 */
export function shortBasis(l) {
  if (!l) return null;
  const v = f1(l.value), g = isNum(l.n) && l.n > 0 ? ` (${l.n} g)` : "";
  const words = {
    starts: () => `Starts avg ${v}${g}`, blend: () => `Blend ${v}${g}`, paired: () => `${poss(lastName(l.name))} starts (${l.pos}) ${v}`, median: () => `Team starter avg ${v}`, spot: () => `Bench ${l.spot}: ${v}`, off_chart: () => `Off chart: ${v}`,
    own: () => `${l.returning ? "Returning" : ROLE_SHORT[l.role] ?? "Own"} avg ${v}${g}`, chart: () => `Chart usual ${v}`, twogun: () => (v === null ? "TwoGun: none" : `TwoGun ${v}`), override: () => `Your usual ${v}`,
    ov_minutes: () => `Your override ${v}`, typed: () => "Yours", none: () => "No figure", std: () => `B+ standard ${v}`, // std: Q14's standard Bench+ figure (tiers.js stdFigure)
  }[l.kind];
  if (!words) return null;
  const delta = [l.bench_floor > 0 ? `floor ${f1(l.bench_floor)} off the bench` : "", l.fill > 0 ? `+${f1(l.fill)} fill` : "", l.trim > 0 ? `${MINUS}${f1(l.trim)} trim` : "", l.capped > 0 ? `${MINUS}${f1(l.capped)} cap` : ""].filter(Boolean).join(" ");
  return { text: words(), delta: l.kind === "typed" ? "" : delta, ceil: l.ceil_words ?? "" }; // Adam 3:03 PM 11-18: his ceiling and its basis, said in the row's tooltip
}

/** A row flag's short word (the full sentence goes in its tooltip). */
const FLAG_WORD = { twogun_far_below: "TG far lower", no_starts_starter: "No starts", no_role_games: "No games", no_games_chart: "No games", no_figure: "Missing", not_matched: "Unmatched" };
/** The worded chips after the Basis words: the row flag (and "TG far lower" when it rides on another flag's sentence), and "Limit N" for a cap override that holds him. */
export function flagChips(flag, limit) {
  const out = [];
  if (flag) {
    out.push({ word: FLAG_WORD[flag.kind] ?? "Check", cls: flag.kind === "twogun_far_below" ? "tgl-far" : "warn", title: flag.text });
    if (flag.kind !== "twogun_far_below" && /TwoGun far lower/.test(flag.text ?? "")) out.push({ word: "TG far lower", cls: "tgl-far", title: flag.text });
  }
  if (isNum(limit)) out.push({ word: `Limit ${Number.isInteger(limit) ? limit : f1(limit)}`, cls: "lim", title: `Your cap override holds him at ${f1(limit)} minutes: no fill above it` });
  return out;
}

/** Where his minutes come from: { tag (ch: the engine, tg: TwoGun's, you: typed), text, delta, title (the full why), chips }. */
function basisOf(r, T, S) {
  const p = r.p;
  if (r.pinned.m) return { tag: "you", text: "Yours", delta: "", title: "minutes typed by you", chips: [] };
  if (r.min_from_ours || ((S.source ?? defaultSourceOf(T)) !== "twogun" && r.min_basis)) {
    const s = shortBasis(r.min_label) ?? { text: "Minutes engine", delta: "" };
    return { tag: "ch", ...s, title: `${r.min_basis ?? "the minutes engine"}${s.ceil ? `; ${s.ceil}` : ""}`, chips: flagChips(r.min_flag, r.min_label?.limit) };
  }
  if (r.min_basis) return { tag: "tg", text: "Role figure", delta: "", title: r.min_basis, chips: [] };
  if (isNum(r.min) && isNum(p.min) && Math.abs(r.min - p.min) < 0.05) return { tag: "tg", text: "TwoGun", delta: "", title: p.starter ? "TwoGun starter" : "TwoGun projection", chips: [] };
  if (isNum(r.min) && isNum(p.min)) {
    const d = r.min - p.min, why = outsOf(keyOf(S.outs)).filter((id) => !T.tonight.includes(id)).map((id) => T.byId[id]?.name).filter(Boolean);
    return { tag: "tg", text: `TwoGun ${f1(p.min)}`, delta: d > 0 ? `+${f1(d)} Outs` : `${MINUS}${f1(-d)}`, title: `TwoGun ${f1(p.min)}, ${d > 0 ? "+" : ""}${f1(d)} ${why.length ? `with ${why.join(", ")} out` : "with the men out shared"}`, chips: [] };
  }
  return { tag: "tg", text: "No minutes", delta: "", title: p.missing?.min ?? "no minutes", chips: [] };
}

/** TwoGun's own figure for the TG Min and TG Proj columns: plain read-only text, a muted dash with the reason when missing. */
const tgCell = (v, what, cls) => `<span class="tgv ${cls}">${isNum(v) ? f1(v) : `<span class="tgmiss" title="${esc(`TwoGun's board row has no ${what} for him`)}">—</span>`}</span>`;

/**
 * The DK/min box's usage line (Adam 11-19), on hover only (G64): the share of his DK/min that follows usage (his scoring share, else the flat RATE_USAGE_SHARE with the reason) and, where this scenario moves
 * his usage per minute, by how much and what it does to his DK/min. r: a calc row (rateAt's usage_x and rate_x), r.p his inputs man (scoring_share, scoring_why).
 */
export function usageText(r) {
  const p = r.p ?? {}, share = isNum(p.scoring_share) ? `${Math.round(p.scoring_share * 100)}% of his DK/min is scoring, so it follows his usage by that share` : `no scoring share (${p.scoring_why ?? "not known"}), so his DK/min follows his usage at the flat ${Math.round(RATE_USAGE_SHARE * 100)}%`;
  const moved = isNum(r.usage_x) && Math.abs(r.usage_x - 1) >= 0.005 ? `; this scenario: usage per minute x${r.usage_x.toFixed(2)}, DK/min x${r.rate_x.toFixed(2)}` : "";
  return `Usage: ${share}${moved}`;
}

/** A typed number box (minutes or DK/min) with its undo chip slot. */
function numBox(team, r, k, mark) {
  const v = k === "m" ? r.min : r.rate, shown = k === "m" ? wholeText(v) : f2(v); // minutes show as the nearest whole minute, with the - and + buttons (min-step.js)
  const label = k === "m" ? "minutes" : "DK points per minute", usage = k === "d" ? `\n${usageText(r)}` : "";
  const box = `<input class="fin${k === "m" ? " mfin" : ""}${mark && !(k === "m" && r.min_aside) ? " pin" : ""}" data-k="${k}" data-id="${esc(r.id)}" data-team="${esc(team)}" value="${shown ?? ""}"${k === "m" && isNum(v) ? ` data-exact="${Math.round(v * 1000) / 1000}"` : ""} inputmode="decimal" autocomplete="off" spellcheck="false" aria-label="${esc(r.p.name)} ${label}" title="${esc(`${mark ? "Your number. " : ""}Type his ${label}; Enter keeps it. Projection = minutes x DK/min${usage}`)}"${shown === null ? ` placeholder="—"` : ""}>`;
  const aside = k === "m" && r.min_aside ? `<button class="rv" type="button" data-restore="${esc(r.id)}" data-team="${esc(team)}" title="${esc(`${r.min_aside.words.charAt(0).toUpperCase()}${r.min_aside.words.slice(1)}. Click to use it again`)}">&#8617; ${esc(wholeText(r.min_aside.value) ?? "")}</button>` : ""; // Adam 9:46 AM 11-20 (typed-aside.js)
  return `<span class="nb nb-${k}">${k === "m" ? stepHtml(box, r.id, team, r.out || shown === null) : box}<span class="cs">${aside || (mark ? chip(team, r.id, k, mark, k === "m" ? wholeText(mark.live) ?? "—" : f2(mark.live) ?? "—") : "")}</span></span>`;
}

/** Salary and Value: read-only plain text (Adam 10:17 AM 11-18, never a box). A missing salary or projection is a dash with the reason, never 0. */
export const salaryText = (p) => (Number.isInteger(p.salary) && p.salary > 0 ? `$${p.salary.toLocaleString("en-US")}` : null);
export const valueText = (r) => { const v = valuePer1k(r.proj, r.p.salary); return v === null ? null : v.toFixed(2); }; // two decimals, as the board's Value column
const salCell = (p) => `<span class="r ro sal">${salaryText(p) ?? miss("no salary for him on this slate")}</span>`;
/** Value's colour: muted for the team's lowest, bright green for its highest (a mix of two theme variables, so it reads on every theme); vr = { lo, hi } over the team's men with a value. */
const valTone = (v, vr) => `color:color-mix(in srgb,var(--gr) ${Math.round(30 + 70 * (vr && vr.hi > vr.lo ? (v - vr.lo) / (vr.hi - vr.lo) : 1))}%,var(--mu))`;
const valCell = (r, vr) => `<span class="r ro val"${valuePer1k(r.proj, r.p.salary) === null ? "" : ` style="${valTone(valuePer1k(r.proj, r.p.salary), vr)}"`}>${valueText(r) ?? miss(salaryText(r.p) ? "no projection, so no value" : "no salary, so no value")}</span>`;

/**
 * Avg Min (Season) and Avg Min (Last 10): his mean minutes over the box-score rows the Console inputs already carry (tier.men[id].rows, overtime-scaled, games he played this season; the same rows Bench+ reads).
 * Last 10 is tiers.js recentOf: his games on or after the date of the team's 10th-last game. null with the reason when there is none, never 0.
 */
export function avgFigures(T, p) {
  const tier = T.tier, none = (why) => ({ season: null, last10: null, whySeason: why, whyLast: why });
  if (!tier || tier.missing) return none(tier?.missing ?? "no minutes engine inputs for this team");
  if (tier.box_note) return none(`no box scores read: ${tier.box_note}`);
  const m = tier.men?.[p.id];
  if (!m) return none("not on the minutes engine's list for this team");
  if (!m.matched) return none("not matched to the box scores, so none of his games were read");
  const rows = (m.rows ?? []).map(([min, , date]) => ({ min, date })), n = rows.length;
  if (!n) return none("no game played this season in the box scores");
  const season = rows.reduce((t, r) => t + r.min, 0) / n, rec = recentOf(rows, tier.since);
  return { season, last10: rec.avg, whySeason: null, whyLast: `no game of his in the team's last ${Math.min(RECENT_GAMES, tier.team_games ?? RECENT_GAMES)}`, nSeason: n, nLast: rec.n };
}
const avgCell = (v, why, n, cls) => `<span class="r ro avg ${cls}"${isNum(v) && n ? ` title="${n} game${n === 1 ? "" : "s"} played"` : ""}>${isNum(v) ? f1(v) : miss(why)}</span>`;

const STATUS = (s) => String(s ?? "").trim();

/**
 * One man in the Starters or the Bench (Adam 2:02-2:04 PM 11-17): Pos/#, Player with his status chip, Min and DK/min boxes, Proj, TwoGun's own minutes and projection as plain text, the Basis in short
 * words (the full why on hover), S and Out. N: the team's news (console-news.js teamNews) or null.
 */
function manRow(team, r, T, S, mk, rank, N, vr) {
  const p = r.p, b = basisOf(r, T, S), starter = r.role === "starter", av = avgFigures(T, p);
  const rmark = mk?.r ? chip(team, r.id, "r", mk.r, flipText(mk.r, mk.r.live === "starter" ? "S" : mk.r.live === "oor" ? "DNP" : "bench")) : "";
  const omark = mk?.out ? chip(team, r.id, "out", mk.out, "out") : "";
  const proj = isNum(r.proj) ? `<b class="pj${r.pinned.m || r.pinned.d ? " pin" : ""}">${f1(r.proj)}</b>` : miss(r.missing.join(", ") || "no projection");
  return `<div class="row${mk ? " marked" : ""}" data-row="${esc(r.id)}">
<span class="ps">${esc(starter ? rank || pos0(p) || "—" : rank)}</span>
<span class="who">${consoleNameOpen(p, p.name, "span", "nm")}<span class="pp">${esc(p.pos ?? "")}</span>${nameChip(N, p)}${mrChip(T.tier?.men?.[r.id]?.mr, "nwc nchip mrc")}</span>
${salCell(p)}${numBox(team, r, "m", mk?.m)}${numBox(team, r, "d", mk?.d)}
<span class="r">${proj}</span>${tgCell(p.tg_proj, "projection", "tgp")}${valCell(r, vr)}${tgCell(p.tg_min, "minutes", "tgm")}${avgCell(av.season, av.whySeason, av.nSeason, "avs")}${avgCell(av.last10, av.whyLast, av.nLast, "avl")}
<span class="why" title="${esc(b.title)}"><span class="bw k-${b.tag}">${esc(b.text)}</span>${b.delta ? `<span class="bd">${esc(b.delta)}</span>` : ""}${b.chips.map((c) => `<span class="fc ${c.cls}" title="${esc(c.title)}">${esc(c.word)}</span>`).join("")}</span>
<span class="tgl"><button class="tg s${starter ? " on" : ""}" type="button" data-s="${esc(r.id)}" data-team="${esc(team)}" title="${starter ? "Starting. Click to send him to the bench" : "Click to mark him a starter (S)"}">S</button><span class="cs">${rmark}</span></span>
<span class="tgl"><button class="tg bp${r.role === "bench_plus" ? " on" : ""}" type="button" data-dbp="1" data-id="${esc(r.id)}" data-team="${esc(team)}"${starter ? ' disabled title="A starter is not Bench+"' : ` title="${r.role === "bench_plus" ? "Bench+ tonight. Click to make him plain Bench" : "Click to make him Bench+ tonight: he goes to the head of the bench order"}"`}>B+</button></span>
<span class="tgl"><button class="tg o" type="button" data-out="${esc(r.id)}" data-team="${esc(team)}" title="Click to mark him Out">Out</button><span class="cs">${omark}</span></span>
</div>`;
}

/** One man in the Out list: his status and where it comes from; the Out toggle brings him back. */
function outRow(team, r, T, mk, N, pos = null) {
  const p = r.p, theirs = T.tonight.includes(r.id), st = STATUS(p.status);
  const page = theirs && (T.tier?.minutes_page?.out ?? []).includes(r.id); // his Minutes-page Out (console-inputs.js withMinutesPage), not a feed's
  void st; // TwoGun's status word is not a source of Tonight's Outs (Adam 11-19)
  const src = page ? `<span class="stag k-you">Yours</span>you marked him Out on the Minutes page` : theirs ? `<span class="stag k-ch">News</span>out on our own injury feeds` : mk?.out?.news ? `<span class="stag k-ch">News</span>${esc(mk.out.news)}` : `<span class="stag k-you">Yours</span>you marked him Out`; // an Out the lineup news made is the news's, not his
  const omark = mk?.out ? chip(team, r.id, "out", mk.out, "in") : "";
  return `<div class="oline" data-row="${esc(r.id)}"><span class="ps">${esc(pos ?? (pos0(p) || "—"))}</span>${consoleNameOpen(p, p.name, "span", "onm")}${outUsage(p)}
<span class="tgl"><button class="tg o on" type="button" data-out="${esc(r.id)}" data-team="${esc(team)}" title="Out. Click to bring him back in">Out</button><span class="cs">${omark}</span></span>
${outNote(N, p)}<div class="why">${src}${isNum(p.healthy) && p.healthy > 0 ? ` &middot; usual ${f1(p.healthy)} min` : ""}${absenceRow(p.absence)}</div></div>`;
}

const HEAD = (first) => `<div class="hd"><span>${first}</span><span>Player</span><span class="r" title="DraftKings salary">Salary</span><span>Min</span><span>DK/min</span><span class="r">Proj</span><span class="tgv tgp" title="TwoGun's projection">TwoGun Proj</span><span class="r" title="Projection per $1,000 of salary">Value</span><span class="tgv tgm" title="TwoGun's minutes">TG Min</span><span class="r" title="His mean minutes a game over the games he played this season (box scores, overtime scaled)">Avg Min (Season)</span><span class="r" title="His mean minutes a game over his games in the team's last 10 games (box scores, overtime scaled): the games he played since the date of the team's 10th-last game">Avg Min (Last 10)</span><span class="bh">Basis</span><span class="c">S</span><span class="c" title="Bench+ tonight">B+</span><span class="c">Out</span></div>`;
const sumMin = (rows) => rows.reduce((s, r) => s + (isNum(r.min) ? r.min : 0), 0);

/** A roles note in the side column's width: the no-chart sentence says the same in fewer words, so it holds one line. */
/** Only a wrong number of starters needs action and stays red; every other team note is information, muted. */
const WARN_NOTE = /starters marked|^Only \d+ starters|TwoGun's minutes are in use|no minutes engine inputs|is not used/;
/** The foot's "Starters" sentence when the header says the sources disagree (news five kind "disagree"): the pages the engine's own five came from (confirmed.sources, tier inputs), the others differ; null when the engine's line should stand. */
export function disagreeNote(five, confirmed) {
  const used = (confirmed?.sources ?? []).map((s) => String(s).replace(/ lineups$/, "")); // without the engine's own sources the news five could be a different one
  if (five?.kind !== "disagree" || !used.length) return null;
  const differs = [...(five.by ?? []), ...(five.differs ?? [])].filter((s) => !used.includes(s)); // every page the engine did not use
  return `Starters: ${used.length === 1 ? `${used[0]}'s five` : `the five ${used.join(" and ")} agree on`} is used${differs.length ? `; ${differs.join(" and ")} differ${differs.length === 1 ? "s" : ""}` : ""}`;
}
/** The team's notes at the foot of its block (global rule: explanations go at the bottom). The last word is held to the line before it with a no-break space, so a lone "0" never wraps. */
export const noteList = (notes) => (notes.length ? `<section class="box"><ul class="notes">${notes.map((n) => `<li${WARN_NOTE.test(n) ? "" : ' class="info"'}>${esc(n).replace(/ (\S+)$/, "&nbsp;$1")}</li>`).join("")}</ul></section>` : "");
const shortNote =(n) => (/^Starters by TwoGun's flag and Tonight's minutes: no depth chart for (?:[A-Z]{2,4}|this team)\.$/.test(n) ? "No depth chart: starters by TwoGun's flag and minutes." : n);

/**
 * The Bench+ suggestions under the Team total (server/rotation/bench-plus.js), muted, one line each; suggestions only, no buttons: he marks a man himself. A check that could not be made,
 * or chart bench men it could not read, get one muted line naming why (rule G62). Nothing at all when there is nothing to say.
 */
export function benchPlusHtml(bp) {
  if (!bp) return "";
  const lines = (bp.suggestions ?? []).map((s) => `<div class="bpl">💡 ${esc(s.text)}</div>`);
  if (bp.missing) lines.push(`<div class="bpl">${esc(bp.missing)}</div>`);
  const nr = bp.not_read ?? [], men = (n) => `${n} bench ${n === 1 ? "man" : "men"}`;
  const skipped = (list, words) => (list.length ? `<div class="bpl" title="${esc(list.map((x) => `${x.name}: ${x.why}`).join("; "))}">Bench+ check skipped ${men(list.length)} ${words}: ${esc(list.map((x) => x.name).join(", "))}</div>` : "");
  lines.push(skipped(nr.filter((x) => x.kind !== "none"), `with under ${bp.min_games ?? "5"} games here`), skipped(nr.filter((x) => x.kind === "none"), "not found in the box scores"));
  if (bp.ot_unknown > 0) lines.push(`<div class="bpl">Bench+ check: ${bp.ot_unknown} of this team's box ${bp.ot_unknown === 1 ? "score carries" : "scores carry"} no overtime count, so ${bp.ot_unknown === 1 ? "its" : "their"} minutes are read unscaled</div>`);
  const shown = lines.filter(Boolean);
  return shown.length ? `<div class="bps">${shown.join("")}</div>` : "";
}

/** The team's sections and side column. */
function teamBody(model, code, news, view = {}) {
  const T = model.TEAMS[code], S = model.ST[code], res = calc(T, S, S.outs), marks = marksOf(T, S), N = news?.N ?? null;
  const rows = res.rows, playing = rows.filter((r) => !r.out), cm = chartModel(T, S, rows); // our depth chart (Adam 11-17); null on inputs without one
  const cpos = (r) => (cm ? cm.posOf(r.id) ?? "—" : ""), cRank = (r) => { const i = POS_ORDER.indexOf(cm?.posOf(r.id) ?? ""); return i < 0 ? 99 : i; };
  const starters = playing.filter((r) => r.role === "starter").sort((a, b) => (cm ? cRank(a) - cRank(b) : posRank(a.p) - posRank(b.p)) || (b.min ?? 0) - (a.min ?? 0));
  const rest = playing.filter((r) => r.role !== "starter");
  const benchAt = cm ? new Map(cm.bench.map((m, i) => [m.id, i])) : null; // the lead, 11-17: with our chart the Bench follows its bench order (Bench+, the 2nds, the 3rds), the numbers as the chart's line says
  const bench = [...rest].sort((a, b) => (benchAt ? (benchAt.get(a.id) ?? 1e3) - (benchAt.get(b.id) ?? 1e3) : 0) || (b.min ?? 0) - (a.min ?? 0) || (a.p.order ?? 0) - (b.p.order ?? 0));
  const outs = rows.filter((r) => r.out).sort((a, b) => (b.p.healthy ?? 0) - (a.p.healthy ?? 0));
  const notes = [];
  if (starters.length > 5) notes.push(`${starters.length} starters marked: unmark one.`);
  else if (starters.length < 5) notes.push(`Only ${starters.length} starters: mark a man S.`);
  const disagree = disagreeNote(N?.team?.five, T.tier?.confirmed); // the foot says what was really used when the header says the sources disagree
  for (const n of String(res.roles_note ?? "").split(/\n+|(?<=\.)\s+/).filter(Boolean).map(shortNote).map((x) => (disagree && /^Starters: the lineup pages' (?:agreed|confirmed) five/.test(x) ? disagree : x))) if (!notes.some((x) => x.slice(0, 12) === n.slice(0, 12)) && !/starters marked|Only \d starters/.test(n)) notes.push(n);
  const vals = playing.map((r) => valuePer1k(r.proj, r.p.salary)).filter((v) => v !== null), vr = vals.length ? { lo: Math.min(...vals), hi: Math.max(...vals) } : null;
  const noSal = playing.filter((r) => !salaryText(r.p));
  if (noSal.length) notes.push(`${noSal.length} ${noSal.length === 1 ? "man has" : "men have"} no salary on this slate, so ${noSal.length === 1 ? "his Value shows" : "their Value shows"} a dash: ${noSal.map((r) => r.p.name).join(", ")}`);
  const avgs = playing.map((r) => ({ r, a: avgFigures(T, r.p) }));
  const noSeason = avgs.filter((x) => x.a.season === null), noLast = avgs.filter((x) => x.a.season !== null && x.a.last10 === null);
  if (noSeason.length) notes.push(`${noSeason.length} ${noSeason.length === 1 ? "man shows" : "men show"} a dash for both Avg Min columns (${[...new Set(noSeason.map((x) => x.a.whySeason))].join("; ")}): ${noSeason.map((x) => x.r.p.name).join(", ")}`);
  if (noLast.length) notes.push(`${noLast.length} ${noLast.length === 1 ? "man shows" : "men show"} a dash for Avg Min (Last 10), no game in the team's last ${Math.min(RECENT_GAMES, T.tier?.team_games ?? RECENT_GAMES)}: ${noLast.map((x) => x.r.p.name).join(", ")}`);
  if (res.chart_note) notes.push(res.chart_note); // one note per team (G68), added whole
  if (res.handout_note) notes.push(res.handout_note); // one note per team, added whole (G68)
  const outPins = outPinsNote(T, S); // his typed numbers on a man Tonight has Out: kept, not used (G62, round 2 item 3)
  if (outPins) notes.push(outPins);
  if (res.injured_note) notes.push(res.injured_note); // one note per team, added whole (G68)
  if (cm) { for (const n of cm.notes) notes.push(n); const sn = sourcesNote(cm, view.when ?? (() => null)); if (sn) notes.push(sn); } // the chart's sources and what they could not place, at the foot (G64)
  const auto = calc(T, { ...S, pins: {} }, T.tonight).totals;
  const typedAdd = (res.totals.min ?? 0) - (auto.min ?? 0);
  const main = `<section class="box"><h2>Starters <small>${starters.length} &middot; ${f1(sumMin(starters))} min</small></h2>${HEAD("Pos")}${starters.map((r) => manRow(code, r, T, S, marks[r.id], cpos(r), N, vr)).join("") || `<div class="none">Nobody is starting. Mark five men S.</div>`}</section>
<section class="box"><h2>Bench <small>bench order &middot; ${f1(sumMin(bench))} min</small></h2>${HEAD("#")}${bench.map((r, i) => manRow(code, r, T, S, marks[r.id], String(6 + i), N, vr)).join("") || `<div class="none">Nobody is on the bench.</div>`}<div class="row tot"><span></span><span class="who">Team total</span><span></span><span class="mt">${f1(res.totals.min) ?? "—"}</span></div>${benchPlusHtml(T.bench_plus)}</section>`;
  const src = S.source ?? defaultSourceOf(T);
  const srcBox = oursUse(T).ok ? `<section class="box"><h2>Minutes for the optimizer</h2><div class="srcs">${MINUTE_SOURCES.map((k) => `<button class="sv${k === src ? " on" : ""}" type="button" data-source="${k}" data-team="${esc(code)}">${SOURCE_LABEL[k]}</button>`).join("")}<button class="sv all" type="button" data-source-all="${src}" data-team="${esc(code)}" title="Use ${esc(SOURCE_LABEL[src])} on every team with the minutes engine">All teams</button></div></section>` : "";
  const outBox = `<section class="box"><h2>Out / injured <small>${outs.length} ${outs.length === 1 ? "man" : "men"}</small></h2>${outs.map((r) => outRow(code, r, T, marks[r.id], N, cm ? cm.posOf(r.id) ?? "—" : null)).join("") || `<div class="none">Nobody is out.</div>`}</section>`;
  const side = `${chartHtml(code, cm, { sel: view.sel ?? null, ro: view.ro === true, showInj: view.showInj === true })}${cm ? outBox : ""}<section class="box"><h2>Team total</h2><div class="tot">
<div class="big"><span>Minutes tonight</span><b class="${Math.abs(typedAdd) >= 0.05 ? "warn" : ""}">${f1(res.totals.min) ?? "—"} min</b></div>
<div><span>Without your marks</span><b>${f1(auto.min) ?? "—"} min</b></div>
${Math.abs(typedAdd) >= 0.05 ? `<div class="warn"><span>Your marks add</span><b>${typedAdd > 0 ? "+" : ""}${f1(typedAdd)}</b></div>` : ""}
<div><span>Team projection</span><b>${f1(res.totals.proj) ?? "—"} pts</b></div></div>
</section>
${cm ? "" : outBox}${srcBox}${noteList(notes)}`;
  // the columns that carry an undo chip on this team widen for it (console.css .wrap.mk-*); every other team keeps them tight
  const chipCols = ["m", "d", "r", "out"].filter((k) => playing.some((r) => marks[r.id]?.[k])).map((k) => ` mk-${k === "out" ? "o" : k}`).join("");
  return { main, side, chipCols, marks: Object.keys(marks).length, starterIds: starters.map((r) => r.id) };
}

/** The team switcher: each game's two teams together, the team on show filled in its colour, a dot on a team that holds his marks. */
function switcherHtml(model, cur, games, colourOf) {
  const btn = (t) => {
    const n = model.TEAMS[t] ? Object.keys(marksOf(model.TEAMS[t], model.ST[t])).length : 0;
    return `<button class="tm${t === cur ? " on" : ""}" type="button" data-team-go="${esc(t)}" style="--tc:${colourOf(t)}" title="${esc(TEAM_NAMES[t] ?? t)}${n ? `: ${n} of your marks` : ""}">${logo(t, "sw")}<b>${esc(t)}</b>${n ? `<i class="dot"></i>` : ""}</button>`;
  };
  return `<nav class="teams" aria-label="Teams">${games.filter((g) => model.TEAMS[g.away] || model.TEAMS[g.home]).map((g) => `<span class="gm">${btn(g.away)}<span class="at">@</span>${btn(g.home)}</span>`).join("")}</nav>`;
}

/** The sentence behind the "?" button. */
const HELP = "Every change goes to the board and the optimizer at once. Type a man's minutes or DK/min and his projection follows (minutes × DK/min). The ↺ chip on a number you set drops it, and he goes back to the live figure.";

/**
 * The whole screen for team `code`. opts: { games (the inputs' games, in tip order), colourOf(team), when(tip) -> "7:30 PM ET", slate, sync (console-auto.js
 * c.sync), canUndo, canRedo, saveErr, news ({ state, why, N } for console-news.js; none draws no strip), help (the "?" sentence is open) }.
 */
export function depthHtml(model, code, opts) {
  const T = model.TEAMS[code], g = opts.games.find((x) => x.away === code || x.home === code), opp = T.opp;
  const { main, side, starterIds, chipCols } = teamBody(model, code, opts.news, { sel: opts.chartSel ?? null, showInj: opts.showInj === true, ro: opts.readOnly === true, when: opts.when });
  const words = syncWords(opts.sync), syncText = `<span class="sync ${words.cls}" title="${esc([words.text, ...words.lines].join(" · "))}"><i></i>${esc(words.text)}</span>`;
  const held = words.lines.length ? `<ul class="heldline">${words.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : "";
  const head = `<header class="thead" style="--tc:${opts.colourOf(code)}">${logo(code, "xl")}<div class="tn"><h1>${esc(TEAM_NAMES[code] ?? code)}</h1><div class="vs">${T.home ? "vs" : "@"} ${logo(opp, "xs")}<b>${esc(TEAM_NAMES[opp] ?? opp)}</b>${g?.tip ? ` &middot; ${esc(opts.when(g.tip) ?? g.tip)}` : ""}</div></div>
<div class="grow"></div><div class="acts">${whatifLoadHtml(code, opts.whatifs ?? [], opts.whatifsErr ?? null)}${syncText}<button class="ub" type="button" data-hist="-1"${opts.canUndo ? "" : " disabled"} title="Undo (Ctrl+Z)">&#8630; Undo</button><button class="ub" type="button" data-hist="1"${opts.canRedo ? "" : " disabled"} title="Redo (Ctrl+Y)">Redo &#8631;</button><button class="help${opts.help ? " on" : ""}" type="button" data-help="1" aria-expanded="${opts.help ? "true" : "false"}" title="${esc(HELP)}">?</button></div></header>`;
  const err = opts.saveErr ? `<div class="errline">${esc(opts.saveErr)}</div>` : "";
  return `${switcherHtml(model, code, opts.games, opts.colourOf)}${head}${held}${err}${opts.help ? `<p class="note">${esc(HELP)}</p>` : ""}${stripHtml(opts.news, starterIds)}<div class="wrap${chipCols}"><div class="mainc">${main}</div><aside>${side}</aside></div>`;
}
