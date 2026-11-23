// The Scenario tab's numbers (Adam 4:51-5:15 PM ET 11-19: "what if X doesn't play", Min, Usage and DK/min editable before Save and Arm; his yes 12:42 PM 11-20).
// Pure ES module, no clock, no disk: the page and the server's arm step (server/slate/whatif-arm.js) run it. It is the Console's own engine, never a second one: index 0 is
// console-model.js calc on the team as the board holds it (buildTeam on his saved work and Apply keys, as the server's resend builds it), index 1 is the same calc with the
// what-if men added to the Outs and his typed edits as Console pins (m minutes, u usage, d DK/min), so a usage edit moves DK/min by the Console's usage scaling (console-engine.js rateAt).
// Never TwoGun's figures or Out list (Adam 11-19). A missing figure stays null and is counted, never stood in for (R1, G62).
import { keyOf, emptyPins, LOW_MINUTES } from "./console-engine.js";
import { buildTeam, calc, chipName, hasPins } from "./console-model.js";
import { defaultSourceOf } from "./depth-chart.js";
import { isNum, valuePer1k } from "./figures.js";
import { PIN_MAX } from "./override-limits.js";

/** The kinds he may type on a what-if: minutes, usage and DK/min (Adam 5:15 PM 11-19). */
export const EDIT_KINDS = ["m", "u", "d"];
/** How many men one what-if may sit. A working limit, not ruled on by Adam. */
export const MAX_SITTERS = 5;
/** A move smaller than this reads as no move (the tab shows tenths). */
export const MOVE_FLOOR = 0.05;

export const emptyEdits = () => ({ m: {}, u: {}, d: {} });

/** Whether the team is held on the board (an Apply key, or a news entry applied): then the board is his saved work's scenario (resend.js sendHeld); else our engine on Tonight. Pure. */
export function teamHeld(scen, code) {
  const rec = scen?.teams?.[code];
  return Object.hasOwn(scen?.applied?.keys ?? {}, code) || Object.values(rec?.news ?? {}).some((e) => e?.state === "applied");
}

/**
 * The team as the board holds it: { T, S } from console-model.js buildTeam, as the server's resend builds it for a held team; a team not held is our engine on Tonight with no pins of his
 * (the board shows the engine's own figures there). scen: { teams, applied } as the console route answers it. Null when the slate has no such team. Pure.
 */
export function boardTeam(inputs, scen, code) {
  const input = inputs?.teams?.[code];
  if (!input) return null;
  const held = teamHeld(scen, code);
  return buildTeam(input, held ? scen.teams?.[code] ?? null : null, held ? scen.applied?.keys?.[code] : undefined, defaultSourceOf(inputs));
}

/** His edits laid on a scenario's pins as Console pins: every other pin (the news's role flips, his numbers) kept, his edit winning for that man and kind. Pure. */
export function withEdits(pins, edits) {
  const out = { ...emptyPins(), ...structuredClone(pins ?? {}) };
  for (const k of EDIT_KINDS) out[k] = { ...(out[k] ?? {}), ...(edits?.[k] ?? {}) };
  return out;
}

/** A what-if's id: the scenario key of its Out men, and of the men it has starting after a "^" (Adam 1:37 PM 11-20: "Y starts" and "Z starts" are two what-ifs on the same Out). Pure. */
export const whatifId = (outs, starts = []) => (starts.length ? `${keyOf(outs)}^${keyOf(starts)}` : keyOf(outs));

/**
 * The state index 1 is worked on: the board's pins carried to the what-if scenario (a scenario of his own there wins, as the Console's carry does), his edits on top, his minutes stamps with them.
 * The men it has starting (w.starts, Adam 1:37 PM 11-20) are marked Starter as standing marks for this sum only, so the engine builds the five the board's way (role-marks.js fiveWithMarks, the rule
 * the board's markedFive runs): the arm rule uses a what-if only when the confirmed five already has them starting, so this is the board it lands on. Nothing is saved from here. Pure.
 */
export function whatIfState(S, key0, key1, w) {
  const base = key1 !== key0 && hasPins(S.pins?.[key1]) ? S.pins[key1] : S.pins?.[key0];
  const stamps = structuredClone(S.stamps ?? {});
  const typed = w?.stamps?.m ?? {};
  for (const id of Object.keys(w?.edits?.m ?? {})) if (typed[id]) ((stamps.m ??= {})[key1] ??= {})[id] = typed[id]; // typed-aside.js: his number carries when and on what role he typed it
  const starts = (w?.starts ?? []).filter((id) => !key1.split("+").includes(id));
  const marks = starts.length ? { role_marks: { ...(S.role_marks ?? {}), ...Object.fromEntries(starts.map((id) => [id, "starter"])) } } : {};
  return { ...S, pins: { ...S.pins, [key1]: withEdits(base, w?.edits) }, stamps, ...marks };
}

/** A man's usage per minute against Tonight's (console-engine.js rateAt's usage_x, the same sum), or null when a figure is missing or his minutes are too few to read. Pure. */
export function usagePerMinX(p, row) {
  const m0 = p.out ? p.healthy : p.min;
  if (!isNum(row?.usg) || !isNum(row?.min) || row.min < LOW_MINUTES || !isNum(p.usg) || p.usg <= 0 || !isNum(m0) || m0 < LOW_MINUTES) return null;
  return row.usg / row.min / (p.usg / m0);
}

/** The team's usage per minute against Tonight's, weighted by minutes over the men with figures: { x, known, counted }. Pure. */
export function teamUsageX(rows) {
  let w = 0, s = 0, known = 0;
  for (const r of rows) { const x = usagePerMinX(r.p, r); if (x === null) continue; s += x * r.min; w += r.min; known++; }
  return { x: w > 0 ? s / w : null, known };
}

const d = (a, b) => (isNum(a) && isNum(b) ? b - a : null);

/** One table row from index 0 and 1 of a man. Pure. */
function rowOf(p, a, b, sitting, edits) {
  const val = (r) => (r.out ? null : valuePer1k(r.proj, p.salary));
  const v0 = val(a), v1 = sitting ? null : val(b);
  return {
    id: p.id, name: p.name, pos: p.pos ?? null, sal: Number.isInteger(p.salary) ? p.salary : null, sitting,
    min0: a.min, min1: b.min, usg0: a.usg, usg1: sitting ? null : b.usg, rate0: a.rate, rate1: sitting ? null : b.rate, proj0: a.proj, proj1: b.proj, val0: v0, val1: v1,
    dmin: d(a.min, b.min), dusg: sitting ? d(a.usg, 0) : d(a.usg, b.usg), drate: sitting ? null : d(a.rate, b.rate), dproj: d(a.proj, b.proj), dval: sitting ? null : d(v0, v1),
    edited: Object.fromEntries(EDIT_KINDS.map((k) => [k, Object.hasOwn(edits?.[k] ?? {}, p.id)])),
    missing: b.missing ?? [], set_aside: b.min_aside ?? null, role1: b.role ?? null,
  };
}

/**
 * The what-if worked out: { key0, key1, sitters (the men it adds to the board's Outs), already (men asked for who are Out on the board already), gone (ids no longer on the team), rows (every man
 * playing on either side, biggest salary first, the sitters first), hidden (men on 0 minutes both sides, not listed), r0, r1 (the engine's answers), summary }. bt: boardTeam's { T, S }. Pure.
 */
export function runWhatIf(bt, wantOut, w = { edits: emptyEdits() }) {
  const { T, S } = bt, outs0 = S.outs, key0 = keyOf(outs0);
  const gone = wantOut.filter((id) => !T.byId[id]), already = wantOut.filter((id) => T.byId[id] && outs0.includes(id));
  const sitters = wantOut.filter((id) => T.byId[id] && !outs0.includes(id));
  const outs1 = [...outs0, ...sitters], key1 = keyOf(outs1);
  const r0 = calc(T, S, outs0), r1 = calc(T, whatIfState(S, key0, key1, w), outs1);
  const by1 = new Map(r1.rows.map((r) => [r.id, r]));
  const rows = [];
  let hidden = 0;
  for (const a of r0.rows) {
    if (a.out) continue; // Out on the board already: the what-if changes nothing for him
    const b = by1.get(a.id), sitting = sitters.includes(a.id);
    if (!sitting && !(a.min > 0) && !(b.min > 0) && !EDIT_KINDS.some((k) => Object.hasOwn(w.edits?.[k] ?? {}, a.id))) { hidden++; continue; }
    rows.push(rowOf(a.p, a, b, sitting, w.edits));
  }
  rows.sort((x, y) => Number(y.sitting) - Number(x.sitting) || (y.sal ?? -1) - (x.sal ?? -1) || x.name.localeCompare(y.name));
  // the name carries every man he picked (each is a condition, the money review's finding 4); the numbers move only for the men not Out on the board already
  return { key0, key1, sitters, already, gone, rows, hidden, r0, r1, summary: summaryOf(T, r0, r1, rows, wantOut.filter((id) => T.byId[id]), (w.starts ?? []).filter((id) => T.byId[id] && !outs1.includes(id))) };
}

/** The one-line summary's figures: minutes moved and to how many men, the team's usage per minute before and after, the team's points, the winner and the loser among the men playing. Pure. */
export function summaryOf(T, r0, r1, rows, picked, starts = []) { // picked: every man he picked to sit, for the name
  const playing = rows.filter((r) => !r.sitting);
  const gains = playing.filter((r) => isNum(r.dmin) && r.dmin >= MOVE_FLOOR);
  const projKnown = (rs) => rs.filter((r) => isNum(r.proj)).reduce((s, r) => s + r.proj, 0);
  const missing = r0.rows.filter((r) => !r.out && r.proj === null).length + r1.rows.filter((r) => !r.out && r.proj === null).length;
  const moved = playing.filter((r) => isNum(r.dproj));
  const best = moved.reduce((m, r) => (!m || r.dproj > m.dproj ? r : m), null), worst = moved.reduce((m, r) => (!m || r.dproj < m.dproj ? r : m), null);
  return {
    name: whatIfName(T, picked, starts),
    min_moved: gains.reduce((s, r) => s + r.dmin, 0), to_men: gains.length,
    usage0: teamUsageX(r0.rows.filter((r) => !r.out)).x, usage1: teamUsageX(r1.rows.filter((r) => !r.out)).x,
    team_delta: projKnown(r1.rows) - projKnown(r0.rows), proj_missing: missing,
    winner: best && best.dproj >= MOVE_FLOOR ? { id: best.id, name: chipName(T, T.byId[best.id]), d: best.dproj } : null,
    loser: worst && worst.dproj <= -MOVE_FLOOR ? { id: worst.id, name: chipName(T, T.byId[worst.id]), d: worst.dproj } : null,
  };
}

const andList = (names) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
/** "If Stewart sits", "If Stewart and Jerome sit", "If Stewart sits, Post starts" (Adam 1:37 PM 11-20): the what-if's name, the men by their chip names in the order picked. Pure. */
export function whatIfName(T, ids, starts = []) {
  const nm = (list) => list.map((id) => T.byId[id]).filter(Boolean).map((p) => chipName(T, p));
  const out = nm(ids), st = nm(starts);
  if (!out.length) return "No one sits";
  return `If ${andList(out)} sit${out.length === 1 ? "s" : ""}${st.length ? `, ${andList(st)} start${st.length === 1 ? "s" : ""}` : ""}`;
}

const sgn = (x, dp = 1) => (Math.abs(x) < 0.5 * 10 ** -dp ? (0).toFixed(dp) : `${x > 0 ? "+" : "−"}${Math.abs(x).toFixed(dp)}`);
/** The summary in words, as the mock-up's line: "MEM if Stewart sits: 26 minutes move to 8 men · usage x1.03 → x1.08 · team +1.6 pts · winner Post +11.5 · loser Mashack −0.1". Pure. */
export function summaryText(team, s) {
  const usage = isNum(s.usage0) && isNum(s.usage1) ? `usage x${s.usage0.toFixed(2)} → x${s.usage1.toFixed(2)}` : "usage: no figure";
  const parts = [`${Math.round(s.min_moved)} minutes move to ${s.to_men} m${s.to_men === 1 ? "an" : "en"}`, usage, `team ${sgn(s.team_delta)} pts`];
  if (s.winner) parts.push(`winner ${s.winner.name} ${sgn(s.winner.d)}`);
  if (s.loser) parts.push(`loser ${s.loser.name} ${sgn(s.loser.d)}`);
  return { lead: `${team} ${s.name.replace(/^If /, "if ")}:`, rest: parts.join(" · ") };
}

/** The ripple view's rows: only the men whose minutes, usage or projection move, the biggest projection change first. Pure. */
export function rippleRows(rows) {
  const moves = (r) => [r.dmin, r.dusg, r.dproj].some((x) => isNum(x) && Math.abs(x) >= MOVE_FLOOR) || r.sitting;
  return rows.filter(moves).sort((a, b) => Math.abs(b.dproj ?? 0) - Math.abs(a.dproj ?? 0) || a.name.localeCompare(b.name));
}

/**
 * One typed edit into a what-if's edits: { ok, edits, stamps } or { ok: false, why }. Blank text takes the edit off. A number is checked against the Console's pin limits (override-limits.js PIN_MAX).
 * A minutes edit carries its stamp { at: nowIso, role } (typed-aside.js: his number is set aside if the man later crosses the starter line). w: { edits, stamps }. Pure.
 */
export function setEdit(w, kind, id, text, { nowIso, role } = {}) {
  if (!EDIT_KINDS.includes(kind)) return { ok: false, why: `${kind} is not an editable figure` };
  const edits = structuredClone(w?.edits ?? emptyEdits()), stamps = structuredClone(w?.stamps ?? { m: {} });
  for (const k of EDIT_KINDS) edits[k] ??= {};
  stamps.m ??= {};
  const raw = String(text ?? "").trim();
  if (raw === "") { delete edits[kind][id]; if (kind === "m") delete stamps.m[id]; return { ok: true, edits, stamps }; }
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0 || v > PIN_MAX[kind]) return { ok: false, why: `${{ m: "Minutes", u: "Usage", d: "DK/min" }[kind]} must be a number from 0 to ${PIN_MAX[kind]}` };
  edits[kind][id] = Math.round(v * 1000) / 1000;
  if (kind === "m") { if (["starter", "bench_plus", "bench", "oor"].includes(role) && typeof nowIso === "string") stamps.m[id] = { at: nowIso, role }; else delete stamps.m[id]; }
  return { ok: true, edits, stamps };
}

/** How many edits a what-if holds. Pure. */
export const editCount = (edits) => EDIT_KINDS.reduce((n, k) => n + Object.keys(edits?.[k] ?? {}).length, 0);
