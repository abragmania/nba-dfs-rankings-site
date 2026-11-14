// POST /api/slate/<slate>/resend: the held-team resend (resend.js) run INSIDE the app, for update_cycle.mjs when the app answers on its port (R4, 11-13). The app is the one writer of overrides.json and
// scenarios.json while it runs; the cycle's own process would race its saves. Origin and content type are checked as every write is (openSlate); the usage table is awaited FIRST, then resendHeld
// runs from its read to its write with no await, so it cannot interleave with another request's save.
import { resendHeld } from "./resend.js";
import { USAGE_OFF } from "./console-route.js";

const FILE_ERROR = /^(SCENARIOS_|OVERRIDES_)/;

/** ctx: { send, fail, readJson, openSlate, usageTable, ourPlayers, now, error }. Answers resendHeld's { status, note, sent, teams }. */
export async function handleResend(req, res, slate, ctx) {
  if (req.method !== "POST") return ctx.fail(res, 405, "METHOD", "POST only.");
  const slateData = ctx.openSlate(req, res, slate, "A resend");
  if (!slateData) return;
  if (!(await ctx.readJson(req, res))) return;
  const usage = ctx.usageTable ? await ctx.usageTable() : USAGE_OFF;
  try {
    return ctx.send(res, 200, resendHeld(slate, { usage, nowMs: ctx.now(), ourPlayers: ctx.ourPlayers }));
  } catch (e) {
    if (FILE_ERROR.test(e?.code ?? "")) return ctx.fail(res, 500, e.code, e.message);
    throw e;
  }
}
