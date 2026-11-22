// The player card's role and minutes block (Adam, 11-06): his role buttons, a minutes box and a DK points per minute box, writing the
// same console work as the console's own controls (console-card.js). Each change goes to the board by itself, as the console's own changes do;
// a change the send would hold back is taken back and said. Typed numbers are his: never scaled, never refused (0 to the pin limits). roleBoxHtml is DOM-free; cardRoles wires it.
import { esc, figSourceWord } from "./board-util.js";
import { stepHtml, stepMinutes, wholeText } from "./min-step.js";
import { ROLES, ROLE_LABEL, ROLE_SHORT } from "./console-roles.js";
import { PIN_MAX } from "./override-limits.js";
import { isNum } from "./figures.js";
import { basisText, medianFlag, tgMinHtml } from "./console-render.js";
import { typedText } from "./console-model.js";
import { clearQueued } from "./instant-pins.js";
import { pickLineHtml } from "./console-picks.js";

/** The card writes his number straight to the console: the board's own number for him of that kind not yet sent is older and is dropped first,
 *  and one being written now lands before the card's (instant-pins.js clearQueued), so the card's is the last word. */
const afterBoard = (id, k, fn) => { const going = clearQueued(id, k); return going ? going.then(fn) : fn(); };

const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const MISS = "—";

/** The block for one man. v: manView's answer, or null when he is on no team of the console; state: { loading, error, said, notes, refusal, busy }. */
export function roleBoxHtml(v, state = {}) {
  const head = `<div class="sec">Role and minutes${v ? `<span class="hint">the console's ${esc(v.team)} scenario numbers; a change here goes to the board by itself</span>` : ""}</div>`;
  if (state.loading) return `${head}<div class="cardmsg">Loading the console…</div>`;
  if (state.error) return `${head}<div class="cardmsg err">The console could not load, so his role and minutes cannot be set here: ${esc(state.error)}</div>`;
  if (!v) return `${head}<div class="cardmsg">He is on no team of this slate's console.</div>`;
  const r = v.row, p = v.man, off = v.off ?? null; // off: his team's game has started (console-tipped.js): every control disabled, the hover saying why (Adam 11-21: no refusal boxes)
  const tip = (title) => (off ? ` disabled title="${esc(off)}"` : ` title="${esc(title)}"`);
  const seg = `<span class="seg">${ROLES.map((k) => `<button type="button" class="rs${r.role === k ? ` on ${k}${r.pinned.r || (k === "out" && r.out) ? " set" : ""}` : ""}" data-crole-set="${k}"${tip(ROLE_LABEL[k])}>${ROLE_SHORT[k]}</button>`).join("")}</span>`;
  const boxOf = (k, val, text) => {
    const pinned = !r.out && r.pinned[k];
    const input = `<input data-crk="${k}" inputmode="decimal" autocomplete="off" value="${r.out ? (k === "m" ? "OUT" : "") : isNum(val) ? text(val) : ""}" placeholder="${MISS}"${r.out || off ? " readonly" : ""} title="${esc(off ?? `${k === "m" ? `Minutes, 0 to ${PIN_MAX.m}` : `DK points per minute, 0 to ${PIN_MAX.d}`}: typed numbers are kept as typed. Empty clears it.`)}">`;
    const aside = k === "m" && !r.out && r.min_aside ? `<button type="button" class="x" data-crrestore="1"${tip(`${r.min_aside.words.charAt(0).toUpperCase()}${r.min_aside.words.slice(1)}. Click to use it again`)}>&#8617; ${esc(wholeText(r.min_aside.value) ?? "")}</button>` : ""; // Adam 9:46 AM 11-20 (typed-aside.js)
    return `<span class="crb${pinned ? " pin" : ""}">${k === "m" ? "Min" : "DK/min"}${k === "m" ? stepHtml(input, v.id, v.team, Boolean(off) || r.out || !isNum(val)) : input}${pinned ? `<button type="button" class="x" data-crx="${k}"${tip("Clear what you typed")}>x</button>` : ""}${aside}</span>`;
  };
  const proj = r.out ? "0.0" : isNum(r.proj) ? f1(r.proj) : MISS;
  const moves = v.moves.length ? `<div class="crm">To keep five starters: ${v.moves.map((m) => `${esc(m.name)} ${esc(ROLE_LABEL[m.from])} to ${esc(ROLE_LABEL[m.to])}`).join(", ")}. Ctrl+Z in the console undoes it.</div>` : "";
  const err = v.saveErr ? `<div class="cardmsg err">${esc(v.saveErr)}</div>` : "";
  const refusal = state.refusal ? `<div class="cardmsg err">Not sent: ${esc(state.refusal)}</div>` : "";
  const notes = state.notes?.length ? `<ul class="crn">${state.notes.map((n) => `<li><b>${esc(n.team)}</b> ${esc(n.text)}</li>`).join("")}</ul>` : "";
  const b = state.board; // the header's own figures, so a console figure that differs says so
  const word = b ? figSourceWord(b, "min") : "";
  const differs = b && isNum(b.minutes) && isNum(r.min) && !r.out && Math.abs(b.minutes - r.min) > 0.05;
  const differ = differs ? `<div class="crs">Console scenario (${esc(basisText(r))} minutes): ${f1(r.min)} min. The board above uses ${word ? `${esc(word)}: ` : ""}${f1(b.minutes)}.</div>` : "";
  return `${head}<div class="crr">${seg}<span class="crf">TwoGun's own ${tgMinHtml(p)}</span></div>${pickLineHtml(v.team, v.id, v.pick, { attr: "data-crpick", label: "His Starter mark replaces", off })}`
    + `<div class="crr">${boxOf("m", r.min, wholeText)}${boxOf("d", r.rate, (x) => x.toFixed(2))}<span class="crf">Console proj <b class="${r.pinned.m || r.pinned.d || r.pinned.r ? "pin" : ""}">${proj}</b></span></div>`
    + `<div class="crs" title="${esc(basisText(r))}">${medianFlag(r)}Console minutes from: ${esc(basisText(r))}</div>${differ}${moves}${err}`
    + `<div class="crr"><span class="crsaid">${state.busy ? "Sending to the board…" : esc(state.said ?? "")}</span></div>${refusal}${notes}`;
}

/** What one send from the card made, in words: the teams, then the counts. */
export function sentText(out) {
  if (out.kept) return out.kept; // the moving numbers held it back: kept, and when it goes again (console-applybox.js)
  if (!out.changed && !out.min_changed) return "Nothing to send: the board already has it.";
  return `Sent ${out.teams.join(", ")}: ${out.changed} projection${out.changed === 1 ? "" : "s"}, ${out.min_changed} minutes.`;
}

/**
 * The card's hook: fill(p, slot) draws the block into the card's slot and wires it. deps: { api() -> the console's card calls,
 * slate() -> the slate on show, toast(msg, kind) }. Each change redraws the block from the console's work.
 */
export function cardRoles({ api, slate, toast }) {
  let said = "", notes = [], refusal = "";
  return function fill(p, slot) {
    if (!slot) return;
    const who = { id: p.dk_id, name: p.name, team: p.team };
    const draw = async (state = {}) => {
      try {
        const v = await api().manView(slate(), who);
        if (slot.isConnected) {
          const a = document.activeElement, at = a && slot.contains(a) && a.matches("[data-crk]") ? { k: a.dataset.crk, typed: typedText(a), s: a.selectionStart, e: a.selectionEnd } : null; // the box he is typing in
          slot.innerHTML = roleBoxHtml(v, { said, notes, refusal, board: p, ...state });
          const el = at && slot.querySelector(`[data-crk="${at.k}"]`);
          if (el && !el.readOnly) { el.focus({ preventScroll: true }); if (at.typed !== null) { el.value = at.typed; el.setSelectionRange(at.s ?? at.typed.length, at.e ?? at.typed.length); } }
        }
        return v;
      } catch (e) {
        if (slot.isConnected) slot.innerHTML = roleBoxHtml(null, { error: e.message });
        return null;
      }
    };
    let last = null; // the last number committed from this card, so a second event for it is not a second history step
    const fresh = () => { said = ""; notes = []; refusal = ""; };
    slot.innerHTML = roleBoxHtml(null, { loading: true });
    let view = null;
    draw().then((v) => { view = v; });
    const redraw = async () => { view = await draw(); };
    /** The card's change goes to the board by itself, checked and sent in one step (console-card.js applyNow). A refusal takes the card's moves back and says why; nothing is sent. */
    const send = async () => {
      if (!view) return;
      view = (await draw({ busy: true })) ?? view; // the next press steps from the number shown, not the one before the send
      try {
        const out = await api().applyNow(view.team);
        said = sentText(out);
        notes = out.notes;
      } catch (err) {
        refusal = err.message;
        notes = (err.notes ?? []).filter((n) => n.team !== view.team || n.note_only);
        toast(`Not sent: ${err.message}`, "err");
      }
      return redraw();
    };
    slot.addEventListener("click", async (e) => {
      if (!view || view.off) return; // his team's game has started: nothing here edits it
      const set = e.target.closest("[data-crole-set]"), clear = e.target.closest("[data-crx]"), step = e.target.closest("[data-mstep]"), back = e.target.closest("[data-crrestore]"), pick = e.target.closest("[data-crpick]");
      if (pick && !pick.disabled) { fresh(); last = null; api().setPick(view.team, view.id, pick.dataset.crpick || null); return send(); } // whom his Starter mark replaces (console-picks.js)
      if (back) { fresh(); last = null; api().restoreCard(view.team, view.id); return send(); } // his set-aside typed minutes back in use (Adam 9:46 AM 11-20)
      if (step && !step.disabled) {
        const n = stepMinutes(view.row.min, Number(step.dataset.mstep));
        if (n === null) return toast("There is no minutes figure to step from; type his minutes.", "err");
        fresh(); last = { id: view.id, k: "m", n };
        const { team, id } = view;
        return afterBoard(id, "m", () => { api().setPin(team, id, "m", n); return send(); });
      }
      if (set) { fresh(); last = null; api().setRole(view.team, view.id, set.dataset.croleSet); return send(); }
      if (clear) { fresh(); last = null; const { team, id } = view, k = clear.dataset.crx; return afterBoard(id, k, () => { api().clearPin(team, id, k); return send(); }); }
    });
    const commit = (inp) => {
      if (!view || inp.readOnly) return;
      const k = inp.dataset.crk, text = inp.value.trim();
      fresh();
      const { team, id } = view;
      if (text === "") { last = null; return afterBoard(id, k, () => { api().clearPin(team, id, k); return send(); }); }
      const n = Number(text);
      if (!Number.isFinite(n) || n < 0) { toast(`${k === "m" ? "Minutes" : "DK/min"} must be a number from 0 up.`, "err"); return redraw(); }
      // Enter then the box's change event: one commit, not two, whether or not the redraw has landed yet.
      const now = k === "m" ? view.row.min : view.row.rate;
      if ((view.row.pinned[k] && isNum(now) && Math.abs(now - n) < 1e-9) || (last && last.id === view.id && last.k === k && last.n === n)) return;
      last = { id: view.id, k, n };
      return afterBoard(id, k, () => { api().setPin(team, id, k, n); return send(); });
    };
    slot.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("[data-crk]")) { e.preventDefault(); commit(e.target); } });
    slot.addEventListener("change", (e) => { if (e.target.matches("[data-crk]")) commit(e.target); });
  };
}
