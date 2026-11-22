// The server's shared request helpers: the answer writers, the body readers and the per-slate route start (name check, method,
// origin and JSON-only guard on a POST, slate read). Moved out of server/server.js unchanged (file split, 11-17); one copy.
import { refuseNonJsonPost } from "../lib/origin.js";
import { SLATE_NAME, readSlate } from "./store.js";

export const MAX_BODY = 64 * 1024;

export function send(res, status, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(text);
}
export const fail = (res, status, code, message) => send(res, status, { error: { code, message } });

/** Reads the request body up to MAX_BODY bytes; resolves null when it is larger or the client closed before sending it all. */
export function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (declared > max) return resolve(null);
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > max) {
        chunks.length = 0;
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(size > max ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("close", () => { if (!req.complete) resolve(null); }); // a dropped upload never leaves the handler waiting
    req.on("error", reject);
  });
}

/**
 * The shared start of a per-slate route: the name check (400), the method (405), a POST's origin and JSON-only guard
 * (403/415), and the slate read (404). Returns the slate data, or null when an answer has already been sent.
 */
export function openSlate(req, res, slate, what, { getOk = true } = {}) {
  if (!SLATE_NAME.test(slate)) { fail(res, 400, "BAD_SLATE", "Slate names look like 2026-10-29-main."); return null; }
  if (req.method === "POST") {
    const refused = refuseNonJsonPost(req.headers, `${what} must be sent as application/json.`);
    if (refused) { fail(res, refused.status, refused.code, refused.message); return null; }
  } else if (!(getOk && req.method === "GET")) {
    fail(res, 405, "METHOD", getOk ? "GET or POST only." : "POST only.");
    return null;
  }
  const slateData = readSlate(slate);
  if (!slateData) { fail(res, 404, "NO_SLATE", "No such slate."); return null; }
  return slateData;
}

/** Reads a POST's JSON body (64 KB at most unless the route passes its own limit). Returns { body }, or null when a 413 or 400 has already been sent. */
export async function readJson(req, res, max = MAX_BODY) {
  const text = await readBody(req, max);
  if (text === null) {
    if (!req.complete && (req.destroyed || res.destroyed)) return null; // the client is gone: nobody to answer
    res.shouldKeepAlive = false;
    fail(res, 413, "TOO_LARGE", `Body is over ${Math.round(max / 1024)} KB.`);
    return null;
  }
  try {
    const body = JSON.parse(text);
    req.jsonBody = body; // kept for the change log's door (change-log-hook.js), which names the change after the answer
    return { body };
  } catch {
    fail(res, 400, "BAD_JSON", "Body is not valid JSON.");
    return null;
  }
}
