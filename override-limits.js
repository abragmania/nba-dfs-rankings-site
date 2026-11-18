// The one copy of the override limits (Adam's overrides, 2026-10-29), shared by the server (server/slate/overrides.js
// checks every write against them) and the page (bump-control.js and board.js draw and check the same limits), as
// slots.js is shared. Pure constants; no imports.

/** A thumb press moves the projection 5% of the figure it scales (typed or base). */
export const BUMP_STEP_PCT = 5;
/** Presses stack from -10 to +10 steps (-50% to +50%). */
export const BUMP_MAX_STEPS = 10;
/** A typed projection is 0 to 200 DraftKings points. */
export const PROJ_MAX = 200;
/** A typed projected ownership is 0 to 100 percent. */
export const OWN_MAX = 100;
/** The console's pins: minutes, usage, DK points per minute and projection, each from 0 to this. */
export const PIN_MAX = { m: 48, u: 100, d: 9, p: PROJ_MAX };
/** A hand-out edit is a percent; a combination table's gain is at most a team's minutes. */
export const SHARE_MAX = 100;
export const COMBO_MAX = 240;
