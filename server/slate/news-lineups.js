// The lineup read of a slate (news/lineups/latest.json, written by tools/lineups_read.mjs) for the board's proposals bar. Pure file access under the
// data root. On the public site the shim's fs serves the copy baked at publish (site-src/bake.mjs, slates/<slate>/lineups-latest.json).
import fs from "../../site/shim/fs.js";
import path from "../../site/shim/path.js";
import { dataRoot } from "./store.js";
import { readLook } from "./lineup-look.js";

/** { state: "ok", latest } , { state: "missing" } when this slate has no read yet, or { state: "unreadable", why } for a damaged file (never an empty answer). */
export function readNewsLineups(slate, { look: withLook = true } = {}) {
  const file = path.join(dataRoot(), "slates", slate, "news", "lineups", "latest.json");
  if (!fs.existsSync(file)) return { state: "missing" };
  try {
    const latest = JSON.parse(fs.readFileSync(file, "utf8"));
    if (latest === null || typeof latest !== "object" || latest.teams === null || typeof latest.teams !== "object" || Array.isArray(latest.teams)) return { state: "unreadable", why: "latest.json has no teams" };
    // The 5-minute lineup check's own finds file rides along as latest.found_by_check (server/pullnow/lineup-sync.js owns it), so a pull rewriting latest.json never loses them; a damaged file is said, not hidden (G62).
    try {
      const f = JSON.parse(fs.readFileSync(path.join(dataRoot(), "slates", slate, "lineup-finds.json"), "utf8"));
      if (Array.isArray(f?.finds)) { latest.found_by_check = f.finds; if (f.last_check) latest.last_check = f.last_check; } else latest.found_unreadable = "lineup-finds.json has no finds list";
    } catch (e) { if (e.code !== "ENOENT") latest.found_unreadable = `lineup-finds.json could not be read (${e.name})`; }
    const look = withLook ? readLook(slate, dataRoot()) : {};
    if (Object.keys(look).length || latest.look === undefined) latest.look = look; // the site has no cache file: the look baked into the copy stands
    // the last look at each page (cache, git-ignored): a source is fresh by the later of its read and its look (lineup-proposals.js freshnessOf)
    return { state: "ok", latest };
  } catch (e) {
    return { state: "unreadable", why: `latest.json could not be read (${e.name})` };
  }
}
