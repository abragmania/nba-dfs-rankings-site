// The page's look (optimizer standard D11): a Dark or Light switch, with Black and Navy as the dark choices. Remembered in the
// browser, a per-viewer convenience: a remembered Light keeps which dark it goes back to. Unreadable or blocked storage gives
// Black. Pure apart from the storage call handed in; tested in node.
import { esc } from "./board-util.js";

const DARKS = ["black", "navy"];

/** The two stored texts to { light, dark }. An older page stored "black" or "navy" under the first key, which still reads. */
export function readTheme(stored, storedDark) {
  const dark = DARKS.includes(stored) ? stored : DARKS.includes(storedDark) ? storedDark : "black";
  return { light: stored === "light", dark };
}

export const loadTheme = (tryStore) => readTheme(tryStore(() => localStorage.getItem("nbaboard.theme")), tryStore(() => localStorage.getItem("nbaboard.theme.dark")));

export function saveTheme(tryStore, t) {
  tryStore(() => localStorage.setItem("nbaboard.theme", t.light ? "light" : t.dark));
  tryStore(() => localStorage.setItem("nbaboard.theme.dark", t.dark));
}

/** The body's classes for a theme. */
export const themeClasses = (t) => ({ light: t.light, navy: !t.light && t.dark === "navy" });

/** The switch in the header; Black and Navy show only in dark, as they are its choices. */
export function themeHtml(t) {
  const btn = (attr, value, label, on) => `<button ${attr}="${esc(value)}" class="${on ? "on" : ""}">${esc(label)}</button>`;
  const seg = `<div class="themes">${btn("data-shade", "dark", "Dark", !t.light)}${btn("data-shade", "light", "Light", t.light)}</div>`;
  return t.light ? seg : `${seg}<div class="themes">${DARKS.map((d) => btn("data-theme", d, d[0].toUpperCase() + d.slice(1), t.dark === d)).join("")}</div>`;
}
