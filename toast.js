// The board's message toast: it sits beside the control just clicked (the row, slot or button), amber for a notice and red only for
// an error (kind "err"); with no clicked control on the page it sits at the bottom. It ends by itself after 4 seconds.
// Moved out of board.js unchanged (file split, 11-17); made once by the page.
import { remScale } from "./board-util.js";

export function createToast() {
  const $ = (id) => document.getElementById(id);
  let lastClick = null; // { el, rect, sel }: the clicked control, where it was, and a selector to find it again after a redraw
  document.addEventListener("click", (e) => {
    if (e.target.closest?.(".cfm")) return; // a confirm's answer: the message that follows belongs beside the control that asked
    const el = e.target.closest?.("tr[data-row], .slot, .lslot, .lr, button, .gorun") ?? null;
    if (!el) { lastClick = null; return; }
    const key = ["data-row", "data-lock", "data-op", "data-i", "data-id"].filter((k) => el.hasAttribute(k)).map((k) => `[${k}="${CSS.escape(el.getAttribute(k))}"]`).join("");
    lastClick = { el, rect: el.getBoundingClientRect(), sel: key ? `${el.tagName.toLowerCase()}${key}` : null };
  }, true);
  const toast = (msg, kind = "notice") => {
    const t = $("toast");
    t.textContent = msg; t.className = `toast${kind === "err" ? " err" : ""}`; t.style.cssText = ""; t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 4000);
    if (document.body.classList.contains("lineups-on")) return; // on the Lineups tab a message sits at the bottom, over no switch, filter or button
    const z = parseFloat(getComputedStyle(document.body).zoom) || 1; // 1 now that the page has no zoom; kept so rects stay in screen pixels if one returns
    const s = remScale(), W = window.innerWidth / z, H = window.innerHeight / z; // G71: the offsets below are design px, times s
    const live = lastClick && (lastClick.el.isConnected ? lastClick.el : lastClick.sel ? document.querySelector(lastClick.sel) : null);
    const r = live ? live.getBoundingClientRect() : lastClick?.rect;
    if (!r || !r.width || r.bottom < 0 || r.top > window.innerHeight) return; // no control on screen: the bottom position
    const a = { left: r.left / z, top: r.top / z, bottom: r.bottom / z };
    const h = t.offsetHeight, w = Math.min(t.offsetWidth, W - 24);
    const top = a.bottom + 4 * s + h > H - 8 * s ? Math.max(8 * s, a.top - h - 4 * s) : a.bottom + 4 * s;
    t.style.cssText = `left:${Math.max(12 * s, Math.min(a.left + 16 * s, W - w - 12 * s))}px;top:${top}px;bottom:auto;transform:none`;
  };
  return toast;
}
