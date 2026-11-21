// Every console change reaches the board and the optimizer by itself (Adam, 11-07): no Apply step. After each change the work is saved,
// then the same preview and send the old Apply made run in the background, one at a time; a change made while one runs is sent after it,
// once. The board's figures come only from the server's answer (overrides.json), so the board has one source of truth.
// Only the teams he changed in this page's life, and teams the board already holds an Apply for, are sent: another team's old saved work
// stays unsent and is named as one line until he next changes that team. What a send holds back (planNotesList) is shown as "partial",
// never as up to date. Each takes the console's shared state `c`; c.auto is set only by createConsole, so the tests' fake consoles send nothing by themselves.
import { keyOf } from "./console-engine.js";
import { defaultSourceOf } from "./depth-chart.js";
import { calc, hasPins } from "./console-model.js";
import { saveDirty, SYNC_WAIT_MS } from "./console-moves.js";

const post = (c, body) => c.api(`/api/slate/${encodeURIComponent(c.slate)}/console/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
/** Each team's scenario on show: { team: key }. */
export const onScreenKeys = (c) => Object.fromEntries(Object.entries(c.model.ST).map(([code, S]) => [code, keyOf(S.outs)]));
/** How long a send waits while the usage table loads before it goes again; the server refuses a send until it has loaded. */
const USAGE_WAIT_MS = 20_000;

/** One held scenario in plain words, men by name: "Powell and Brown have pins on BKN's Porter out scenario, which is not on show, so nothing is sent for it." */
export function orphanText(o) {
  const names = o.who ?? [], n = o.count ?? names.length;
  if (o.gone) return `${n === 1 ? "A pin" : `${n} pins`} on ${o.team}'s ${o.scenario ?? "earlier"} scenario ${n === 1 ? "names a man" : "name men"} no longer on the team, so nothing is sent for ${n === 1 ? "it" : "them"}.`;
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? (n === 1 ? "A man no longer on the team" : `${n} men, some no longer on the team,`);
  const where = o.scenario ? `${o.team}'s ${o.scenario} scenario` : `a ${o.team} scenario from an earlier Tonight`;
  return `${list} ${names.length === 1 || (!names.length && n === 1) ? "has a pin" : "have pins"} on ${where}, which is not on show, so nothing is sent for it.`;
}

/** What the preview leaves out or holds back, man by man: [{ team, text, note_only }]. note_only: said, but never a reason to refuse the card's Apply
 *  (pins on a scenario not on show; a man Out tonight whom the scenario has playing). */
export function planNotesList(plan) {
  return [
    ...(plan.missing ?? []).map((m) => (m.kind ? { team: m.team, text: m.why, note_only: m.kind !== "blank" } : { team: m.team, text: `${m.name} has no projection here (${m.why})` })), // kind (console-apply.js, R4 11-17): blank (the team was not sent), disagree, his: said in their own words
    ...(plan.kept ?? []).map((k) => ({ team: k.team, text: `${k.name} keeps the projection you typed on the board (${k.typed})` })),
    ...(plan.not_on_board ?? []).map((m) => ({ team: m.team, text: `${m.name} is not on the board, so nothing is sent for him` })),
    ...(plan.back_on_zero ?? []).map((m) => ({ team: m.team, text: `${m.name} is back on 0 minutes` })),
    ...(plan.orphaned_pins ?? []).map((o) => ({ team: o.team, text: orphanText(o), note_only: true })),
    ...(plan.back_in ?? []).map((m) => ({ team: m.team, text: `${m.name} is out tonight but playing in this scenario`, note_only: true })),
  ];
}

const etTime = (ms) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET";
/**
 * What the console's header and the board say about the send (c.sync): { cls ("ok" | "busy" | "wait" | "err" | "held"), text, lines }. Never "up to date"
 * while a send held anything back, a change waits to go, or old work is unsent; each of those is a line. Pure.
 */
export function syncWords(sync) {
  const s = sync ?? { state: "ok" }, lines = [];
  const notes = s.notes ?? [], unsent = s.unsent ?? [], pending = s.pending ?? [];
  if (s.state === "partial") for (const n of notes) lines.push(`${n.team}: ${n.text}`);
  if (unsent.length) lines.push(`Unsent work on ${unsent.join(", ")}: it goes to the board when you next change that team.`);
  if (s.state === "sending") return { cls: "busy", text: "Sending to the board…", lines };
  if (s.state === "error") return { cls: "err", text: s.msg ?? "Not sent", lines };
  if (s.state === "waiting") return { cls: "wait", text: s.msg ?? "Waiting", lines };
  if (pending.length) return { cls: "held", text: `Not on the board yet: ${pending.join(", ")}`, lines };
  if (s.state === "partial") return { cls: "held", text: `On the board, ${notes.length} held back`, lines };
  if (unsent.length) return { cls: "held", text: `On the board${s.at ? ` · ${etTime(s.at)}` : ""}; some old work unsent`, lines };
  return { cls: "ok", text: `Board and optimizer up to date${s.at ? ` · ${etTime(s.at)}` : ""}`, lines };
}

/** The teams a send covers: those he changed in this page's life (c.touched), those the board holds an Apply for, and any `extra`. Sorted. */
export const sendTeams = (c, extra = []) => [...new Set([...(c.touched ?? []), ...Object.keys(c.applied?.keys ?? {}), ...extra])].filter((t) => c.model.ST[t]).sort();
/**
 * Whether the console may send or save by itself, with no click of his (a load, a pull): never on a locked slate and never on one that is not the newest. A click of his keeps
 * sending as before. Fails closed on what the inputs say (locked true, newest false); a console with no such fields (a test's fake) is left as it was. Pure.
 */
export const mayAutoSend = (inputs) => inputs?.locked !== true && inputs?.newest !== false;

/** After a load: every team holding an applied news entry is sent, because a news change whose send never landed must still reach the board. True when any was added; a preview with no changes then sends nothing. */
export function requeueNews(c) {
  if (!mayAutoSend(c.inputs)) return false;
  c.touched ??= new Set();
  c.pending ??= new Set();
  let any = false;
  for (const [code, S] of Object.entries(c.model.ST)) {
    if (!Object.values(S.news ?? {}).some((e) => e.state === "applied")) continue;
    c.touched.add(code); c.pending.add(code); any = true;
  }
  return any;
}

/** Teams with saved work of his that this page has not sent: pins on any scenario, a scenario off Tonight, or a minutes source other than the default. */
export const unsentTeams = (c, sent) => Object.keys(c.model.ST).filter((t) => !sent.includes(t) && ((c.model.ST[t].source ?? defaultSourceOf(c.model.TEAMS[t])) !== defaultSourceOf(c.model.TEAMS[t]) || Object.values(c.model.ST[t].pins ?? {}).some(hasPins) || keyOf(c.model.ST[t].outs) !== c.model.TEAMS[t]?.tonightKey)).sort();

/** Each team's console result as a short text: the scenario on show and every man's minutes and projection in it. A pull that changes it is what the board must be sent again. */
export function resultSigs(c) {
  const r3 = (x) => (typeof x === "number" ? Math.round(x * 1000) / 1000 : null);
  return Object.fromEntries(Object.entries(c.model.ST).map(([code, S]) => [code, JSON.stringify([keyOf(S.outs), calc(c.model.TEAMS[code], S, S.outs).rows.map((r) => [r.id, r3(r.min), r3(r.proj)])])]));
}

/**
 * New inputs landed (a pull) and the model was rebased: every team the board is held for whose console result moved is marked not yet on the board and sent,
 * with no click. `before`: resultSigs taken before the rebase. A preview that finds the board already equal sends nothing, so this never writes in a loop.
 * Returns the teams marked.
 */
export function resendChanged(c, before) {
  if (!mayAutoSend(c.inputs)) return [];
  const after = resultSigs(c), held = new Set(sendTeams(c)), moved = Object.keys(after).filter((t) => held.has(t) && before[t] !== after[t]);
  if (!moved.length) return [];
  c.pending ??= new Set();
  for (const t of moved) c.pending.add(t);
  c.auto?.kick(true); // a pull moved it: no click of his started this send
  return moved;
}

/** A send the slate switch dropped (review 11-21 round 2, item 2): its teams are kept by slate, so his saved change still reaches that slate's board when it is opened again. */
export function keepDropped(c, slate, teams) {
  if (!slate || !teams?.size && !teams?.length) return;
  const kept = (c.droppedSends ??= new Map()).get(slate) ?? new Set();
  for (const t of teams) kept.add(t);
  c.droppedSends.set(slate, kept);
}
/** After a load: the teams a switch dropped on this slate are marked changed and to go again. True when any (his clicks: the send is his, never auto). */
export function requeueDropped(c) {
  const kept = c.droppedSends?.get(c.slate);
  if (!kept?.size) return false;
  c.droppedSends.delete(c.slate);
  c.touched ??= new Set(); c.pending ??= new Set();
  let any = false;
  for (const t of kept) if (c.model?.ST?.[t]) { c.touched.add(t); c.pending.add(t); any = true; }
  return any;
}

/** After a load: every team the board holds an Apply for is checked against the board once, because a pull may have landed since it was sent. True when any. */
export function requeueApplied(c) {
  if (!mayAutoSend(c.inputs)) return false;
  const teams = Object.keys(c.applied?.keys ?? {}).filter((t) => c.model.ST[t]);
  if (!teams.length) return false;
  c.pending ??= new Set();
  for (const t of teams) c.pending.add(t);
  return true;
}

/** How many preview-and-send rounds a send makes while the numbers move under it (CONSOLE_MOVED), and for how long at most, before it waits and goes again by itself (Adam 11-21).
 *  MOVED_WAITS: the waits after each capped send in a row (4 s, 8 s, 16 s); past the last, nothing goes by itself and his next change is the retry. */
export const MOVED_ROUNDS = 5, MOVED_CAP_MS = 10_000, MOVED_WAITS = [4000, 8000, 16_000];

/** His changes saved before a preview: every dirty team written and waited for. Throws SYNC_RUNNING (the save waits on its own timer) or a failed save's words. */
async function savedFirst(c, auto) {
  saveDirty(c, auto);
  await c.saveQueue;
  if (c.saveWaiting) throw Object.assign(new Error("a sync is running, so your last change is not saved yet"), { code: "SYNC_RUNNING" }); // the save is tried again by its own timer; the send waits for it the same way
  const failed = Object.values(c.saveErrs);
  if (failed.length) throw new Error(`not sent, because your last change is not saved. ${failed.join(" ")}`);
}

/**
 * One preview and send for `teams`, the keys taken each round (after his saves) and used for that round's preview and send. A write landing between a preview and its send (CONSOLE_MOVED: his own next click's save, the lineup news,
 * another page's send) saves what is his, previews again on the fresh numbers and sends, silently, up to MOVED_ROUNDS rounds within MOVED_CAP_MS; past that it throws CONSOLE_MOVED with
 * `capped` (and `rounds`), and the sender keeps the change pending and sends it again by itself. check(plan) may throw to refuse before anything is sent.
 * { plan, out } (out null when nothing moved), or null when the slate changed. `clock`: the time in ms (tests inject one).
 */
export async function previewAndSend(c, teams, check = null, auto = false, clock = Date.now) {
  const slate = c.slate, started = clock();
  for (let round = 1; ; round++) {
    await savedFirst(c, auto); // round 2 on: a click of his made while the last round ran is saved before the numbers are read again
    if (slate !== c.slate) return null;
    const keys = Object.fromEntries(teams.map((t) => [t, keyOf(c.model.ST[t].outs)])); // taken each round, after his saves: a round's preview and send carry the same keys
    // auto: no click of his started this send (a load, a pull, the lineup bar's news), so the server carries his_at; file_base: the scenarios file's his_at as this page last saw it.
    const body = { scenarios: keys, teams, pull: c.inputs.basis.pull, tier: c.inputs.basis.tier ?? null, source_default: c.inputs.source_default ?? null, ...(auto ? { auto: true } : {}) };
    const plan = await post(c, { ...body, preview: true });
    if (slate !== c.slate) return null;
    check?.(plan);
    if (!plan.changes.length && !plan.min_moves && !plan.flag_moves && !plan.holds) return { plan, out: null };
    try {
      const out = await post(c, { ...body, basis: plan.basis, file_base: c.serverFileHisAt ?? null });
      if (slate !== c.slate) return null;
      if (out.his_at !== undefined) c.serverFileHisAt = out.his_at;
      c.applied = out.applied;
      c.onPlayers(out.players);
      return { plan, out };
    } catch (e) {
      if (e.code !== "CONSOLE_MOVED") throw e;
      if (slate !== c.slate) return null;
      if (round >= MOVED_ROUNDS || clock() - started >= MOVED_CAP_MS) throw Object.assign(new Error(`the numbers moved under the send ${round} times in a row`), { code: "CONSOLE_MOVED", capped: true, rounds: round });
    }
  }
}

/** When a send the moving numbers held back goes again (c.sync.moved), or that it is stuck and his next change is the retry. Pure. */
export const movedAgainText = (m) => (m.again ? `Your change is kept and goes again by itself at ${etTime(m.again)}.` : `Your change is kept; after ${m.cycles} tries in a row nothing goes by itself, so it goes with your next change.`);

/** The Console's foot line for a send the moving numbers held back (c.sync.moved): what is waiting and when it goes again, or that it is stuck; null otherwise. Pure. */
export function sendFootText(sync) {
  const m = sync?.state === "waiting" ? sync.moved : null;
  if (!m) return null;
  return `Not on the board yet: ${m.teams.join(", ")}. The numbers moved under the send ${m.rounds} times in a row (the lineup news, another page or your next change writing at the same moment), so nothing was sent over them. ${movedAgainText(m)}`;
}

/**
 * The background sender: { kick() (a change was made: send it), run(fn) (fn runs in the same line, after what is queued), direct(team, check),
 * idle() }. c.sync is what the console's header and the board show: { state: "ok" | "partial" | "sending" | "error" | "waiting", at, seq, msg,
 * notes (what the last send held back), unsent (teams with old work not sent), pending (teams changed since the last send) }.
 * seq: the count of sends started on this page (c.sendSeq, never reset), so the board tells a send begun after his typed number from one begun before (instant-pins.js settleOf, review 11-21 F8).
 */
export function createAutoApply(c, { refreshInputs, onState }) {
  let chain = Promise.resolve(), queued = false, queuedAuto = true;
  c.pending ??= new Set();
  const set = (state, extra = {}) => { c.sync = { state, at: Date.now(), msg: null, notes: [], unsent: [], ...extra, seq: c.sendSeq ?? 0, pending: [...c.pending].sort() }; onState(); };
  /** After a send: the teams it covered are no longer pending; what it held back is "partial". */
  const settle = (res, teams, was) => {
    for (const t of was) if (teams.includes(t)) c.pending.delete(t);
    const notes = res ? planNotesList(res.plan) : [], unsent = unsentTeams(c, sendTeams(c));
    set(notes.length ? "partial" : "ok", { notes, unsent });
  };
  /**
   * The numbers kept moving under a send (previewAndSend's cap): its teams stay pending, so nothing of his is lost, and the foot says so (sendFootText), no box over the table. One timer sends
   * again after MOVED_WAITS[n - 1] for the n-th capped send in a row on this slate; past the last nothing goes by itself and his next change is the retry. A card's send (`check`) goes again
   * as the card's send with its check kept; the background's as a kick. Returns { teams, rounds, cycles, again (ms; null when stuck) }.
   */
  function movedLater(teams, e, auto, check) {
    for (const t of teams) c.pending.add(t);
    const n = c.movedCycles?.slate === c.slate ? c.movedCycles.n + 1 : 1;
    c.movedCycles = { slate: c.slate, n };
    const r = c.movedRetry?.slate === c.slate ? c.movedRetry : { slate: c.slate, kick: false, auto: true, direct: new Map() };
    if (check) for (const t of teams) r.direct.set(t, check); else r.kick = true;
    r.auto = r.auto && auto === true;
    c.movedRetry = r;
    const wait = MOVED_WAITS[n - 1] ?? null;
    const moved = { teams: [...new Set([...teams, ...r.direct.keys()])].sort(), rounds: e.rounds ?? MOVED_ROUNDS, cycles: n, again: wait === null ? null : Date.now() + wait };
    set("waiting", { msg: wait === null ? "Not on the board yet; it goes with your next change" : "Not on the board yet; sending again in a moment", moved });
    clearTimeout(c.retryTimer);
    if (wait !== null) c.retryTimer = setTimeout(retryMoved, wait); // one retry timer, as the sync and usage waits; cleared with the slate (console.js load)
    return moved;
  }
  /** The timer's retry of what movedLater kept: each card team as the card's send with its check, the rest as a kick. A refusal then is said as the card says one. */
  function retryMoved() {
    const r = c.movedRetry;
    c.movedRetry = null;
    if (!r || r.slate !== c.slate) return;
    for (const [team, check] of r.direct) {
      api.run(() => sendWith(() => sendTeams(c, [team]), check, r.auto)).catch((e) => {
        if (r.slate !== c.slate) return;
        set("error", { msg: `Your last change on ${team} has not reached the board: ${e.message}` });
        c.toast?.(`Not sent: ${e.message}`, "err");
      });
    }
    if (r.kick) api.kick(r.auto);
  }
  /** One send; a pull that landed since the console read its inputs reads them again (his work rebased on the new Tonight) and sends once more. */
  async function sendWith(teamsOf, check, auto = false) {
    const slate = c.slate, was = new Set(c.pending);
    let teams = teamsOf();
    if (!teams.length) { settle(null, teams, was); return null; }
    c.sendSeq = (c.sendSeq ?? 0) + 1; // this send starts now: it carries every mark written before this line (previewAndSend saves them first)
    set("sending");
    let res;
    try {
      try {
        res = await previewAndSend(c, teams, check, auto);
      } catch (e) {
        if (e.code !== "CONSOLE_OLD_PULL" && e.code !== "CHANGED_ELSEWHERE") throw e; // a pull landed, or the disk's work moved (the other computer's came down): read again, which takes that work, and send once more from it
        await refreshInputs();
        teams = teamsOf();
        res = await previewAndSend(c, teams, check, auto);
      }
    } catch (e) {
      if (slate !== c.slate) keepDropped(c, slate, teams); // the slate changed under it: kept to go again on that slate (round 2, item 2)
      else if (e.code === "CONSOLE_MOVED" && e.capped) return { plan: null, out: null, moved: movedLater(teams, e, auto, check) }; // kept, never an error: the card and the foot say when it goes again
      throw e;
    }
    if (slate === c.slate) {
      if (c.movedCycles?.slate === slate) c.movedCycles = null; // a send went through: the next capped one waits the first wait again
      if (c.movedRetry?.slate === slate) for (const t of teams) c.movedRetry.direct.delete(t); // this send carried a card team the timer was to send
    }
    if (slate === c.slate) settle(res, teams, was);
    else keepDropped(c, slate, teams); // dropped by the switch (previewAndSend answers null): kept, never lost without a word
    return res;
  }
  async function send() {
    const auto = queuedAuto; // true only when every change waiting to go was started by no click of his
    queued = false; queuedAuto = true;
    if (!c.model || !c.slate) return;
    c.cardStart = null; // any send, a pull's included, carries the card's held moves, so they can no longer be taken back
    for (const s of c.cardOwned ?? []) s.carried = true;
    const slate = c.slate;
    try {
      await sendWith(() => sendTeams(c), null, auto);
    } catch (e) {
      if (slate !== c.slate) return;
      if (e.code === "SYNC_RUNNING") { set("waiting", { msg: "GitHub's data is coming down; your change goes to the board in a moment." }); clearTimeout(c.retryTimer); c.retryTimer = setTimeout(() => api.kick(auto), SYNC_WAIT_MS); return; } // one retry timer, like the usage wait
      if (e.code === "USAGE_LOADING") { set("waiting", { msg: "The usage table is still loading; your change goes to the board when it has." }); clearTimeout(c.retryTimer); c.retryTimer = setTimeout(() => api.kick(), USAGE_WAIT_MS); return; } // one retry timer, replaced by the next and cleared with the slate (console.js load)
      set("error", { msg: `Your last change has not reached the board: ${e.message}` });
      c.toast(`The board was not updated: ${e.message}`, "err");
    }
  }

  const api = {
    /** A change was made: send it. `auto`: no click of his started it (a load, a pull, the lineup bar's news); a click among the changes waiting makes the send his. */
    kick(auto = false) {
      queuedAuto = queuedAuto && auto === true;
      if (queued) return chain;
      queued = true;
      chain = chain.then(send).catch((e) => { // one throw never stops every later send (round 2, item 4), as run() does
        queued = false;
        try { set("error", { msg: `Your last change has not reached the board: ${e.message}` }); } catch (e2) { console.warn("console send state:", e2.message); }
        c.toast?.(`The board was not updated: ${e.message}`, "err");
      });
      return chain;
    },
    run(fn) {
      const p = chain.then(fn);
      chain = p.catch((e) => { console.warn("console send line: the caller was told", e.message); }); // the caller has the error; the line goes on
      return p;
    },
    /** The player card's and the lineup bar's send for `team` in the same line: check(plan) refuses before anything is sent. */
    direct: (team, check) => api.run(() => sendWith(() => sendTeams(c, [team]), check)),
    idle: () => chain,
    /** The header after a load or a failed read: old work the page has not sent is said ("unsent"), never "up to date". Leaves a send in flight or waiting alone. */
    settleNow() { if (!c.pending.size && !["sending", "waiting", "error"].includes(c.sync?.state)) settle(null, [], new Set(c.pending)); },
    /** A read of the inputs failed: the header says so instead of staying green. */
    fail(msg) { set("error", { msg }); },
    /** A read that failed has worked again: the header's error `msg` from it goes (to "unsent" or "up to date", as settleNow); a send's own error or anything since is left alone. */
    readOk(msg) { if (c.sync?.state === "error" && c.sync.msg === msg) settle(null, [], new Set(c.pending)); },
  };
  return api;
}

/**
 * The page's reaction to a pull that landed, as a pure line: `read()` takes the new inputs (and queues the sends for the teams whose result moved), `kick()` sends what is still marked
 * not on the board, `pending()` is that set. One read at a time; a pull that lands while one runs makes one more read after it, never a pile. Once per pull, a team still not on the board is kicked.
 */
export function createPullReads({ read, kick, pending }) {
  let busy = false, again = false;
  return async function onPull() {
    if (busy) { again = true; return; }
    busy = true;
    try {
      for (let round = 0; round < 2; round++) {
        again = false;
        await read();
        if (!again) break;
      }
      if (pending().size) kick();
    } finally { busy = false; again = false; }
  };
}
