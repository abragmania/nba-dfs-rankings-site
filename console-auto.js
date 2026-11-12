// Every console change reaches the board and the optimizer by itself (Adam, 11-07): no Apply step. After each change the work is saved,
// then the same preview and send the old Apply made run in the background, one at a time; a change made while one runs is sent after it,
// once. The board's figures come only from the server's answer (overrides.json), so the board has one source of truth.
// Only the teams he changed in this page's life, and teams the board already holds an Apply for, are sent: another team's old saved work
// stays unsent and is named as one line until he next changes that team. What a send holds back (planNotesList) is shown as "partial",
// never as up to date. Each takes the console's shared state `c`; c.auto is set only by createConsole, so the tests' fake consoles send nothing by themselves.
import { keyOf } from "./console-engine.js";
import { calc, hasPins } from "./console-model.js";
import { saveDirty } from "./console-moves.js";

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
    ...(plan.missing ?? []).map((m) => ({ team: m.team, text: `${m.name} has no projection here (${m.why})` })),
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

/** Teams with saved work of his that this page has not sent: pins on any scenario, a scenario off Tonight, or minutes from Ours. */
export const unsentTeams = (c, sent) => Object.keys(c.model.ST).filter((t) => !sent.includes(t) && ((c.model.ST[t].source ?? "twogun") !== "twogun" || Object.values(c.model.ST[t].pins ?? {}).some(hasPins) || keyOf(c.model.ST[t].outs) !== c.model.TEAMS[t]?.tonightKey)).sort();

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
  c.auto?.kick();
  return moved;
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

/**
 * One preview and send for `teams`, the keys taken once and used for both calls. A save landing between them (CONSOLE_MOVED) previews once more,
 * silently. check(plan) may throw to refuse before anything is sent. { plan, out } (out null when nothing moved), or null when the slate changed.
 */
export async function previewAndSend(c, teams, check = null) {
  const slate = c.slate;
  saveDirty(c);
  await c.saveQueue;
  const failed = Object.values(c.saveErrs);
  if (failed.length) throw new Error(`not sent, because your last change is not saved. ${failed.join(" ")}`);
  const keys = Object.fromEntries(teams.map((t) => [t, keyOf(c.model.ST[t].outs)]));
  const body = { scenarios: keys, teams, pull: c.inputs.basis.pull, tier: c.inputs.basis.tier ?? null };
  for (let round = 0; ; round++) {
    const plan = await post(c, { ...body, preview: true });
    if (slate !== c.slate) return null;
    check?.(plan);
    if (!plan.changes.length && !plan.min_moves && !plan.holds) return { plan, out: null };
    try {
      const out = await post(c, { ...body, basis: plan.basis });
      if (slate !== c.slate) return null;
      c.applied = out.applied;
      c.onPlayers(out.players);
      return { plan, out };
    } catch (e) {
      if (e.code !== "CONSOLE_MOVED" || round > 0) throw e;
    }
  }
}

/**
 * The background sender: { kick() (a change was made: send it), run(fn) (fn runs in the same line, after what is queued), direct(team, check),
 * idle() }. c.sync is what the console's header and the board show: { state: "ok" | "partial" | "sending" | "error" | "waiting", at, msg,
 * notes (what the last send held back), unsent (teams with old work not sent), pending (teams changed since the last send) }.
 */
export function createAutoApply(c, { refreshInputs, onState }) {
  let chain = Promise.resolve(), queued = false;
  c.pending ??= new Set();
  const set = (state, extra = {}) => { c.sync = { state, at: Date.now(), msg: null, notes: [], unsent: [], ...extra, pending: [...c.pending].sort() }; onState(); };
  /** After a send: the teams it covered are no longer pending; what it held back is "partial". */
  const settle = (res, teams, was) => {
    for (const t of was) if (teams.includes(t)) c.pending.delete(t);
    const notes = res ? planNotesList(res.plan) : [], unsent = unsentTeams(c, sendTeams(c));
    set(notes.length ? "partial" : "ok", { notes, unsent });
  };
  /** One send; a pull that landed since the console read its inputs reads them again (his work rebased on the new Tonight) and sends once more. */
  async function sendWith(teamsOf, check) {
    const slate = c.slate, was = new Set(c.pending);
    let teams = teamsOf();
    if (!teams.length) { settle(null, teams, was); return null; }
    set("sending");
    let res;
    try {
      res = await previewAndSend(c, teams, check);
    } catch (e) {
      if (e.code !== "CONSOLE_OLD_PULL") throw e;
      await refreshInputs();
      teams = teamsOf();
      res = await previewAndSend(c, teams, check);
    }
    if (slate === c.slate) settle(res, teams, was);
    return res;
  }
  async function send() {
    queued = false;
    if (!c.model || !c.slate) return;
    c.cardStart = null; // any send, a pull's included, carries the card's held moves, so they can no longer be taken back
    for (const s of c.cardOwned ?? []) s.carried = true;
    const slate = c.slate;
    try {
      await sendWith(() => sendTeams(c), null);
    } catch (e) {
      if (slate !== c.slate) return;
      if (e.code === "USAGE_LOADING") { set("waiting", { msg: "The usage table is still loading; your change goes to the board when it has." }); clearTimeout(c.retryTimer); c.retryTimer = setTimeout(() => api.kick(), USAGE_WAIT_MS); return; } // one retry timer, replaced by the next and cleared with the slate (console.js load)
      set("error", { msg: `Your last change has not reached the board: ${e.message}` });
      c.toast(`The board was not updated: ${e.message}`, "err");
    }
  }

  const api = {
    kick() {
      if (queued) return chain;
      queued = true;
      chain = chain.then(send);
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
