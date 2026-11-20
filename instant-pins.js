// His typed minutes and DK/min on the player list show at once (Adam 1:35 PM 11-20: "can they be instant?"): the Min cell's - and +, its box and
// the DK/m TON box. A press moves the row's Min, Proj and Value in the page before any server answer, marked pending (min-step.js stepHtml, min-step.css);
// presses within QUIET_MS of each other go to the console as one change, the newest value, in order, so a stale value never follows a newer one; when
// the console's send has settled the row takes the server's figures (teammates' minutes moved by the team's refill came in its answer), and a send
// that failed puts back the last figures the server gave, said in a toast. Each press carries the slate it was made on: a value whose slate is no
// longer on show is never written, and is counted in a toast (G62). Nothing about what is saved or how the engine computes changes.
// The pure parts (guessFigures, settleOf, createPinLine) are tested in node; createInstantPins wires them to the board's rows (board-marks.js).
import { isNum, tonightRate, valuePer1k } from "./figures.js";

/** How long the line waits after the last press before the change goes to the console: five quick presses are one save and one send. */
export const QUIET_MS = 350;
/** How long a number may stay pending after his last press before the row gives up on it, shows the board's figures and says so. */
export const STUCK_MS = 30_000;

/** The men with a number shown before the server's answer; min-step.js reads it to mark their step buttons pending. One board per page. */
export const PENDING = new Set();
export const isPending = (id) => PENDING.has(String(id));
/** The page's one board layer (createInstantPins sets it), for the player card's direct writes (clearQueued). */
let active = null;
/**
 * The player card writes his minutes straight to the console: a board value for the same man and kind not yet sent is dropped first (it is older
 * than the card's), and when one is being handed off now, the returned promise settles once it has landed, so the card's number lands after it. Null when nothing is on its way.
 */
export function clearQueued(id, kind) {
  if (!active) return null;
  active.cancel(id, kind);
  return active.inFlight(id, kind);
}

const FIGS = ["minutes", "projection", "value"];
const figsOf = (p) => Object.fromEntries(FIGS.map((k) => [k, p?.[k] ?? null]));

/**
 * The row's figures as the board will show them once the server answers, from the server's last figures `base` ({ minutes, projection, value }), his
 * pending typed minutes `m` and DK/min `d` (either may be undefined), and his salary: minutes x DK/min tonight, value per $1,000 (figures.js), the board's
 * own formulas. DK/min tonight is his typed `d`, else the server's projection over its minutes; with neither, the projection is left as the server had it. Pure.
 */
export function guessFigures(base, { m, d } = {}, salary = null) {
  const minutes = isNum(m) ? m : base.minutes, rate = isNum(d) ? d : tonightRate(base.projection, base.minutes);
  if (!isNum(minutes) || rate === null) return { minutes: minutes ?? null, projection: base.projection, value: base.value };
  const projection = minutes * rate;
  return { minutes, projection, value: valuePer1k(projection, salary) ?? base.value };
}

/**
 * Where his handed-off change stands, from the console's send state (console-card.js syncState: { state, at, msg, pending: [teams] }), his team, and
 * when it was handed off: "busy" (a send is under way or waiting, his team is still to go, or the state has not moved since the hand-off), "failed"
 * (the send after it failed: msg says why) or "done". Pure.
 */
export function settleOf(sync, team, handedAt) {
  const s = sync ?? { state: "ok" };
  if (s.state === "sending" || s.state === "waiting") return { state: "busy" };
  if (isNum(handedAt) && !(isNum(s.at) && s.at >= handedAt)) return { state: "busy" };
  if (s.state === "error") return { state: "failed", why: s.msg ?? "the send failed" }; // a failed send leaves his team marked to go, so this comes first
  if ((s.pending ?? []).includes(team)) return { state: "busy" };
  return { state: "done" };
}

/**
 * The save line: press(id, kind, v, tag) keeps only the newest value per man and kind; QUIET_MS after the last press every newest value is handed to
 * `hand(id, kind, v, tag)` (resolves true when kept, false when refused, "skipped" when not tried), one at a time and in press order; a press during a
 * hand-off waits for the next round, never lost. Each press resolves true only when the hand-off that carried its value or a newer one kept it.
 * onHanded(id, kind, v, result) after each. timers: { setTimeout, clearTimeout } (tests pass their own clock). cancel(id, kind) drops a value not yet
 * handed (resolving false); cancelAll() drops every one and says how many; inFlight(id, kind) is a promise settling when the value being handed off now has landed, else null.
 */
export function createPinLine({ hand, onHanded = () => {}, quietMs = QUIET_MS, timers = globalThis }) {
  const waiting = new Map(); // `${id}|${kind}` -> { id, kind, v, tag, done: [resolve] }; Map order is first-press order
  const going = new Map(); // `${id}|${kind}` -> the promise of the hand-off under way for it
  let timer = null, chain = Promise.resolve();
  function flush() {
    timer = null;
    const batch = [...waiting.values()];
    waiting.clear();
    chain = chain.then(async () => {
      for (const b of batch) {
        const key = `${b.id}|${b.kind}`;
        let result = false;
        const p = (async () => {
          try { result = await hand(b.id, b.kind, b.v, b.tag); } catch (e) { console.warn("the typed number could not be handed to the console:", e.message); }
        })();
        going.set(key, p);
        await p;
        if (going.get(key) === p) going.delete(key);
        try { onHanded(b.id, b.kind, b.v, result); } finally { for (const r of b.done) r(result === true); }
      }
    });
    return chain;
  }
  return {
    press(id, kind, v, tag = null) {
      return new Promise((resolve) => {
        const key = `${id}|${kind}`, was = waiting.get(key);
        if (was) { was.v = v; was.tag = tag; was.done.push(resolve); } else waiting.set(key, { id, kind, v, tag, done: [resolve] });
        timers.clearTimeout(timer);
        timer = timers.setTimeout(flush, quietMs);
      });
    },
    cancel(id, kind) {
      const key = `${id}|${kind}`, was = waiting.get(key);
      if (!was) return false;
      waiting.delete(key);
      for (const r of was.done) r(false);
      if (!waiting.size) { timers.clearTimeout(timer); timer = null; }
      return true;
    },
    cancelAll() {
      const n = waiting.size;
      for (const w of waiting.values()) for (const r of w.done) r(false);
      waiting.clear();
      timers.clearTimeout(timer); timer = null;
      return n;
    },
    inFlight: (id, kind) => going.get(`${id}|${kind}`) ?? null,
    /** Hands off what is waiting now, without the quiet time (tests, and a page leaving). */
    flushNow: () => { timers.clearTimeout(timer); return flush(); },
    waiting: () => waiting.size,
    has: (id, kind) => waiting.has(`${id}|${kind}`),
    idle: () => chain,
  };
}

const whatOf = (e) => (isNum(e.m) ? `${e.m} minutes` : isNum(e.d) ? `${e.d} DK/min` : "number");

/**
 * The board's instant layer. deps: { players() -> the board's rows (S.players; S.byId holds the same objects), slate() -> the slate on show,
 * hand(id, kind, v, slate) -> Promise<true | false | "skipped"> (the console write, board-marks.js), syncState() -> the console's send state, teamOf(id),
 * onChange() (redraw the rows), toast(msg, kind), timers, now() }.
 * The rows are the board's own objects: a guess is written onto the man's row in place, so the next press steps from the number shown, and
 * keep(list) writes it again onto a new list the server's answer brought in while his change is still on its way (an older answer must not show
 * a number he has already moved off). The server's own figures are kept beside the guess, so a settled or failed change shows exactly them.
 * A number still pending STUCK_MS after his last press ends with the board's figures and a toast. A new slate on show ends them all (reset).
 * Returns { press(id, kind, v), keep(list), check(), cancel(id, kind), inFlight(id, kind), reset(), pending(id), idle() }.
 */
export function createInstantPins({ players, slate = () => null, hand, syncState = () => null, teamOf = () => null, onChange = () => {}, toast = () => {}, timers = globalThis, now = () => Date.now(), quietMs = QUIET_MS, stuckMs = STUCK_MS }) {
  // id -> { row, base (what a settled send shows), saved (the last figures known to be the server's, put back on a failure), m, d (his numbers on their way),
  //         team, n (his numbers waiting in the line, one per kind), kept (a hand-off of his was kept), handedAt, since (his last press) }
  const men = new Map();
  let list = null, on = null, checkTimer = null, skipped = 0, skippedOn = null, skipTimer = null;
  const rowOf = (id, from = players()) => (Array.isArray(from) ? from.find((p) => String(p?.dk_id) === id) ?? null : null);
  const put = (row, figs) => { for (const k of FIGS) row[k] = figs[k]; };
  const guessOf = (e) => guessFigures(e.base, { m: e.m, d: e.d }, e.row.salary);
  function end(id, figs) {
    const e = men.get(id);
    if (!e) return;
    men.delete(id); PENDING.delete(id);
    put(e.row, figs);
  }
  /** Numbers made on a slate no longer on show were not written: counted, said once (G62). */
  function skip(n, name) {
    if (!n) return;
    skipped += n; skippedOn = name;
    timers.clearTimeout(skipTimer);
    skipTimer = timers.setTimeout(() => {
      toast(`${skipped} typed number${skipped === 1 ? " was" : "s were"} not kept: made on ${skippedOn ?? "the slate you left"}, and the slate on show changed before ${skipped === 1 ? "it" : "they"} went to the console.`, "err");
      skipped = 0; skippedOn = null;
    }, 0);
  }
  /** A new slate on show: every number not yet sent is dropped and counted, every pending row shows the server's figures again, nothing stays pending. */
  function reset() {
    const was = on;
    skip(line.cancelAll(), was);
    for (const id of [...men.keys()]) end(id, men.get(id).saved);
    PENDING.clear();
    list = null; on = null;
    timers.clearTimeout(checkTimer); checkTimer = null;
  }
  const moved = () => { if (men.size && slate() !== on) { reset(); return true; } return false; };
  /** A new list from the server (its answer, a reload): each pending man's server figures are taken from it and his guess written over them again. */
  function keep(now = players()) {
    if (moved()) return;
    if (now === list || !Array.isArray(now)) return;
    list = now;
    for (const [id, e] of men) {
      const row = rowOf(id, now);
      if (!row) { men.delete(id); PENDING.delete(id); continue; } // he left the slate: nothing to show
      const g = guessOf(e);
      if (row !== e.row) {
        if (FIGS.every((k) => row[k] === g[k])) e.base = g; // the answer agrees with his number, or a copy of his row carried it: either way it is what a settled send shows, never what a failure puts back
        else e.base = e.saved = figsOf(row);
      }
      e.row = row;
      put(row, guessOf(e));
    }
  }
  /** After the console's send state moves: a handed change whose send has settled shows the server's figures; a failed one is put back and said; one pending too long ends and is said. */
  function check() {
    if (moved()) return;
    let changed = false;
    for (const [id, e] of men) {
      if (now() - e.since >= stuckMs) {
        const st = syncState()?.state ?? "unknown";
        toast(`Your ${whatOf(e)} for ${e.row.name ?? "him"} has not reached the board after ${Math.round(stuckMs / 1000)} seconds (the send is ${st === "sending" ? "still under way" : st === "waiting" ? "waiting" : `"${st}"`}). His row shows the figures the board has; the Console shows whether your number is kept.`, "err");
        end(id, e.saved); changed = true;
        continue;
      }
      if (!e.kept || e.n) continue;
      const s = settleOf(syncState(), e.team, e.handedAt);
      if (s.state === "busy") continue;
      if (s.state === "failed") {
        const back = e.saved.minutes;
        toast(`Your ${whatOf(e)} for ${e.row.name ?? "him"} did not reach the board: ${s.why}. His row shows ${isNum(back) ? `${Math.round(back)} minutes` : "the board's figures"} again, the last the board has; the console keeps your number and sends it with your next change.`, "err");
      }
      end(id, s.state === "failed" ? e.saved : e.base); changed = true;
    }
    if (changed) onChange();
    later();
  }
  /** One look a moment after each state change, and again while anything is pending (the console's own redraw also calls check). */
  function later() {
    timers.clearTimeout(checkTimer); checkTimer = null;
    if (men.size) checkTimer = timers.setTimeout(check, 250);
  }
  const line = createPinLine({
    quietMs, timers,
    hand: async (id, kind, v, tag) => {
      if (tag !== slate()) { skip(1, tag); return "skipped"; } // made on a slate no longer on show: never written to this one
      const r = await hand(id, kind, v, tag);
      if (r === "skipped") skip(1, tag);
      return r;
    },
    onHanded(id, kind, v, result) {
      const e = men.get(id);
      if (!e) return;
      e.n = Math.max(0, e.n - 1);
      if (result === true) { e.kept = true; e.handedAt = now(); e.team = teamOf(id) ?? e.row.team ?? null; }
      else if (e[kind] === v) e[kind] = undefined; // refused or skipped (said by the hand-off): his other kind, if any, still shows on the server's figures
      if (e.n) { put(e.row, guessOf(e)); if (result !== true) onChange(); return; } // a newer number is waiting: it carries on
      if (!e.kept) { end(id, e.saved); onChange(); return; } // nothing of his was kept: the row as the server had it
      put(e.row, guessOf(e));
      if (result !== true) onChange();
      later();
    },
  });
  const api = {
    /** A press or a typed number: shown at once on his row, handed to the console after the quiet time. Resolves as the hand-off did (true when kept). */
    press(id, kind, v) {
      const key = String(id), rows = players(), row = rowOf(key, rows), name = slate();
      if (!row) return line.press(key, kind, v, name); // no row on the board to show it on: to the console in the line, so it keeps its order
      moved();
      if (!men.size) on = name;
      if (list !== rows) keep(rows);
      let e = men.get(key);
      if (!e) { e = { row, base: figsOf(row), saved: figsOf(row), m: undefined, d: undefined, n: 0, kept: false }; men.set(key, e); PENDING.add(key); }
      if (!line.has(key, kind)) e.n += 1;
      e[kind] = v; e.since = now();
      put(row, guessOf(e));
      onChange();
      later();
      return line.press(key, kind, v, name);
    },
    keep,
    check,
    /** His undo chip, or the card's own write: a number not yet handed is dropped, and his row shows the server's figures unless another of his is on its way. */
    cancel(id, kind) {
      const key = String(id);
      if (!line.cancel(key, kind)) return;
      const e = men.get(key);
      if (!e) return;
      e.n = Math.max(0, e.n - 1); e[kind] = undefined;
      if (!e.n && !e.kept) end(key, e.saved); else put(e.row, guessOf(e));
      onChange();
    },
    inFlight: (id, kind) => line.inFlight(String(id), kind),
    reset,
    pending: (id) => men.has(String(id)),
    idle: () => line.idle(),
  };
  active = api;
  return api;
}
