// The player card's role and minutes block (Adam, 11-06): his role buttons, a minutes box and a DK points per minute box, writing the
// same console work as the console's own controls (console-card.js), and an Apply that sends it to the board as the console's Apply
// does. Typed numbers are his: never scaled, never refused (0 to the pin limits). roleBoxHtml is DOM-free; cardRoles wires it.
import { esc } from "./board-util.js";
import { ROLES, ROLE_LABEL, ROLE_SHORT } from "./console-roles.js";
import { PIN_MAX } from "./override-limits.js";
import { isNum } from "./figures.js";
import { basisText, medianFlag } from "./console-render.js";

const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const MISS = "—";

/** The block for one man. v: manView's answer, or null when he is on no team of the console; state: { loading, error, said, notes, refusal, busy }. */
export function roleBoxHtml(v, state = {}) {
  const head = `<div class="sec">Role and minutes${v ? `<span class="hint">the console's ${esc(v.team)} scenario; Apply sends every team's scenario on show to the board</span>` : ""}</div>`;
  if (state.loading) return `${head}<div class="cardmsg">Loading the console…</div>`;
  if (state.error) return `${head}<div class="cardmsg err">The console could not load, so his role and minutes cannot be set here: ${esc(state.error)}</div>`;
  if (!v) return `${head}<div class="cardmsg">He is on no team of this slate's console.</div>`;
  const r = v.row, p = v.man;
  const seg = `<span class="seg">${ROLES.map((k) => `<button type="button" class="rs${r.role === k ? ` on ${k}${r.pinned.r || (k === "out" && r.out) ? " set" : ""}` : ""}" data-crole-set="${k}" title="${ROLE_LABEL[k]}">${ROLE_SHORT[k]}</button>`).join("")}</span>`;
  const boxOf = (k, val, text) => {
    const pinned = !r.out && r.pinned[k];
    return `<label class="crb${pinned ? " pin" : ""}">${k === "m" ? "Min" : "DK/min"}<input data-crk="${k}" inputmode="decimal" autocomplete="off" value="${r.out ? (k === "m" ? "OUT" : "") : isNum(val) ? text(val) : ""}" placeholder="${MISS}"${r.out ? " readonly" : ""} title="${k === "m" ? `Minutes, 0 to ${PIN_MAX.m}` : `DK points per minute, 0 to ${PIN_MAX.d}`}: typed numbers are kept as typed. Empty clears it.">${pinned ? `<button type="button" class="x" data-crx="${k}" title="Clear what you typed">x</button>` : ""}</label>`;
  };
  const proj = r.out ? "0.0" : isNum(r.proj) ? f1(r.proj) : MISS;
  const moves = v.moves.length ? `<div class="crm">To keep five starters: ${v.moves.map((m) => `${esc(m.name)} ${esc(ROLE_LABEL[m.from])} to ${esc(ROLE_LABEL[m.to])}`).join(", ")}. Ctrl+Z in the console undoes it.</div>` : "";
  const err = v.saveErr ? `<div class="cardmsg err">${esc(v.saveErr)}</div>` : "";
  const refusal = state.refusal ? `<div class="cardmsg err">Apply refused: ${esc(state.refusal)}</div>` : "";
  const notes = state.notes?.length ? `<ul class="crn">${state.notes.map((n) => `<li><b>${esc(n.team)}</b> ${esc(n.text)}</li>`).join("")}</ul>` : "";
  return `${head}<div class="crr">${seg}<span class="crf">TwoGun <b>${isNum(p.tg_min) ? f1(p.tg_min) : MISS}</b> min</span></div>`
    + `<div class="crr">${boxOf("m", r.min, f1)}${boxOf("d", r.rate, (x) => x.toFixed(2))}<span class="crf">Proj <b class="${r.pinned.m || r.pinned.d || r.pinned.r ? "pin" : ""}">${proj}</b></span></div>`
    + `<div class="crs" title="${esc(basisText(r))}">${medianFlag(r)}Minutes from: ${esc(basisText(r))}</div>${moves}${err}`
    + `<div class="crr"><button type="button" class="crap" data-crapply${state.busy ? " disabled" : ""}>${state.busy ? "Applying…" : "Apply to board"}</button><span class="crsaid">${esc(state.said ?? "")}</span></div>${refusal}${notes}`;
}

/** What one Apply from the card sent, in words: the teams, then the counts. */
export function sentText(out) {
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
        if (slot.isConnected) slot.innerHTML = roleBoxHtml(v, { said, notes, refusal, ...state });
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
    slot.addEventListener("click", async (e) => {
      if (!view) return;
      const set = e.target.closest("[data-crole-set]"), clear = e.target.closest("[data-crx]");
      if (set) { fresh(); last = null; api().setRole(view.team, view.id, set.dataset.croleSet); return redraw(); }
      if (clear) { fresh(); last = null; api().clearPin(view.team, view.id, clear.dataset.crx); return redraw(); }
      if (e.target.closest("[data-crapply]")) {
        fresh();
        await draw({ busy: true });
        try {
          const out = await api().applyNow(view.team);
          said = sentText(out);
          notes = out.notes;
        } catch (err) {
          refusal = err.message;
          notes = (err.notes ?? []).filter((n) => n.team !== view.team || n.note_only);
          toast(`Apply refused: ${err.message}`, "err");
        }
        return redraw();
      }
    });
    const commit = (inp) => {
      if (!view || inp.readOnly) return;
      const k = inp.dataset.crk, text = inp.value.trim();
      fresh();
      if (text === "") { last = null; api().clearPin(view.team, view.id, k); return redraw(); }
      const n = Number(text);
      if (!Number.isFinite(n) || n < 0) { toast(`${k === "m" ? "Minutes" : "DK/min"} must be a number from 0 up.`, "err"); return redraw(); }
      // Enter then the box's change event: one commit, not two, whether or not the redraw has landed yet.
      const now = k === "m" ? view.row.min : view.row.rate;
      if ((view.row.pinned[k] && isNum(now) && Math.abs(now - n) < 1e-9) || (last && last.id === view.id && last.k === k && last.n === n)) return;
      last = { id: view.id, k, n };
      api().setPin(view.team, view.id, k, n);
      return redraw();
    };
    slot.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("[data-crk]")) { e.preventDefault(); commit(e.target); } });
    slot.addEventListener("change", (e) => { if (e.target.matches("[data-crk]")) commit(e.target); });
  };
}
