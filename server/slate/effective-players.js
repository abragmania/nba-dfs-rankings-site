// The slate's players as the board, the optimizer and the console build them: our projections or TwoGun's, Adam's overrides on top.
// Moved out of server/server.js unchanged (file split, 11-17); one copy.
import { error, warn } from "../../site/shim/log.js";
import { readScenarios, heldTeams } from "./scenarios.js";
import { withInFigures } from "./out-pool.js";
import { readOverrides, mergeOverrides } from "./overrides.js";
import { MARK_MODES, marksOrNone, marksTrouble } from "./mode-marks.js";
import { withModes } from "../board/mode-rows.js";
import { fail } from "./http-helpers.js";

/** The teams the board is held for, for mergeOverrides' guard on the teams it is not (R4); null when the scenarios file cannot be read, so no comparison is made (the board foot names held numbers a resend did not refresh). */
function heldFor(slate) {
  try { return heldTeams(readScenarios(slate)); } catch (e) {
    warn("the scenarios file could not be read, so no stored send number is compared with the engine", { slate, message: e.message });
    return null;
  }
}

/**
 * Players with the overrides merged, as the board, the optimizer and the console's answers all build them. `mode` named (a build, an Entries
 * re-fill of one mode): that mode's thumbs and stars, throwing OVERRIDES_UNREADABLE when they cannot be read. No mode (the board and every answer
 * the page draws, mode-rows.js): the shared rows with GPP's thumbs and stars on top (the shared figures alone while GPP's cannot be read), and each
 * row's `modes` part per mode, a mode that cannot be read given the shared figures and marked marks_unknown (the page foot says so; its builds refuse).
 */
export function mergedFor(slate, players, overrides, { mode = null } = {}) {
  const held = heldFor(slate);
  const merge = (o, m) => withInFigures(mergeOverrides(players, o, { held, mode: m }));
  if (mode) return merge(overrides, mode);
  const shared = () => merge({ ...(overrides ?? {}), modes: undefined, bump: {}, stars: [] }, "GPP"); // no thumbs and no stars: the shared figures
  const byMode = {}, unknown = {};
  for (const m of MARK_MODES) {
    if (marksOrNone(overrides, m).unreadable) { byMode[m] = shared(); unknown[m] = true; } else byMode[m] = merge(overrides, m);
  }
  return withModes(byMode.GPP, byMode, unknown);
}

/** What the page foot says about each mode's thumbs and stars (mode-marks.js marksTrouble), or null when the overrides cannot be read at all (the board then answers 500). */
export function marksFoot(slate) {
  try { return marksTrouble(readOverrides(slate)); } catch (e) { if (!e?.code?.startsWith?.("OVERRIDES_")) throw e; return null; }
}

/**
 * The slate's players with Adam's overrides applied (server/slate/overrides.js): the effective projection, value and
 * ownership every reader uses. Returns null after sending a 500 when the overrides file cannot be read (never the base
 * figures in its place: a build or a board on the wrong numbers would be worse than none). `mode`: as mergedFor's; a build names
 * its own, and a mode whose thumbs and stars cannot be read then refuses too (500, OVERRIDES_UNREADABLE).
 */
export function effectivePlayers(res, slate, slateData, opts = null, mode = null) {
  try {
    return mergedFor(slate, withOurs(slate, slateData, opts).players ?? [], readOverrides(slate), { mode });
  } catch (e) {
    if (!e?.code?.startsWith?.("OVERRIDES_")) throw e;
    error("overrides unreadable", { slate, mode, message: e.message });
    fail(res, 500, e.code, e.message);
    return null;
  }
}

/** The slate with our minutes engine's figures (server/minutes/board.js) when the server has it wired (opts.ourProjection; the app does, the tests and the site do not); otherwise as built. */
export const withOurs = (slate, slateData, opts) => (opts?.ourProjection ? opts.ourProjection(slate, slateData, { nowMs: opts.now() }) : slateData);
