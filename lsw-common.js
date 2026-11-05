// The Late swap screen's shared drawing helpers (entries late swap). Pure strings; every figure comes from the server's model, a missing one
// is an em dash with a title, never zero. Times show in Eastern.
import { esc, logo, shortTime } from "./board-util.js";
import { teamColors } from "./teams.js";
import { gameStacks } from "./corr.js";

export { esc };
export const money = (n) => (Number.isFinite(n) ? `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US")}` : "—");
export const f1 = (n) => (Number.isFinite(n) ? n.toFixed(1) : "—");
export const signed = (n, fmt) => (Number.isFinite(n) ? `${n > 0 ? "+" : n < 0 ? "-" : ""}${fmt(Math.abs(n))}` : "—");
export const tint = (team) => teamColors(team).t1;
export const feeText = (n) => (Number.isFinite(n) ? `$${Number.isInteger(n) ? n : n.toFixed(2)}` : "—");

const LOCK = '<svg class="lkic" viewBox="0 0 12 14" width="11" height="13"><rect x="1" y="6" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M3.5 6V4a2.5 2.5 0 015 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
export const ICON_LOCK = LOCK;

/** A spot's colour by its place in the list: Cash green, then amber, violet, pink, blue, orange, repeating. */
const SPOT_PALETTE = ["#39e58c", "#ffb000", "#c78bff", "#ff6fa8", "#6aa8ff", "#ff8a1f", "#3fe0d0", "#9bd14b"];
export function spotColour(name, spots) {
  const i = spots.findIndex((s) => s.name === name);
  return SPOT_PALETTE[(i < 0 ? 0 : i) % SPOT_PALETTE.length];
}

/** The tip text of a man: "started" with a lock, "tips 7:30 PM ET", or why it cannot be read. */
export function tipHtml(man, refMs) {
  if (!man || man.missing) return '<span class="tp dim" title="not on the slate">not on slate</span>';
  if (man.gone) return `<span class="tp" title="no longer on the newest pull">${LOCK} off board</span>`;
  if (man.started) return `<span class="tp stl">${LOCK} started</span>`;
  if (man.untimed) return '<span class="tp un" title="his tip time is unreadable, so his game may have started">tip unreadable</span>';
  const t = shortTime(man.tip, refMs);
  return `<span class="tp">tips ${esc(t ?? "—")}</span>`;
}

/** A game chip, "PHI@DET", in the game's own colour (one colour per game by order on the slate). */
const GAME_COLOURS = ["#ff8a1f", "#6aa8ff", "#39e58c", "#c78bff", "#ff6fa8", "#ffd23f", "#3fe0d0", "#ff7a5c", "#9bd14b", "#8aa0ff", "#e5a0ff"];
export const gameColour = (game, games) => GAME_COLOURS[Math.max(0, games.findIndex((g) => g.game === game)) % GAME_COLOURS.length];
export function gameChip(man, games) {
  if (!man?.game) return '<span class="gm dim">—</span>';
  const c = gameColour(man.game, games);
  return `<span class="gm" style="color:${c};border-color:${c}77;background:${c}14">${esc(man.game.replace("@", "@"))}</span>`;
}

/** CORR chips of a lineup: Map dk_id -> { n, colour } (corr.js). */
export const stacksOf = (spot) => (spot.mode === "Cash" ? new Map() : gameStacks(spot.slots.map((s) => s.man).filter(Boolean))); // nothing GPP-specific on Cash: no CORR chips there
export const corrChip = (st) => (st ? `<span class="corr" style="color:${st.colour};border-color:${st.colour}88;background:${st.colour}18" title="Game stack: this lineup holds men from both teams of this game">CORR</span>` : "");

/** A man who is Out or gone from the board and has not started (the engine's own test, outAlert): his own row wears a red OUT chip. */
export const isOutMan = (m) => Boolean(m && !m.started && !m.untimed && (m.out || m.gone));
export const outChip = (m) => (isOutMan(m) ? `<i class="outchip" title="${m.gone ? "Gone from the board" : "Ruled Out"}">OUT</i>` : "");

/** The name of a man with his logo and, when he is Out, his red OUT chip. */
export const manLabel = (man) => (man ? `${man.team ? logo(man.team, "sm") : ""}<span class="mn">${esc(man.name)}</span>${outChip(man)}` : '<span class="mn dim">open</span>');

/** The Eastern tip time without its AM/PM and zone, for a game chip: "7:30". */
export const chipTime = (tip, refMs) => (shortTime(tip, refMs) ?? "").replace(/\s?[AP]M ET$/, "");

/** A banner line for an outcome of an action: { spot, status, reason, amber, notes, duplicate }. */
export function outcomeLine(o) {
  const dup = o.duplicate ? ` <b class="dup">${esc(o.duplicate.text)}</b> (matches ${esc(o.duplicate.matchedSpot)})` : "";
  const out = o.alert && o.status !== "confirm" ? ` <b class="dup">${esc(o.alert.text)}</b>` : ""; // a confirm already says it in its reason
  const tag = o.status === "confirm" ? "waiting for your say-so" : o.status === "changed" ? `${o.moves.length} slot${o.moves.length === 1 ? "" : "s"} changed` : o.status === "flagged" ? "left as it was" : "no change";
  const why = o.reason ? ` — ${esc(tidyReasons(o.reason))}` : "";
  return `<li class="o-${o.amber ? "amber" : o.status}"><b>${esc(o.spot)}</b>: ${tag}${why}${dup}${out}${o.notes.map((n) => `<em>${esc(n)}</em>`).join("")}</li>`;
}

/**
 * What the page does with an answer, given the newest server revision it has drawn. A read older than that is thrown away. An action's
 * answer is never thrown away: what it says (outcomes, refusals, go-aheads) belongs on screen even when a later read has already been drawn;
 * only its model is skipped when it is older than the one on show. Returns { use, takeModel, applied }.
 */
export function replyVerdict(applied, rev, isAction) {
  if (!Number.isFinite(rev)) return { use: true, takeModel: true, applied };
  const older = rev < applied;
  if (older && !isAction) return { use: false, takeModel: false, applied };
  return { use: true, takeModel: !older, applied: Math.max(applied, rev) };
}

/** The engine's reasons say the same thing once per entry ("... in entry 5324761853: his game has started. ... in entry 5324761850 ..."). The
 *  screen says each once and counts the entries: "(8 entries)". Sentences that name no entry pass through unchanged. */
export function tidyReasons(text) {
  const parts = String(text ?? "").split(/(?<=\.)\s+/).filter(Boolean), seen = new Map();
  for (const p of parts) { const key = p.replace(/ in entry \d+/g, ""); seen.set(key, (seen.get(key) ?? 0) + (/ in entry \d+/.test(p) ? 1 : 0)); }
  return [...seen].map(([k, n]) => (n > 1 ? `${k.replace(/\.$/, "")} (${n} entries).` : k)).join(" ");
}

/** The red flag for a spot that holds a man who is Out or off the board: his name and why. Empty when it holds none. */
export function outFlag(spot) {
  const men = spot.alert?.men ?? [];
  const gone = new Set(spot.confirmedOut ?? []);
  return men.length ? `<div class="redflag">${men.map((m) => `<b>${esc(m.name)}</b> ${m.why === "Out" ? "is Out" : "is gone from the board"}${gone.has(m.dk_id) ? " (you went ahead with him)" : ` <button class="lnk" data-lsw="confirmMan" data-spot="${esc(spot.name)}" data-man="${esc(m.dk_id)}" title="Let his entries be written with him in them">Go ahead with him</button>`}`).join("; ")}: this spot holds ${men.length === 1 ? "him" : "them"}.</div>` : "";
}
