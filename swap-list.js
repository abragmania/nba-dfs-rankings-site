// The swap button on a built lineup's slot (Adam, 2026-11-04): the five best legal replacements for that man, counting the
// salary left once he is out. Legal = the slot allows his positions, he is not in the lineup, not excluded, not locked (a lock
// is in every build already), not Out, not started, has a salary and a projection, and the whole lineup passes slots.js
// checkLineup (the one validator: positions, no twin, the $50,000 cap, two games). Ranked by projection. Pure: no DOM except
// the markup strings, tested in node.
import { esc, money, dec1, nameOpen } from "./board-util.js";
import { SLOTS, SALARY_CAP, checkLineup } from "./slots.js";
import { slateRefMs, startedSplit } from "./lateswap.js";
import { outFor } from "./figures.js";
import { isPending } from "./instant-pins.js";
import { isGuessed } from "./board-saves.js";

export const SWAP_COUNT = 5;
/** A man whose figures on show are a guess not yet answered: his typed minutes (instant-pins.js) or an override on its way (board-saves.js) (review 11-21 F6). */
export const guessedNow = (id) => isPending(id) || isGuessed(id);
const PEND_TITLE = "A typed number or change of yours is on its way to the board; this figure is the instant one until the board answers";
/** Why Use waits, or null: either man's figures are still a guess, so the swap would be ranked and made on a number the server has not answered. */
export function useWait(out, p) {
  const who = [out, p].filter((m) => m && guessedNow(m.dk_id)).map((m) => m.name ?? m.dk_id);
  return who.length ? `Wait a moment: your change to ${who.join(" and ")} is still on its way to the board, so this swap is ranked on instant figures. Use comes back once the board answers.` : null;
}

/** The page's view of who may be swapped in or out now: started men (from the clock) plus the board's picks. */
export function swapContext(c, seat, nowMs = Date.now()) {
  const { started, untimed } = startedSplit(c.players, { nowMs, refMs: slateRefMs(c.name) });
  return { byId: c.byId, players: c.players, excludedIds: new Set(c.picks.excluded), lockedIds: new Set(c.picks.locked), started, untimed: new Set(untimed.map((p) => p.dk_id)), seat, noIds: new Set(c.no ?? []), noMode: c.noMode ?? null, picksOff: picksOffWords(c) };
}
/** Swaps are off for a mode whose locks and excludes the server could not read (review 11-20, money): who is excluded is unknown. */
const picksOffWords = (c) => (c.picks?.unreadable ? `The ${c.noMode ?? "board's"} locks and excludes could not be read; swaps are off until a lock or exclude change in ${c.noMode ?? "that mode"} saves new ones.` : null);

/** The swap context of one mode's card (review 11-20, money: Cash and GPP keep separate picks, Adam 11-14/11-20): that mode's excludes,
 *  locks and NO list (c.picksOf / c.noOf, board.js), never the mode on show. A card of no known mode uses the board's on show. */
export function swapContextFor(c, seat, mode, nowMs = Date.now()) {
  const known = (mode === "Cash" || mode === "GPP") && c.picksOf && c.noOf;
  return swapContext(known ? { ...c, picks: c.picksOf(mode), no: c.noOf(mode), noMode: mode } : c, seat, nowMs);
}

/** The men whose game has started by the tip times (a man with an unreadable tip is not in it: for a DK file he is treated as not started). */
export function startedByTip(c, nowMs = Date.now()) {
  const { started, untimed } = startedSplit(c.players, { nowMs, refMs: slateRefMs(c.name) });
  const none = new Set(untimed.map((p) => p.dk_id));
  return new Set([...started].filter((id) => !none.has(id)));
}

const FROZEN = "A man in this lineup has started or has no readable tip time; use Late swap.";
/** True when any man of the lineup (men: slate players or stale stubs) has started: a swap would re-seat him. */
export const lineupStarted = (men, ctx) => men.some((p) => p && ctx.started.has(p.dk_id));


/** Why the man in a lineup cannot be swapped out, or null. */
export function swapOutRefusal(p, ctx) {
  if (ctx.picksOff) return ctx.picksOff; // the mode's locks and excludes are unknown: no swap at all
  if (!p || p.stale) return "He is no longer on this slate.";
  if (ctx.untimed?.has(p.dk_id)) return "His tip time can't be read."; // startedSplit counts him as started: the words must not say so
  if (ctx.started.has(p.dk_id)) return "His game has started.";
  if (ctx.lockedIds.has(p.dk_id)) return "He is locked; unlock him first.";
  return null;
}

/**
 * The replacements for man `outId` in lineup `ids`. Returns { out, k, slot, options, why }: `options` up to `limit` entries
 * { p, diff (his projection minus the man's, null when the man has none), left (salary left after) } best projection first;
 * `why` is set when the man cannot be swapped out at all. The lineup is seated by ctx.seat (as the card draws it) so the
 * slot is the one on show; the new man must fit that very slot.
 */
export function swapOptions(ids, outId, ctx, limit = SWAP_COUNT) {
  const men = ctx.seat(ids.map((id) => ctx.byId.get(id) ?? { dk_id: id, stale: true })).men;
  const k = men.findIndex((p) => p?.dk_id === outId);
  if (k < 0) return { out: null, k, slot: null, options: [], why: "He is not in this lineup." };
  const out = men[k], slot = SLOTS[k];
  const why = ctx.picksOff ?? (lineupStarted(men, ctx) ? FROZEN : swapOutRefusal(out, ctx));
  if (why) return { out, k, slot, options: [], why };
  if (men.some((p) => !p || p.stale)) return { out, k, slot, options: [], why: "A man in this lineup is no longer on this slate." };
  const inLineup = new Set(ids);
  const room = SALARY_CAP - men.reduce((t, m, j) => t + (j === k || !Number.isInteger(m.salary) ? 0 : m.salary), 0); // what the slot may cost
  const options = [], noSkipped = [];
  for (const p of ctx.players) {
    if (inLineup.has(p.dk_id) || ctx.excludedIds.has(p.dk_id) || ctx.lockedIds.has(p.dk_id) || ctx.started.has(p.dk_id) || ctx.untimed?.has(p.dk_id) || outFor(p, { engine: true })) continue; // an unreadable tip fails closed
    if (typeof p.projection !== "number" || !Number.isInteger(p.salary)) continue;
    const next = men.map((m, j) => (j === k ? p : m));
    if (!checkLineup(next).ok) continue;
    if (ctx.noIds?.has(p.dk_id)) { noSkipped.push(p); continue; } // on the open mode's NO list (no-picks.js, review F9a): never offered
    options.push({ p, diff: typeof out.projection === "number" ? p.projection - out.projection : null, left: SALARY_CAP - next.reduce((t, m) => t + m.salary, 0) });
  }
  options.sort((a, b) => b.p.projection - a.p.projection || String(a.p.name).localeCompare(String(b.p.name)));
  noSkipped.sort((a, b) => b.projection - a.projection);
  return { out, k, slot, room, men, options: options.slice(0, limit), why: null, noSkipped, noMode: ctx.noMode ?? null };
}

/** The lineup's ids after a swap, in the seated order the options were checked in (so every man sits in a slot he can play);
 *  `o` is swapOptions' answer and `inId` one of its options. A new array. */
export const swapIds = (o, inId) => o.men.map((m, j) => (j === o.k ? inId : m.dk_id));

/** The swap button for a slot's control cell: disabled, with the reason, when the man cannot come out. `frozen`: a man of
 *  the lineup has started. */
export function swapButtonHtml(p, i, ctx, openId, frozen = false) {
  if (p === undefined) return "";
  if (p === null || p.stale) return "<span></span>";
  const why = ctx?.picksOff ?? (frozen ? FROZEN : swapOutRefusal(p, ctx));
  const on = openId === p.dk_id;
  return `<button class="swb${on ? " on" : ""}" data-op="swap" data-k="${esc(i)}" data-id="${esc(p.dk_id)}"${why ? ` disabled title="Cannot swap ${esc(p.name)}: ${esc(why)}"` : ` title="Swap ${esc(p.name)} for one of the best replacements"`}>⇄</button>`;
}

const sgn = (v, dash) => (v == null ? dash("the man being swapped out has no projection") : `<b class="${v < 0 ? "neg" : "pos0"}">${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(1)}</b>`);

/** The panel under the slot: the options as rows with a Use button, or the plain "no legal replacement" line. */
export function swapPanelHtml(o, i, dash) {
  if (o.why) return `<div class="swp"><div class="swn">Cannot swap ${esc(o.out?.name ?? o.out?.dk_id ?? "this man")}: ${esc(o.why)}</div></div>`;
  const head = `<div class="swh">Swap ${nameOpen(o.out.name, o.out.dk_id, "b")} (${esc(o.slot)}): ${o.options.length ? `${o.options.length} best` : "none"} at ${money(o.room)} or less<span>Left = salary left after</span></div>`;
  const noNote = ""; // a NO man is simply not offered, with no line about it (Adam 6:19 PM 11-19: "just don't have that guy shown"); o.noSkipped keeps who, as data
  if (!o.options.length) return `<div class="swp">${head}<div class="swn">No legal replacement for ${esc(o.out.name)}: nobody who fits the ${esc(o.slot)} slot, is not already in the lineup, not excluded, not on the NO list, not Out, not started and keeps the lineup under ${money(SALARY_CAP)}.</div>${noNote}</div>`;
  const outPend = guessedNow(o.out.dk_id);
  const at = (cls, on) => { const c = [cls, on ? "pend" : ""].filter(Boolean).join(" "); return `${c ? ` class="${c}"` : ""}${on ? ` title="${esc(PEND_TITLE)}"` : ""}`; }; // a guessed figure is drawn pending, with why in its hover
  const rows = o.options.map(({ p, diff, left }) => {
    const mine = guessedNow(p.dk_id), wait = useWait(o.out, p);
    return `<tr><td class="swl">${nameOpen(p.name, p.dk_id)} <span class="pos">${esc((p.positions ?? []).join("/"))}</span> <small>${esc(p.team)}</small></td>`
    + `<td>${money(p.salary)}</td><td${at("swpj", mine)}>${dec1(p.projection)}</td><td${at("", mine || outPend)}>${sgn(diff, dash)}</td>`
    + `<td${at("", mine)}>${typeof p.value === "number" ? p.value.toFixed(2) : dash("no value in this pull")}</td>`
    + `<td${at("swo", mine)}>${typeof p.proj_own === "number" ? p.proj_own.toFixed(1) + "%" : dash("no projected ownership in this pull")}</td>`
    + `<td>${money(left)}</td><td><button class="xf" data-op="swapuse" data-k="${esc(i)}" data-in="${esc(p.dk_id)}"${wait ? ` disabled title="${esc(wait)}"` : ` title="Put ${esc(p.name)} in this lineup"`}>Use</button></td></tr>`;
  }).join("");
  return `<div class="swp">${head}<table class="swt"><thead><tr><th class="swl">Player</th><th>Sal</th><th>Proj</th><th>Diff</th><th>Val</th><th>Own</th><th>Left</th><th></th></tr></thead><tbody>${rows}</tbody></table>${noNote}</div>`;
}
