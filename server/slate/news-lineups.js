// The lineup read of a slate (news/lineups/latest.json, written by tools/lineups_read.mjs) for the board's proposals bar. Pure file access under the
// data root. On the public site the shim's fs serves the copy baked at publish (site-src/bake.mjs, slates/<slate>/lineups-latest.json).
import fs from "../../site/shim/fs.js";
import path from "../../site/shim/path.js";
import { dataRoot } from "./store.js";
import { readLook } from "./lineup-look.js";
import { warn } from "../../site/shim/log.js";
import { withCardStatus } from "../board/news-claims.js";
import { readStatusSinceChecked } from "../../site/shim/status-since.js";
import { readOverrides, hisNumbers } from "./overrides.js";
import { readScenarios, heldTeams } from "./scenarios.js";
import { keyOf, outsOf } from "../board/console-engine.js";

/**
 * What the card-status step needs besides the read: the slate's men with TwoGun's status and when it last changed, and the men he typed a number on (a Doubtful card never zeroes them).
 * An unreadable part is left out, not guessed (the card then wins, as news-status.js says with no status time). `local` false (the site bake): only the committed slate file, no typed numbers.
 */
export function cardContext(slate, local) {
  const ctx = { players: [], typed: new Set(), problems: [] };
  const problem = (text, extra = {}) => { ctx.problems.push(text); warn(`card status: ${text}`, { slate, ...extra }); }; // G62: counted, logged and shown at the foot of the News tab
  try {
    const file = path.join(dataRoot(), "slates", slate, "slate.json");
    const players = JSON.parse(fs.readFileSync(file, "utf8")).players ?? [];
    const { since, problem: sinceProblem } = readStatusSinceChecked(slate); // the committed raw pulls on the app; the baked times on the site (shim)
    if (sinceProblem) problem(sinceProblem);
    ctx.players = players.map((p) => (since[String(p.dk_id)] != null ? { ...p, status_since: since[String(p.dk_id)] } : p));
  } catch (e) { if (e.code !== "ENOENT") problem(`the slate file could not be read (${e.name}), so cards are judged without TwoGun's status`); }
  if (local) {
    try {
      const o = readOverrides(slate), sent = new Set(o.auto?.min ?? []);
      ctx.typed = new Set([...hisNumbers(o).proj, ...Object.keys(o.min ?? {}).filter((id) => !sent.has(id))]); // a board number he typed, or a minutes number no send of news or the engine wrote
    } catch (e) { problem(`the overrides could not be read (${e.message?.slice(0, 80)}), so his typed numbers are not checked`); }
    try { // his console work on a team he has applied: minutes or DK/min he typed and men he marked S, on the scenario the team is on (Adam 11-13: a Doubtful man's typed minutes stand)
      const file = readScenarios(slate), held = heldTeams(file);
      for (const [team, rec] of Object.entries(file.teams ?? {})) {
        if (!held.has(team)) continue;
        const mine = (rec?.pins ?? {})[keyOf(outsOf(rec?.on ?? rec?.tonight ?? ""))] ?? {};
        for (const id of [...Object.keys(mine.m ?? {}), ...Object.keys(mine.d ?? {}), ...Object.keys(mine.r ?? {}).filter((i) => mine.r[i] === "starter")]) ctx.typed.add(String(id));
      }
    } catch (e) { problem(`the console work could not be read (${e.message?.slice(0, 80)}), so his typed minutes and S marks are not checked`); }
  }
  return ctx;
}

/**
 * { state: "ok", latest } , { state: "missing" } when this slate has no read yet, or { state: "unreadable", why } for a damaged file (never an empty answer).
 * `cards` false: the read as saved, with no card-status step (the site bake publishes it untransformed; the browser runs the step on the baked read).
 */
export function readNewsLineups(slate, { look: withLook = true, cards = true, cardCtx = null } = {}) {
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
    if (!cards) return { state: "ok", latest };
    const ctx = cardCtx ?? cardContext(slate, withLook), out = withCardStatus(latest, ctx); // Doubtful card = Out claim, newer IN card drops an older Out claim (news-claims.js)
    if (ctx.problems.length) out.card_status_problems = ctx.problems;
    return { state: "ok", latest: out };
  } catch (e) {
    return { state: "unreadable", why: `latest.json could not be read (${e.name})` };
  }
}
