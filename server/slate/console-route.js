// The scenario console's routes, called from server.js with its shared helpers:
//   GET  /api/slate/<slate>/console          the inputs and his saved work
//   POST /api/slate/<slate>/scenarios        { team, record, base?, seen? } saves one team's work; a base (his_at) or seen (the record's sig) that no longer matches the disk is refused
//   POST /api/slate/<slate>/console/apply    { scenarios, teams?, preview: true } what Apply would change, nothing written (teams: only those are planned);
//                                            { scenarios, basis, file_base?, seen? } sends each team's on-screen scenario; a basis, file_base or seen that no longer matches is refused
//   POST /api/slate/<slate>/console/reverse  { preview: true } what a reverse would restore; {} restores only what Apply set
// Writes go through openSlate (origin and content type, as the overrides route) and read the files only after the body has arrived,
// so overlapping POSTs each apply onto the other's saved result. Like the overrides route they carry no lock check: late swap builds
// read the overrides after the main lock.
import { refuseCrossSiteRead } from "../lib/origin.js";
import { error } from "../../site/shim/log.js";
import { SLATE_NAME } from "./store.js";
import { buildInputs } from "../../site/shim/app-only.js";
import { readScenarios, writeScenarios, checkTeamBody } from "./scenarios.js";
import { planApply, applyRecord, reverseChanges, checkKeys, checkTeams, sourceRefusal } from "./console-apply.js";
import { readOverrides, writeOverrides, applyChanges, mergeOverrides } from "./overrides.js";
import { basePlayers } from "./base-players.js";
import { recordSig } from "../board/console-model.js";

export const USAGE_OFF = { state: "off", message: "The usage table is not connected on this server." };

const FILE_ERROR = /^(SCENARIOS_|OVERRIDES_)/;
const answerFileError = (res, ctx, slate, e) => {
  if (!FILE_ERROR.test(e?.code ?? "")) return false;
  error("console files unreadable", { slate, message: e.message });
  ctx.fail(res, 500, e.code, e.message);
  return true;
};

/** Whether his write must wait: GitHub's data is coming down (ctx.syncBusy, the app's pullnow/sync-flag.js; the public site has none), so it never lands between the set-aside and the put-back. True after answering 409. */
const syncRefusal = async (res, ctx) => { const busy = (await ctx.syncBusy?.()) ?? null; if (!busy) return false; ctx.fail(res, 409, "SYNC_RUNNING", busy); return true; };
const hisNow = (ctx) => new Date(ctx.now()).toISOString(); // the time of his click: it becomes his_at on what he writes (scenarios.js, overrides.js)

const usageState = async (ctx) => (ctx.usageTable ? ctx.usageTable() : USAGE_OFF);

const SIG = /^[0-9a-f]{1,32}$/;
/** A body's `seen` ({ TEAM: sig } on a send, one sig on a save; console-model.js recordSig): null when absent or well formed, else why. Outside input, checked before any file is read. */
export function badSeen(seen, one) {
  if (seen === undefined) return null;
  if (one) return typeof seen === "string" && SIG.test(seen) ? null : '"seen" must be the record\'s sig as the page last saw it.';
  const ok = seen && typeof seen === "object" && !Array.isArray(seen) && Object.keys(seen).length <= 60 && Object.entries(seen).every(([t, s]) => /^[A-Z]{2,4}$/.test(t) && typeof s === "string" && SIG.test(s));
  return ok ? null : '"seen" must name each team\'s record sig as the page last saw it.';
}
/** The teams whose record on disk is not the one the page last saw (11-13 audit, state 1): any write since its read, the server's own (news, what-if, resend) included. */
const movedTeams = (seen, file) => Object.entries(seen ?? {}).filter(([t, s]) => s !== recordSig(file.teams[t])).map(([t]) => t).sort();
const movedWords = (teams, did) => `${teams.join(", ")}'s saved work changed since this page read it (the lineup news, a pull or another page wrote it), so nothing was ${did} over it.`;

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

const publicPlan = ({ changes, rows, min_moves, flag_moves, holds, teams, refused, kept, missing, clamped, back_on_zero, not_on_board, back_in, orphaned_pins, unchanged, basis }) => ({ changes, rows, min_moves, flag_moves, holds, teams, refused, kept, missing, clamped, back_on_zero, not_on_board, back_in, orphaned_pins, unchanged, basis });
/** count: men whose projection an Apply set. min_count: men holding applied minutes, read from the overrides, the only place they are kept. */
const appliedView = (applied, overrides) => (applied ? { at: applied.at, count: Object.keys(applied.set).length, min_count: Object.keys(overrides.min ?? {}).length, keys: applied.keys ?? {}, set: Object.fromEntries(Object.entries(applied.set).map(([id, e]) => [id, e.to])) } : null); // set: { id: the number the Apply wrote }, so the page does not call it his

async function handleRead(req, res, slate, ctx) {
  if (req.method !== "GET") return ctx.fail(res, 405, "METHOD", "GET only.");
  if (!SLATE_NAME.test(slate)) return ctx.fail(res, 400, "BAD_SLATE", "Slate names look like 2026-10-29-main.");
  const refused = refuseCrossSiteRead(req.headers);
  if (refused) return ctx.fail(res, refused.status, refused.code, refused.message);
  const slateData = ctx.openSlate(req, res, slate, "The console's data");
  if (!slateData) return;
  const inputs = await inputsFor(res, ctx, slate, slateData);
  if (!inputs) return;
  ctx.benchPlus?.(slate, inputs); // each charted team's Bench+ suggestions (minutes/route.js consoleBenchPlus; app only, never throws)
  try {
    const file = readScenarios(slate);
    ctx.send(res, 200, { inputs, scenarios: { teams: file.teams, applied: appliedView(file.applied, readOverrides(slate)), his_at: file.his_at ?? null } }); // his_at: the stamp the page sends back as `base`, so a stale page cannot write over a brought-down record
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
  const seenWhy = badSeen(read.body.seen, true);
  if (seenWhy) return ctx.fail(res, 400, "BAD_SCENARIOS", seenWhy);
  if (await syncRefusal(res, ctx)) return;
  try {
    const file = readScenarios(slate); // only after the body has arrived: nothing awaits from here to the write
    // A page that saw an older record than the disk holds (GitHub's data came down since, or another page wrote) must not write over it: it is told, takes the disk's work and says so.
    if (Object.hasOwn(read.body, "base") && (read.body.base ?? null) !== (file.teams[checked.team]?.his_at ?? null)) return ctx.fail(res, 409, "CHANGED_ELSEWHERE", `${checked.team}'s saved work changed since this page read it (another page, or the other computer's work came down), so nothing was written over it.`);
    // `seen`: the record as the page last read or wrote it, so a write that carried his_at (the news pass, a what-if, a resend) is seen too (11-13 audit, state 1).
    if (read.body.seen !== undefined && movedTeams({ [checked.team]: read.body.seen }, file).length) return ctx.fail(res, 409, "CHANGED_ELSEWHERE", movedWords([checked.team], "written"));
    // `auto`: no click of his started this save (a load, a pull, the lineup bar's news), so his_at is carried and only a click moves it.
    const written = writeScenarios(slate, { ...file, teams: { ...file.teams, [checked.team]: checked.record } }, { his: read.body.auto === true ? null : hisNow(ctx), team: checked.team });
    ctx.send(res, 200, { saved: checked.team, his_at: written.teams[checked.team]?.his_at ?? null, file_his_at: written.his_at ?? null, seen: recordSig(readScenarios(slate).teams[checked.team]) }); // seen: as read back, the stamps block rejoined
  } catch (e) {
    if (!answerFileError(res, ctx, slate, e)) throw e;
  }
}

/** The record first, so a failed overrides write has nothing of its own to reverse; on that failure the record goes back as it was. The one path that writes a send, a press's or the server's news (news-apply.js). */
export function writeApply(slate, file, overrides, rec, players, his = null) {
  writeScenarios(slate, { ...file, applied: rec.applied }, { his }); // his: the time of his own click, null for the server's resend and news (they carry his_at unchanged)
  try {
    return writeOverrides(slate, applyChanges(overrides, rec.changes, players), { his });
  } catch (e) {
    writeScenarios(slate, file);
    throw e;
  }
}

async function handleApply(req, res, slate, ctx) {
  if (req.method !== "POST") return ctx.fail(res, 405, "METHOD", "POST only.");
  const slateData = ctx.openSlate(req, res, slate, "A send");
  if (!slateData) return;
  const read = await ctx.readJson(req, res);
  if (!read) return;
  const inputs = await inputsFor(res, ctx, slate, slateData);
  if (!inputs) return;
  const unknown = sourceRefusal(inputs);
  if (unknown) return ctx.fail(res, 409, "CONSOLE_SOURCE_UNKNOWN", `Nothing was sent: ${unknown}.`);
  // A console left open across a setting change opens teams on another default: what it reads as TwoGun's or Ours' minutes would be sent as the other (the page reads its inputs again and sends once more).
  if (Object.hasOwn(read.body ?? {}, "source_default") && read.body.source_default !== (inputs.source_default ?? null)) return ctx.fail(res, 409, "CONSOLE_OLD_PULL", "The minutes setting changed since this console read its inputs, so nothing was sent. The console reads the new setting and sends again by itself.");
  // A console left open across a pull holds an old Tonight: what it reads as a chosen scenario would be sent as one.
  if ((Object.hasOwn(read.body ?? {}, "pull") && read.body.pull !== inputs.basis.pull) || (Object.hasOwn(read.body ?? {}, "tier") && read.body.tier !== (inputs.basis.tier ?? null))) return ctx.fail(res, 409, "CONSOLE_OLD_PULL", "A new pull has landed since this console read its inputs, so nothing was sent. The console reads the new pull and sends again by itself.");
  const checked = checkKeys(read.body?.scenarios, inputs), teams = checkTeams(read.body?.teams, inputs);
  if (!checked.ok) return ctx.fail(res, 400, "BAD_SCENARIO", checked.message);
  if (!teams.ok) return ctx.fail(res, 400, "BAD_SCENARIO", teams.message);
  const seenWhy = badSeen(read.body.seen, false);
  if (seenWhy) return ctx.fail(res, 400, "BAD_SCENARIO", seenWhy);
  const players = basePlayers(slate, slateData, ctx.now(), ctx.ourPlayers).players; // the board's own figures (the engine's on), the same base the server's resend plans against
  const shown = () => (ctx.effectivePlayers ? ctx.effectivePlayers(res, slate, slateData) : mergeOverrides(players, readOverrides(slate))); // the answer's players are built as the board builds them (null after a 500)
  if (read.body?.preview !== true && await syncRefusal(res, ctx)) return; // asked before the files are read: a send waits while GitHub's data comes down
  const his = read.body?.auto === true ? null : hisNow(ctx); // `auto`: no click of his started this send (a load, a pull, the lineup bar's news), so his_at is carried; only a click moves it
  try {
    const file = readScenarios(slate), overrides = readOverrides(slate);
    const plan = planApply(inputs, file, overrides, players, checked.keys, teams.only);
    if (read.body.preview === true) return ctx.send(res, 200, { ...publicPlan(plan), usage: inputs.usage });
    if (inputs.usage.state === "loading") return ctx.fail(res, 409, "USAGE_LOADING", "The usage table is still loading; try again in a moment.");
    if (read.body.basis !== plan.basis) return ctx.fail(res, 409, "CONSOLE_MOVED", "The numbers moved since the preview, so nothing was sent. Look again.");
    // A page that read the scenarios file before GitHub's data came down (or another page wrote) must not send over what is there now.
    if (Object.hasOwn(read.body, "file_base") && (read.body.file_base ?? null) !== (file.his_at ?? null)) return ctx.fail(res, 409, "CHANGED_ELSEWHERE", "Your saved work changed since this page read it (another page, or the other computer's work came down), so nothing was sent.");
    const moved = movedTeams(read.body.seen, file); // a team record the server wrote since the page's read (news, what-if, resend: his_at carried); the page reads again and sends once more (console-auto.js sendWith)
    if (moved.length) return ctx.fail(res, 409, "CHANGED_ELSEWHERE", movedWords(moved, "sent"));
    if (!plan.changes.length && !plan.min_moves && !plan.flag_moves && !plan.dropped) {
      if (plan.holds) writeScenarios(slate, { ...file, applied: applyRecord(plan, overrides, file.applied, new Date(ctx.now()).toISOString()).applied }, { his }); // no number moved, but the mark is held: only the record is written
      const held = plan.holds ? readScenarios(slate).applied : file.applied;
      const now = shown();
      if (!now) return;
      return ctx.send(res, 200, { applied: appliedView(held, overrides), changed: 0, min_changed: 0, refused: plan.refused, missing: plan.missing, players: now, his_at: readScenarios(slate).his_at ?? null });
    }
    const rec = applyRecord(plan, overrides, file.applied, new Date(ctx.now()).toISOString());
    const written = writeApply(slate, file, overrides, rec, players, his);
    const now = shown();
    if (!now) return;
    ctx.send(res, 200, { applied: appliedView(rec.applied, written), changed: plan.changes.length, min_changed: plan.min_moves, refused: plan.refused, missing: plan.missing, players: now, his_at: his ?? file.his_at ?? null });
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
  const players = basePlayers(slate, slateData, ctx.now(), ctx.ourPlayers).players;
  if (read.body?.preview !== true && await syncRefusal(res, ctx)) return; // asked before the files are read
  try {
    const file = readScenarios(slate), overrides = readOverrides(slate);
    if (!file.applied) return ctx.fail(res, 409, "NOTHING_APPLIED", "Nothing has been applied on this slate.");
    const rev = reverseChanges(file.applied, overrides, players);
    if (read.body?.preview === true) return ctx.send(res, 200, { restored: rev.restored, restored_min: rev.restored_min, kept: rev.kept, at: file.applied.at });
    writeOverrides(slate, applyChanges(overrides, rev.changes, players), { his: hisNow(ctx) });
    writeScenarios(slate, { ...file, applied: null }, { his: hisNow(ctx) });
    const now = ctx.effectivePlayers ? ctx.effectivePlayers(res, slate, slateData) : mergeOverrides(players, readOverrides(slate));
    if (!now) return;
    ctx.send(res, 200, { applied: null, restored: rev.restored, restored_min: rev.restored_min, kept: rev.kept, players: now });
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
