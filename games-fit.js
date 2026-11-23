// The games strip's columns, moved out of board.js unchanged (file split, 11-20).
import { remScale } from "./board-util.js";

/** The game boxes fill the strip's full width: one row when every game fits at the box floor, else two rows with row 1 filled first (Adam 7:21 PM 11-18).
 *  Never a third row. GAME_MIN_REM is a box's content at its narrowest (tip, O/U, logo, code, spread, implied points), measured in the browser
 *  with the game CSS (board.css .game, .side): nothing cut at that width. GAP_REM is the strip's gap (board.css .games). */
const GAME_MIN_REM = 12.27, GAME_MAX_REM = 14.75, GAP_REM = 0.5;
export function fitGameStrip(el) {
  const n = el.children.length;
  if (!n || !el.clientWidth) return;
  const px = remScale() * 16; // one rem in px at this root size
  const cap = Math.max(1, Math.floor((el.clientWidth + GAP_REM * px) / (GAME_MIN_REM * px + GAP_REM * px))); // most boxes one row holds at the floor
  const cols = n <= cap ? n : n <= 2 * cap ? cap : Math.ceil(n / 2); // row 1 filled first; past 2 rows the boxes would need to be narrower
  el.style.gridTemplateColumns = `repeat(${cols}, minmax(${GAME_MIN_REM}rem, ${GAME_MAX_REM}rem))`; // never stretched past GAME_MAX_REM on a small slate (Adam 4:35 PM 11-19)
}
