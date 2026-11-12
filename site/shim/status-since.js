// The browser's stand-in for server/slate/status-since.js: the raw pulls are never published, so each man's "TwoGun status last changed" time was worked out at publish time (site-src/bake.mjs) and is laid on the slate
// by shim/pull-moves.js. withStatusSince therefore returns the slate as it is.
export const withStatusSince = (slate, input) => input;
