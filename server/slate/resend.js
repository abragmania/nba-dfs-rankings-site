// The server-side resend of every team the board is held for (R4, Adam 11-13). A send's numbers (overrides.json proj / min listed in `auto`) come from the console's scenario maths
// (console-engine.js: scenario Outs, pins, flips, usage-scaled DK/min), so only that maths can refresh them when a pull moves the engine's minutes. The browser did it (console-auto.js
// resendChanged / requeueApplied); between a pull and the next page load the board served stale numbers (11-12: PHI 256.1 and TOR 257.7 minutes, engine 240). This file is the one
// server copy: sendHeld is planApply + writeApply for each held team, the same two calls the page's send makes (console-route.js), used by applyNews (inside every pressed pull and the 5-minute
// check) and by resendHeld (every other pull path: update_cycle.mjs, cloud_cycle.mjs). Nothing here re-implements the console's sums.
// Every pass writes data/slates/<slate>/resend.json (what it did, or what blocked it and why) so the board foot can name held numbers that were not refreshed (G62/G64).
import fs from "../../site/shim/fs.js";
import path from "../../site/shim/path.js";
import { dataDir, warn } from "../../site/shim/log.js";
import { writeFileAtomic } from "../../site/shim/atomic.js";
import { buildInputs } from "../../site/shim/app-only.js";
import { readSlate } from "./store.js";
import { readScenarios, writeScenarios, heldTeams } from "./scenarios.js";
import { readOverrides } from "./overrides.js";
import { planApply, applyRecord, checkKeys } from "./console-apply.js";
import { writeApply } from "./console-route.js";
import { buildModel, recordOf, canonRecord } from "../board/console-model.js";
import { keyOf } from "../board/console-engine.js";
import { EMPTY_RECORD } from "../board/figures.js";
import { withOurProjection } from "../../site/shim/app-only.js";
import { basePlayers } from "./base-players.js";

/** Whether numbers may be sent by themselves: never on a locked slate and never on one that is not the newest (the rule mayAutoSend states for the page). Pure. */
export const mayResend = (inputs) => inputs?.locked !== true && inputs?.newest === true;

export const resendFile = (slate) => path.join(dataDir(), "slates", slate, "resend.json");

/** The slate's last resend record, or null when none was written. A damaged file is { problem }, never silently null. */
export function readResend(slate) {
  let raw;
  try { raw = fs.readFileSync(resendFile(slate), "utf8"); } catch (e) { return e?.code === "ENOENT" ? null : { problem: `resend.json could not be read (${e?.code ?? e?.message})` }; }
  try { const rec = JSON.parse(raw); return rec && typeof rec === "object" && !Array.isArray(rec) ? rec : { problem: "resend.json is not an object" }; } catch (e) { return { problem: `resend.json is not valid JSON (${e.message})` }; }
}

/** Saves what a pass did. { at, pull, status: "sent" | "blocked", why, teams, sent, usage_state, usage_message, missing: [{ team, name, why }], base_note }. A failed write is a warning; it never stops the pull. */
export function writeResend(slate, rec) {
  const was = readResend(slate);
  if (was && !was.problem && was.status === rec.status && was.why === rec.why && was.pull === rec.pull && JSON.stringify(was.missing ?? []) === JSON.stringify(rec.missing ?? [])) return false; // nothing a reader would see differs: a 5-minute pass does not rewrite the file
  try { writeFileAtomic(resendFile(slate), `${JSON.stringify(rec, null, 1)}\n`); return true; } catch (e) { warn("resend: the record could not be saved", { slate, error: e.message }); return false; }
}

/** Why a usage table that is not "ready" blocks a resend, in words. */
export const usageWhy = (usage) => (usage?.state === "loading" ? "the usage table is still loading" : !usage ? "no usage table was given" : `the usage table is ${usage.state}${usage.message ? ` (${usage.message})` : ""}`);

/** Why a locked slate sends nothing. It is never recorded: after lock the last record stands as the final word, and the board check stays quiet about it. */
export const LOCKED_WHY = "the slate is locked";

/**
 * The shared core: every held team's saved work rebased on this Tonight, then planApply + writeApply from it. `model`: buildModel(inputs, file.teams, file.applied?.keys), already changed by the caller's
 * news moves; `extra`: teams the caller moved this pass. `players`: the slate's players as the board has them (our engine's figures on), the base planApply compares with and restores to.
 * Returns { teams, sent, wrote, missing, failed }. Nothing is written when `failed` (a scenario key that no longer fits); a failed send puts the team records back and throws.
 */
export function sendHeld({ slate, inputs, model, file, overrides, players, extra = [], usageReady = true, writeSend = writeApply, atIso }) {
  const held = new Set([...Object.keys(file.applied?.keys ?? {}), ...Object.entries(model.ST).filter(([, S]) => Object.values(S.news ?? {}).some((e) => e.state === "applied")).map(([t]) => t), ...extra]);
  const all = [...held].filter((t) => model.ST[t]).sort();
  // A usage table that is not ready blocks the RESEND of held teams (their scenario maths needs it; the earlier numbers stay): only teams the news moved this pass (`extra`) are still sent, so a news Out lands.
  const teams = usageReady ? all : all.filter((t) => extra.includes(t)), blocked = all.filter((t) => !teams.includes(t));
  let next = file, wrote = false;
  for (const t of teams) {
    const rec = { ...EMPTY_RECORD(), ...recordOf(model.ST[t]) };
    if (canonRecord(rec) === canonRecord(next.teams[t])) continue;
    next = { ...next, teams: { ...next.teams, [t]: rec } };
    wrote = true;
  }
  const keys = Object.fromEntries(teams.map((t) => [t, keyOf(model.ST[t].outs)]));
  const checked = checkKeys(keys, inputs);
  if (!checked.ok) return { teams, blocked, sent: 0, wrote: false, missing: [], failed: checked.message };
  if (wrote) writeScenarios(slate, next); // the team records first, so the plan below reads what it sends; a failure here leaves overrides untouched
  let sent = 0, missing = [];
  try {
    if (teams.length) {
      const sendPlan = planApply(inputs, next, overrides, players, checked.keys, new Set(teams));
      sent = sendPlan.changes.length + sendPlan.min_moves;
      missing = sendPlan.missing.map((m) => ({ team: m.team, name: m.name, why: m.why }));
      if (sent || sendPlan.flag_moves) { // flag_moves: numbers left as they are whose his-or-news mark changes (console-apply.js setAuto)
        writeSend(slate, next, overrides, applyRecord(sendPlan, overrides, next.applied, atIso), players);
        if (sent) wrote = true; // a marks-only send moved no number
      } else if (sendPlan.holds) {
        writeScenarios(slate, { ...next, applied: applyRecord(sendPlan, overrides, next.applied, atIso).applied });
        wrote = true;
      }
    }
  } catch (e) {
    // The board did not take the numbers: this pass's record goes back too, so the two files agree and the next pull does it again.
    if (wrote) { try { writeScenarios(slate, file); } catch (e2) { warn("resend: the team record could not be put back after a failed send", { slate, error: e2.message }); } }
    throw e;
  }
  return { teams, blocked, sent, wrote, missing, failed: null };
}

/** Records a pass that sent nothing, and why, for every team the board is held for; null when no team is held (nothing stored depends on a send). */
export function recordBlocked(slate, why, { nowMs, usage = null, pull = null } = {}) {
  if (why === LOCKED_WHY) return null;
  let file;
  try { file = readScenarios(slate); } catch (e) { warn("resend: the scenarios file could not be read for the record", { slate, error: e.message }); return null; }
  const teams = [...heldTeams(file)].sort();
  if (!teams.length) return null;
  const rec = { at: new Date(nowMs ?? Date.now()).toISOString(), pull, status: "blocked", why, teams, sent: 0, usage_state: usage?.state ?? null, usage_message: usage?.message ?? null, missing: [], base_note: null };
  writeResend(slate, rec);
  return rec;
}

/**
 * The resend for a pull path with no lineup news of its own (update_cycle.mjs, through the app's POST /api/slate/<slate>/resend when the app is up): every held team sent again from his saved work
 * on the new Tonight. SYNCHRONOUS from its read to its write (the caller awaits the usage table first), so nothing can interleave with a save. Returns
 * { status: "ok" | "skipped" | "blocked", note, sent, teams }. `usage`: seasonUsageTable's answer, which must be "ready" (any other state is a block: the scenario maths needs it, and the earlier numbers stay);
 * `ourPlayers`: the engine's door (default minutes/board.js withOurProjection).
 */
export function resendHeld(slate, { usage, nowMs = Date.now(), ourPlayers = withOurProjection, writeSend = writeApply } = {}) {
  const slateData = readSlate(slate);
  if (!slateData) return { status: "skipped", note: `${slate} has no slate file`, sent: 0, teams: [] };
  const file = readScenarios(slate);
  if (!heldTeams(file).size) return { status: "skipped", note: "no team is held, so nothing is stored to refresh", sent: 0, teams: [] };
  if (usage?.state !== "ready") {
    const why = usageWhy(usage);
    recordBlocked(slate, why, { nowMs, usage });
    return { status: "blocked", note: `${why}; held numbers are not refreshed until the next pull`, sent: 0, teams: [...heldTeams(file)].sort() };
  }
  const inputs = buildInputs(slate, slateData, { usage, nowMs });
  if (!mayResend(inputs)) {
    const why = inputs.locked === true ? LOCKED_WHY : "this is not the newest slate";
    recordBlocked(slate, why, { nowMs, usage, pull: inputs.basis?.pull ?? null });
    return { status: "blocked", note: `${why}, so nothing is re-sent by itself`, sent: 0, teams: [...heldTeams(file)].sort() };
  }
  const overrides = readOverrides(slate);
  const { players, note } = basePlayers(slate, slateData, nowMs, ourPlayers);
  const model = buildModel(inputs, file.teams, file.applied?.keys);
  const r = sendHeld({ slate, inputs, model, file, overrides, players, writeSend, atIso: new Date(nowMs).toISOString() });
  if (r.failed) {
    recordBlocked(slate, r.failed, { nowMs, usage, pull: inputs.basis?.pull ?? null });
    return { status: "blocked", note: r.failed, sent: 0, teams: r.teams };
  }
  writeResend(slate, { at: new Date(nowMs).toISOString(), pull: inputs.basis?.pull ?? null, status: "sent", why: null, teams: r.teams, sent: r.sent, usage_state: usage.state, usage_message: usage.message ?? null, missing: r.missing, base_note: note });
  return { status: "ok", note: `${r.teams.length} held team${r.teams.length === 1 ? "" : "s"} re-sent, ${r.sent} number${r.sent === 1 ? "" : "s"} moved${r.missing.length ? `, ${r.missing.length} could not be refreshed` : ""}`, sent: r.sent, teams: r.teams };
}
