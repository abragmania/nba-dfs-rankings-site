// The lineup row and the totals block (optimizer standard A5, A11, A19, A20): every result card and late swap mode draw their
// slots through cardRowHtml and their totals through capLine. The working lineup on the Player list passes `wk` and draws its
// own roster-card row (wkRowHtml: Salary, Proj, Value, Own under a header row) and its own totals layout, over the same capLine.
// A card row is the slot (boxed, first at the left, every path), the team logo, the name (it opens the player card), the injury letter, then Sal, Proj, Own.
// A missing figure is the board's dash with a reason, never zero (RULES R1). Pure: no DOM, tested in node.
import { esc, money, dec1, logo, injBadge } from "./board-util.js";
import { SALARY_CAP } from "./slots.js";

/** A lineup's totals from the slate's current figures; each is null when any man (or his figure) is missing (RULES R1). */
export function totals(men) {
  const sum = (f) => (men.every((p) => p && typeof p[f] === "number") ? men.reduce((t, p) => t + p[f], 0) : null);
  return { salary: sum("salary"), projection: sum("projection"), own: sum("proj_own") };
}

/** A lineup's value: its projection per $1,000 of its salary (the table's Val form); null with no men, a man's figure missing, or no salary. Pure. */
export function totalValue(men) {
  if (!men.length) return null;
  const t = totals(men);
  return t.salary > 0 && t.projection != null ? t.projection / (t.salary / 1000) : null;
}

/** Whether a man's own row has him Out. Pure. */
export const isOutNow = (p) => /^out$/i.test(p?.injury_status ?? "");

/**
 * What has become of a man on a frozen lineup card, from the board now; null when nothing has. p: his row as the card holds it; live: dk_id to the row on the board;
 * outNames: a Set of the names on the slate's Out list. The card's figures stay frozen; only this reads live. Pure.
 */
export function lineupTag(p, live, outNames) {
  if (!p) return null;
  if (p.stale && !p.name) return null;
  const row = live.get(p.dk_id);
  if (!row) return outNames?.has(p.name) ? "now Out" : "off the slate";
  return /^out$/i.test(row.injury_status ?? "") && !/^out$/i.test(p.injury_status ?? "") ? "now Out" : null;
}

/** The frozen men of one lineup a DK file must not hold, as a sentence's words ("Jalen Smith is now Out"); [] with none. Pure. */
export function lineupRefusals(men, live, outNames) {
  return men.flatMap((p) => { const tag = lineupTag(p, live, outNames); return tag ? [`${p.name} ${tag === "now Out" ? "is now Out" : "is no longer on this slate"}`] : []; });
}

/** A player's name as the button that opens his card (board.js reads data-dk-id from any click). `cls` adds a class. */
export const nameLink = (p, cls = "", short = "") => `<button class="pn${cls ? ` ${cls}` : ""}" data-dk-id="${esc(p.dk_id)}"${short ? ` data-short="${esc(short)}"` : ""} title="Open ${esc(p.name)}'s card">${esc(p.name)}</button>`;

/** The name with the first name cut to an initial ("Onyeka Okongwu" -> "O. Okongwu"); a one-word name stays. A lineup card shows it
 *  only on a row where the whole name does not fit, so the last name and the chips always show. */
export const shortName = (name) => { const t = String(name ?? "").trim().split(/\s+/); return t.length > 1 ? `${t[0][0]}. ${t.slice(1).join(" ")}` : t.join(" "); };

/** A note's list of men as card links; a man with no dk_id or no name stays plain text. */
export const nameLinks = (men) => men.map((p) => (p.dk_id != null && p.name ? nameLink(p, "il") : esc(p.name ?? p.dk_id))).join(", ");

/** The list a "men skipped" note opens; a man with a dk_id is a card link. */
export function skippedList(skipped) {
  return `<ul class="skl">${skipped.map((s) => { const t = `${s.name ?? "No name"} (${s.why})`; return `<li title="${esc(t)}">${s.dk_id != null && s.name ? `${nameLinks([s])} (${esc(s.why)})` : esc(t)}</li>`; }).join("")}</ul>`;
}

const teamAttr = (team, colourOf) => {
  if (!colourOf) return "";
  const c = colourOf(team);
  return ` style="--t1:${esc(c.t1)};--t2:${esc(c.t2)}"`;
};
const fig = (cls, label, html) => `<span class="${cls}"><i>${label}</i>${html}</span>`;

/** The working lineup's name button: the whole name; a name over 20 letters also carries its initial form (board.css shows that one
 *  on the narrow panel, so the last name stays whole whatever the font). Fixed by length, not measured: no first-draw font race. */
function wkName(p) {
  const long = String(p.name ?? "").length > 20;
  return `<button class="pn" data-dk-id="${esc(p.dk_id)}" title="Open ${esc(p.name)}'s card">${long ? `<span class="nf">${esc(p.name)}</span><span class="ns">${esc(shortName(p.name))}</span>` : esc(p.name)}</button>`;
}

/**
 * The working lineup's row (Player list, `wk`): slot badge, logo, name with position over "TEAM vs OPP · tip", then Salary, Proj,
 * Value, Own in columns the header row above the slots names, the control cell last. An open seat is the slot and "Empty" only.
 * Same params as cardRowHtml; `when(tip)` writes the tip time. A missing figure is the dash with its reason (RULES R1).
 */
function wkRowHtml({ slot, p, dash, colourOf, cls, attrs, ctl, note, emptyLabel, when }) {
  const row = (extra, style, body) => `<div class="crow wkr${cls ? ` ${cls}` : ""}${extra}"${attrs}${style}><span class="sl">${esc(slot)}</span>${body}</div>`;
  if (p === undefined) return row(" empty", "", `<div class="sn"><b>${esc(emptyLabel)}</b></div>`);
  const ctlCell = ctl == null || ctl === "" ? "<span></span>" : ctl;
  const f = (c, v, why) => `<span class="${c}">${v == null ? dash(why) : v}</span>`;
  if (p === null || p.stale) {
    const id = p?.dk_id == null ? "" : `<small>DraftKings id ${esc(p.dk_id)}</small>`;
    const gone = "this player is no longer on this slate";
    return row(" stale", "", `<span></span><div class="sn"><b>${p?.name ? `${esc(p.name)} · ${esc(note || "off the slate")}` : "Not on this slate"}</b>${id}</div>${f("ss", null, gone)}${f("sp", null, gone)}${f("sv", null, gone)}${f("so", null, gone)}${ctlCell}`);
  }
  const matchup = p.oppText ? esc(p.oppText) : dash("no opponent in this slate file");
  const t = p.tip ? (when ? when(p.tip) : p.tip) : null;
  const tip = t ? esc(t) : dash("no tip time in this slate file");
  return row(colourOf ? " tm" : "", teamAttr(p.team, colourOf), `${logo(p.team, "sm")}<div class="sn"><div class="sn1">${wkName(p)}${p.positions?.length ? `<span class="pos">${esc(p.positions.join("/"))}</span>` : ""}<span class="inj1">${injBadge(p.injury_status)}</span></div><small><span class="inj2">${injBadge(p.injury_status)}</span>${esc(p.team)} ${matchup} · ${tip}${note ? ` · ${esc(note)}` : ""}</small></div>`
    + f("ss", p.salary == null ? null : money(p.salary), "no salary in this slate file")
    + f("sp", p.projection == null ? null : p.projection.toFixed(1), "no projection in this pull")
    + f("sv", p.value == null ? null : p.value.toFixed(2), "no value in this pull")
    + f("so", p.proj_own == null ? null : p.proj_own.toFixed(1) + "%", "no projected ownership in this pull")
    + ctlCell);
}

/**
 * One row. p: a slate player, undefined (an open slot) or null / { dk_id, stale } (no longer on the slate). `ctl` is the
 * control cell's markup ("" for an empty one); null draws no control column (the result cards). `cls` and `attrs` add the
 * caller's classes and attributes; `note` follows the matchup on the second line. colourOf(team) gives the team treatment.
 * `emptyLabel` is what an open slot reads (`Empty` unless the lineup's own state is not known yet).
 */
export function cardRowHtml({ slot, p, dash, colourOf = null, cls = "", attrs = "", ctl = null, note = "", emptyLabel = "Empty", lead = "slot", corr = null, wk = false, when = null }) {
  if (wk) return wkRowHtml({ slot, p, dash, colourOf, cls, attrs, ctl, note, emptyLabel, when });
  // lead "logo" (the Lineups tab's cards): the same boxed slot first, then the logo; the compact grid and hidden position/matchup are lineups.css.
  const logoLead = lead === "logo";
  const row = (extra, style, body) => `<div class="crow${logoLead ? " lead" : ""}${ctl == null ? " noctl" : ""}${cls ? ` ${cls}` : ""}${extra}"${attrs}${style}><span class="sl">${esc(slot)}</span>${body}</div>`;
  const chip = corr ? `<span class="corr" style="--cc:${esc(corr.colour)}" title="Game stack: men from both sides of this game are in the lineup">CORR</span>` : "";
  if (p === undefined) return row(" empty", "", `<span></span><div class="sn"><b>${esc(emptyLabel)}</b></div>`);
  const ctlCell = ctl == null ? "" : ctl === "" ? "<span></span>" : ctl;
  if (p === null || p.stale) {
    const gone = dash("this player is no longer on this slate");
    const id = p?.dk_id == null ? "" : `<small>DraftKings id ${esc(p.dk_id)}</small>`;
    return row(" stale", "", `<span></span><div class="sn"><b>${p?.name ? `${esc(p.name)} · ${esc(note || "off the slate")}` : "Not on this slate"}</b>${id}</div>${ctlCell}${fig("ss", "Sal", gone)}${fig("sp", "Proj", gone)}${fig("so", "Own", gone)}`);
  }
  const matchup = p.oppText ? esc(p.oppText) : dash("no opponent in this slate file");
  return row(colourOf ? " tm" : "", teamAttr(p.team, colourOf), `${logo(p.team, "sm")}<div class="sn"><div class="sn1">${nameLink(p, "", shortName(p.name))}${p.positions?.length ? `<span class="pos">${esc(p.positions.join("/"))}</span>` : ""}${injBadge(p.injury_status)}${chip}</div><small>${esc(p.team)} ${matchup}${note ? ` · ${esc(note)}` : ""}</small></div>${ctlCell}`
    + fig("ss", "Sal", p.salary == null ? dash("no salary in this slate file") : money(p.salary))
    + fig("sp", "Proj", p.projection == null ? dash("no projection in this pull") : p.projection.toFixed(1))
    + fig("so", "Own", p.proj_own == null ? dash("no projected ownership in this pull") : p.proj_own.toFixed(1) + "%"));
}

/**
 * The cap bar and the lineup's totals, drawn under the last slot from the first man on (A11): Salary used, Salary left, Proj,
 * Own. With nobody in yet the two scores are dashes, never zero. Over the cap, Salary left is a red negative.
 * `unknown`: the lineup itself has not been read, so nothing here can be known: all four are dashes and the bar is empty.
 * `perOpen` and `valueTot` (a number or null) are the working lineup's extra figures: Per open slot and Value; absent for the cards.
 */
export function capLine(men, { dash, unknown = false, short = false, perOpen = null, valueTot }) {
  if (unknown) {
    const d = dash("the working lineup has not loaded");
    return `<div class="cap"><div class="capbar"><i style="width:0%"></i></div><div class="capt">${["Salary used", "Salary left", "Proj", "Own"].map((l) => `<span>${l} <b>${d}</b></span>`).join("")}${valueTot === undefined ? "" : `<span class="tval">Value <b>${d}</b></span>`}</div></div>`;
  }
  const t = totals(men);
  const known = t.salary != null;
  const used = known ? t.salary : 0;
  const over = known && used > SALARY_CAP;
  const pct = Math.min(100, (used / SALARY_CAP) * 100);
  const why = men.length ? "a man in this lineup has no figure here or is no longer on this slate" : "no man in this lineup yet";
  const score = (v, f) => (v == null || !men.length ? dash(why) : f(v));
  // `short` (the Lineups tab's cards): "Salary $50,000  Left $0  Proj 285.5  Own 172.6%", all on one line.
  const parts = [
    short ? `<span>Salary <b>${known ? money(t.salary) : dash(why)}</b></span>` : `<span>Salary used <b>${known ? money(t.salary) : dash(why)}</b>${valueTot === undefined ? ` / ${money(SALARY_CAP)}` : `<em class="of">of ${money(SALARY_CAP)}</em>`}</span>`, // the working lineup (valueTot given) sets the cap as its own quiet line
    over ? `<span class="overcap">${short ? "Left" : "Salary left"} <b>−${money(used - SALARY_CAP)}</b></span>` : `<span>${short ? "Left" : "Salary left"} <b>${known ? money(SALARY_CAP - used) : dash(why)}</b></span>`,
    `<span>Proj <b>${score(t.projection, dec1)}</b></span>`,
    `<span>Own <b>${score(t.own, (v) => v.toFixed(1) + "%")}</b></span>`,
    // The working lineup only: salary left spread over the open slots, a plain average (null: nothing to show).
    ...(perOpen == null ? [] : [`<span class="perop" title="Salary left divided by the open slots">Per open slot <b>${money(perOpen)}</b></span>`]),
    // The working lineup only (valueTot given, a number or null): projection per $1,000 of salary used, as the table's Val.
    ...(valueTot === undefined ? [] : [`<span class="tval" title="Projection per $1,000 of salary used">Value <b>${score(valueTot, (v) => v.toFixed(2))}</b></span>`]),
  ];
  return `<div class="cap"><div class="capbar${over ? " over" : ""}"><i style="width:${pct}%"></i></div><div class="capt">${parts.join("")}</div></div>`;
}
