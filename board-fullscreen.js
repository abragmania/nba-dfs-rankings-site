// Full screen (Player list header): hides the optimizer panel so the table takes the width. Remembered per viewer; under 900 px
// wide with nothing stored it starts on. Pin slots (late swap) needs the panel, so the button and the hiding step aside then.
// Moved out of board.js unchanged (file split, 11-17).
import { fullScreenPref } from "./panel.js";

const FS_KEY = "nbaboard.fullscreen";
/** Makes the button, draws it once, and returns apply(), which draws it again. */
export function createFullScreen({ panel, tryStore, stickyHeights, fixTableWidth }) {
  const $ = (id) => document.getElementById(id);
  let fullScreen = fullScreenPref(tryStore(() => localStorage.getItem(FS_KEY)), window.innerWidth);
  const fsBtn = document.createElement("button");
  fsBtn.className = "chip"; fsBtn.id = "fsBtn"; fsBtn.type = "button";
  $("colsBtn").closest(".colsw").before(fsBtn);
  function apply() {
    const on = fullScreen && !panel.lateSwap();
    document.body.classList.toggle("fs-list", on);
    fsBtn.hidden = Boolean(panel.lateSwap());
    fsBtn.textContent = fullScreen ? "Show optimizer" : "Full screen";
    fsBtn.setAttribute("aria-pressed", String(fullScreen));
    stickyHeights();
  }
  fsBtn.addEventListener("click", () => {
    fullScreen = !fullScreen;
    tryStore(() => localStorage.setItem(FS_KEY, fullScreen ? "1" : "0"));
    apply();
    fixTableWidth(); // the table's held width is the other layout's until measured again
  });
  apply();
  return apply;
}
