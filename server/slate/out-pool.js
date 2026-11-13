// His own In and Out beat every outside source (Adam 11-13): a man he put back in from the console (scenarios.json mine.in, for a team he has applied) or the Minutes page (minutes edits `in`)
// plays, whatever TwoGun, ESPN, Monster or a lineup page says; his own Out stays Out. readSlate (store.js) calls applyHis, so the board, the engine, the optimizer and late swap all read
// the same row: each player carries p.his = "in" | "out" when he made the call (figures.js outFor reads it). A man on the slate's Out list is not in slate.players, so a man he put In (or one
// he typed a number on) is brought into the pool from the TwoGun board row the slate was built from (call OUT rows hold his DraftKings id, salary, positions and roster slots), as an Out man
// with no figures of his own; when that row cannot give him, he is named in slate.his_in_pool.unbuildable with the reason and on his Out-list entry (G62: said, never dropped).
// A file of his that exists but cannot be read is "unknown", never "no calls": slate.his_in_pool.problems names it and the optimize and late-swap routes refuse (hisProblem).
import fs from "../../site/shim/fs.js";
import path from "../../site/shim/path.js";
import { dataDir, warn } from "../../site/shim/log.js";
import { nameKey } from "../lib/names.js";
import { isNum, isPlain } from "../board/figures.js";
import { outsOf } from "../board/console-engine.js";
import { manAsLeft } from "../board/console-marks.js";
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
 * His marks on a slate: { ins, outs (Sets of ids), problems }. The console's `mine` counts only for a team he has applied (scenarios.js heldTeams: the console reaches the board only through Apply),
 * and an Out that the lineup news made and that still stands as it left him is the news's, not his. The Minutes page's edits always count. No file is no calls; a file that exists but
 * cannot be read is a problem naming it (fail closed). A man marked Out stays Out when another mark has him In.
 */
export function hisCalls(slate) {
  const ins = new Set(), outs = new Set(), problems = [];
  try {
    const file = readScenarios(slate), held = heldTeams(file);
    for (const [team, rec] of Object.entries(file.teams ?? {})) {
      if (!held.has(team)) continue;
      const S = { outs: outsOf(rec?.on ?? rec?.tonight ?? ""), pins: rec?.pins ?? {} };
      const byNews = new Set(Object.values(rec?.news ?? {}).filter((e) => e?.state === "applied").flatMap((e) => (e.men ?? []).filter((m) => m.kind === "out" && manAsLeft(S, m)).map((m) => String(m.id))));
      for (const id of rec?.mine?.in ?? []) ins.add(String(id));
      for (const id of rec?.mine?.out ?? []) if (!byNews.has(String(id))) outs.add(String(id));
    }
  } catch (e) { problems.push(`scenarios.json: ${e.message}`); warn("his-marks: scenarios unreadable", { slate, message: e.message }); }
  try {
    for (const rec of Object.values(minutesEdits(slate))) {
      for (const id of rec?.in ?? []) ins.add(String(id));
      for (const id of rec?.out ?? []) outs.add(String(id));
    }
  } catch (e) { problems.push(e.message); warn("his-marks: minutes edits unreadable", { slate, message: e.message }); }
  for (const id of outs) ins.delete(id); // a man marked both ways: his Out stands
  return { ins, outs, problems };
}

/** Why the optimize and late-swap routes must refuse this slate's data, or null: a file of his calls exists but cannot be read, so who is In or Out is unknown. */
export const hisProblem = (data) => (data?.his_in_pool?.problems?.length ? `Your In and Out calls could not be read: ${data.his_in_pool.problems.join("; ")}. Nothing was built.` : null);

/** The board row's call OUT men: Map id -> row player; or { why } when the row is not there (no built_from, no raw folder, no board_row.json, or one that cannot be read). */
function outRowMen(data) {
  const from = typeof data?.built_from === "string" ? data.built_from : null;
  if (!from || !/^slates\/[^/]+\/raw\/[^/]+$/.test(from)) return { why: "the slate was not built from a TwoGun board row, so no DraftKings data is saved for its Out men" };
  const file = path.join(dataDir(), from, "board_row.json");
  try {
    const mtime = fs.statSync(file).mtimeMs, hit = rowCache.get(file);
    if (hit?.mtime === mtime) return hit.men;
    const d = JSON.parse(fs.readFileSync(file, "utf8")), row = Array.isArray(d) ? d[0] : d;
    if (!isPlain(row) || !Array.isArray(row.players)) return { why: `${from}/board_row.json has no players` };
    const men = new Map(row.players.filter((p) => p?.call === "OUT").map((p) => [String(p.id), p]));
    rowCache.set(file, { mtime, men });
    return men;
  } catch (e) { return { why: `${from}/board_row.json could not be read (${e.message.slice(0, 80)})` }; }
}

/** One pool row for an Out man from his board-row entry, or { why }. The tip is his game's, as a teammate or opponent on the slate writes it. TwoGun's ownership for him was made while he was Out, so it is not used (proj_own null, own_note says so). */
function poolRow(p, data, out) {
  const miss = [];
  if (typeof p.pos !== "string" || !p.pos) miss.push("position");
  if (!Array.isArray(p.slots) || !p.slots.length) miss.push("roster slots");
  if (!Number.isInteger(p.sal) || p.sal <= 0) miss.push("salary");
  if (typeof p.team !== "string" || typeof p.game !== "string") miss.push("team or game");
  if (miss.length) return { why: `the board row holds no ${miss.join(" and no ")} for him` };
  const tip = (data.players ?? []).find((q) => q.game === p.game)?.tip ?? null;
  return { row: {
    dk_id: String(p.id), name: p.name, team: p.team, opponent: p.opp ?? null, game: p.game, positions: p.pos.split("/"), roster_positions: p.slots, tip,
    salary: p.sal, minutes: null, projection: null, ceiling: null, value: null, proj_own: null, own_note: "TwoGun's ownership for him was made while he was Out, so it is not used; type one to have it counted",
    injury_status: out?.status ?? "Out", starter: false,
    dd_pct: null, td_pct: null, no_history: null, out_pool: true, out_reason: out?.reason ?? null, usual_minutes: isNum(out?.usual_minutes) ? out.usual_minutes : null,
  } };
}

/**
 * The slate data with his marks on it: p.his on each man he called, and the Out-list men he put In (or typed a number on) added to players as Out men. Adds slate.his_in_pool
 * { added: [{ dk_id, name }], unbuildable: [{ dk_id, name, why, typed? }], problems } when there is anything to say, and his_in_note on the Out-list entry of a man who could not be brought in.
 * Returns the data as given when he has made no call. Never throws.
 */
export function applyHis(slate, data) {
  if (!data || !Array.isArray(data.players)) return data;
  const calls = hisCalls(slate), onSlate = new Set(data.players.map((p) => String(p.dk_id))), problems = [...calls.problems];
  let typed = [];
  try { const his = hisNumbers(readOverrides(slate)); typed = [...new Set([...his.proj, ...his.own])]; } catch (e) { warn("his-marks: overrides unreadable", { slate, message: e.message }); }
  const wantIn = [...calls.ins].filter((id) => !onSlate.has(id)), wantTyped = typed.filter((id) => !onSlate.has(id) && !calls.ins.has(id));
  if (!calls.ins.size && !calls.outs.size && !wantTyped.length && !problems.length) return data;
  const players = data.players.map((p) => { const id = String(p.dk_id); return calls.outs.has(id) ? { ...p, his: "out" } : calls.ins.has(id) ? { ...p, his: "in" } : p; });
  const added = [], unbuildable = [], out = (data.out ?? []).map((o) => ({ ...o }));
  if (wantIn.length || wantTyped.length) {
    const men = outRowMen(data), outById = new Map(out.map((o) => [xId(o.name), o]));
    for (const raw of [...wantIn, ...wantTyped]) {
      const o = outById.get(raw) ?? null;
      let id = raw, p = men.why ? null : men.get(raw) ?? null;
      if (!p && o && !men.why) { p = [...men.values()].find((q) => q.team === o.team && nameKey(q.name) === nameKey(o.name)) ?? null; if (p) id = String(p.id); } // an "x-name" id: found by name and team
      if (p && onSlate.has(id)) continue;
      const hisOut = calls.outs.has(id) || calls.outs.has(raw), hisIn = !hisOut && (calls.ins.has(id) || calls.ins.has(raw)); // his Out first, whichever id form carries it
      const entry = o ?? out.find((q) => p && q.team === p.team && nameKey(q.name) === nameKey(p.name)) ?? null;
      const made = p ? poolRow(p, data, entry) : { why: men.why ?? "the slate's board row holds no Out man with that DraftKings id (a stale mark from an earlier pull)" };
      if (made.row) { players.push({ ...made.row, ...(hisOut ? { his: "out" } : hisIn ? { his: "in" } : {}) }); onSlate.add(id); added.push({ dk_id: id, name: made.row.name }); continue; }
      unbuildable.push({ dk_id: raw, name: p?.name ?? o?.name ?? null, why: made.why, typed: !hisIn && !hisOut });
      if (hisIn && entry) entry.his_in_note = `You put him In, but he cannot be built with: ${made.why}.`;
    }
  }
  const say = added.length || unbuildable.length || problems.length;
  return { ...data, players, out, ...(say ? { his_in_pool: { added, unbuildable, problems } } : {}) };
}

/**
 * A man he put In shows a projection, never zero or hidden (Adam 11-13): his typed number (already on the row after the overrides merge), else our minutes x DK/min (the engine's row for him once
 * he plays), else TwoGun's own projection; with none of them the projection stays blank and proj_note says why (the optimizer then names him). Pure; players are the merged rows.
 */
export function withInFigures(players) {
  return (players ?? []).map((p) => {
    if (p?.his !== "in" || (isNum(p.projection) && p.projection > 0)) return p;
    const ours = p.ours, tg = isNum(p.tg_projection) && p.tg_projection > 0 ? p.tg_projection : null;
    if (isNum(ours?.projection) && ours.projection > 0) return { ...p, projection: ours.projection, value: valueFrom(ours.projection, p.salary), minutes: isNum(p.minutes) && p.minutes > 0 ? p.minutes : ours.minutes ?? p.minutes, proj_note: `You put him In: ${ours.minutes} minutes x ${ours.rate} DK/min` };
    if (tg !== null) return { ...p, projection: tg, value: valueFrom(tg, p.salary), proj_note: "You put him In: TwoGun's own projection" };
    return { ...p, projection: null, value: null, proj_note: `You put him In, but no projection can be made for him: ${ours?.missing ?? "our minutes engine has no row for him"}, and TwoGun has none` };
  });
}
