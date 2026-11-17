// The Console's "All teams" news page and the cleaned fact rows (Adam 2:58-3:25 PM 11-17: "on the all teams page, I just want a list of news -- with the option to filter by team"; the News tab is gone).
// Pure strings, tested in node; console.js puts them on the page and owns the clicks (data-ca-filter, data-ca-dismiss, data-team-go, data-go-all). The facts are news-facts.js's, the data newsModel's:
// no second source. Main view: the list and its team filter only; every count of what was folded, unusable or still being watched is one muted line at the foot (G62, G64). Look: console-all.css (ca-).
import { esc, logo } from "./board-util.js";
import { CONFLICT_HOLD_MIN } from "./news-facts.js";
import { timeLabel } from "./news-model.js";

const KIND_TITLE = { OUT: "Out", Q: "Questionable", D: "Doubtful", P: "Probable", IN: "Playing / available", START: "Starting", BENCH: "Out of the starting five", NOTE: "Note", INFO: "Note", CHECK: "The sources disagree" };
const REACT = {
  applied: ["ca-ok", "✓ Applied", "TwoGun's board carries this report"],
  waiting: ["ca-wait", "⚠ TwoGun hasn't reacted", "No change in TwoGun's minutes since this report"],
  newer: ["ca-wait", "🕒 Newer than your last pull", "Reported after your last pull, so it is not in the numbers yet: press Pull now"],
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The minutes at stake as the row shows them: "14.1", "3.5 → 6.6", or a dash (never a stand-in figure). */
const minsHtml = (m) => (m ? `<span class="ca-m" title="Minutes at stake (TwoGun's board)"><b>${esc(m)}</b> min</span>` : '<span class="ca-m ca-none">—</span>');
const chipsHtml = (srcs) => (srcs.length ? srcs.map((s) => `<span class="ca-src">${esc(s)}</span>`).join("") : "");

/**
 * One fact as a row. opts: { team: true on the landing (a team cell that opens that team's page), compact: true in a team's own strip (two lines, no team cell) }.
 * A source conflict ("Your call") carries the page's hide X (data-ca-dismiss), the one resolve control the lineup news has.
 */
export function factRow(f, { team = true, compact = false } = {}) {
  const k = f.kind, chip = `<span class="ca-k ca-k-${esc(k)}" title="${esc(KIND_TITLE[k] ?? k)}">${esc(k === "CHECK" ? "CHECK" : k)}</span>`;
  const react = f.conflict ? `<span class="ca-call" title="Two sources disagree and have for ${CONFLICT_HOLD_MIN} minutes or more: nothing is applied until you decide">Your call</span><button type="button" class="ca-x" data-ca-dismiss="${esc(f.conflict.id)}" data-ca-sig="${esc(f.conflict.signature)}" title="Hide this until a source changes">&#10005;</button>`
    : f.react && REACT[f.react] ? `<span class="${REACT[f.react][0]}" title="${esc(REACT[f.react][2])}">${REACT[f.react][1]}</span>` : "";
  const who = f.plain != null
    ? `<span class="ca-who" title="${esc(f.title ?? f.plain)}"><span class="ca-d">${esc(f.plain)}</span>${f.sides?.length ? `<span class="ca-sides">${f.sides.map((s) => `<span>${esc(s)}</span>`).join("")}</span>` : ""}</span>`
    : `<span class="ca-who" title="${esc(f.title ?? "")}"><b>${esc(f.name ?? "")}</b>${f.detail ? ` <span class="ca-d">${esc(f.detail)}</span>` : ""}</span>`;
  const tm = f.team ? `<button type="button" class="ca-tm" data-team-go="${esc(f.team)}" title="Open ${esc(f.team)}'s console page">${logo(f.team, "xs")}<b>${esc(f.team)}</b></button>` : '<span class="ca-tm ca-none">—</span>';
  const time = `<time>${esc(f.time ?? "—")}</time>`;
  if (compact) return `<div class="ca-row ca-c${f.conflict ? " ca-conf" : ""}" data-team="${esc(f.team ?? "")}">${time}${chip}${who}${f.conflict ? "" : minsHtml(f.mins)}<span class="ca-sub">${react}${chipsHtml(f.srcs)}</span></div>`;
  return `<div class="ca-row${f.conflict ? " ca-conf" : ""}" data-team="${esc(f.team ?? "")}">${time}${chip}${team ? tm : ""}${who}${f.conflict ? "<span></span>" : minsHtml(f.mins)}<span class="ca-re">${react}</span><span class="ca-srcs">${chipsHtml(f.srcs)}</span></div>`;
}

/** The team bar's first chip, inserted into the console's own bar (console-depth.js switcherHtml, which this module does not edit): "All teams", lit while that page is on show. */
export function withAllChip(html, on) {
  const nav = '<nav class="teams" aria-label="Teams">';
  return html.replace(nav, `${nav}<button class="tm ca-all${on ? " on" : ""}" type="button" data-go-all="1" style="--tc:var(--bl)" title="Tonight's lineup news, all teams">All teams</button>`);
}
/** The console's team bar taken from a page already drawn for one team, with no team lit (the All teams page has its own header and no team on show). "" if the bar is not there. */
export const teamBarOf = (html) => (/<nav class="teams"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "").replace(/class="tm on"/g, 'class="tm"');

/** The muted foot: the check's own lines, what was folded and why, what is under watch, who was read when. One paragraph; "" is never returned for a read (it always says when the sources were read). */
export function footHtml(V, day = null) {
  const { F, model, problem } = V, bits = [];
  bits.push(...(model.foot ?? []).map((l) => (/[.!?]$/.test(l) ? l : `${l}.`)));
  const fl = F.folded;
  if (fl.vague) bits.push(`${plural(fl.vague, "vague lineup-check note")} ("a man's status changed", "may-not-play list changed") folded into the facts above${fl.attached < fl.vague ? ` (${fl.vague - fl.attached} matched no report, so only counted)` : ""}.`);
  if (fl.rollup) bits.push(`${plural(fl.rollup, "roll-up line")} of Monster's own reports folded into their facts.`);
  if (fl.repeats) bits.push(`${plural(fl.repeats, "repeated report")} merged into the newest.`);
  if (F.watching) bits.push(`${plural(F.watching, "source disagreement")} under watch, shown once held ${CONFLICT_HOLD_MIN} minutes${F.hold?.why ? ` (${F.hold.why})` : ""}.`);
  if (!model.hasRead) bits.push("No lineup read yet: the starting fives are TwoGun's and no lineup news is proposed.");
  else if (model.stale) bits.push("The lineup read is too old to act on: the starting fives are TwoGun's and nothing is proposed from it.");
  for (const n of V.notes ?? []) bits.push(/[.!?]$/.test(n) ? n : `${n}.`);
  if (problem) bits.push(`Source disagreements could not be checked (${problem}).`);
  const A = model.asOf ?? {}, at = (ms) => timeLabel(ms, { day }) ?? "not read";
  bits.push(`Sources read: Monster ${at(A.monster)} · RotoWire ${at(A.rotowire)} · RotoGrinders ${at(A.rotogrinders)}.`);
  return `<p class="ca-foot">${bits.map(esc).join(" ")}</p>`;
}

/** The team codes of the slate in game order, then any team with players but no game row (so none vanishes from the filter). */
export const teamsOf = (model, order = []) => {
  const codes = [...new Set([...model.games.flatMap((g) => [g.away.code, g.home.code]), ...(model.orphans ?? []).map((o) => o.team)])], rank = (t) => (order.includes(t) ? order.indexOf(t) : order.length);
  return codes.map((t, i) => [t, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([t]) => t); // the console's own team bar order when given
};

/**
 * The All teams page. V: newsView's answer { model, F, notes, problem }; filter: a team code or "" for all (a team that is not on the slate counts as all). The chip row is the filter; the list is the facts.
 */
export function landingHtml(V, filter = "", order = []) {
  const teams = teamsOf(V.model, order), sel = teams.includes(filter) ? filter : "";
  const count = (t) => V.F.facts.filter((f) => f.team === t).length, all = V.F.facts.length;
  const chips = [`<button type="button" class="ca-chip${sel ? "" : " on"}" data-ca-filter="">All <b>${all}</b></button>`,
    ...teams.map((t) => `<button type="button" class="ca-chip${t === sel ? " on" : ""}${count(t) ? "" : " ca-quiet"}" data-ca-filter="${esc(t)}" title="${esc(t)}: ${plural(count(t), "item")}">${logo(t, "xs")}${esc(t)} <b>${count(t)}</b></button>`)].join("");
  const shown = sel ? V.F.facts.filter((f) => f.team === sel) : V.F.facts;
  const rows = shown.map((f) => factRow(f)).join("") || `<div class="ca-empty">${sel ? `No lineup news for ${esc(sel)} tonight.` : "No lineup news tonight."}</div>`;
  return `<section class="ca"><header class="ca-h"><h1>Tonight's lineup news</h1><span class="ca-n">newest first · ${sel ? `${esc(sel)} only · ` : ""}${plural(shown.length, "item")}</span></header>`
    + `<div class="ca-chips">${chips}</div><div class="ca-list">${rows}</div>${footHtml(V, V.model.day)}</section>`;
}
