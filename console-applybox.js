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
