// The board's own refresh: a light check of the slate's pull stamp once a minute, the slate fetched only when the stamp changes, and figures updated in place. Never a page reload.
// The decisions here are pure and tested in node; createRefresher takes everything it touches as arguments, and board.js owns the drawing.
import { isoToEastern } from "./board-util.js";
import { pullTime } from "./console-render.js";
import { cleanWork } from "./worklineup.js";
import { goneSlots } from "./lateswap.js";

export const CHECK_MS = 60_000;

/** What a check's stamp asks for. "none": nothing new. "wait": new, but a build is running, so the next check takes it. "fetch": get the slate. */
export function decideCheck({ stamp, lastStamp, busy }) {
  if (stamp === lastStamp) return "none";
  return busy ? "wait" : "fetch";
}

/**
 * The rows after a new slate: the server's, which already carry his overrides on top of the new figures, in its order. The row he is typing in keeps what it shows, its new
 * version waiting in `held` (null when the new slate drops him) until he leaves it. Picks, filters, settings and lineups are not inputs, so nothing here can touch them. Pure.
 * { players, held: Map of id to row or null, added: names, removed: names }.
 */
export function mergeFresh(current, fresh, typingId = null) {
  const was = new Set(current.map((p) => p.dk_id)), now = new Set(fresh.map((p) => p.dk_id));
  const held = new Map();
  const players = fresh.map((p) => {
    if (p.dk_id !== typingId) return p;
    held.set(p.dk_id, p);
    return current.find((c) => c.dk_id === typingId) ?? p;
  });
  const typed = current.find((c) => c.dk_id === typingId);
  if (typed && !now.has(typingId)) { held.set(typingId, null); players.push(typed); }
  return { players, held, added: fresh.filter((p) => !was.has(p.dk_id)).map((p) => p.name), removed: current.filter((p) => !now.has(p.dk_id)).map((p) => p.name) };
}

/** The rows with what was held put in: a new version in his place, a man the new slate dropped gone. Pure. */
export function applyHeld(players, held) {
  return players.flatMap((p) => { if (!held.has(p.dk_id)) return [p]; const row = held.get(p.dk_id); return row ? [row] : []; });
}

/** Every man this page has held, id to his last row, so a man a new pull drops can still be named on a card or in a refusal. Pure: a new Map. */
export function rememberRows(known, rows) {
  const out = new Map(known);
  for (const p of rows) out.set(p.dk_id, p);
  return out;
}

/** The names on a slate's Out list. Pure. */
export const outNamesOf = (slate) => new Set((slate?.out ?? []).map((o) => o.name));

/** Why a slate answer must not be drawn; null when it may. An empty or malformed answer is a failure, never an empty board (the old numbers stay). Pure. */
export function freshProblem(fresh) {
  if (!Array.isArray(fresh?.players)) return "the new slate came back with no player list";
  if (!fresh.players.length) return "the new slate came back with no players";
  if (!Array.isArray(fresh.games)) return "the new slate came back with no game list";
  return null;
}

/** The pull a slate's figures came from: { key, label } from built_from's last segment, else as_of.pull_started; nulls when neither reads. Pure. */
export function pullOf(slate) {
  const stamp = String(slate?.built_from ?? "").split(/[\\/]/).at(-1);
  const shown = stamp ? pullTime(stamp) : null;
  if (shown && shown !== stamp) return { key: stamp, label: shown };
  const at = slate?.as_of?.pull_started, label = isoToEastern(at);
  return label ? { key: at, label } : { key: null, label: null };
}

/** A build key with the men off the slate taken out. A key that is not this shape is compared as its own text, so a redraw never throws on one. */
function onSlateText(key, narrow) {
  try {
    return JSON.stringify(narrow(JSON.parse(key)));
  } catch (e) {
    return `unread ${e instanceof SyntaxError || e instanceof TypeError ? key : String(e)}`;
  }
}
const picksOnSlate = (key, byId) => onSlateText(key, (lists) => lists.map((list) => list.filter((id) => byId.has(id)).sort()));
/** Whether the picks differ from a build's, a man off the slate on either side counting for nothing. Pure. */
export const picksMoved = (atKey, nowKey, byId) => picksOnSlate(atKey, byId) !== picksOnSlate(nowKey, byId);
const limitsOnSlate = (key, byId) => onSlateText(key, (limits) => Object.entries(limits ?? {}).filter(([id]) => byId.has(id)).sort(([a], [b]) => a.localeCompare(b)));
/** Whether the Min % and Max % differ from a build's, likewise. Pure. */
export const limitsMoved = (atKey, nowKey, byId) => limitsOnSlate(atKey, byId) !== limitsOnSlate(nowKey, byId);
const oversOnSlate = (key, byId) => onSlateText(key, (rows) => rows.filter(([id]) => byId.has(id)).sort(([a], [b]) => String(a).localeCompare(String(b))));
/** Whether his override inputs differ from a build's, likewise. Pure. */
export const oversMoved = (atKey, nowKey, byId) => oversOnSlate(atKey, byId) !== oversOnSlate(nowKey, byId);
/** The key a build compares his overrides with: what he typed and bumped, never a figure a new pull moves. Pure. */
export const overrideKey = (players) => JSON.stringify(players.filter((p) => p.ovr).map((p) => [p.dk_id, p.ovr.steps, p.ovr.projection, p.ovr.proj_own]));

/** The picks as the board acts on them: only men on the slate. A view, never stored over the picks: a man who leaves and comes back is locked on the board as he still is in the server's file. Pure. */
export function picksOnBoard(picks, byId) {
  const keep = (list) => list.filter((id) => byId.has(id));
  return { locked: keep(picks.locked), excluded: keep(picks.excluded) };
}

/**
 * What a roster change leaves of the state that names men. A man off the slate leaves the picks and the working lineup, and is named; a team or game filter that left the slate
 * ends. A late swap slot is never opened here: a gone man stays and is listed in `lsGone`, and Build refuses until Adam decides. Nothing is changed in place. Pure.
 * in: { byId, picks, work, workReady, ls: { slots, last } or null, filters: { teams, game }, teamsOn, gamesOn, nameOf(id) }.
 */
export function rosterCleanup({ byId, picks, work, workReady, ls, filters, teamsOn, gamesOn, nameOf }) {
  const next = picksOnBoard(picks, byId);
  const dropped =[...picks.locked, ...picks.excluded].filter((id) => !byId.has(id)).map(nameOf);
  const cleaned = workReady ? cleanWork(work, byId) : work;
  const workLeft = workReady ? work.filter((id) => id != null && !cleaned.includes(id)).map(nameOf) : [];
  return {
    picks: next, dropped, work: cleaned, workLeft,
    lsGone: ls ? goneSlots(ls.slots, byId, ls.last) : [],
    filters: { teams: filters.teams.filter((t) => teamsOn.includes(t)), game: filters.game != null && gamesOn.includes(filters.game) ? filters.game : null },
  };
}

const et = (ms) => isoToEastern(new Date(ms).toISOString());

/** The small line under the banner. s: { pull (its time, in words), updatedMs, failed: { ms, reason } or null, added, removed, consoleOpen }. Pure. */
export function statusLine(s) {
  const from = s.pull ? ` from the ${s.pull} pull` : "";
  const head = s.failed
    ? `Could not check for new numbers at ${et(s.failed.ms)} (${s.failed.reason}), so these may be stale. Numbers${from}, last updated ${et(s.updatedMs)}.`
    : `Numbers${from}, updated ${et(s.updatedMs)}.`;
  const men = [s.added?.length ? `Added ${s.added.join(", ")}.` : "", s.removed?.length ? `Removed ${s.removed.join(", ")}.` : ""].filter(Boolean).join(" ");
  return [head, s.waiting ? "New numbers waiting; they go on when you finish here." : "", men, s.consoleOpen ?"The console shows the pull it opened with; open it again for new numbers." : ""].filter(Boolean).join(" ");
}

/**
 * One check at a time. deps: api(url), name() (the slate on show), busy() (a build running, a form holding focus, a press under way), saves() (a count that moves with every override write), apply(slate) (draws it),
 * status({ failed }) after each check. A slate that changed, or an override written, while the fetch was out is thrown away and the next check fetches again: an older
 * answer must never cover a newer saved number. A failure changes nothing on screen but the line.
 */
export function createRefresher({ api, name, busy, saves, apply, status, now = Date.now }) {
  let lastStamp = null, running = false;
  const stampUrl = (slate) => `/api/slate/${encodeURIComponent(slate)}/pull-stamp`;
  return {
    /** The stamp as a slate starts loading, read before its figures so a pull landing in between is fetched by the next check. Null when unreadable: the next check fetches. */
    async baseline(slate) {
      try { lastStamp = (await api(stampUrl(slate))).stamp; } catch (e) { lastStamp = null; status({ failed: { ms: now(), reason: e.message } }); }
    },
    async tick() {
      const slate = name();
      if (running || !slate) return;
      running = true;
      try {
        const { stamp } = await api(stampUrl(slate));
        if (slate !== name()) return;
        const act = decideCheck({ stamp, lastStamp, busy: busy() });
        if (act === "wait") { status({ failed: null, waiting: true }); return; }
        if (act === "fetch") {
          const at = saves();
          const fresh = await api(`/api/slate/${encodeURIComponent(slate)}`);
          if (slate !== name()) return;
          if (at !== saves() || busy()) { status({ failed: null, waiting: true }); return; }
          const problem = freshProblem(fresh);
          if (problem) throw new Error(problem);
          apply(fresh);
          lastStamp = stamp; // only once it is on screen: a failed draw fetches again
        }
        status({ failed: null });
      } catch (e) {
        if (slate === name()) status({ failed: { ms: now(), reason: e.message } });
      } finally {
        running = false;
      }
    },
  };
}
