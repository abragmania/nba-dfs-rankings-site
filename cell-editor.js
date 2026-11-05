// The typed Proj and Own boxes and the note box on a player row (optimizer standard A3): click-away saves, Enter saves, Esc
// cancels, with the hint under the box. The rows redraw on every pick, save and answer from the server, so an open box is
// lifted out and put back around each redraw: the same element, with what was typed, its caret and its listeners. The box is
// laid over the figure, right-aligned to it, while the figure keeps its place hidden, so no column moves. The outcomes are
// pure and tested in node; the rest is tested on a stand-in page.
import { PROJ_MAX, OWN_MAX, NOTE_MAX, BUMP_STEP_PCT } from "./override-limits.js";
import { pressSettle } from "./press-settle.js";

export const HINT = "Enter saves, Esc cancels";
// Two decimals, the precision the slate and the server keep, so the box shows the stored number itself.
const hundredths = (x) => Math.round(x * 100) / 100;

/** What closing a number box does. An empty box or an unchanged number cancels; a number out of range is refused with its
 *  sentence. Unchanged is against the stored number at the server's hundredths: 40.8 over 40.76 saves. */
export function numberOutcome(text, { cur, max, what }) {
  const t = String(text).trim();
  if (t === "") return { act: "cancel" };
  const v = /^(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN;
  if (!(v >= 0 && v <= max)) return { act: "bad", msg: `${what} must be a number from 0 to ${max}.` };
  if (typeof cur === "number" && hundredths(v) === hundredths(cur)) return { act: "cancel" };
  return { act: "save", value: v };
}

/** What closing a note box does: unchanged cancels; an empty box removes the note (null). */
export function noteOutcome(text, old) {
  const t = String(text).trim();
  if (t === (old ?? "")) return { act: "cancel" };
  return { act: "save", value: t === "" ? null : t };
}

/** The number a Proj or Own box starts from: the typed one when there is one, else the slate's own, never the bumped one
 *  (a bump stays on top of whatever is typed). */
export function typedBase(p, kind) {
  return kind === "proj" ? p.ovr?.projection ?? p.base?.projection ?? p.projection : p.ovr?.proj_own ?? p.base?.proj_own ?? p.proj_own;
}

/**
 * The one editor at a time. deps: root (the table body), rowOf(id) (the player as the board holds him now), save(kind, id,
 * value) ("proj", "own", "note", "min" or "max"; a note's or a limit's null removes it), toast(msg, kind) for a click-away that
 * cannot save, limits: { current(kind, id), outcome(kind, id, text) } for the Min % and Max % boxes (row-limits.js).
 */
export function createEditors({ root, rowOf, save, toast, limits = null, onClosed = null }) {
  let ed = null, closedMark = null;
  const isLimit = (kind) => kind === "min" || kind === "max";
  // A press that closes a box only closes it: the row under it does not also take the man, and the note's own pencil does not
  // open it again. Pressing first clears the mark, and a blur from that press sets it.
  document.addEventListener("pointerdown", () => { closedMark = null; }, true);
  // A press that closes a limit's box must still click what is under it: a redraw before the click ends would remove its target.
  const settle = pressSettle(document);

  const anchor = (e) => root.querySelector(e.kind === "note" ? `[data-note="${CSS.escape(e.id)}"]` : `[data-edit="${e.kind}"][data-id="${CSS.escape(e.id)}"]`);

  /** Puts the box and its hint at the anchor of a fresh draw; false when the row is gone. */
  function mount(e) {
    const at = anchor(e);
    if (!at) return false;
    if (e.kind === "note") { at.parentElement.append(e.input, e.hint); return true; }
    const td = at.closest("td");
    // The wide-screen body zoom scales the rectangles but not these style lengths, so they are divided back by it.
    const sr = at.getBoundingClientRect(), tr = td.getBoundingClientRect(), z = td.offsetWidth ? tr.width / td.offsetWidth : 1;
    const mid = (sr.top - tr.top + sr.height / 2) / z, right = `${(tr.right - sr.right) / z}px`;
    e.input.style.right = right;
    e.input.style.top = `${mid}px`;
    e.hint.style.right = right;
    e.hint.style.top = `${mid + 14}px`;
    at.style.visibility = "hidden";
    td.append(e.input, e.hint);
    return true;
  }

  function close(e) {
    e.done = true;
    if (ed === e) ed = null;
    e.input.remove();
    e.hint.remove();
    const at = anchor(e);
    if (at && e.kind !== "note") at.style.visibility = "";
    onClosed?.();
    return at;
  }

  // Text as it opened is no change, whatever the board holds by now: a box opened while an earlier save of the same figure was
  // still out shows the older figure, and that must never be saved back over the newer one.
  const outcome = (e) => {
    const p = rowOf(e.id);
    if (!p || e.input.value === e.start) return { act: "cancel" };
    if (e.kind === "note") return noteOutcome(e.input.value, p.note);
    if (isLimit(e.kind)) return limits.outcome(e.kind, e.id, e.input.value);
    const proj = e.kind === "proj";
    return numberOutcome(e.input.value, { cur: typedBase(p, e.kind), max: proj ? PROJ_MAX : OWN_MAX, what: proj ? "Projection" : "Ownership" });
  };

  /** Enter: a bad number keeps the box open, marked, with the reason in the hint line. A note box hands the keyboard back to its button. */
  function enter(e) {
    const out = outcome(e);
    if (out.act === "bad") {
      e.input.classList.add("bad");
      e.hint.classList.add("bad");
      e.hint.textContent = out.msg;
      return;
    }
    const at = close(e);
    if (out.act === "save") save(e.kind, e.id, out.value);
    if (e.kind === "note") at?.focus({ preventScroll: true });
  }

  /** Click-away, or the row gone from under the box: there is nowhere left to correct a bad number, so it says why it did not save. */
  function leave(e, byBlur = false) {
    const out = outcome(e);
    close(e);
    if (out.act === "save" && byBlur && isLimit(e.kind)) save(e.kind, e.id, out.value, settle);
    else if (out.act === "save") save(e.kind, e.id, out.value);
    else if (out.act === "bad") toast(`Not saved. ${out.msg}`, "err");
  }

  function cancel(e) {
    const at = close(e);
    if (e.kind === "note") at?.focus({ preventScroll: true });
  }

  function open(kind, id, input) {
    if (ed) leave(ed);
    const hint = document.createElement("span");
    hint.className = `ed-hint${kind === "note" ? " nt" : ""}`;
    hint.textContent = HINT;
    const e = { kind, id, input, hint, start: input.value, done: false, moving: false };
    input.autocomplete = "off";
    input.addEventListener("input", () => {
      input.classList.remove("bad");
      hint.classList.remove("bad");
      hint.textContent = HINT;
    });
    input.addEventListener("keydown", (k) => {
      if (k.key !== "Escape" && k.key !== "Enter") return;
      k.preventDefault();
      k.stopPropagation(); // Esc on a box closes the box and nothing else
      if (k.key === "Enter") enter(e); else cancel(e);
    });
    input.addEventListener("blur", () => {
      // Lifted out for a redraw, closed already, or the whole window lost focus (the box is still the active one): stays open.
      if (e.done || e.moving || document.activeElement === input) return;
      closedMark = { kind, id };
      leave(e, true);
    });
    ed = e;
    if (!mount(e)) { close(e); return; }
    input.focus();
    input.select();
  }

  /** True when the press now ending has just closed this very box. */
  const justClosed = (kind, id) => closedMark?.kind === kind && closedMark.id === id;

  return {
    openNumber(span) {
      const id = span.dataset.id, kind = span.dataset.edit, p = rowOf(id);
      if (!p || !span.closest("td") || justClosed(kind, id)) return;
      const cur = isLimit(kind) ? limits.current(kind, id) : typedBase(p, kind);
      const input = document.createElement("input");
      input.className = isLimit(kind) ? "ov-in lim" : "ov-in";
      input.inputMode = "decimal";
      input.value = typeof cur === "number" ? String(hundredths(cur)) : "";
      const steps = kind === "proj" ? p.ovr?.steps ?? 0 : 0;
      input.title = `${HINT}${steps ? `. The ${steps > 0 ? "+" : "−"}${Math.abs(steps) * BUMP_STEP_PCT}% bump stays on top of the number you type` : ""}`;
      open(kind, id, input);
    },
    openNote(btn) {
      const id = btn.dataset.note, p = rowOf(id);
      if (!p || justClosed("note", id)) return;
      const input = document.createElement("input");
      input.className = "nt-in";
      input.maxLength = NOTE_MAX;
      input.value = p.note ?? "";
      input.placeholder = "Note";
      open("note", id, input);
    },
    /** Runs a redraw of the rows with the open box, if any, lifted out and put back as it was. */
    around(draw) {
      const e = ed;
      if (!e) { draw(); return; }
      const { selectionStart: a, selectionEnd: b } = e.input;
      e.moving = true;
      e.input.remove();
      e.hint.remove();
      draw();
      e.moving = false;
      if (!mount(e)) { leave(e); return; }
      e.input.focus({ preventScroll: true });
      e.input.setSelectionRange(a, b);
    },
    /** Closes the open box without saving (the slate on show is changing). */
    drop() { if (ed) close(ed); },
    /** The man whose box is open, or null. */
    openId: () => ed?.id ?? null,
    /** True when the press now ending closed a box. */
    closedByPress: () => closedMark != null,
  };
}
