// Changed since the last pull: the banner, its chip, and the tag and line a moved man's row wears. Pure strings from the slate route's
// pull_changes and each man's pull_move (server/slate/pull-moves.js), tested in node; board.js owns the state and the events.
import { esc } from "./board-util.js";
import { lastName } from "./console-model.js";
import { pullTime } from "./console-render.js";

const LIST_UP = 3, LIST_DOWN = 3, LIST_OUT = 5;
const signed = (v, digits) => `${v > 0 ? "+" : "-"}${Math.abs(v).toFixed(digits)}`;
const diff = (m) => m.to - m.from;

/** The slot beside a figure, on every row, and in it the tag with both of TwoGun's figures on hover; empty when that figure did not move. `signed`: a plain signed
 *  figure, for a cell whose own arrow already says something else. */
export function moveTag(m, digits, what, { signed: plain = false } = {}) {
  if (!m) return `<span class="tagslot"></span>`;
  const d = diff(m), text = plain ? signed(d, digits) : `${d > 0 ? "▲" : "▼"}${Math.abs(d).toFixed(digits)}`;
  return `<span class="tagslot"><span class="dtag ${d > 0 ? "up" : "dn"}" title="${esc(`${what} moved ${m.from.toFixed(digits)} to ${m.to.toFixed(digits)} between the last two pulls`)}">${text}</span></span>`;
}

/** The row's second line: what moved, each figure that did, then a new status. */
export function moveLine(pm) {
  const parts = [pm.proj && `${signed(diff(pm.proj), 1)} proj`, pm.min && `${signed(diff(pm.min), 1)} min`, pm.rate && `${signed(diff(pm.rate), 2)} DK/m`].filter(Boolean);
  return [parts.length ? `<b>${parts.join(", ")}</b>` : "", pm.status ? `now ${esc(pm.status)}` : "", pm.figure_gone ? esc(pm.figure_gone) : ""].filter(Boolean).join(" · ");
}

const named = (list, digits) => list.map(({ p }) => `${esc(lastName(p.name))} ${signed(diff(p.pull_move.proj), digits)}`).join(", ");

/** The banner, or "" when there is nothing to say or he has dismissed this pull's. `filterOn`: the rows are showing only these men. */
export function pullNoteHtml(ch, players, { dismissed = null, filterOn = false } = {}) {
  if (ch?.state !== "ready" || dismissed === ch.pull) return "";
  const moved = players.filter((p) => p.pull_move);
  if (!moved.length && !ch.now_out.length && !ch.gone.length && !ch.unread_newer.length) return "";
  const byProj = moved.filter((p) => p.pull_move.proj).map((p) => ({ p, d: diff(p.pull_move.proj) }));
  const ups = byProj.filter((x) => x.d > 0).sort((a, b) => b.d - a.d).slice(0, LIST_UP);
  const downs = byProj.filter((x) => x.d < 0).sort((a, b) => a.d - b.d).slice(0, LIST_DOWN);
  const lists = [ups.length ? `${named(ups, 1)} up` : "", downs.length ? `${named(downs, 1)} down` : ""].filter(Boolean).join("; ");
  const more = moved.length - ups.length - downs.length;
  const namesOf = (head, names) => (names.length ? ` <span title="${esc(names.join(", "))}">${head}: ${names.slice(0, LIST_OUT).map((n) => esc(lastName(n))).join(", ")}${names.length > LIST_OUT ? ` and ${names.length - LIST_OUT} more` : ""}.</span>` : "");
  const out = namesOf("Now out", ch.now_out) + namesOf("Gone from this pull", ch.gone);
  const behind = ch.board_behind ? ` The board still shows the ${esc(pullTime(ch.board_behind))} pull.` : "";
  const unread = ch.unread_newer.length ? ` The ${ch.unread_newer.map((s) => esc(pullTime(s))).join(", ")} pull could not be compared.` : "";
  return `<span><b>The ${esc(pullTime(ch.pull))} pull moved ${moved.length} ${moved.length === 1 ? "man" : "men"}</b> since the ${esc(pullTime(ch.prev))} pull${lists ? `: ${lists}${more > 0 ? `, ${more} more` : ""}` : ""}.${out}${behind}${unread}</span><span class="grow"></span>${moved.length ? `<button data-chip="changed">${filterOn ? "Show everyone" : "Show only these"}</button>` : ""}<button id="pullDismiss">Dismiss</button>`;
}

/** The filter chip: live with men to show; greyed with why on hover when there is no comparison or nobody moved. */
export function pullChipHtml(ch, players, on) {
  if (ch?.state !== "ready") return `<button class="chip movedchip zero" disabled title="${esc(ch?.why ?? "No pull comparison on this slate.")}">Changed since last pull</button>`;
  const n = players.filter((p) => p.pull_move).length, since = esc(pullTime(ch.prev));
  if (!n) return `<button class="chip movedchip zero" disabled title="${esc(`No man on the board moved between the ${pullTime(ch.prev)} and ${pullTime(ch.pull)} pulls.`)}">Changed since ${since} <b>0</b></button>`;
  return `<button data-chip="changed" class="chip movedchip${on ? " on" : ""}" title="${on ? "Show everyone again" : `Show only the men the ${esc(pullTime(ch.pull))} pull moved`}">Changed since ${since} <b>${n}</b></button>`;
}
