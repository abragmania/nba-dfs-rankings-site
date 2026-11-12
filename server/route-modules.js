// The lazily imported route modules: the key -> file map, routeModule(key), and loadRouteModules, the startup check (rules repo R6).
/** Loaded once at startup by loadRouteModules; after that a request uses
 *  the copy loaded then, so an edit on disk reaches the running app only with a restart. Tests that build a server without
 *  the startup load fall back to a plain import on first use. */
// The site build does not shim these; static-api.js and site-pull.js answer these routes on the site. The worker and cycle child read code from disk, which is safe because the live app runs from a clean copy nobody edits.
// newsApply has no route of its own: Pull now imports it lazily (pullnow/route.js), and loading it here puts it in the module cache.
const ROUTE_FILES = { usage: "usage/route.js", pullnow: "pullnow/route.js", newsApply: "slate/news-apply.js" };
export const routeMods = {};
export function routeModule(key) {
  return routeMods[key] ? Promise.resolve(routeMods[key]) : import(`./${ROUTE_FILES[key]}`);
}

/** Imports every lazily loaded route module before the server listens. Returns { ok: true, mods } (key -> module; the caller
 *  keeps it, so a test's own map never leaks into routeMods) or { ok: false, file, message, stack } for the first file that
 *  would not load. `files` is the key -> relative path map. */
export async function loadRouteModules(files = ROUTE_FILES, base = import.meta.url) {
  const mods = {};
  for (const [key, rel] of Object.entries(files)) {
    try {
      mods[key] = await import(new URL(rel, base).href);
    } catch (e) {
      return { ok: false, file: `server/${rel}`, message: e?.message ?? String(e), stack: String(e?.stack ?? "").split("\n").slice(0, 5).join("\n") };
    }
  }
  return { ok: true, mods };
}

