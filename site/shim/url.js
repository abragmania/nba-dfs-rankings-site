// node:url for the app's own code on the public site. server.js works out two paths from these at import time; neither is ever read.
export const fileURLToPath = (u) => new URL(u).pathname;
export const pathToFileURL = (p) => new URL(`file://${p}`);
