// The thumbs pair in the board's thumbs column and the Proj figure (Adam, 5:20 PM ET 2026-10-29: "bring all the functionality from that over").
// Ported from NFLDFSRankings public/js/bump-control.js at 7e49266 (Adam 2026-10-22 there: one filled thumb per step,
// green up and red down; presses stack 5% a step from -10 to +10; the opposite thumb clears the adjustment to 0), adapted
// to this board's player shape (dk_id, projection, base.projection, ovr.steps): a bump moves the projection and nothing
// else (optimizer standard A21). The browser sends only the new step count (POST .../overrides {bump: {id: steps}}, 0 sent
// as null) and redraws from the players the server answers. On a man with a typed projection the thumbs raise and lower
// the typed number (Adam, 5:41 PM ET 2026-10-29), as the NFL app does. This file is the one copy of the pair's and the
// Proj figure's markup and of the press; the limits come from override-limits.js, shared with the server.
import { esc, dec1, hisProj } from "./board-util.js";
import { BUMP_STEP_PCT, BUMP_MAX_STEPS } from "./override-limits.js";

export { BUMP_STEP_PCT, BUMP_MAX_STEPS };
const MINUS = "−"; // a real minus sign, never a hyphen
const THUMB_PATH = "M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"; // Material thumb_up, 24x24
const THUMB_SVG = `<svg class="thumb" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${THUMB_PATH}"/></svg>`;

/** The player's bump in steps: p.ovr.steps, 0 when he has none. */
export function bumpStepsOf(p) {
  const n = Number(p?.ovr?.steps ?? 0);
  return Number.isInteger(n) ? n : 0;
}

/** True when the player has a typed projection of his own (the thumbs then scale it; the figure wears the typed marker). A number a send wrote from news or the engine is a plain figure (board-util.js hisProj). */
export const hasTypedProj = (p) => hisProj(p);

/** The steps one press leaves: one more in the same direction; the opposite thumb clears to 0; kept within -10..10. */
export function nextBumpSteps(current, dir) {
  if ((current > 0 && dir < 0) || (current < 0 && dir > 0)) return 0;
  return Math.max(-BUMP_MAX_STEPS, Math.min(BUMP_MAX_STEPS, current + (dir > 0 ? 1 : -1)));
}

/** "+10%", "−5%" (U+2212); "" at 0. */
export function bumpPctText(steps) {
  if (!steps) return "";
  return `${steps > 0 ? "+" : MINUS}${Math.abs(steps) * BUMP_STEP_PCT}%`;
}

/** The POST body of one press: 0 steps is sent as null, which removes the bump. */
export function bumpPatch(id, steps) {
  return { bump: { [String(id)]: steps || null } };
}

/**
 * The thumbs inside one button: `count` filled thumbs when that side is on, otherwise one outline thumb. Several fan out
 * `fan` px apart (6px for two or three, then 12px shared among the gaps), so they never span more than 25px and the
 * .bump-ctl slot (sized for the widest pair) never shifts the column.
 */
function thumbsHtml(count) {
  const n = Math.max(1, count);
  const fan = n <= 1 ? 0 : n <= 3 ? 6 : 12 / (n - 1);
  return { svgs: THUMB_SVG.repeat(n), style: n <= 1 ? "" : ` style="--fan:${Math.floor(fan * 100) / 100}px"` };
}

/**
 * The pair: a thumbs-down and a thumbs-up button, each showing one filled thumb per step on its side and one outline thumb
 * when its side is off. Both are disabled when `enabled` is false or the man has no projection (nothing to move), and
 * each at its own limit. A typed projection keeps them live: they scale the typed number.
 */
export function bumpControlHtml(p, { enabled = true } = {}) {
  const id = esc(String(p?.dk_id ?? ""));
  const name = esc(p?.name ?? "this player");
  const steps = bumpStepsOf(p);
  const live = enabled && typeof p?.projection === "number";
  const off = (atLimit) => (!live || atLimit ? " disabled" : "");
  const side = (count) => ({ cls: count > 0 ? " is-on" : "", count: Math.max(1, count), ...thumbsHtml(count) });
  const down = side(steps < 0 ? -steps : 0);
  const up = side(steps > 0 ? steps : 0);
  const clearTitle = `Clear the ${bumpPctText(steps)} adjustment`;
  const clearLabel = `Clear ${name}'s adjustment`;
  const downTitle = steps > 0 ? clearTitle : `${MINUS}${BUMP_STEP_PCT}% a press${steps < 0 ? ` · now ${bumpPctText(steps)}` : ""}`;
  const upTitle = steps < 0 ? clearTitle : `+${BUMP_STEP_PCT}% a press${steps > 0 ? ` · now ${bumpPctText(steps)}` : ""}`;
  const downLabel = steps > 0 ? clearLabel : `Lower ${name}'s projection ${BUMP_STEP_PCT}%`;
  const upLabel = steps < 0 ? clearLabel : `Raise ${name}'s projection ${BUMP_STEP_PCT}%`;
  const btn = (dir, s, label, title, atLimit) =>
    `<button type="button" class="bump-btn${s.cls}" data-action="bump-${dir}" data-id="${id}" data-count="${s.count}"${s.style} aria-label="${label}" title="${esc(title)}"${off(atLimit)}>${s.svgs}</button>`;
  return `<span class="bump-ctl">${btn("down", down, downLabel, downTitle, steps <= -BUMP_MAX_STEPS)}${btn("up", up, upLabel, upTitle, steps >= BUMP_MAX_STEPS)}</span>`;
}

/**
 * The Proj figure's span: plain; bumped (.bump-up / .bump-down, hover "Base 40.8 → 42.8 (+5%)"); typed (.bump-typed, the
 * board's marker for Adam's own number, hover with the base); or typed and bumped (both, hover "Typed 30.0 → 31.5 (+5%)"
 * then the base). It carries data-edit so a click opens the editor. `also` follows on the hover (why the row is greyed).
 */
export function bumpFigureHtml(p, text, also = "") {
  const steps = bumpStepsOf(p);
  const id = esc(String(p?.dk_id ?? ""));
  const typed = hasTypedProj(p), base = dec1(p?.base?.projection) ?? "—";
  let cls = "bump-fig", title = "Click to type your own projection";
  if (steps) cls += steps > 0 ? " bump-up" : " bump-down";
  if (typed) {
    cls += " bump-typed";
    title = steps
      ? `Typed ${dec1(p.ovr.projection) ?? "—"} → ${dec1(p?.projection) ?? "—"} (${bumpPctText(steps)}); base ${base}. Click to change the typed number, or reset the row`
      : `Your number. Base ${base}; click to change it, or reset the row`;
  } else if (steps) {
    const from = p?.auto?.proj ? dec1(p?.ovr?.projection) ?? base : base; // under a news or engine number the bump scales that number
    title = `Base ${from} → ${dec1(p?.projection) ?? "—"} (${bumpPctText(steps)})`;
  }
  return `<span class="${cls}" data-edit="proj" data-id="${id}" title="${esc(also ? `${title} · ${also}` : title)}">${text}</span>`;
}

const inFlight = new Set(); // ids whose bump request is out: a press for one of them is ignored until it is answered

/** Test hook: the ids whose request is out. */
export function bumpsInFlight() {
  return new Set(inFlight);
}

/**
 * One press, sent through `onBump(id, stepsAt)` (a promise: truthy when the server took it, which redraws the rows; falsy
 * when refused). `stepsAt()` works the new steps out from the player as the board holds him when the request is actually
 * sent, not at the click, so a press queued behind a row reset still in flight counts from that reset's 0 (review round
 * 2). The press is dropped when the board's current steps leave nothing to do (at the limit). The pair is disabled from
 * the press on and put back, as his limits have it, only after a refusal or a failure; after a success it stays disabled
 * until the redraw replaces it, so a second press can never re-send the old steps.
 */
export async function bumpPress(btn, { rowOf, onBump }) {
  if (btn.disabled) return;
  const id = String(btn.dataset.id);
  if (inFlight.has(id)) return;
  const p = rowOf(id);
  if (!p || typeof onBump !== "function") return;
  const dir = btn.dataset.action === "bump-up" ? 1 : -1;
  const current = bumpStepsOf(p);
  if (nextBumpSteps(current, dir) === current) return;
  const stepsAt = () => nextBumpSteps(bumpStepsOf(rowOf(id)), dir);
  const buttons = [...(btn.closest?.(".bump-ctl")?.querySelectorAll?.(".bump-btn") ?? [btn])];
  for (const b of buttons) b.disabled = true;
  inFlight.add(id);
  let taken = false;
  try {
    taken = Boolean(await onBump(id, stepsAt));
  } catch (e) {
    console.error("The projection bump could not be sent:", e); // the caller's write shows its own message; this keeps the pair usable
  } finally {
    inFlight.delete(id);
    if (!taken) for (const b of buttons) b.disabled = b.dataset.action === "bump-up" ? current >= BUMP_MAX_STEPS : current <= -BUMP_MAX_STEPS;
  }
}

/** One click listener on a mount whose inside is redrawn by innerHTML: set once, it serves every redraw. */
export function delegateBumpClicks(root, opts) {
  root?.addEventListener?.("click", (e) => {
    const btn = e.target?.closest?.(".bump-ctl .bump-btn");
    if (btn && !btn.disabled) bumpPress(btn, opts);
  });
}
