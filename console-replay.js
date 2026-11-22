// 11-13 audit, state 1 (the lead 11-21: never a refusal box): a save the server refused because the team's record was written since this page read it (the lineup news, a resend, a what-if,
// another page) is replayed: his moves since the record he last saw are laid on the newer record and saved again, silently, up to REPLAY_ROUNDS rounds. A move that no longer applies
// (the man is off the team, Out now, a sixth starter) or a man changed both here and there is said in one line at the team's foot; no move is dropped without a word.
// The three records are first rebased onto this Tonight (buildTeam), so their scenario keys compare. Pure; runs in the browser too (tests/console_replay.test.mjs).
import { buildTeam, recordOf } from "./console-model.js";
import { keyOf, outsOf } from "./console-engine.js";
import { STARTERS } from "./console-roles.js";

/** How many save-and-replay rounds a refused save makes before it waits for his next change, said at the foot. */
export const REPLAY_ROUNDS = 3;
const SEP = "\u0001";
const NUM_KINDS = { m: "minutes", u: "usage", d: "DK/min", p: "projection" };

/** A record as leaves: path (parts joined by SEP) -> the value's JSON. Lists (saved, mine.out, mine.in) are sets, one leaf per member. Pure. */
export function leaves(rec) {
  const out = new Map(), put = (parts, v) => out.set(parts.join(SEP), JSON.stringify(v));
  for (const k of rec?.saved ?? []) put(["saved", k], true);
  for (const sec of ["pins", "handouts", "combos"]) for (const [key, p] of Object.entries(rec?.[sec] ?? {})) for (const [kind, byId] of Object.entries(p ?? {})) for (const [id, v] of Object.entries(byId ?? {})) put([sec, key, kind, id], v);
  for (const side of ["out", "in"]) for (const id of rec?.mine?.[side] ?? []) put(["mine", side, id], true);
  for (const [k, e] of Object.entries(rec?.news ?? {})) put(["news", k], e);
  for (const [kind, byKey] of Object.entries(rec?.stamps ?? {})) for (const [key, byId] of Object.entries(byKey ?? {})) for (const [id, v] of Object.entries(byId ?? {})) put(["stamps", kind, key, id], v);
  for (const f of ["source", "whatif_used", "on", "tonight"]) if (rec?.[f] !== undefined && rec[f] !== null) put([f], rec[f]);
  return out;
}

/** The record the leaves describe (leaves' inverse). Pure. */
export function fromLeaves(map) {
  const rec = { saved: [], pins: {}, handouts: {}, combos: {} };
  for (const [path, text] of map) {
    const k = path.split(SEP), v = JSON.parse(text);
    if (k[0] === "saved") rec.saved.push(k[1]);
    else if (k[0] === "pins" || k[0] === "handouts" || k[0] === "combos") ((rec[k[0]][k[1]] ??= {})[k[2]] ??= {})[k[3]] = v;
    else if (k[0] === "mine") (rec.mine ??= { out: [], in: [] })[k[1]].push(k[2]);
    else if (k[0] === "news") (rec.news ??= {})[k[1]] = v;
    else if (k[0] === "stamps") (((rec.stamps ??= {})[k[1]] ??= {})[k[2]] ??= {})[k[3]] = v;
    else rec[k[0]] = v;
  }
  return rec;
}

/**
 * His moves (base -> mine) laid on theirs: { record, moves: [path], clashes: [path] (a leaf theirs also changed, to something else: his stands) }. A man his move puts back in leaves the
 * out list, and the other way round, so the two lists never both hold him. theirsWins: a leaf theirs changed stays theirs (an older undo step of his, replayHistory: an undo never takes back newer work). Pure.
 */
export function mergeRecords(base, mine, theirs, tonightKey = "", { theirsWins = false } = {}) {
  const B = leaves(base), Mi = leaves(mine), Th = leaves(theirs), out = new Map(Th), moves = [], clashes = [];
  // The scenario on show: his Outs and back-ins since `base` laid on theirs' (a news Out that moved theirs off his scenario keeps both). A record with no `on` is on Tonight (round 2, item 7).
  const onOf = (r) => r?.on ?? r?.tonight ?? tonightKey, bOn = onOf(base), mOn = onOf(mine), tOn = onOf(theirs), finalOn = onDelta(bOn, mOn, tOn);
  const onShow = mOn !== bOn || finalOn !== mOn; // his scenario moved (his Out, or the news's): its pins and stamps are laid by hand below
  /** The scenario a pins or stamps leaf sits on, else null. Handouts (keyed by the sitter) and combos (measured for exactly their set of Outs) are never re-keyed (round 2, items 1 and 2). */
  const keyAt = (k) => (k[0] === "pins" ? 1 : k[0] === "stamps" ? 2 : -1);
  const lay = (p, b, m, t) => { if (theirsWins && t !== b && t !== m) return; moves.push(p); if (t !== b && t !== m) clashes.push(p); if (m === undefined) out.delete(p); else out.set(p, m); };
  for (const p of new Set([...B.keys(), ...Mi.keys()])) {
    if (p === "on") continue;
    const k = p.split(SEP), b = B.get(p), m = Mi.get(p);
    if (b === m) continue;
    if (k[0] === "news" && Th.get(p) !== b) continue; // round 2, item 6: an entry the server changed too stays the server's; otherwise his change (an undo, a revert) goes through
    if (onShow && keyAt(k) >= 0 && k[keyAt(k)] === mOn) { if (finalOn !== mOn) { if (m === undefined) out.delete(p); else out.set(p, m); } continue; } // round 2, item 3: kept where he made it too; laid on the scenario on show below
    lay(p, b, m, Th.get(p));
  }
  if (onShow) layOnShow({ B, Mi, Th, out, bOn, mOn, tOn, finalOn, lay });
  if (finalOn !== tOn) { out.set("on", JSON.stringify(finalOn)); if (mOn !== bOn && tOn !== bOn) clashes.push("on"); }
  for (const p of moves) {
    const [sec, side, id] = p.split(SEP);
    if (sec === "mine" && Mi.has(p)) out.delete(["mine", side === "in" ? "out" : "in", id].join(SEP));
  }
  return { record: fromLeaves(out), moves, clashes, on: finalOn };
}

const MARK = "\u0000"; // stands for the scenario key in a leaf taken off its scenario
/** A map's pins and stamps leaves on scenario `key`, the key replaced by MARK. Pure. */
function leavesOn(map, key) {
  const o = new Map();
  for (const [p, v] of map) { const k = p.split(SEP), at = k[0] === "pins" ? 1 : k[0] === "stamps" ? 2 : -1; if (at >= 0 && k[at] === key) { k[at] = MARK; o.set(k.join(SEP), v); } }
  return o;
}
const onto = (rel, key) => rel.split(SEP).map((x) => (x === MARK ? key : x)).join(SEP);
/**
 * Round 2, item 4: his edits on the scenario he was on (mine at mOn against base at bOn, so the pins his own Out carried across are not taken for edits) laid on the scenario on show. That
 * one starts from theirs there, or, when theirs holds nothing there yet, from theirs on its own scenario (as the console's carry does), so the news's flips survive. Changes `out`. Pure.
 */
function layOnShow({ B, Mi, Th, out, bOn, mOn, tOn, finalOn, lay }) {
  const there = leavesOn(Th, finalOn), seed = there.size ? there : leavesOn(Th, tOn);
  if (!there.size && finalOn !== tOn) for (const [rel, v] of seed) out.set(onto(rel, finalOn), v);
  const b0 = leavesOn(B, bOn), m0 = leavesOn(Mi, mOn);
  for (const rel of new Set([...b0.keys(), ...m0.keys()])) { const b = b0.get(rel), m = m0.get(rel); if (b !== m) lay(onto(rel, finalOn), b, m, seed.get(rel)); }
}

/** The scenario key with his change of Outs (bOn -> mOn) laid on theirs (tOn). Pure. */
function onDelta(bOn, mOn, tOn) {
  const b = new Set(outsOf(bOn)), m = new Set(outsOf(mOn)), next = new Set(outsOf(tOn));
  for (const id of m) if (!b.has(id)) next.add(id);
  for (const id of b) if (!m.has(id)) next.delete(id);
  return keyOf(next);
}

/** After a replay or a take, every undo step holds `S` for that team (review of 11-21, finding 2): Ctrl+Z then cannot take back a news Out or another page's numbers. G: the console's
 *  history ({ hist: [{ label, s }] }, console-moves.js snap). Changes G in place. */
export function rebaseHistory(G, code, S) {
  const team = JSON.parse(JSON.stringify({ ...S, news: undefined })); // as snap keeps a team: the news record is not part of history
  for (const h of G?.hist ?? []) {
    const o = JSON.parse(h.s);
    if (!o.ST || !Object.hasOwn(o.ST, code)) continue;
    o.ST[code] = team;
    h.s = JSON.stringify(o);
  }
}

/** The parts of his work on a team kept beside the record (their own saves, console.js replayOnto): each undo step keeps its own. */
export const BESIDE = ["depth_moves", "role_marks", "role_picks", "mark_at", "pick_at"];
/**
 * After a replay (the review of 11-21's side list: undo after a replay keeps his own older steps): each undo step of his on team `code` is his own work at that step laid on the newer record `theirs` as the
 * replay lays his current work (replayTeam from `seen`), so Ctrl+Z still walks back through his steps in order; where the newer record changed a thing it stands in every older step (theirsWins), so an undo
 * never takes back a news Out or another page's numbers. The step on show (G.hi) becomes `current`, the replay's own team. news: his news record now (history never holds it, console-moves.js snap), so no
 * step reads as a change to the news. Each step keeps its own chart moves, role marks and picks. Changes G in place.
 */
export function replayHistory(G, code, { input, seen, theirs, applied, dflt, current, news }) {
  for (const [i, h] of (G?.hist ?? []).entries()) {
    const o = JSON.parse(h.s);
    if (!o.ST || !Object.hasOwn(o.ST, code)) continue;
    const st = o.ST[code];
    let S = current;
    if (i !== G.hi) {
      S = replayTeam(input, { seen, mine: { ...recordOf(st), ...(news ? { news } : {}) }, theirs, applied, dflt, theirsWins: true }).S;
      for (const k of BESIDE) if (st[k] !== undefined) S[k] = st[k];
    }
    o.ST[code] = JSON.parse(JSON.stringify({ ...S, news: undefined })); // as snap keeps a team: the news record is not part of history
    h.s = JSON.stringify(o);
  }
}

/** The man a path names (its id part), or null. */
const idOf = (p) => { const k = p.split(SEP); return k[0] === "mine" ? k[2] : ["pins", "handouts", "combos", "stamps"].includes(k[0]) ? k[3] : null; };

/** His starter flips beyond the five on a scenario: taken off (said), his oldest first by their stamps (rec.stamps.r; one with no stamp counts as oldest), so his newest call stands (the lead's
 *  call on Adam's rule, round 2, item 9). Changes `rec`; the names taken off. */
function trimStarters(rec, moves, nameOf) {
  const off = [];
  for (const [key, p] of Object.entries(rec.pins)) {
    const outs = new Set(outsOf(key)), starters = Object.entries(p.r ?? {}).filter(([id, r]) => r === "starter" && !outs.has(id)).map(([id]) => id), at = (id) => rec.stamps?.r?.[key]?.[id] ?? "";
    const his = moves.filter((m) => m.startsWith(["pins", key, "r", ""].join(SEP))).map(idOf).filter((id) => starters.includes(id)).sort((a, b) => (at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : 0));
    while (starters.length > STARTERS && his.length) { const id = his.shift(); delete p.r[id]; starters.splice(starters.indexOf(id), 1); off.push(nameOf(id)); }
  }
  return off;
}

/**
 * One team's work after a refused save: his moves since `seen` (the record text he last saw, console-model.js canonRecord) laid on `theirs` (the disk's record now), all three rebased onto
 * `input`'s Tonight first. { T, S, moved (he had moves to lay on), notes: [one line] or [] }. dflt: the minutes source default (buildTeam). Pure.
 */
export function replayTeam(input, { seen, mine, theirs, applied, dflt, theirsWins = false }) { // theirsWins: mergeRecords's
  const on = (rec) => recordOf(buildTeam(input, rec, applied, dflt).S);
  const base = JSON.parse(seen), m = mergeRecords(on(base), on(mine), on(theirs), keyOf(input.tonight ?? []), { theirsWins });
  const { T } = buildTeam(input, theirs, applied, dflt), nameOf = (id) => T.byId[id]?.name ?? `DraftKings id ${id}`;
  const Bl = leaves(base), gone = [...new Set([...leaves(mine)].filter(([p, v]) => Bl.get(p) !== v).map(([p]) => idOf(p)).filter((id) => id && !T.byId[id]))]; // what he set on a man no longer on the team (his removals are moot): a rebase drops it, so it is said (finding 10)
  const off = trimStarters(m.record, m.moves, nameOf);
  const { S } = buildTeam(input, m.record, applied, dflt);
  const shown = keyOf(S.outs), outNow = new Set(S.outs), held = (k) => S.pins[k[1]]?.[k[2]]?.[k[3]] !== undefined; // round 2, item 7: judged on the team as it opens
  const pinMoves = m.moves.map((p) => p.split(SEP)).filter((k) => k[0] === "pins" && T.byId[k[3]]);
  const sitting = [...new Set(pinMoves.filter((k) => k[1] === shown && NUM_KINDS[k[2]] && outNow.has(k[3]) && held(k)).map((k) => k[3]))];
  const offShow = [...new Set(pinMoves.filter((k) => k[1] !== shown && m.record.pins[k[1]]?.[k[2]]?.[k[3]] !== undefined).map((k) => k[3]))]; // kept on a scenario not on show (finding 1); his clears are not said (round 2, item 10)
  const clashed = [...new Set(m.clashes.map(idOf).filter((id) => id && T.byId[id] && !off.includes(nameOf(id))))];
  const other = { source: "your minutes source", whatif_used: "your what-if choice" }, otherClash = m.clashes.filter((p) => other[p]).map((p) => other[p]); // finding 3: a clash on no man is named too
  const parts = [
    ...(gone.length ? [`your change on ${gone.map((id) => `DraftKings id ${id}`).join(", ")} was not kept: no longer on the team`] : []),
    ...(sitting.length ? [`your numbers on ${sitting.map(nameOf).join(", ")} are kept, but he is Out now, so they count only if he plays`] : []),
    ...(offShow.length ? [`your change on ${offShow.map(nameOf).join(", ")} is kept on a scenario not on show`] : []),
    ...(off.length ? [`your start for ${off.join(", ")} was not kept: five men already start there`] : []),
    ...(clashed.length ? [`your call on ${clashed.map(nameOf).join(", ")} stands over a newer one from the lineup news or another page`] : []),
    ...(otherClash.length ? [`${otherClash.join(" and ")} stands over a newer one from the lineup news or another page`] : []),
    ...(m.clashes.includes("on") ? ["the scenario on show holds both your Outs and the newer ones"] : []),
  ];
  return { T, S, moved: m.moves.length > 0, notes: parts.length ? [`${input.code ?? T.code}: ${parts.join("; ")}.`] : [] };
}
