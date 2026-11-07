// The swap button on a built lineup's slot (Adam, 2026-11-04): the five best legal replacements for that man, counting the
// salary left once he is out. Legal = the slot allows his positions, he is not in the lineup, not excluded, not locked (a lock
// is in every build already), not Out, not started, has a salary and a projection, and the whole lineup passes slots.js
// checkLineup (the one validator: positions, no twin, the $50,000 cap, two games). Ranked by projection. Pure: no DOM except
// the markup strings, tested in node.
import { esc, money, dec1 } from "./board-util.js";
import { SLOTS, SALARY_CAP, checkLineup } from "./slots.js";
import { slateRefMs, startedSplit } from "./lateswap.js";

export const SWAP_COUNT = 5;

/** The page's view of who may be swapped in or out now: started men (from the clock) plus the board's picks. */
export function swapContext(c, seat, nowMs = Date.now()) {
  const { started, untimed } = startedSplit(c.players, { nowMs, refMs: slateRefMs(c.name) });
  return { byId: c.byId, players: c.players, excludedIds: new Set(c.picks.excluded), lockedIds: new Set(c.picks.locked), started, untimed: new Set(untimed.map((p) => p.dk_id)), seat };
}

const FROZEN = "A man in this lineup has started; use Late swap.";
/** True when any man of the lineup (men: slate players or stale stubs) has started: a swap would re-seat him. */
export const lineupStarted = (men, ctx) => men.some((p) => p && ctx.started.has(p.dk_id));

const isOut = (p) => String(p?.injury_status ?? "").trim().toLowerCase() === "out";

/** Why the man in a lineup cannot be swapped out, or null. */
export function swapOutRefusal(p, ctx) {
  if (!p || p.stale) return "He is no longer on this slate.";
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
  const why = lineupStarted(men, ctx) ? FROZEN : swapOutRefusal(out, ctx);
  if (why) return { out, k, slot, options: [], why };
  if (men.some((p) => !p || p.stale)) return { out, k, slot, options: [], why: "A man in this lineup is no longer on this slate." };
  const inLineup = new Set(ids);
  const room = SALARY_CAP - men.reduce((t, m, j) => t + (j === k || !Number.isInteger(m.salary) ? 0 : m.salary), 0); // what the slot may cost
  const options = [];
  for (const p of ctx.players) {
    if (inLineup.has(p.dk_id) || ctx.excludedIds.has(p.dk_id) || ctx.lockedIds.has(p.dk_id) || ctx.started.has(p.dk_id) || ctx.untimed?.has(p.dk_id) || isOut(p)) continue; // an unreadable tip fails closed
    if (typeof p.projection !== "number" || !Number.isInteger(p.salary)) continue;
    const next = men.map((m, j) => (j === k ? p : m));
    if (!checkLineup(next).ok) continue;
    options.push({ p, diff: typeof out.projection === "number" ? p.projection - out.projection : null, left: SALARY_CAP - next.reduce((t, m) => t + m.salary, 0) });
  }
  options.sort((a, b) => b.p.projection - a.p.projection || String(a.p.name).localeCompare(String(b.p.name)));
  return { out, k, slot, room, men, options: options.slice(0, limit), why: null };
}

/** The lineup's ids after a swap, in the seated order the options were checked in (so every man sits in a slot he can play);
 *  `o` is swapOptions' answer and `inId` one of its options. A new array. */
export const swapIds = (o, inId) => o.men.map((m, j) => (j === o.k ? inId : m.dk_id));

/** The swap button for a slot's control cell: disabled, with the reason, when the man cannot come out. `frozen`: a man of
 *  the lineup has started. */
export function swapButtonHtml(p, i, ctx, openId, frozen = false) {
  if (p === undefined) return "";
  if (p === null || p.stale) return "<span></span>";
  const why = frozen ? FROZEN : swapOutRefusal(p, ctx);
  const on = openId === p.dk_id;
  return `<button class="swb${on ? " on" : ""}" data-op="swap" data-k="${esc(i)}" data-id="${esc(p.dk_id)}"${why ? ` disabled title="Cannot swap ${esc(p.name)}: ${esc(why)}"` : ` title="Swap ${esc(p.name)} for one of the best replacements"`}>⇄</button>`;
}

const sgn = (v, dash) => (v == null ? dash("the man being swapped out has no projection") : `<b class="${v < 0 ? "neg" : "pos0"}">${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(1)}</b>`);

/** The panel under the slot: the options as rows with a Use button, or the plain "no legal replacement" line. */
export function swapPanelHtml(o, i, dash) {
  if (o.why) return `<div class="swp"><div class="swn">Cannot swap ${esc(o.out?.name ?? o.out?.dk_id ?? "this man")}: ${esc(o.why)}</div></div>`;
  const head = `<div class="swh">Swap <b>${esc(o.out.name)}</b> (${esc(o.slot)}): ${o.options.length ? `${o.options.length} best` : "none"} at ${money(o.room)} or less<span>Left = salary left after</span></div>`;
  if (!o.options.length) return `<div class="swp">${head}<div class="swn">No legal replacement for ${esc(o.out.name)}: nobody who fits the ${esc(o.slot)} slot, is not already in the lineup, not excluded, not Out, not started and keeps the lineup under ${money(SALARY_CAP)}.</div></div>`;
  const rows = o.options.map(({ p, diff, left }) => `<tr><td class="swl">${esc(p.name)} <span class="pos">${esc((p.positions ?? []).join("/"))}</span> <small>${esc(p.team)}</small></td>`
    + `<td>${money(p.salary)}</td><td class="swpj">${dec1(p.projection)}</td><td>${sgn(diff, dash)}</td>`
    + `<td>${typeof p.value === "number" ? p.value.toFixed(2) : dash("no value in this pull")}</td>`
    + `<td class="swo">${typeof p.proj_own === "number" ? p.proj_own.toFixed(1) + "%" : dash("no projected ownership in this pull")}</td>`
    + `<td>${money(left)}</td><td><button class="xf" data-op="swapuse" data-k="${esc(i)}" data-in="${esc(p.dk_id)}" title="Put ${esc(p.name)} in this lineup">Use</button></td></tr>`).join("");
  return `<div class="swp">${head}<table class="swt"><thead><tr><th class="swl">Player</th><th>Sal</th><th>Proj</th><th>Diff</th><th>Val</th><th>Own</th><th>Left</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
