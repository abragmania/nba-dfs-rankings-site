// Every console change reaches the board and the optimizer by itself (Adam, 11-07): no Apply step. After each change the work is saved,
// then the same preview and send the old Apply made run in the background, one at a time; a change made while one runs is sent after it,
// once. The board's figures come only from the server's answer (overrides.json), so the board has one source of truth.
// Only the teams he changed in this page's life, and teams the board already holds an Apply for, are sent: another team's old saved work
// stays unsent and is named as one line until he next changes that team. What a send holds back (planNotesList) is shown as "partial",
// never as up to date. Each takes the console's shared state `c`; c.auto is set only by createConsole, so the tests' fake consoles send nothing by themselves.
import { keyOf } from "./console-engine.js";
import { hasPins } from "./console-model.js";
import { saveDirty } from "./console-moves.js";

const post = (c, body) => c.api(`/api/slate/${encodeURIComponent(c.slate)}/console/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
/** Each team's scenario on show: { team: key }. */
export const onScreenKeys = (c) => Object.fromEntries(Object.entries(c.model.ST).map(([code, S]) => [code, keyOf(S.outs)]));
/** How long a send waits while the usage table loads before it goes again; the server refuses a send until it has loaded. */
const USAGE_WAIT_MS = 20_000;

/** What the preview leaves out or holds back, man by man: [{ team, text, note_only }]. note_only: said, but never a reason to refuse the card's Apply
 *  (pins on a scenario not on show; a man Out tonight whom the scenario has playing). */
export function planNotesList(plan) {
  return [
    ...(plan.missing ?? []).map((m) => ({ team: m.team, text: `${m.name} has no projection here (${m.why})` })),
    ...(plan.kept ?? []).map((k) => ({ team: k.team, text: `${k.name} keeps the projection you typed on the board (${k.typed})` })),
    ...(plan.not_on_board ?? []).map((m) => ({ team: m.team, text: `${m.name} is not on the board, so nothing is sent for him` })),
    ...(plan.back_on_zero ?? []).map((m) => ({ team: m.team, text: `${m.name} is back on 0 minutes` })),
    ...(plan.orphaned_pins ?? []).map((o) => ({ team: o.team, text: `${o.count} pins on ${o.team}'s ${o.key || "Healthy"} scenario are not on show and not sent`, note_only: true })),
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
/** After a load: every team holding an applied news entry is sent, because a news change whose send never landed must still reach the board. True when any was added; a preview with no changes then sends nothing. */
export function requeueNews(c) {
  c.touched ??= new Set();
  c.pending ??= new Set();
  let any = false;
  for (const [code, S] of Object.entries(c.model.ST)) {
    if (!Object.values(S.news ?? {}).some((e) => e.state === "applied")) continue;
    c.touched.add(code); c.pending.add(code); any = true;
  }
  return any;
}

/** Teams with saved work of his that this page has not sent: pins on any scenario, or a scenario off Tonight. */
export const unsentTeams = (c, sent) => Object.keys(c.model.ST).filter((t) => !sent.includes(t) && (Object.values(c.model.ST[t].pins ?? {}).some(hasPins) || keyOf(c.model.ST[t].outs) !== c.model.TEAMS[t]?.tonightKey)).sort();

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
  const body = { scenarios: keys, teams, pull: c.inputs.basis.pull };
  for (let round = 0; ; round++) {
    const plan = await post(c, { ...body, preview: true });
    if (slate !== c.slate) return null;
    check?.(plan);
    if (!plan.changes.length && !plan.min_moves) return { plan, out: null };
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
    const slate = c.slate;
    try {
      await sendWith(() => sendTeams(c), null);
    } catch (e) {
      if (slate !== c.slate) return;
      if (e.code === "USAGE_LOADING") { set("waiting", { msg: "The usage table is still loading; your change goes to the board when it has." }); setTimeout(() => api.kick(), USAGE_WAIT_MS); return; }
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
  };
  return api;
}
