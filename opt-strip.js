// The optimizer strip over the table while the player panel is docked (Layout A+C): the mode, the lineup count, Build, and a button that brings back the
// full optimizer column (the working lineup and the build settings). It holds no state of its own: it reads the hidden optimizer column's controls and
// clicks them, so Build and the mode switch are exactly the panel's own (panel.js), never a second path.
import { esc } from "./board-util.js";

/** The strip's markup from what the optimizer column shows now: { modes: [{ m, on }], count, label, busy }. Pure, tested. */
export function stripHtml({ modes, count, label, busy }) {
  const seg = modes.length ? `<span class="osseg">${modes.map((x) => `<button type="button" data-strip="mode" data-m="${esc(x.m)}" class="${x.on ? "on" : ""}">${esc(x.m)}</button>`).join("")}</span>` : "";
  const cnt = count === null ? `<span class="osmiss" title="the optimizer column has not drawn its count yet">Lineups —</span>` : `<span>Lineups <b>${esc(count)}</b></span>`;
  return `<b class="osh">OPTIMIZER</b>${seg}${cnt}<span class="osgrow"></span><button type="button" class="oslu" data-strip="lineup" title="Close the player panel and show the optimizer column with the working lineup and build settings">Working lineup and settings</button>`
    + `<button type="button" class="osgo" data-strip="build"${busy ? " disabled" : ""}>${esc(label || "Build lineups")}</button>`;
}

/** What the optimizer column (opt) shows: its mode buttons, the Lineups box, the Build button's label and whether a build is running. */
export function readOpt(opt) {
  const go = opt.querySelector('[data-op="build"]');
  return {
    modes: [...opt.querySelectorAll('.oh [data-op="mode"]')].map((b) => ({ m: b.dataset.m, on: b.classList.contains("on") })),
    count: opt.querySelector('[data-f="count"]')?.value.trim() || null, // an empty box is no count: the strip shows a dash
    label: go?.querySelector(".golabel")?.textContent ?? "",
    busy: Boolean(go?.disabled),
  };
}

/** Wires the strip into `el`. opt: the optimizer column; onWorking(): the working-lineup button (board.js closes the panel). Redraws when the column does. */
export function createOptStrip({ el, opt, onWorking }) {
  const draw = () => { el.innerHTML = stripHtml(readOpt(opt)); };
  new MutationObserver(draw).observe(opt, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "disabled", "value"] });
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-strip]");
    if (!b || b.disabled) return;
    if (b.dataset.strip === "build") opt.querySelector('[data-op="build"]')?.click();
    else if (b.dataset.strip === "mode") opt.querySelector(`.oh [data-op="mode"][data-m="${CSS.escape(b.dataset.m)}"]`)?.click();
    else if (b.dataset.strip === "lineup") onWorking();
  });
  draw();
  return { draw };
}
