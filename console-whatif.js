// The Console's Load of a saved what-if (Adam 1:37-1:38 PM 11-20: "in the console I can 'load' those scenarios"; "manual is nice to have too just so i can pull one or the other when I want it /
// quickly"). A per-team picker in the team page's header lists the team's saved what-ifs (the Scenario tab's, data/slates/<slate>/whatifs.json); loading one puts its Out men, its starters and its
// Min, Usg and DK/min edits into the team's working scenario as his own Console clicks (setRole, setPin: one Undo step). Like every Console change it is saved and sent by itself
// (console-auto.js: the Console has no Apply step). Being his own Console work, it then wins over any armed what-if on the team (whatif-rule.js hisWork); loading the very what-if in use, whose
// numbers it repeats, is told apart by the team record's his_at moving past the time it went on (whatif-rule.js hisSince: its numbers are then his and nothing of it is taken off).
import { esc } from "./board-util.js";
import { calc } from "./console-model.js";
import { histMark, foldHistory, setRole, setPin, clearPin } from "./console-moves.js";
import { keyOf } from "./console-engine.js";

/** Reads the slate's what-ifs onto the console (c.whatifs); a failed read is kept as c.whatifsErr and shown on the picker, never as an empty list. Never rejects. */
export async function readWhatifs(c) {
  const name = c.slate;
  try {
    const out = await c.api(`/api/slate/${encodeURIComponent(name)}/whatifs`);
    if (name === c.slate) Object.assign(c, { whatifs: out.whatifs, whatifsErr: null });
  } catch (e) { if (name === c.slate) Object.assign(c, { whatifs: null, whatifsErr: e.message }); }
}

/** The header's picker for one team: nothing when the team has no saved what-if; a muted word when they could not be read. */
export function whatifLoadHtml(code, list, err) {
  if (err) return `<span class="wl-err" title="${esc(`The saved what-ifs could not be read: ${err}`)}">What-ifs: not read</span>`;
  if (!list?.length) return "";
  return `<select class="wload" data-wload="${esc(code)}" title="Load a saved what-if from the Scenario tab into this team's scenario: its Outs, its starters and its numbers, as your own Console work (Undo takes it back)"><option value="" selected>Load what-if…</option>${list.map((w) => `<option value="${esc(w.id)}">${esc(w.name)}${w.armed ? " · armed" : ""}</option>`).join("")}</select>`;
}

/**
 * The what-if into the team's working scenario, as his clicks: each of its Out men Out, each of its starters Starter (tonight's flips: a one-night what-if writes no standing mark), each of its edits
 * typed. One Undo step. { ok, why }: not ok, with nothing changed, when one of its men is no longer on the team.
 */
export function loadWhatif(c, t, w) {
  const T = c.model?.TEAMS?.[t];
  if (!T) return { ok: false, why: `${t} is not on this console` };
  const gone = [...w.outs, ...(w.starts ?? [])].filter((id) => !T.byId[id]);
  if (gone.length) return { ok: false, why: `${w.name} names ${gone.length === 1 ? "a man" : `${gone.length} men`} no longer on ${t}, so it was not loaded` };
  const base = histMark(c), S = () => c.model.ST[t];
  for (const id of w.outs) if (!S().outs.includes(id)) setRole(c, t, id, "out");
  for (const id of w.starts ?? []) if (calc(T, S(), S().outs).rows.find((r) => r.id === id)?.role !== "starter") setRole(c, t, id, "starter", { perNight: true });
  const cleared = clearInUse(c, t, w);
  let typed = 0;
  for (const k of ["m", "u", "d"]) for (const [id, v] of Object.entries(w.edits?.[k] ?? {})) if (setPin(c, t, id, k, v)) typed++;
  foldHistory(c, base);
  return { ok: true, typed, cleared };
}

/**
 * Round 2, finding 2: loading another what-if than the one in use, the in-use one's numbers still standing as it wrote them on the scenario on show come off first (in the same Undo step), so the
 * two are never mixed. Nothing when the one loaded is the one in use or none is in use. Returns { name, count } or null.
 */
function clearInUse(c, t, w) {
  const used = c.model.ST[t].whatif_used;
  if (!used || used.id === w.id) return null;
  let count = 0;
  for (const k of ["m", "u", "d"]) for (const [id, v] of Object.entries(used.pins?.[k] ?? {})) {
    const S = c.model.ST[t], here = S.pins?.[keyOf(S.outs)]?.[k] ?? {};
    if (here[id] === v && clearPin(c, t, id, k)) count++;
  }
  return { name: used.name, count };
}

/** The picker's change: the chosen what-if loaded, said beside it. */
export function loadPicked(c, sel) {
  const t = sel.dataset.wload, w = (c.whatifs?.teams?.[t]?.whatifs ?? []).find((x) => x.id === sel.value);
  sel.value = "";
  if (!w || !c.model) return;
  const r = loadWhatif(c, t, w);
  const off = r.cleared?.count ? ` ${r.cleared.name}'s numbers came off (${r.cleared.count}).` : "";
  c.toast(r.ok ? `Loaded ${w.name} into ${t}'s scenario (${r.typed} number${r.typed === 1 ? "" : "s"}).${off} Undo takes it back.` : r.why, r.ok ? undefined : "err");
}
