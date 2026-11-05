// The one confirm (optimizer standard A6, A12, B13): a box shown in the page, so a redraw behind it changes nothing and it
// never blocks the page the way the browser's own does. Enter takes the focused button, Esc or a click outside cancels, and
// an Esc here never reaches anything else on the page (the player card closes on Esc too).

/** The standard's wordings. */
export const CONFIRM = {
  resetAll: "Clear every typed projection, typed ownership, bump and applied minutes? Stars and notes stay.",
  deleteSaved: "Delete this saved lineup?",
  clearLineup: "Clear the lineup?",
};

let dismiss = null; // answers the box on show, so a second ask never leaves two

/** Shows `text`; the promise answers true for the `ok` button, false for anything else. */
export function askConfirm(text, { ok = "OK" } = {}) {
  dismiss?.(false);
  return new Promise((resolve) => {
    const back = document.activeElement;
    const wrap = document.createElement("div");
    wrap.className = "cfm";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    const box = document.createElement("div");
    box.className = "cfm-box";
    const say = document.createElement("p");
    say.textContent = text;
    const no = document.createElement("button");
    no.className = "cfm-no";
    no.textContent = "Cancel";
    const yes = document.createElement("button");
    yes.className = "cfm-yes";
    yes.textContent = ok;
    const row = document.createElement("div");
    row.className = "cfm-btns";
    row.append(no, yes);
    box.append(say, row);
    wrap.append(box);
    const answer = (v) => {
      dismiss = null;
      document.removeEventListener("keydown", onKey, true);
      wrap.remove();
      if (back?.isConnected) back.focus({ preventScroll: true });
      resolve(v);
    };
    // On the way down, so nothing under the box acts on the key.
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); answer(false); return; }
      if (e.key === "Enter" && e.repeat) { e.preventDefault(); e.stopPropagation(); return; } // the Enter or held key that brought the box up is no answer
      if (e.key !== "Tab") return;
      e.preventDefault();
      (document.activeElement === yes ? no : yes).focus();
    };
    document.addEventListener("keydown", onKey, true);
    wrap.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.detail > 1) return; // the second click of a double-click that brought the box up is no answer
      if (e.target === yes) answer(true);
      else if (e.target === no || e.target === wrap) answer(false);
    });
    dismiss = answer;
    document.body.append(wrap);
    yes.focus();
  });
}
