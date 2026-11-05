// The public site's stand-in for the server: the page keeps calling the same /api paths, and this answers them in the browser by
// running the app's own request handler (server/server.js makeServer) on its own request and answer objects. Picks, overrides,
// lineups, the working lineup, the console, the optimizer's progress and Stop are therefore the app's own code; only its files differ
// (shim/fs.js: published files from baked/, a visitor's own in this browser). The two card routes read outside sites in the app, so
// here they answer from the card files baked at publish. Nothing leaves the browser except the reads of baked/.
import "./shim/globals.js";
import { makeServer } from "../server/server.js";
import { nameKey } from "../server/lib/names.js";
import { seed, dropKept } from "./shim/fs.js";

const DATA = "/data/slates";
const JSON_TYPE = { "content-type": "application/json; charset=utf-8" };
const bakedUrl = (rel) => new URL(`../baked/${rel}`, import.meta.url);
const answer = (status, body) => new Response(JSON.stringify(body), { status, headers: JSON_TYPE });
const refusal = (status, code, message) => answer(status, { error: { code, message } });
const aborted = () => new DOMException("The request was cancelled.", "AbortError");

/** The text of a baked file, or null when the site does not hold it. Any other failure throws: "not there" is said only when it is so. */
async function readBaked(rel) {
  const r = await fetch(bakedUrl(rel), { cache: "no-cache" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`the site answered ${r.status} for ${rel}`);
  return r.text();
}

// Each published file is read once per page, so the board and the optimizer use the same numbers until a reload.
const once = new Map();
function loadOnce(key, load) {
  if (!once.has(key)) {
    const p = load();
    p.catch(() => once.delete(key)); // a failed read is tried again next time
    once.set(key, p);
  }
  return once.get(key);
}
const seedBaked = (rel, file) => loadOnce(rel, async () => {
  const text = await readBaked(rel);
  if (text !== null) seed(file, text);
  return text;
});
const figuresOf = (slate) => seedBaked(`slates/${slate}/figures.json`, `${DATA}/${slate}/figures.json`).then((text) => (text === null ? null : JSON.parse(text)));

/** The board's season figures from the baked file: the app's seasonFigures hook, on the same player fields. */
async function bakedFigures(slate) {
  const f = await figuresOf(slate.slate);
  const missing = "Basketball-Reference season figures were not published with this slate";
  const blank = { dk_per_min: null, dk_per_min_note: missing, dk_per_min_tag: null, usage: null, usage_note: missing, usage_tag: null, min_usual_note: "usual minutes were not published with this slate" };
  // The slate-level half of the usual minutes (figures.json's `usual`) was applied by the shim's withUsualMinutes, at the app's step.
  return { ...slate, players: slate.players.map((p) => ({ ...p, ...(f?.players?.[p.dk_id] ?? blank) })), ...(f?.season_figures ? { season_figures: f.season_figures } : {}) };
}

const SLATE_FILES = ["slate.json", "figures.json", "console-inputs.json", "pull-moves.json"];
/**
 * The board's once-a-minute check reads the baked pull stamp afresh, so a publish made while the page is open reaches it: when the stamp has
 * moved, the slate's files are let go and the board's next read of the slate takes the new ones, as a new pull does in the app.
 */
async function freshStamp(slate) {
  const rel = `slates/${slate}/pull-moves.json`;
  const text = await readBaked(rel);
  if (text === null) return null;
  const held = once.has(rel) ? await once.get(rel).catch(() => null) : null;
  if (held !== null && held !== text) {
    for (const f of SLATE_FILES) once.delete(`slates/${slate}/${f}`);
  }
  if (held === null || held !== text) once.set(rel, Promise.resolve(text));
  seed(`${DATA}/${slate}/pull-moves.json`, text);
  return text;
}

/** The published files a path needs, in memory before the app's handler reads them. */
async function loadFor(pathname) {
  if (pathname === "/api/slates") return seedBaked("slates.json", `${DATA}/manifest.json`);
  const m = /^\/api\/slate\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!m) return null;
  let slate;
  try {
    slate = decodeURIComponent(m[1]);
  } catch {
    return null; // the handler refuses the name
  }
  if (!/^[a-z0-9-]+$/.test(slate)) return null;
  if (m[2] === "/pull-stamp") return freshStamp(slate);
  const jobs = [seedBaked(`slates/${slate}/slate.json`, `${DATA}/${slate}/slate.json`), seedBaked(`slates/${slate}/pull-moves.json`, `${DATA}/${slate}/pull-moves.json`), figuresOf(slate)];
  if (/^\/console/.test(m[2] ?? "")) jobs.push(seedBaked(`slates/${slate}/console-inputs.json`, `${DATA}/${slate}/console-inputs.json`));
  return Promise.all(jobs);
}

const server = makeServer({ seasonFigures: bakedFigures });

/** A request as the app's handler reads one. The body arrives once its reader is listening. */
function makeRequest(method, url, headers, body) {
  const on = {};
  let sent = false;
  return {
    method, url, headers, complete: true, destroyed: false,
    on(event, fn) {
      on[event] = fn;
      if (event === "end" && !sent) {
        sent = true;
        queueMicrotask(() => {
          if (body) on.data?.(new TextEncoder().encode(body));
          on.end?.();
        });
      }
      return this;
    },
  };
}

/** An answer as the app's handler writes one; `done` is settled with the Response, or rejected when the answer is dropped. */
function makeAnswer() {
  const on = {};
  const chunks = [];
  let status = 200, resolve, reject;
  const done = new Promise((res, rej) => { resolve = res; reject = rej; });
  const res = {
    headersSent: false, destroyed: false, closed: false, writableFinished: false, shouldKeepAlive: true, socket: { destroyed: false },
    on(event, fn) { on[event] = fn; return this; },
    writeHead(code) { status = code; res.headersSent = true; return this; },
    write(text) { res.headersSent = true; chunks.push(text); return true; },
    end(text) {
      if (text != null) chunks.push(text);
      res.headersSent = true; res.writableFinished = true; res.closed = true;
      resolve(new Response(chunks.join(""), { status, headers: JSON_TYPE }));
      on.close?.();
    },
    destroy() {
      res.destroyed = true; res.closed = true;
      reject(aborted());
      on.close?.();
    },
  };
  /** The caller went away: the handler hears what a dropped connection tells it. */
  const drop = () => { if (!res.writableFinished && !res.destroyed) res.destroy(); };
  return { res, done, drop };
}

function runHandler(method, url, headers, body, signal) {
  const { res, done, drop } = makeAnswer();
  if (signal?.aborted) return Promise.reject(aborted());
  signal?.addEventListener("abort", drop, { once: true });
  server.handler(makeRequest(method, url, headers, body), res);
  return done.finally(() => signal?.removeEventListener("abort", drop));
}

// A visitor's own file that fails its check can only be fixed by removing it, and there is no one else to do that for him.
const DAMAGED = new Set(["OVERRIDES_UNREADABLE", "SCENARIOS_UNREADABLE"]);
async function damagedCode(response) {
  if (response.status !== 500) return null;
  try {
    const code = (await response.clone().json())?.error?.code;
    return DAMAGED.has(code) ? code : null;
  } catch {
    return null;
  }
}

async function appAnswer(method, pathname, url, headers, body, signal) {
  const first = await runHandler(method, url, headers, body, signal);
  const code = await damagedCode(first);
  if (!code) return first;
  const slate = decodeURIComponent(/^\/api\/slate\/([^/]+)/.exec(pathname)?.[1] ?? "");
  console.warn(`This browser's saved changes for ${slate} could not be read and were removed (${code}).`);
  dropKept(`${DATA}/${slate}/${code === "OVERRIDES_UNREADABLE" ? "overrides" : "scenarios"}.json`);
  return runHandler(method, url, headers, body, signal);
}

// ---------- the player card's two routes, from baked files ----------
const CARD_FILE = (params, kind) => {
  const name = params.get("name"), team = params.get("team");
  if (typeof name !== "string" || !/^[A-Z]{2,4}$/.test(team ?? "")) return null;
  const key = nameKey(name);
  return key ? `cards/${team}/${key}.${kind}.json` : null;
};
async function cardAnswer(method, params, kind, code, status, message) {
  if (method !== "GET") return answer(200, { closed: true }); // the app's card-close: nothing is running here to stop
  const rel = CARD_FILE(params, kind);
  const text = rel ? await readBaked(rel) : null;
  if (text === null) return refusal(status, code, message);
  return new Response(text, { status: 200, headers: JSON_TYPE });
}

/** Answers one /api request as the app would, as a Response; throws AbortError when the signal fires, as fetch does. */
export async function apiFetch(path, init = {}) {
  const url = new URL(path, "http://127.0.0.1");
  const method = (init.method ?? "GET").toUpperCase();
  try {
    if (url.pathname === "/api/player-log") return await cardAnswer(method, url.searchParams, "log", "NO_LOG", 404, "His game log is not on the public site yet.");
    if (url.pathname === "/api/player-usage") return await cardAnswer(method, url.searchParams, "usage", "NO_USAGE", 502, "His usage figures are not on the public site yet.");
    await loadFor(url.pathname);
  } catch (e) {
    return refusal(503, "SITE_READ", `The site's files could not be read (${e.message}). Check the connection and reload.`);
  }
  const headers = { host: "127.0.0.1", ...Object.fromEntries(new Headers(init.headers ?? {}).entries()) };
  return appAnswer(method, url.pathname, `${url.pathname}${url.search}`, headers, typeof init.body === "string" ? init.body : null, init.signal);
}

/** Sends the page's /api calls here; every other fetch goes out as usual. */
export function installApi(target = globalThis) {
  const real = target.fetch.bind(target);
  target.fetch = (input, init) => {
    const path = typeof input === "string" ? input : null;
    return path?.startsWith("/api/") ? apiFetch(path, init) : real(input, init);
  };
}
