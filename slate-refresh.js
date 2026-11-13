// The board's own refresh: a light check of the slate's pull stamp once a minute, the slate fetched only when the stamp changes, and figures updated in place. Never a page reload.
// The decisions here are pure and tested in node; createRefresher takes everything it touches as arguments, and board.js owns the drawing.
import { isoToEastern } from "./board-util.js";
import { pullTime } from "./console-render.js";
import { cleanWork } from "./worklineup.js";
import { goneSlots } from "./lateswap.js";

export const CHECK_MS = 60_000;

/** The newest slate's name in a list of { slate } (names sort by date), or null for none. Pure. */
export const newestSlate = (slates) => (Array.isArray(slates) && slates.length ? slates.map((x) => String(x.slate)).reduce((a, b) => (b > a ? b : a)) : null);

/** The slate to open: the one a `?slate=` names when it is a real slate (a deliberate older pick), else the newest. Pure. */
export const pickSlate = (slates, want) => (slates.some((x) => x.slate === want) ? want : newestSlate(slates));

/** The address bar's query for the slate on show: no `?slate=` for the newest (a refresh on a later day opens that day's), `?slate=` for an older one; the console view rides along. Pure. */
export function slateQuery(name, slates, consoleOn = false, path = "/") {
  const q = new URLSearchParams();
  if (name !== newestSlate(slates)) q.set("slate", name);
  if (consoleOn) q.set("view", "console");
  const s = q.toString();
  return s ? `?${s}` : path;
}

/**
 * What a fresh slate list means for the page. before: the list the page knew; fresh: the list just read; showing: the slate on show.
 * { slates, switchTo }: switchTo is the new newest slate when one appeared and he was on the previous newest; null otherwise (an older pick stays, the menu still gains the new slate).
 * An unreadable or empty fresh list changes nothing. Pure.
 */
export function followNewest({ before, fresh, showing }) {
  if (!Array.isArray(fresh) || !fresh.length) return { slates: before, switchTo: null };
  if (JSON.stringify(fresh) === JSON.stringify(before)) return { slates: before, switchTo: null }; // nothing changed: the same list object, so no redraw
  const was = newestSlate(before), now = newestSlate(fresh);
  if (!fresh.some((x) => x.slate === showing)) return { slates: fresh, switchTo: now }; // the slate on show left the list: the newest
  return { slates: fresh, switchTo: was !== null && now > was && showing === was ? now : null };
}

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
/** The row fields an overrides or console answer owns (`auto`: which of a row's figures news or the engine wrote, so the marks follow every answer). */
export const OV_KEYS = ["projection", "value", "proj_own", "base", "ovr", "auto", "stale_auto", "proj_note", "starred", "minutes", "base_minutes", "his"]; // his: his own In or Out call (out-pool.js); stale_auto / proj_note: a send's number the board did not use, and why
/** A board row with the server's answer for him taken onto it: the override fields come from the answer, and a field the answer lacks is dropped. Pure. */
export function takeAnswer(p, f) {
  const next = { ...p };
  for (const k of OV_KEYS) { if (k in f) next[k] = f[k]; else delete next[k]; }
  return next;
}
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
 * status({ failed }) after each check, onNews() (the lineup read moved and the slate did not: the News tab and the S chips are read again and the board rows are not redrawn; while busy it waits for the next check). A slate that changed, or an override written, while the fetch was out is thrown away and the next check fetches again: an older
 * answer must never cover a newer saved number. A failure changes nothing on screen but the line. onBoxes(slate) (the app's box score check, box-note.js) starts after every
 * check's own work, whatever the stamp says, since a gap appears at 6 AM or is filled by hand with no new pull; it is not awaited (a slow answer never holds a refresh), one
 * runs at a time, and it should not throw (its own failure is an "unknown" answer); if it does, the line says so.
 */
export function createRefresher({ api, name, busy, saves, apply, status, onNews = null, onBoxes = null, now = Date.now }) {
  let lastStamp = null, lastNews = null, running = false, boxing = null;
  const stampUrl = (slate) => `/api/slate/${encodeURIComponent(slate)}/pull-stamp`;
  return {
    /** The stamp as a slate starts loading, read before its figures so a pull landing in between is fetched by the next check. Null when unreadable: the next check fetches. */
    async baseline(slate) {
      try { const b = await api(stampUrl(slate)); lastStamp = b.stamp; lastNews = b.news ?? null; } catch (e) { lastStamp = null; lastNews = null; status({ failed: { ms: now(), reason: e.message } }); }
    },
    async tick() {
      const slate = name();
      if (running || !slate) return;
      running = true;
      try {
        const { stamp, news = null } = await api(stampUrl(slate));
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
          apply(fresh); // a new slate also reads the lineup news again, so the news stamp is taken with it
          lastStamp = stamp; lastNews = news; // only once it is on screen: a failed draw fetches again
        } else if (news !== lastNews && onNews && !busy()) {
          await onNews();
          if (slate === name()) lastNews = news;
        }
        status({ failed: null });
      } catch (e) {
        if (slate === name()) status({ failed: { ms: now(), reason: e.message } });
      } finally {
        running = false;
        if (onBoxes && !boxing && slate === name()) { // after the stamp and slate work, never awaited, so a slow box answer cannot hold a refresh; one at a time
          boxing = Promise.resolve().then(() => onBoxes(slate)).catch((e) => { if (slate === name()) status({ failed: { ms: now(), reason: `the box score check failed (${e?.message ?? e})` } }); }).finally(() => { boxing = null; });
        }
      }
    },
  };
}
