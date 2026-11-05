// The scenario console's routes, called from server.js with its shared helpers:
//   GET  /api/slate/<slate>/console          the inputs and his saved work
//   POST /api/slate/<slate>/scenarios        { team, record } saves one team's work
//   POST /api/slate/<slate>/console/apply    { scenarios, preview: true } what Apply would change, nothing written;
//                                            { scenarios, basis } sends each team's on-screen scenario; a basis that no longer matches is refused
//   POST /api/slate/<slate>/console/reverse  { preview: true } what a reverse would restore; {} restores only what Apply set
// Writes go through openSlate (origin and content type, as the overrides route) and read the files only after the body has arrived,
// so overlapping POSTs each apply onto the other's saved result. Like the overrides route they carry no lock check: late swap builds
// read the overrides after the main lock.
import { refuseCrossSiteRead } from "../lib/origin.js";
import { error } from "../../site/shim/log.js";
import { SLATE_NAME } from "./store.js";
import { buildInputs } from "../../site/shim/app-only.js";
import { readScenarios, writeScenarios, checkTeamBody } from "./scenarios.js";
import { planApply, applyRecord, reverseChanges, checkKeys } from "./console-apply.js";
import { readOverrides, writeOverrides, applyChanges, mergeOverrides } from "./overrides.js";

export const USAGE_OFF = { state: "off", message: "The usage table is not connected on this server." };

const FILE_ERROR = /^(SCENARIOS_|OVERRIDES_)/;
const answerFileError = (res, ctx, slate, e) => {
  if (!FILE_ERROR.test(e?.code ?? "")) return false;
  error("console files unreadable", { slate, message: e.message });
  ctx.fail(res, 500, e.code, e.message);
  return true;
};

const usageState = async (ctx) => (ctx.usageTable ? ctx.usageTable() : USAGE_OFF);

/** Inputs for a request, or null after answering 500 for a row that cannot be read (never older figures in its place). */
async function inputsFor(res, ctx, slate, slateData) {
  const usage = await usageState(ctx);
  try {
    return buildInputs(slate, slateData, { usage, nowMs: ctx.now() });
  } catch (e) {
    error("console inputs unreadable", { slate, message: e.message });
    ctx.fail(res, 500, "CONSOLE_INPUTS", `The console's inputs could not be read: ${e.message}`);
    return null;
  }
}

const publicPlan = ({ changes, rows, min_moves, teams, refused, kept, missing, clamped, back_on_zero, not_on_board, back_in, orphaned_pins, unchanged, basis }) => ({ changes, rows, min_moves, teams, refused, kept, missing, clamped, back_on_zero, not_on_board, back_in, orphaned_pins, unchanged, basis });
/** count: men whose projection an Apply set. min_count: men holding applied minutes, read from the overrides, the only place they are kept. */
const appliedView = (applied, overrides) => (applied ? { at: applied.at, count: Object.keys(applied.set).length, min_count: Object.keys(overrides.min ?? {}).length, keys: applied.keys ?? {} } : null);

async function handleRead(req, res, slate, ctx) {
  if (req.method !== "GET") return ctx.fail(res, 405, "METHOD", "GET only.");
  if (!SLATE_NAME.test(slate)) return ctx.fail(res, 400, "BAD_SLATE", "Slate names look like 2026-10-29-main.");
  const refused = refuseCrossSiteRead(req.headers);
  if (refused) return ctx.fail(res, refused.status, refused.code, refused.message);
  const slateData = ctx.openSlate(req, res, slate, "The console's data");
  if (!slateData) return;
  const inputs = await inputsFor(res, ctx, slate, slateData);
  if (!inputs) return;
  try {
    const file = readScenarios(slate);
    ctx.send(res, 200, { inputs, scenarios: { teams: file.teams, applied: appliedView(file.applied, readOverrides(slate)) } });
  } catch (e) {
    if (!answerFileError(res, ctx, slate, e)) throw e;
  }
}

async function handleSave(req, res, slate, ctx) {
  if (req.method !== "POST") return ctx.fail(res, 405, "METHOD", "POST only.");
  const slateData = ctx.openSlate(req, res, slate, "Scenarios");
  if (!slateData) return;
  const read = await ctx.readJson(req, res);
  if (!read) return;
  const checked = checkTeamBody(read.body, slateData);
  if (!checked.ok) return ctx.fail(res, 400, "BAD_SCENARIOS", checked.message);
  try {
    const file = readScenarios(slate); // only after the body has arrived: nothing awaits from here to the write
    writeScenarios(slate, { ...file, teams: { ...file.teams, [checked.team]: checked.record } });
    ctx.send(res, 200, { saved: checked.team });
  } catch (e) {
    if (!answerFileError(res, ctx, slate, e)) throw e;
  }
}

/** The record first, so a failed overrides write has nothing of its own to reverse; on that failure the record goes back as it was. */
function writeApply(slate, file, overrides, rec, players) {
  writeScenarios(slate, { ...file, applied: rec.applied });
  try {
    return writeOverrides(slate, applyChanges(overrides, rec.changes, players));
  } catch (e) {
    writeScenarios(slate, file);
    throw e;
  }
}

async function handleApply(req, res, slate, ctx) {
  if (req.method !== "POST") return ctx.fail(res, 405, "METHOD", "POST only.");
  const slateData = ctx.openSlate(req, res, slate, "An Apply");
  if (!slateData) return;
  const read = await ctx.readJson(req, res);
  if (!read) return;
  const inputs = await inputsFor(res, ctx, slate, slateData);
  if (!inputs) return;
  // A console left open across a pull holds an old Tonight: what it reads as a chosen scenario would be sent as one.
  if (Object.hasOwn(read.body ?? {}, "pull") && read.body.pull !== inputs.basis.pull) return ctx.fail(res, 409, "CONSOLE_OLD_PULL", "A new pull has landed since this console opened, so nothing was applied. Go back to the board and open the console again, then Apply.");
  const checked = checkKeys(read.body?.scenarios, inputs);
  if (!checked.ok) return ctx.fail(res, 400, "BAD_SCENARIO", checked.message);
  const players = slateData.players ?? [];
  try {
    const file = readScenarios(slate), overrides = readOverrides(slate);
    const plan = planApply(inputs, file, overrides, players, checked.keys);
    if (read.body.preview === true) return ctx.send(res, 200, { ...publicPlan(plan), usage: inputs.usage });
    if (inputs.usage.state === "loading") return ctx.fail(res, 409, "USAGE_LOADING", "The usage table is still loading; try Apply again in a moment.");
    if (read.body.basis !== plan.basis) return ctx.fail(res, 409, "CONSOLE_MOVED", "The numbers moved since the preview, so nothing was applied. Look again.");
    if (!plan.changes.length && !plan.min_moves) return ctx.send(res, 200, { applied: appliedView(file.applied, overrides), changed: 0, min_changed: 0, refused: plan.refused, players: mergeOverrides(players, overrides) });
    const rec = applyRecord(plan, overrides, file.applied, new Date(ctx.now()).toISOString());
    const written = writeApply(slate, file, overrides, rec, players);
    ctx.send(res, 200, { applied: appliedView(rec.applied, written), changed: plan.changes.length, min_changed: plan.min_moves, refused: plan.refused, players: mergeOverrides(players, written) });
  } catch (e) {
    if (!answerFileError(res, ctx, slate, e)) throw e;
  }
}

async function handleReverse(req, res, slate, ctx) {
  if (req.method !== "POST") return ctx.fail(res, 405, "METHOD", "POST only.");
  const slateData = ctx.openSlate(req, res, slate, "A reverse");
  if (!slateData) return;
  const read = await ctx.readJson(req, res);
  if (!read) return;
  const players = slateData.players ?? [];
  try {
    const file = readScenarios(slate), overrides = readOverrides(slate);
    if (!file.applied) return ctx.fail(res, 409, "NOTHING_APPLIED", "Nothing has been applied on this slate.");
    const rev = reverseChanges(file.applied, overrides, players);
    if (read.body?.preview === true) return ctx.send(res, 200, { restored: rev.restored, restored_min: rev.restored_min, kept: rev.kept, at: file.applied.at });
    const written = writeOverrides(slate, applyChanges(overrides, rev.changes, players));
    writeScenarios(slate, { ...file, applied: null });
    ctx.send(res, 200, { applied: null, restored: rev.restored, restored_min: rev.restored_min, kept: rev.kept, players: mergeOverrides(players, written) });
  } catch (e) {
    if (!answerFileError(res, ctx, slate, e)) throw e;
  }
}

/** The console's routes for a path, or null when the path is not one of them. */
export function consoleHandler(pathname) {
  const m = /^\/api\/slate\/([^/]+)\/(console|scenarios|console\/apply|console\/reverse)$/.exec(pathname);
  if (!m) return null;
  const handler = { console: handleRead, scenarios: handleSave, "console/apply": handleApply, "console/reverse": handleReverse }[m[2]];
  return { encodedSlate: m[1], handler };
}
