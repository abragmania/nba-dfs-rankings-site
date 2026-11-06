// Apply and Reverse: the one box they share, its Enter and Esc, and the calls behind them. Each takes the console's shared state `c`.
import { keyOf } from "./console-engine.js";
import { applyHtml, countsText, reverseHtml } from "./console-render.js";
import { saveDirty } from "./console-moves.js";

const url = (c, tail) => `/api/slate/${encodeURIComponent(c.slate)}/${tail}`;
const post = (c, tail, body) => c.api(url(c, tail), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const say = (c, msg) => { c.E("cmdhint").textContent = msg; };
const onScreenKeys = (c) => Object.fromEntries(Object.entries(c.model.ST).map(([code, S]) => [code, keyOf(S.outs)]));

function showBox(c, html) {
  const box = c.E("applybox");
  box.innerHTML = html;
  box.hidden = false;
  c.el.querySelector("#applyNo").focus();
}

/** Opens the box on what `ask` answers; keys wait from the moment it is asked, and Esc before the answer comes cancels it. */
async function askThenShow(c, kind, ask, htmlOf) {
  const asked = { pending: true };
  c.G.modal = asked;
  try {
    const answer = await ask();
    if (c.G.modal !== asked) return;
    c.G.modal = { kind, answer };
    showBox(c, htmlOf(answer));
  } catch (e) {
    if (c.G.modal === asked) c.G.modal = null;
    say(c, `${kind === "apply" ? "Apply" : "Reverse"}: ${e.message}`);
    c.toast(`${kind === "apply" ? "Apply" : "Reverse"} could not be worked out: ${e.message}`, "err");
  }
}

export function openApply(c) {
  return askThenShow(c, "apply", async () => {
    saveDirty(c); // anything not yet saved, a failed save among it, goes again first
    await c.saveQueue; // the server works out the plan from the saved file
    const failed = Object.values(c.saveErrs);
    if (failed.length) throw new Error(`refused, because your last change is not saved. ${failed.join(" ")}`);
    return post(c, "console/apply", { preview: true, scenarios: onScreenKeys(c), pull: c.inputs.basis.pull });
  }, (plan) => applyHtml(plan, c.slate));
}

export function openReverse(c) {
  if (!c.applied) { say(c, "Nothing has been applied on this slate."); return Promise.resolve(); }
  return askThenShow(c, "reverse", async () => {
    await c.saveQueue;
    return post(c, "console/reverse", { preview: true });
  }, (rev) => reverseHtml(rev, c.slate));
}

export function closeModal(c) {
  c.G.modal = null;
  c.E("applybox").hidden = true;
  c.focusCell();
}

/** What the preview leaves out or holds back, man by man: [{ team, text, note_only }]. The card shows these, since it has no preview box.
 *  note_only: said, but never a reason to refuse the card's Apply (pins on a scenario not on show; a man Out tonight whom the scenario has playing). */
export function planNotesList(plan) {
  return [
    ...plan.missing.map((m) => ({ team: m.team, text: `${m.name} has no projection here (${m.why})` })),
    ...plan.kept.map((k) => ({ team: k.team, text: `${k.name} keeps the projection you typed on the board (${k.typed})` })),
    ...plan.not_on_board.map((m) => ({ team: m.team, text: `${m.name} is not on the board, so nothing is sent for him` })),
    ...plan.back_on_zero.map((m) => ({ team: m.team, text: `${m.name} is back on 0 minutes` })),
    ...plan.orphaned_pins.map((o) => ({ team: o.team, text: `${o.count} pins on ${o.team}'s ${o.key || "Healthy"} scenario are not on show and not sent`, note_only: true })),
    ...(plan.back_in ?? []).map((m) => ({ team: m.team, text: `${m.name} is out tonight but playing in this scenario`, note_only: true })),
  ];
}

/**
 * Apply without the box, for the player card: the same saved work, the same preview's basis, the same route. Refused, with the
 * reasons, when the preview holds anything back on `team` (the card's own team), since the card cannot show a preview. Otherwise
 * { changed, min_changed, teams (the teams sent), notes (what was held back on other teams) }.
 */
export async function applyDirect(c, team) {
  saveDirty(c);
  await c.saveQueue;
  const failed = Object.values(c.saveErrs);
  if (failed.length) throw new Error(`refused, because your last change is not saved. ${failed.join(" ")}`);
  const plan = await post(c, "console/apply", { preview: true, scenarios: onScreenKeys(c), pull: c.inputs.basis.pull });
  const notes = planNotesList(plan), mine = notes.filter((n) => n.team === team && !n.note_only);
  if (mine.length) throw Object.assign(new Error(`nothing sent, because on ${team}: ${mine.map((n) => n.text).join("; ")}. Open the console's Apply to see it all.`), { notes });
  const teams = plan.teams.filter((t) => t.moves > 0 || t.min_moves > 0).map((t) => t.team);
  if (!plan.changes.length && !plan.min_moves) return { changed: 0, min_changed: 0, teams: [], notes };
  const out = await post(c, "console/apply", { basis: plan.basis, scenarios: onScreenKeys(c), pull: c.inputs.basis.pull });
  c.applied = out.applied;
  c.onPlayers(out.players);
  if (c.on) c.drawBar();
  return { changed: out.changed, min_changed: out.min_changed, teams, notes };
}

async function sendApply(c, plan) {
  const out = await post(c, "console/apply", { basis: plan.basis, scenarios: onScreenKeys(c), pull: c.inputs.basis.pull });
  c.applied = out.applied;
  c.onPlayers(out.players);
  const refused = out.refused.length ? `; refused, nothing sent: ${out.refused.map((t) => t.team).join(", ")}` : "";
  say(c, `done: ${countsText(out.changed, out.min_changed)} sent to the board; R takes them back${refused}`);
}
async function sendReverse(c) {
  const out = await post(c, "console/reverse", {});
  c.applied = null;
  c.onPlayers(out.players);
  say(c, `done: ${countsText(out.restored, out.restored_min)} restored${out.kept.length ? `; left as you typed them: ${out.kept.join(", ")}` : ""}`);
}

/** Enter in the box, for both kinds. */
export async function confirmModal(c) {
  const m = c.G.modal;
  if (!m || m.pending || m.sending) return;
  if (m.kind === "apply" && !m.answer.changes.length && !m.answer.min_moves) { closeModal(c); return; }
  m.sending = true;
  try {
    if (m.kind === "apply") await sendApply(c, m.answer);
    else await sendReverse(c);
    closeModal(c);
    c.drawBar();
  } catch (e) {
    closeModal(c);
    const what = m.kind === "apply" ? "Apply" : "Reverse";
    say(c, `${what} refused: ${e.message}`);
    c.toast(`${what} refused: ${e.message}`, "err");
  }
}
