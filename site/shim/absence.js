// The browser's stand-in for server/boxes/absence.js: the stored box scores are not on the site, so each injured man's missed games were counted at publish time (site-src/bake.mjs) and are laid on the slate
// by shim/pull-moves.js. withAbsence therefore returns the slate as it is.
export const withAbsence = (slate, input) => input;
