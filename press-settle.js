// A redraw while a press is under way removes what the press is about to click. settle(fn) runs fn at once when no press is under
// way, else just after the press and its click have ended. Used where closing a box by a press saves and would redraw.

/** A settle bound to a document's presses. With no page (node) it runs at once. */
export function pressSettle(doc = globalThis.document) {
  if (!doc?.addEventListener) return Object.assign((fn) => fn(), { pressing: () => false });
  let pressing = false, afterPress = [];
  doc.addEventListener("pointerdown", () => { pressing = true; }, true);
  const released = () => {
    pressing = false;
    const run = afterPress;
    afterPress = [];
    if (run.length) setTimeout(() => run.forEach((fn) => fn()), 50);
  };
  doc.addEventListener("pointerup", released, true);
  doc.addEventListener("pointercancel", released, true);
  return Object.assign((fn) => { if (pressing) afterPress.push(fn); else fn(); }, { pressing: () => pressing });
}
