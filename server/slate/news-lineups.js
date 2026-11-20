// The lineup read of a slate (news/lineups/latest.json, written by tools/lineups_read.mjs) for the board's proposals bar. Pure file access under the
// data root. On the public site the shim's fs serves the copy baked at publish (site-src/bake.mjs, slates/<slate>/lineups-latest.json).
import fs from "../../site/shim/fs.js";
import path from "../../site/shim/path.js";
import { dataRoot, readSlateAsBuilt } from "./store.js";
import { nameKey, soleNear } from "../lib/names.js";
import { readLook } from "./lineup-look.js";
import { warn } from "../../site/shim/log.js";
import { withCardStatus } from "../board/news-claims.js";
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
  // TwoGun's status and when it changed are never read (Adam 11-19, 4:18 PM ET): a card is judged against our own feeds only, so ctx.players stays empty
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
 * The lineup read with DraftKings ids on the men of TwoGun's Out list who joined the pool (out-pool.js joinOutList, Adam 11-19): the read tied names to the board when it was made, and TwoGun's
 * board did not hold these men, so their rows carry no id and no claim of a source could reach them. A row with no id is tied to a pool man of its team by his exact name, then one near name
 * that is not another board man's (names.js soleNear; two near men: none). Rows that already carry an id are never changed. players: the slate's men (out_pool marks the joined ones). Returns a
 * new read, or the argument itself when there is no joined man. Pure.
 */
export function withPoolIds(latest, players) {
  const pool = (players ?? []).filter((p) => p?.out_pool && p.dk_id != null && typeof p.name === "string");
  if (!pool.length || !latest || typeof latest !== "object") return latest;
  const read = structuredClone(latest), byTeam = new Map();
  for (const p of pool) byTeam.set(p.team, [...(byTeam.get(p.team) ?? []), p]);
  const mates = (team) => (players ?? []).filter((p) => p?.team === team && !p.out_pool).map((p) => p.name);
  const tie = (m, team, idKey = "id") => {
    if (!m || m[idKey] != null || typeof m.name !== "string" || !byTeam.has(team)) return;
    const cands = byTeam.get(team), exact = cands.filter((p) => nameKey(p.name) === nameKey(m.name));
    const hit = exact.length === 1 ? exact[0] : exact.length ? null : soleNear(cands, m.name, { teammates: mates(team) })?.hit ?? null;
    if (hit) { m[idKey] = String(hit.dk_id); m.match = exact.length ? "exact" : "near"; }
  };
  for (const [team, block] of Object.entries(read.teams ?? {})) {
    if (!block || typeof block !== "object") continue;
    for (const b of Object.values(block)) {
      if (!b || typeof b !== "object") continue;
      for (const m of Array.isArray(b.men) ? b.men : []) tie(m, team);
      for (const m of Array.isArray(b.may_not_play) ? b.may_not_play : []) tie(m, team);
    }
  }
  for (const m of Array.isArray(read.monster_news?.out) ? read.monster_news.out : []) tie(m, m?.team);
  for (const c of Array.isArray(read.monster_news?.cards) ? read.monster_news.cards : []) tie(c, c?.team, "dk_id");
  return read;
}

/** The copy of the lineup read kept before lock (news/lineups/prelock.json), marked prelock_copy, when it is from before `asOfMs`; null when there is none, it is later, or it cannot be read (logged). */
function prelockAsOf(dir, asOfMs) {
  let doc;
  try { doc = JSON.parse(fs.readFileSync(path.join(dir, "prelock.json"), "utf8")); } catch (e) { if (e.code !== "ENOENT") warn("lineup read: the copy kept before lock could not be read", { dir, error: e.message }); return null; }
  return doc && typeof doc === "object" && Date.parse(doc.generated_at ?? "") < asOfMs ? { ...doc, prelock_copy: true } : null;
}

/**
 * { state: "ok", latest } , { state: "missing" } when this slate has no read yet, or { state: "unreadable", why } for a damaged file (never an empty answer).
 * `cards` false: the read as saved, with no card-status step (the site bake publishes it untransformed; the browser runs the step on the baked read).
 * `asOfMs` (a back-test's moment, R5): when latest.json was written at or after it, the copy kept before lock (prelock.json, tools/lineups_read.mjs keepPrelock) is read instead if it is from before that
 * moment, marked `prelock_copy`; otherwise latest.json is answered and the caller judges its time.
 */
export function readNewsLineups(slate, { look: withLook = true, cards = true, cardCtx = null, asOfMs = null } = {}) {
  const dir = path.join(dataRoot(), "slates", slate, "news", "lineups"), file = path.join(dir, "latest.json");
  if (!fs.existsSync(file)) return { state: "missing" };
  try {
    let latest = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Number.isFinite(asOfMs) && !(Date.parse(latest?.generated_at ?? "") < asOfMs)) latest = prelockAsOf(dir, asOfMs) ?? latest;
    if (latest === null || typeof latest !== "object" || latest.teams === null || typeof latest.teams !== "object" || Array.isArray(latest.teams)) return { state: "unreadable", why: "latest.json has no teams" };
    // The 5-minute lineup check's own finds file rides along as latest.found_by_check (server/pullnow/lineup-sync.js owns it), so a pull rewriting latest.json never loses them; a damaged file is said, not hidden (G62).
    try {
      const f = JSON.parse(fs.readFileSync(path.join(dataRoot(), "slates", slate, "lineup-finds.json"), "utf8"));
      if (Array.isArray(f?.finds)) { latest.found_by_check = f.finds; if (f.last_check) latest.last_check = f.last_check; } else latest.found_unreadable = "lineup-finds.json has no finds list";
    } catch (e) { if (e.code !== "ENOENT") latest.found_unreadable = `lineup-finds.json could not be read (${e.name})`; }
    let built = null, poolProblem = null;
    try { built = readSlateAsBuilt(slate); } catch (e) { poolProblem = `the slate file could not be read (${e.name}), so the Out-list men who joined the pool are not tied to the lineup read`; warn(`lineup read: ${poolProblem}`, { slate }); } // G62: said at the foot of the News tab
    latest = withPoolIds(latest, built?.players);
    const look = withLook && !latest.prelock_copy ? readLook(slate, dataRoot()) : {}; // the copy kept before lock takes no later look
    if (Object.keys(look).length || latest.look === undefined) latest.look = look; // the site has no cache file: the look baked into the copy stands
    // the last look at each page (cache, git-ignored): a source is fresh by the later of its read and its look (lineup-proposals.js freshnessOf)
    if (!cards) return { state: "ok", latest };
    const ctx = cardCtx ?? cardContext(slate, withLook), out = withCardStatus(latest, ctx); // Doubtful card = Out claim, newer IN card drops an older Out claim (news-claims.js)
    if (ctx.problems.length || poolProblem) out.card_status_problems = [...ctx.problems, ...(poolProblem ? [poolProblem] : [])];
    return { state: "ok", latest: out };
  } catch (e) {
    return { state: "unreadable", why: `latest.json could not be read (${e.name})` };
  }
}
