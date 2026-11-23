// His own In and Out beat every outside source (Adam 11-13): a man he put back in from the console (scenarios.json mine.in, for a team he has applied) or the Minutes page (minutes edits `in`)
// plays, whatever TwoGun, ESPN, Monster or a lineup page says; his own Out stays Out. readSlate (store.js) calls applyHis, so the board, the engine, the optimizer and late swap all read
// the same row: each player carries p.his = "in" | "out" when he made the call (figures.js outFor reads it). Every man the TwoGun board row lists is in the pool (joinRowMen, Adam 11-19), read
// through identityOf: his name, team, DraftKings id, salary, positions and roster slots only, never TwoGun's Out word or status. A number he typed on a man the row does not hold is named in
// slate.his_in_pool.unbuildable with the reason (G62: said, never dropped).
// A file of his that exists but cannot be read is "unknown", never "no calls": slate.his_in_pool.problems names it and the optimize and late-swap routes refuse (hisProblem).
import fs from "../../site/shim/fs.js";
import path from "../../site/shim/path.js";
import { dataDir, warn } from "../../site/shim/log.js";
import { nameKey } from "../lib/names.js";
import { isNum, isPlain } from "../board/figures.js";
import { outsOf, keyOf } from "../board/console-engine.js";
import { manAsLeft } from "../board/console-marks.js";
import { newsFlips, newsFlipTimes } from "../board/role-marks.js";
import { readScenarios, heldTeams } from "./scenarios.js";
import { badEditsFile } from "./edits-shape.js";
import { readOverrides, hisNumbers, valueFrom } from "./overrides.js";

const rowCache = new Map(); // file -> { mtime, men } (the board row is large; a slate read repeats)
const xId = (name) => `x-${nameKey(name).replace(/[^a-z0-9]+/g, "-")}`; // the console's id for an Out-list man with no DraftKings id (console-inputs.js slateMen)

/** The Minutes page's team records for a slate (data/slates/<slate>/minutes-edits.json): {} with no file; a file that cannot be read or is not well formed throws, naming the file. */
function minutesEdits(slate) {
  let raw;
  try { raw = fs.readFileSync(path.join(dataDir(), "slates", slate, "minutes-edits.json"), "utf8"); } catch (e) { if (e?.code === "ENOENT") return {}; throw new Error(`minutes-edits.json could not be read (${e.message})`); }
  let d;
  try { d = JSON.parse(raw); } catch (e) { throw new Error(`minutes-edits.json is not valid JSON (${e.message})`); }
  const why = badEditsFile(d);
  if (why) throw new Error(`minutes-edits.json is not well formed: ${why}`);
  return d.teams;
}

/**
 * His marks on a slate: { ins, outs (Sets of ids), newsRoles (Map id -> { role, at }), problems }. The console's `mine` counts only for a team he has applied (scenarios.js heldTeams: the console reaches the board only through Apply),
 * and an Out that the lineup news made and that still stands as it left him is the news's, not his. newsRoles: the lineup news's role flips still in force on an applied team's scenario on show
 * (role-marks.js newsFlips; Adam 9:30 AM 11-20: the board's engine rebuilds the team on the five they make). The Minutes page's edits always count. No file is no calls; a file that exists but
 * cannot be read is a problem naming it (fail closed). A man marked Out stays Out when another mark has him In.
 */
export function hisCalls(slate) {
  const ins = new Set(), outs = new Set(), newsRoles = new Map(), problems = [];
  try {
    const file = readScenarios(slate), held = heldTeams(file);
    for (const [team, rec] of Object.entries(file.teams ?? {})) {
      if (!held.has(team)) continue;
      const S = { outs: outsOf(rec?.on ?? rec?.tonight ?? ""), pins: rec?.pins ?? {} };
      const byNews = new Set(Object.values(rec?.news ?? {}).filter((e) => e?.state === "applied").flatMap((e) => (e.men ?? []).filter((m) => m.kind === "out" && manAsLeft(S, m)).map((m) => String(m.id))));
      for (const id of rec?.mine?.in ?? []) ins.add(String(id));
      for (const id of rec?.mine?.out ?? []) if (!byNews.has(String(id))) outs.add(String(id));
      const flips = S.pins[keyOf(S.outs)]?.r, at = newsFlipTimes(rec?.news, flips);
      for (const [id, role] of Object.entries(newsFlips(rec?.news, flips))) newsRoles.set(id, { role, at: at[id] ?? null });
    }
  } catch (e) { problems.push(`scenarios.json: ${e.message}`); warn("his-marks: scenarios unreadable", { slate, message: e.message }); }
  try {
    for (const rec of Object.values(minutesEdits(slate))) {
      for (const id of rec?.in ?? []) ins.add(String(id));
      for (const id of rec?.out ?? []) outs.add(String(id));
    }
  } catch (e) { problems.push(e.message); warn("his-marks: minutes edits unreadable", { slate, message: e.message }); }
  for (const id of outs) ins.delete(id); // a man marked both ways: his Out stands
  return { ins, outs, newsRoles, problems };
}

/** Why the optimize and late-swap routes must refuse this slate's data, or null: a file of his calls exists but cannot be read, so who is In or Out is unknown. */
export const hisProblem = (data) => (data?.his_in_pool?.problems?.length ? `Your In and Out calls could not be read: ${data.his_in_pool.problems.join("; ")}. Nothing was built.` : null);

/**
 * THE IDENTITY BOUNDARY (Adam 11-19, 4:18 PM ET: "NOTHING should read twoguns' fucking out list"). TwoGun's board row is read for who a man is, nothing else: these keys of a row man and no
 * other (his call, status, DraftKings status, reason, minutes or projection never pass). Every other module reads a row man only through identityOf (tests/feeds_decide_out.test.mjs checks the code).
 */
export const IDENTITY_KEYS = Object.freeze(["id", "name", "team", "opp", "game", "pos", "slots", "sal"]);
/** A row man's identity: IDENTITY_KEYS only. Pure. */
export const identityOf = (p) => Object.fromEntries(IDENTITY_KEYS.filter((k) => isPlain(p) && Object.hasOwn(p, k)).map((k) => [k, p[k]]));
/** The slate with every status TwoGun wrote stripped: players[].injury_status, status_since and tg_status removed, and TwoGun's Out list (slate.out) emptied. Pure. */
export function statusFree(data) {
  if (!isPlain(data) || !Array.isArray(data.players)) return data;
  const STATUS = new Set(["injury_status", "status_since", "tg_status"]);
  const { on_report_but_playing: _onReport, ...rest } = data; // TwoGun's own list of report men it plays: a status of TwoGun's too (review 11-19)
  return { ...rest, players: data.players.map((p) => (isPlain(p) ? Object.fromEntries(Object.entries(p).filter(([k]) => !STATUS.has(k))) : p)), out: [] };
}

/** Every man of the board row the slate was built from, as identities: Map id -> identityOf; or { why } when the row is not there (no built_from, no raw folder, no board_row.json, or one that cannot be read). */
function rowIdentities(data) {
  const from = typeof data?.built_from === "string" ? data.built_from : null;
  if (!from || !/^slates\/[^/]+\/raw\/[^/]+$/.test(from)) return { why: "the slate was not built from a TwoGun board row, so no DraftKings data is saved for the men its board does not show" };
  const file = path.join(dataDir(), from, "board_row.json");
  try {
    const mtime = fs.statSync(file).mtimeMs, hit = rowCache.get(file);
    if (hit?.mtime === mtime) return hit.men;
    const d = JSON.parse(fs.readFileSync(file, "utf8")), row = Array.isArray(d) ? d[0] : d;
    if (!isPlain(row) || !Array.isArray(row.players)) return { why: `${from}/board_row.json has no players` };
    const men = new Map(row.players.filter((p) => isPlain(p) && p.id != null).map((p) => [String(p.id), identityOf(p)]));
    rowCache.set(file, { mtime, men });
    return men;
  } catch (e) { return { why: `${from}/board_row.json could not be read (${e.message.slice(0, 80)})` }; }
}

/** One pool row from a row man's identity, or { why }. The tip is his game's, as a teammate or opponent on the slate writes it. No figure of TwoGun's comes with him. */
function poolRow(p, data) {
  const miss = [];
  if (typeof p.pos !== "string" || !p.pos) miss.push("position");
  if (!Array.isArray(p.slots) || !p.slots.length) miss.push("roster slots");
  if (!Number.isInteger(p.sal) || p.sal <= 0) miss.push("salary");
  if (typeof p.team !== "string" || typeof p.game !== "string") miss.push("team or game");
  if (miss.length) return { why: `the board row holds no ${miss.join(" and no ")} for him` };
  const tip = (data.players ?? []).find((q) => q.game === p.game)?.tip ?? null;
  return { row: {
    dk_id: String(p.id), name: p.name, team: p.team, opponent: p.opp ?? null, game: p.game, positions: p.pos.split("/"), roster_positions: p.slots, tip,
    salary: p.sal, minutes: null, projection: null, ceiling: null, value: null, proj_own: null, own_note: "TwoGun's board did not show him, so it gave no ownership for him; type one to have it counted",
    starter: false, dd_pct: null, td_pct: null, no_history: null, out_pool: true,
  } };
}

/**
 * NOBODY is left out of the player pool (Adam 11-19, 4:18 PM ET): every man the board row lists who is not on the slate's board is added to players (out_pool) from his identity (identityOf), and our
 * minutes engine decides from our own injury feeds whether he plays; a man not playing is excluded with a projection of 0, never dropped (board-excluded.js). A man the row cannot give is named in
 * data.out_pool.unbuildable with the reason (G62). A read already joined, or a man already on players, is not added twice. Never throws.
 */
export function joinRowMen(data) {
  if (!data || !Array.isArray(data.players) || data.out_pool) return data;
  const men = rowIdentities(data);
  if (men.why) return { ...data, out_pool: { joined: [], unbuildable: [], ...(typeof data.built_from === "string" || !/^none/i.test(String(data.sources?.minutes ?? "none")) ? { why: men.why } : {}) } }; // only a DraftKings CSV night (no board row and its minutes source none) has nobody to add and says nothing; a board night always says why (review 11-19)
  const onSlate = new Set(data.players.map((p) => String(p.dk_id))), players = [...data.players], joined = [], unbuildable = [];
  for (const [id, p] of men) {
    if (onSlate.has(id)) continue;
    const made = poolRow(p, data);
    if (made.row) { players.push(made.row); onSlate.add(id); joined.push({ dk_id: id, name: made.row.name, team: made.row.team }); continue; }
    unbuildable.push({ name: p.name ?? null, team: p.team ?? null, why: made.why });
  }
  return { ...data, players, out_pool: { joined, unbuildable } };
}
/** The old name, kept for its callers. */
export const joinOutList = joinRowMen;

/**
 * The slate data with his marks on it: p.his on each man he called, p.news_role on each man the lineup news's role flip still holds on an applied team (hisCalls newsRoles), and the Out-list men he put In (or typed a number on) added to players as Out men. Adds slate.his_in_pool
 * { added: [{ dk_id, name }], unbuildable: [{ dk_id, name, why, typed? }], problems } when there is anything to say, and his_in_note on the Out-list entry of a man who could not be brought in.
 * Returns the data as given when he has made no call. Never throws.
 */
export function applyHis(slate, data) {
  if (!data || !Array.isArray(data.players)) return data;
  const calls = hisCalls(slate), onSlate = new Set(data.players.map((p) => String(p.dk_id))), problems = [...calls.problems];
  const joinedIds = new Map(data.players.filter((p) => p.out_pool).map((p) => [xId(p.name), String(p.dk_id)])); // a console mark made on an Out-list man before he joined the pool carries his "x-name" id
  if (joinedIds.size) { for (const k of ["ins", "outs"]) calls[k] = new Set([...calls[k]].map((id) => joinedIds.get(id) ?? id)); for (const id of calls.outs) calls.ins.delete(id); calls.newsRoles = new Map([...calls.newsRoles].map(([id, r]) => [joinedIds.get(id) ?? id, r])); }
  let typed = [];
  try { const his = hisNumbers(readOverrides(slate)); typed = [...new Set([...his.proj, ...his.own])]; } catch (e) { warn("his-marks: overrides unreadable", { slate, message: e.message }); }
  const wantIn = [...calls.ins].filter((id) => !onSlate.has(id)), wantTyped = typed.filter((id) => !onSlate.has(id) && !calls.ins.has(id));
  if (!calls.ins.size && !calls.outs.size && !calls.newsRoles.size && !wantTyped.length && !problems.length) return data;
  const news = (id) => (calls.newsRoles.has(id) ? { news_role: calls.newsRoles.get(id).role, news_role_at: calls.newsRoles.get(id).at } : null); // the board's engine reads it over his older standing mark (personal-view.js planInputs); its time judges his typed minutes (typed-aside.js)
  const players = data.players.map((p) => { const id = String(p.dk_id), n = news(id); return calls.outs.has(id) ? { ...p, his: "out", ...n } : calls.ins.has(id) ? { ...p, his: "in", ...n } : n ? { ...p, ...n } : p; });
  const added = [], unbuildable = [];
  if (wantIn.length || wantTyped.length) {
    const men = rowIdentities(data);
    for (const id of [...wantIn, ...wantTyped]) {
      const p = men.why ? null : men.get(id) ?? null;
      const hisOut = calls.outs.has(id), hisIn = !hisOut && calls.ins.has(id);
      const made = p ? poolRow(p, data) : { why: men.why ?? "the slate's board row holds no man with that DraftKings id (a stale mark from an earlier pull)" };
      if (made.row) { players.push({ ...made.row, ...(hisOut ? { his: "out" } : hisIn ? { his: "in" } : {}) }); onSlate.add(id); added.push({ dk_id: id, name: made.row.name }); continue; }
      unbuildable.push({ dk_id: id, name: p?.name ?? null, why: made.why, typed: !hisIn && !hisOut });
    }
  }
  const say = added.length || unbuildable.length || problems.length;
  return { ...data, players, ...(say ? { his_in_pool: { added, unbuildable, problems } } : {}) };
}

/**
 * A man he put In takes the projection WE make for him (Adam 5:27 PM 11-19: "he should use the god damn projection WE create for our players, based on the lineup!"), on either projection source:
 * his own typed number when he typed one (ovr.projection, after the overrides merge), else our engine's: he plays in the team plan by his role (the chart, the five and the tiers, the 240 fill redone, his
 * teammates moved to make room) and his projection is those minutes x our DK/min. Never TwoGun's number. When our engine cannot give one (it cannot run for his team, or he has no row), the projection
 * is blank and proj_note names why (the optimizer then names him). Pure; players are the merged rows.
 */
export function withInFigures(players) {
  return (players ?? []).map((p) => {
    if (p?.his !== "in" || isNum(p.ovr?.projection)) return p;
    const ours = p.ours;
    if (isNum(ours?.projection) && ours.projection > 0) return { ...p, projection: ours.projection, value: valueFrom(ours.projection, p.salary), minutes: isNum(ours.minutes) ? ours.minutes : p.minutes, play_unknown: false, proj_note: `You put him In: ${ours.minutes} minutes in our team plan x ${ours.rate} DK/min` };
    return { ...p, projection: null, value: null, proj_note: `You put him In, but our engine gives no projection for him: ${ours?.missing ?? "our minutes engine has no row for him"} (never TwoGun's number)` };
  });
}
