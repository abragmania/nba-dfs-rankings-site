// The Scenario tab's routes (Adam 11-19 4:51-5:15 PM ET; 1:37-1:38 PM 11-20), called from server.js with its shared helpers:
//   GET  /api/slate/<slate>/whatifs          his saved what-ifs on the slate, and the server's last words on them (whatif-status.json)
//   POST /api/slate/<slate>/whatifs          { team, whatif } saves one (its men and starters are its id: the same ones replace it), armed unless he turned it off
//   POST /api/slate/<slate>/whatifs/arm      { team, id, armed } arms or disarms one
//   POST /api/slate/<slate>/whatifs/delete   { team, id } drops one
// Each write goes through openSlate (origin and JSON content type, as the console's routes), refuses while GitHub's data comes down or when that cannot be asked (fails closed), stamps the team's and
// the file's his_at with his click, and then at once runs the what-if step and the held teams' send on the newest slate (whatif-arm.js armAndSend; the money review's finding 3), answering with
// what happened on the board. The usage table is awaited before the files are read, so nothing awaits between the read and the write. The public site's server has no usage table: there the
// write stays in the visitor's browser and nothing is sent, said (site-src/static-api.js).
import { refuseCrossSiteRead } from "../lib/origin.js";
import { error } from "../../site/shim/log.js";
import { SLATE_NAME } from "./store.js";
import { isPlain } from "../board/figures.js";
import { readWhatifs, writeWhatifs, readStatus, checkSave, putWhatif, armWhatif, dropWhatif } from "./whatifs.js";
import { armAndSend } from "./whatif-arm.js";

const fileFailed = (res, ctx, slate, e) => {
  if (!/^(WHATIFS_|SCENARIOS_|OVERRIDES_)/.test(e?.code ?? "")) return false;
  error("what-ifs: a file could not be used", { slate, message: e.message });
  ctx.fail(res, 500, e.code, e.message);
  return true;
};
/** Whether his write must wait: GitHub's data is coming down (ctx.syncBusy), or there is no way to ask (fails closed, finding 12). True after answering. */
async function syncRefusal(res, ctx) {
  if (typeof ctx.syncBusy !== "function") { ctx.fail(res, 500, "SYNC_UNKNOWN", "This server cannot tell whether GitHub's data is coming down, so nothing was written."); return true; }
  const busy = (await ctx.syncBusy()) ?? null;
  if (!busy) return false;
  ctx.fail(res, 409, "SYNC_RUNNING", busy);
  return true;
}
const hisNow = (ctx) => new Date(ctx.now()).toISOString();

async function handleRead(req, res, slate, ctx) {
  if (req.method !== "GET") return ctx.fail(res, 405, "METHOD", "GET only.");
  if (!SLATE_NAME.test(slate)) return ctx.fail(res, 400, "BAD_SLATE", "Slate names look like 2026-10-29-main.");
  const refused = refuseCrossSiteRead(req.headers);
  if (refused) return ctx.fail(res, refused.status, refused.code, refused.message);
  try { return ctx.send(res, 200, { whatifs: readWhatifs(slate), status: readStatus(slate) }); } catch (e) { if (!fileFailed(res, ctx, slate, e)) throw e; }
}

/** The shared start of a write: { slateData, body, usage } or null once answered. The usage table is awaited first, then the sync check, then nothing awaits until the write is done. */
async function openWrite(req, res, slate, ctx, what) {
  if (req.method !== "POST") { ctx.fail(res, 405, "METHOD", "POST only."); return null; }
  const slateData = ctx.openSlate(req, res, slate, what);
  if (!slateData) return null;
  const read = await ctx.readJson(req, res);
  if (!read) return null;
  if (!isPlain(read.body)) { ctx.fail(res, 400, "BAD_WHATIF", "Body must be a JSON object."); return null; }
  const usage = ctx.usageTable ? await ctx.usageTable() : null; // round 2, finding 3: the last wait before the sync check, so nothing awaits between the check and the read and write
  if (await syncRefusal(res, ctx)) return null;
  return { slateData, body: read.body, usage };
}

/** After his write: the step and the send at once, or why not. Never throws for a file it cannot use: that is said in the answer, his write already stands. */
function sendNow(slate, ctx, usage) {
  if (!ctx.usageTable) return { status: "skipped", note: "this copy of the app never sends what-ifs to the board (the public site)", notes: [], sent: 0 };
  try { return armAndSend(slate, { usage, nowMs: ctx.now(), ...(ctx.ourPlayers ? { ourPlayers: ctx.ourPlayers } : {}) }); } catch (e) {
    error("what-ifs: the send after his write failed", { slate, message: e.message });
    return { status: "failed", note: `saved, but the board was not updated: ${e.message}; the next news pass tries again`, notes: [], sent: 0 };
  }
}

async function handleSave(req, res, slate, ctx) {
  const w = await openWrite(req, res, slate, ctx, "A what-if");
  if (!w) return;
  const his = hisNow(ctx), checked = checkSave(w.body, w.slateData, his);
  if (!checked.ok) return ctx.fail(res, 400, "BAD_WHATIF", checked.message);
  try {
    const written = writeWhatifs(slate, putWhatif(readWhatifs(slate), checked.team, checked.whatif, his), { his });
    ctx.send(res, 200, { saved: checked.whatif.id, stripped: checked.stripped, whatifs: written, send: sendNow(slate, ctx, w.usage), status: readStatus(slate) });
  } catch (e) { if (!fileFailed(res, ctx, slate, e)) throw e; }
}

/** Arm (or disarm) and delete: one what-if named by team and id. */
async function handleOne(req, res, slate, ctx, kind) {
  const w = await openWrite(req, res, slate, ctx, kind === "arm" ? "Arming a what-if" : "Dropping a what-if");
  if (!w) return;
  const { team, id, armed } = w.body;
  if (typeof team !== "string" || typeof id !== "string" || (kind === "arm" && typeof armed !== "boolean")) return ctx.fail(res, 400, "BAD_WHATIF", kind === "arm" ? "Body must be { team, id, armed }." : "Body must be { team, id }.");
  try {
    const his = hisNow(ctx), doc = readWhatifs(slate), next = kind === "arm" ? armWhatif(doc, team, id, armed, his) : dropWhatif(doc, team, id, his);
    if (!next) return ctx.fail(res, 404, "NO_WHATIF", "No such what-if on that team.");
    const written = writeWhatifs(slate, next, { his });
    ctx.send(res, 200, { whatifs: written, send: sendNow(slate, ctx, w.usage), status: readStatus(slate) });
  } catch (e) { if (!fileFailed(res, ctx, slate, e)) throw e; }
}

/** The what-if routes for a path, or null when the path is not one of them. */
export function whatifHandler(pathname) {
  const m = /^\/api\/slate\/([^/]+)\/whatifs(?:\/(arm|delete))?$/.exec(pathname);
  if (!m) return null;
  const handler = !m[2] ? (req, res, slate, ctx) => (req.method === "GET" ? handleRead(req, res, slate, ctx) : handleSave(req, res, slate, ctx)) : (req, res, slate, ctx) => handleOne(req, res, slate, ctx, m[2]);
  return { encodedSlate: m[1], handler };
}
