// The lineup read of a slate (news/lineups/latest.json, written by tools/lineups_read.mjs) for the board's proposals bar. Pure file access under the
// data root. On the public site the shim's fs serves the copy baked at publish (site-src/bake.mjs, slates/<slate>/lineups-latest.json).
import fs from "../../site/shim/fs.js";
import path from "../../site/shim/path.js";
import { dataRoot } from "./store.js";

/** { state: "ok", latest } , { state: "missing" } when this slate has no read yet, or { state: "unreadable", why } for a damaged file (never an empty answer). */
export function readNewsLineups(slate) {
  const file = path.join(dataRoot(), "slates", slate, "news", "lineups", "latest.json");
  if (!fs.existsSync(file)) return { state: "missing" };
  try {
    const latest = JSON.parse(fs.readFileSync(file, "utf8"));
    if (latest === null || typeof latest !== "object" || latest.teams === null || typeof latest.teams !== "object" || Array.isArray(latest.teams)) return { state: "unreadable", why: "latest.json has no teams" };
    return { state: "ok", latest };
  } catch (e) {
    return { state: "unreadable", why: `latest.json could not be read (${e.name})` };
  }
}
