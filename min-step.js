// The minus and plus buttons on every minutes figure Adam can adjust (Adam 8:19 PM 11-19): one copy, used by the player list's Min cell
// (player-table.js), the console's Min box (console-depth.js) and the player card's Min box (card-role.js). The figure is shown as the
// nearest whole minute (display only, the engine keeps its decimals); a press sends his typed-minutes edit with the shown whole number
// minus or plus one, never below 0 and never above the console's own ceiling. Pure strings and numbers, tested in node. Look: min-step.css.
import { PIN_MAX } from "./override-limits.js";
import { esc } from "./board-util.js";
import { isPending } from "./instant-pins.js";

/** The nearest whole minute as a number, or null when there is no figure. */
export const wholeMin = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
/** The nearest whole minute as the text shown, or null. */
export const wholeText = (v) => { const w = wholeMin(v); return w === null ? null : String(w); };

/** The value one press sends: the shown whole number moved by dir (-1 or +1), kept from 0 up to the console's ceiling. null when there is no figure to step from. */
export function stepMinutes(shown, dir) {
  const w = wholeMin(shown);
  return w === null ? null : Math.min(PIN_MAX.m, Math.max(0, w + (dir < 0 ? -1 : 1)));
}

/** One button. data-mstep is -1 or 1; data-id and data-team say whose minutes. */
export function stepButtonHtml(dir, id, team = "", off = false) {
  const down = dir < 0;
  return `<button class="msb" type="button" data-mstep="${down ? -1 : 1}" data-id="${esc(id)}" data-team="${esc(team)}" title="${down ? "One minute less" : "One minute more"}" aria-label="${down ? "One minute less" : "One minute more"}"${off ? " disabled" : ""}>${down ? "&minus;" : "+"}</button>`;
}

/** The figure (already drawn HTML) between its two buttons; "pend" while his number is shown before the server's answer (instant-pins.js; min-step.css dims it and his row's Proj and Value). */
export const stepHtml = (inner, id, team = "", off = false) => `<span class="mstep${isPending(id) ? " pend" : ""}">${stepButtonHtml(-1, id, team, off)}${inner}${stepButtonHtml(1, id, team, off)}</span>`;
