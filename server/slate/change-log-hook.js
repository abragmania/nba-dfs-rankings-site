// The change log's door on the app's own writes (server/slate/change-log.js): which POST moves a man's projection inputs, who made it and in what words. server.js wraps each answer's end:
// a POST that answered 200 on one of these routes is logged on the turn after its answer is written, from the body readJson kept (http-helpers.js); on a slate with no state yet the board is read
// just before the handler runs, so his first change is logged too. Only the app wires it (makeServer's changeLog);
// the public site and the tests that do not ask for it log nothing.
import { listSlates, SLATE_NAME } from "./store.js";
import { recordBoard, snapshotIfNew } from "./change-log.js";
import { warn } from "../../site/shim/log.js";

const MODE = (b) => (b?.mode === "Cash" || b?.mode === "GPP" ? ` (${b.mode})` : "");
const val = (v) => (v === null || v === undefined ? null : typeof v === "number" ? String(Math.round(v * 100) / 100) : String(v).slice(0, 40));
const ids = (sec) => (sec && typeof sec === "object" && !Array.isArray(sec) ? Object.entries(sec) : []);

/** The board overrides route's words per man: a typed projection, a thumb per mode, ownership, a reset. Pure. */
function overridesWriter(b) {
  if (b?.resetAll === true) return { by: "you", why: `you reset every board override${MODE(b)}`, allBy: true, teams: null };
  if (typeof b?.reset === "string") return { by: "you", why: `you reset his board overrides${MODE(b)}`, subjects: new Map([[b.reset, {}]]) };
  const subjects = new Map();
  for (const [id, v] of ids(b?.proj)) subjects.set(id, { why: v === null ? "you cleared his typed projection" : `you typed his projection ${val(v)}` });
  for (const [id, v] of ids(b?.bump)) subjects.set(id, { kind: "thumb", why: v === null || v === 0 ? `you took his thumb off${MODE(b)}` : `you set his thumb to ${v > 0 ? "+" : ""}${val(v)}${MODE(b)}` });
  for (const [id, v] of ids(b?.own)) if (!subjects.has(id)) subjects.set(id, { why: v === null ? "you cleared his typed ownership" : `you typed his ownership ${val(v)}` });
  return subjects.size ? { by: "you", why: "your board override", subjects } : null;
}

const MINUTES_ACTION = {
  promote: () => "you moved him up the chart", demote: () => "you moved him down the chart", out: () => "you marked him Out on the Minutes page", in: () => "you put him back In on the Minutes page",
  minutes: (b) => (b.value === null ? "you cleared his typed minutes" : `you typed his minutes ${val(b.value)}`), rate: (b) => (b.value === null ? "you cleared his typed DK/min" : `you typed his DK/min ${val(b.value)}`),
  undo: () => "you undid a Minutes-page mark", undo_last: () => "you undid your last Minutes-page change", reset: (b, t) => `you reset ${t}'s chart`, depth: (b, t) => `your depth-chart move on ${t}`, role: (b, t) => `your role marks on ${t}`,
};
/** The Minutes page's edits (minutes/route.js): who he named and what he did. Pure. */
function minutesWriter(b, team) {
  const words = MINUTES_ACTION[b?.action];
  if (!words) return null;
  const keys = b.action === "role" && Array.isArray(b.marks) ? new Map(b.marks.filter((m) => typeof m?.key === "string").map((m) => [m.key, {}])) : new Map(); // his marked men, by chart key; the page sends his whole list, and a mark that did not move logs nothing
  return { by: "you", why: words(b, team), teams: [team], subjects: typeof b.id === "string" ? new Map([[b.id, {}]]) : new Map(), keys };
}
/** His standing overrides on the Minutes page (overrides/route.js): a man named by his chart key. Pure. */
function standingWriter(b, team) {
  const f = typeof b?.field === "string" ? b.field.replace("_", " ") : "override";
  const why = b?.action === "set" ? `you set his standing ${f} to ${val(b.value)}` : b?.action === "clear" ? `you cleared his standing ${f}` : b?.action === "clear_all" ? `you cleared ${team}'s standing overrides` : b?.action === "set_aside" ? `you set aside ${team}'s damaged standing overrides file` : null;
  if (!why) return null;
  return { by: "you", why, teams: [team], keys: typeof b.id === "string" ? new Map([[b.id, {}]]) : new Map() };
}

const ROUTES = [
  [/^\/api\/slate\/([^/]+)\/overrides$/, (b) => overridesWriter(b)],
  [/^\/api\/slate\/([^/]+)\/console\/apply$/, (b) => (b?.preview === true ? null : { by: "console", why: b?.auto === true ? "Console send (automatic: a load, a pull or the lineup bar's news)" : "your Console send", allBy: true, teams: Array.isArray(b?.teams) ? b.teams : null })], // a send with no "teams" plans every team (console-apply.js checkTeams)
  [/^\/api\/slate\/([^/]+)\/console\/reverse$/, (b) => (b?.preview === true ? null : { by: "console", why: "your Console reverse (what the last send set is put back)", allBy: true, teams: null })],
  [/^\/api\/slate\/([^/]+)\/resend$/, () => ({ by: "console", why: "held Console numbers re-sent on the new pull", allBy: true, teams: null })],
  [/^\/api\/slate\/([^/]+)\/whatifs(\/arm|\/delete)?$/, (b, m) => ({ by: "you", why: m[2] === "/delete" ? "Scenario tab: you deleted a what-if" : m[2] === "/arm" ? `Scenario tab: you ${b?.armed === false ? "disarmed" : "armed"} a what-if` : "Scenario tab: you saved a what-if", teams: typeof b?.team === "string" ? [b.team] : null })],
  [/^\/api\/minutes\/([^/]+)\/team\/([A-Z]{2,4})$/, (b, m) => minutesWriter(b, m[2])],
  [/^\/api\/minutes-overrides\/([^/]+)\/team\/([A-Z]{2,4})$/, (b, m) => standingWriter(b, m[2])],
  [/^\/api\/minutes\/([^/]+)\/snapshot$/, (b) => (b?.action === "set_aside" ? { by: "you", why: "you set aside the damaged minutes snapshot", teams: null } : null)],
];
/** Routes with no slate in the path: they move the newest slate's board (the one on show tonight), as the source setting does. [pattern, (body, match) -> writer]. */
const NEWEST = [
  [/^\/api\/minutes\/settings$/, (b) => (typeof b?.projection === "string" ? { by: "you", why: `you set the projection source to ${b.projection === "ours" ? "ours" : "TwoGun's"}`, allBy: true, teams: null } : null)],
  [/^\/api\/depth\/([A-Z]{2,4})$/, (b, m) => ({ by: "you", why: `you saved ${m[1]}'s depth chart`, teams: [m[1]] })],
];
const newestSlate = () => listSlates()[0]?.slate ?? null;

/** The slate a writer's path moves, before its body is read (the door's first-record snapshot), or null. Never throws. */
export function slateOfPath(pathname, decode = decodeURIComponent) {
  try {
    if (NEWEST.some(([re]) => re.test(pathname))) return newestSlate();
    for (const [re] of ROUTES) { const m = re.exec(pathname); if (m) { const s = decode(m[1]); return SLATE_NAME.test(s) ? s : null; } } // before the handler's own name check: an odd name reads nothing
  } catch (e) { warn("change log: the slate of a write could not be told", { path: pathname, error: e.message }); }
  return null;
}

/** Who made a POST that answered 200, and in what words: { slate, by, why, subjects?, keys?, teams?, allBy? }, or null for a route that moves no projection. decode: the path segment decoder. Pure but for the slate list on the newest-slate routes. */
export function writerOf(pathname, body, decode = decodeURIComponent) {
  for (const [re, make] of NEWEST) {
    const m = re.exec(pathname);
    if (!m) continue;
    const w = make(body ?? {}, m), slate = w ? newestSlate() : null;
    return w && slate ? { slate, ...w } : null;
  }
  for (const [re, make] of ROUTES) {
    const m = re.exec(pathname);
    if (!m) continue;
    const w = make(body ?? {}, m);
    return w ? { slate: decode(m[1]), ...w } : null;
  }
  return null;
}

/**
 * The door on a POST to a writer's route. rec: { snapshot(slate) -> figures or null (the board before the write, for a slate with no state yet), record(slate, w, before) }. res.end is wrapped once: the
 * first end answers, and only a 200 is logged, on the next turn (setImmediate), so the answer never waits on the engine; a second end is passed through and logs nothing. Never throws into the answer.
 */
export function watchWrite(req, res, pathname, rec, defer = setImmediate) {
  if (req.method !== "POST" || ![...ROUTES, ...NEWEST].some(([re]) => re.test(pathname))) return;
  const slate = slateOfPath(pathname), before = slate ? rec.snapshot?.(slate) ?? null : null;
  const end = res.end.bind(res);
  let done = false;
  res.end = (...args) => {
    const out = end(...args);
    if (done) return out;
    done = true;
    if (res.statusCode !== 200) return out;
    defer(() => {
      try { const w = writerOf(pathname, req.jsonBody ?? null); if (w) rec.record(w.slate, w, w.slate === slate ? before : null); } catch (e) { warn("change log: a write could not be logged (the save itself stands)", { path: pathname, error: e.message }); }
    });
    return out;
  };
}

/** The app's door (server.js): ourPlayers(slate, data) -> the engine's figures read only; now() the server's clock. The snapshot and the record both read the board as the Player list builds it. */
export const boardDoor = ({ ourPlayers, now }) => ({
  snapshot: (slate) => snapshotIfNew(slate, ourPlayers),
  record: (slate, w, before) => recordBoard(slate, w, { ourPlayers, nowMs: now(), before }),
});
