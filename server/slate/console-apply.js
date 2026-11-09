// Sending each team's on-screen scenario to the one overrides path (typed projections), and taking it back. Pure: the route reads and
// writes the files. A plan is worked out on the server from the saved work and the posted scenario keys, so preview and Apply are the same sums.
import crypto from "../../site/shim/crypto.js";
import { keyOf, outsOf, scenario, teamFor, emptyPins } from "../board/console-engine.js";
import { hasPins, label, tableName } from "../board/console-model.js";
import { effectiveProjection, mergeOverrides } from "./overrides.js";
import { PROJ_MAX } from "../board/override-limits.js";
import { isNum, isPlain, round2, tonightRate } from "../board/figures.js";
import { validKey } from "./scenarios.js";

const MOVE_FLOOR = 0.05; // the console shows tenths
const MIN_FLOOR = 0.0005; // minutes are kept to thousandths, so a team's total survives the rounding

/** Checks the posted { team: scenario key } against the inputs: { ok, keys } with every team filled in (Tonight when not named), or { ok: false, message }. */
export function checkKeys(posted, inputs) {
  if (!isPlain(posted)) return { ok: false, message: '"scenarios" must map each team to its scenario key.' };
  const keys = {};
  for (const [code, t] of Object.entries(inputs.teams)) keys[code] = keyOf(t.tonight);
  for (const [code, key] of Object.entries(posted)) {
    if (!Object.hasOwn(inputs.teams, code)) return { ok: false, message: `${code.slice(0, 8)} is not a team on this slate.` };
    const t = inputs.teams[code];
    if (!validKey(key)) return { ok: false, message: `${code}'s scenario key is not well formed.` };
    const known = new Set(t.men.map((p) => p.id));
    if (!outsOf(key).every((id) => known.has(id))) return { ok: false, message: `${code}'s scenario names a man who is not on the team now.` };
    keys[code] = keyOf(outsOf(key));
  }
  return { ok: true, keys };
}

/** The posted "teams" (the console sends only these, Adam 11-07): null when absent (every team), a Set when well formed, else { message }. */
export function checkTeams(posted, inputs) {
  if (posted === undefined) return { ok: true, only: null };
  if (!Array.isArray(posted) || posted.length > 40 || !posted.every((t) => typeof t === "string" && Object.hasOwn(inputs.teams, t))) return { ok: false, message: '"teams" must list teams on this slate.' };
  return { ok: true, only: new Set(posted) };
}

/** Pins that go nowhere in this send: on a scenario that names or pins a man no longer on the team, or on a key that is neither sent, saved nor Tonight. Never carried forward. */
export function orphanedPins(inputs, file, keys) {
  const out = [];
  for (const [code, rec] of Object.entries(file.teams)) {
    if (!Object.hasOwn(inputs.teams, code)) continue;
    const t = inputs.teams[code];
    const known = new Set(t.men.map((p) => p.id)), tonight = keyOf(t.tonight);
    for (const [key, pins] of Object.entries(rec.pins ?? {})) {
      const ids = Object.values(pins).flatMap((sec) => Object.keys(sec ?? {}));
      if (!ids.length) continue;
      const stale = !outsOf(key).every((id) => known.has(id));
      const gone = ids.filter((id) => !known.has(id)).length;
      const unsent = key !== keys[code] && key !== tonight && key !== "" && !(rec.saved ?? []).includes(key);
      if (stale || unsent) out.push({ team: code, key, count: ids.length });
      else if (gone) out.push({ team: code, key, count: gone });
    }
  }
  return out;
}

const shapedTeam = (t) => ({ ...t, byId: Object.fromEntries(t.men.map((p) => [p.id, p])), pl: t.men, tonightKey: keyOf(t.tonight) });

/** One man's scenario minutes into the plan when the board shows otherwise: 1 if they move, else 0. Back on the slate's own figure removes the entry. Each man goes, however small, so the board holds the scenario's minutes exactly. */
function planMinutes(plan, r, ctx) {
  if (!isNum(r.min)) return 0;
  const to = Math.round(r.min * 1000) / 1000, base = ctx.base.get(r.id).minutes, typed = ctx.overrides.min?.[r.id];
  if (Math.abs(to - (typed ?? base ?? Infinity)) < MIN_FLOOR) return 0;
  if (typed === undefined && !isNum(base) && to === 0) return 0;
  plan.min[r.id] = isNum(base) && Math.abs(to - base) < MIN_FLOOR ? null : to;
  return 1;
}

/** Why a man has no projection in the scenario: the row's own minutes reason first (a flipped man's role figure says why it is missing), then his inputs'. */
function missingWhy(r, man) {
  const min = r.missing.find((m) => m.startsWith("min: "));
  return min ? min.slice(5) : Object.values(man.missing)[0] ?? "no projection";
}

/** One team's moves into the plan. A hand-typed board number with no pin in this scenario, not one an Apply set, stays and is listed as kept. */
function planTeam(plan, t, rec, key, ctx) {
  const pins = rec?.pins?.[key] ?? emptyPins();
  const res = scenario(teamFor(t, rec), outsOf(key), pins);
  const before = plan.changes.length;
  let minMoves = 0;
  for (const r of res.rows) {
    const man = t.men.find((p) => p.id === r.id);
    if (r.clamped) plan.clamped.push({ name: man.name, team: t.code });
    if (r.back_on_zero) plan.back_on_zero.push({ name: man.name, team: t.code });
    if (!r.out && t.tonight.includes(r.id)) plan.back_in.push({ name: man.name, team: t.code }); // the board has him Out and this scenario has him playing: an old applied key, or his choice; either way, named
    if (!man.board || !ctx.board.has(r.id)) {
      if (!r.out && t.tonight.includes(r.id)) plan.not_on_board.push({ name: man.name, team: t.code });
      continue;
    }
    ctx.men.set(r.id, { man, t });
    minMoves += planMinutes(plan, r, ctx);
    if (r.proj === null) {
      const earlier = ctx.applied?.set?.[r.id];
      const held = earlier && ctx.overrides.proj?.[r.id] === earlier.to ? `; his earlier applied projection ${earlier.to} is still on the board` : "";
      plan.missing.push({ name: man.name, team: t.code, why: `${missingWhy(r, man)}${held}` });
      continue;
    }
    const typedNow = ctx.overrides.proj?.[r.id];
    const fromApply = ctx.applied?.set?.[r.id]?.to === typedNow;
    const hasPin = ["m", "u", "d", "p", "r"].some((k) => Object.hasOwn(pins[k] ?? {}, r.id));
    const to = round2(Math.max(0, Math.min(PROJ_MAX, r.proj)));
    const from = ctx.board.get(r.id).projection, baseProj = ctx.base.get(r.id).projection, earlier = ctx.applied?.set?.[r.id];
    if (earlier && fromApply && !hasPin && !r.out && isNum(baseProj) && Math.abs(to - baseProj) < MOVE_FLOOR) {
      // Back on the slate's own figure with no mark of his on him (an undo chip): the typed number comes off and he is on the live figure the chip
      // showed, never an older typed number from before an Apply (Adam, 11-07: one undo-chip rule).
      const back = effectiveProjection(baseProj, null, ctx.overrides.bump?.[r.id] ?? 0);
      plan.typed[r.id] = null;
      plan.restoring.add(r.id);
      plan.changes.push({ id: r.id, name: man.name, short: tableName(shapedTeam(t), man), team: t.code, from: from ?? null, to: back ?? null, move: isNum(from) && isNum(back) ? round2(back - from) : null });
      continue;
    }
    const after = effectiveProjection(baseProj, to, ctx.overrides.bump?.[r.id] ?? 0);
    if (isNum(from) && Math.abs(after - from) < MOVE_FLOOR) { plan.unchanged++; continue; }
    if (typedNow !== undefined && !fromApply && !hasPin && !r.out) { plan.kept.push({ id: r.id, name: man.name, team: t.code, typed: typedNow, would: to }); continue; }
    plan.typed[r.id] = to;
    plan.changes.push({ id: r.id, name: man.name, short: tableName(shapedTeam(t), man), team: t.code, from: from ?? null, to: after, move: isNum(from) ? round2(after - from) : null });
  }
  return { moves: plan.changes.length - before, min_moves: minMoves, totals: res.totals };
}

/** A team he has moved back to Tonight, with no pins: each man an earlier Apply set, whose typed number is still that one, goes back to what he had.
 *  Only a team with an applied key has been moved back: a record with none, written before keys were kept, is left for Reverse. */
function undoTeam(plan, t, ctx) {
  if (!Object.hasOwn(ctx.applied?.keys ?? {}, t.code)) return { moves: 0, min_moves: 0 };
  let moves = 0, minMoves = 0;
  for (const man of t.men) {
    ctx.men.set(man.id, { man, t });
    if (Object.hasOwn(ctx.overrides.min ?? {}, man.id)) { plan.min[man.id] = null; minMoves++; }
    const set = ctx.applied?.set?.[man.id];
    if (!set || ctx.overrides.proj?.[man.id] !== set.to || !ctx.board.has(man.id)) continue;
    const after = effectiveProjection(ctx.base.get(man.id).projection, set.prev, ctx.overrides.bump?.[man.id] ?? 0);
    const from = ctx.board.get(man.id).projection;
    plan.typed[man.id] = set.prev;
    plan.restoring.add(man.id);
    plan.changes.push({ id: man.id, name: man.name, short: tableName(shapedTeam(t), man), team: t.code, from: from ?? null, to: after ?? null, move: isNum(from) && isNum(after) ? round2(after - from) : null });
    moves++;
  }
  return { moves, min_moves: minMoves };
}

/**
 * The preview's rows, one for each man whose projection or minutes the send moves: projection movers first in their order, then men whose minutes
 * alone move, largest first. Each carries minutes and projection as the board holds them now and after. DK/min after is the after projection over the after
 * minutes, the sum the board's DK/m TON does, so the two agree. The board holds no scenario rate, so the "from" rate is Tonight's, even over an earlier Apply. A missing figure stays null.
 */
function changedRows(plan, ctx) {
  const row = (id, change) => {
    const { man, t } = ctx.men.get(id), now = ctx.board.get(id);
    const held = now?.projection ?? null;
    const minFrom = now?.minutes ?? null;
    const minTo = Object.hasOwn(plan.min, id) ? plan.min[id] ?? ctx.base.get(id)?.minutes ?? null : minFrom;
    const projTo = change ? change.to : held;
    return { id, name: man.name, short: tableName(shapedTeam(t), man), team: t.code, min_from: minFrom, min_to: minTo, rate_from: man.out ? null : man.rate ?? null, rate_to: tonightRate(projTo, minTo), proj_from: change ? change.from : held, proj_to: projTo, move: change ? change.move : isNum(held) ? 0 : null };
  };
  const moved = new Set(plan.changes.map((c) => c.id));
  const minBy = (r) => (isNum(r.min_from) && isNum(r.min_to) ? Math.abs(r.min_to - r.min_from) : Infinity);
  const minOnly = Object.keys(plan.min).filter((id) => !moved.has(id)).map((id) => row(id, null)).sort((a, b) => minBy(b) - minBy(a) || a.name.localeCompare(b.name));
  return [...plan.changes.map((c) => row(c.id, c)), ...minOnly];
}

/**
 * What Apply would do for the posted scenarios: { changes: largest move first, rows (changedRows, the preview's table), typed: { id: number, or null for a removal }, min: { id: minutes,
 * or null for a removal }, min_moves (how many), restoring (the men going back to before an earlier Apply), teams: [{ team, key, name, moves,
 * min_moves, min_total }], refused (always empty: no team total refuses Apply, Adam 11-06), kept,
 * missing, clamped, back_on_zero, not_on_board, orphaned_pins, unchanged, basis }. A team on Tonight with no pins or role flips sends nothing but
 * that undoing. min_total is the team's minutes for reference only. `from` and `to` are the effective board figures, so a man's thumbs bump on top
 * of the typed number is counted; each sent man's bump is in the basis.
 */
export function planApply(inputs, file, overrides, players, keys, only = null) {
  const ctx = {
    overrides, applied: file.applied, men: new Map(),
    board: new Map(mergeOverrides(players, overrides).map((p) => [String(p.dk_id), p])),
    base: new Map(players.map((p) => [String(p.dk_id), p])),
  };
  const plan = { changes: [], typed: {}, min: {}, restoring: new Set(), teams: [], refused: [], kept: [], missing: [], clamped: [], back_on_zero: [], not_on_board: [], back_in: [], unchanged: 0 };
  for (const t of Object.values(inputs.teams)) {
    if (only && !only.has(t.code)) continue; // a team not asked for is not planned, sent or undone (the console sends only the teams he changed)
    const rec = Object.hasOwn(file.teams, t.code) ? file.teams[t.code] : null, key = keys[t.code], tonight = keyOf(t.tonight);
    const name = label(shapedTeam(t), key);
    if (key === tonight && !hasPins(rec?.pins?.[key])) {
      const { moves, min_moves } = undoTeam(plan, t, ctx);
      if (moves || min_moves) plan.teams.push({ team: t.code, key, tonight, name, moves, min_moves, min_total: null, undone: true });
      continue;
    }
    const { moves, min_moves, totals } = planTeam(plan, t, rec, key, ctx);
    plan.teams.push({ team: t.code, key, tonight, name, moves, min_moves, min_total: totals.min });
  }
  plan.min_moves = Object.keys(plan.min).length;
  plan.changes.sort((a, b) => Math.abs(b.move ?? Infinity) - Math.abs(a.move ?? Infinity) || a.name.localeCompare(b.name));
  plan.rows = changedRows(plan, ctx);
  plan.orphaned_pins = orphanedPins(inputs, file, keys).filter((o) => !only || only.has(o.team));
  const sent = Object.entries(plan.typed).sort().map(([id, to]) => [id, to, overrides.bump?.[id] ?? 0]);
  plan.basis = crypto.createHash("sha256").update(JSON.stringify({ sent, min: Object.entries(plan.min).sort(), keys: Object.entries(keys).sort(), orphans: plan.orphaned_pins, refused: plan.refused })).digest("hex").slice(0, 16);
  plan.pull = inputs.basis?.pull ?? null;
  plan.base = baseOf(plan, ctx);
  return plan;
}

/** What TwoGun had under each man this Apply sends a number for: { id: { min, out } }, his minutes and out flag in the pull the console read.
 *  The pull check (minute-misses.js) compares a newer pull against this. A man only going back to what he had is left out. */
function baseOf(plan, ctx) {
  const base = {};
  for (const id of new Set([...Object.keys(plan.typed), ...Object.keys(plan.min)])) {
    const sends = (Object.hasOwn(plan.typed, id) && !plan.restoring.has(id)) || (Object.hasOwn(plan.min, id) && plan.min[id] !== null);
    const man = ctx.men.get(id)?.man;
    if (sends && man) base[id] = { min: man.out ? 0 : isNum(man.min) ? man.min : null, out: Boolean(man.out) };
  }
  return base;
}

/** The overrides change an Apply makes and the applied record that goes with it. A man an earlier Apply set whose typed number is still that one keeps his first `prev`. */
export function applyRecord(plan, overrides, applied, atIso) {
  const set = { ...(applied?.set ?? {}) };
  const proj = {};
  for (const [id, to] of Object.entries(plan.typed)) {
    proj[id] = to;
    if (plan.restoring?.has(id)) { delete set[id]; continue; } // he is back to what he had: nothing of Apply's left on him
    const now = overrides.proj?.[id] ?? null;
    set[id] = { to, prev: set[id] && set[id].to === now ? set[id].prev : now };
  }
  // Per team, the scenario on the board and the Tonight it was made on ({ key, tonight }; an older record holds the key alone): a reload opens there,
  // rebased from that Tonight onto the current one, and only moving off it undoes it.
  const keys = { ...(applied?.keys ?? {}) };
  for (const t of plan.teams) {
    if (t.undone) delete keys[t.team];
    else if (t.moves > 0 || t.min_moves > 0 || Object.hasOwn(keys, t.team)) keys[t.team] = { key: t.key, tonight: t.tonight };
  }
  const minLeft = Object.keys({ ...(overrides.min ?? {}), ...plan.min }).some((id) => (Object.hasOwn(plan.min, id) ? plan.min[id] !== null : true));
  // What TwoGun had under each applied man, kept until his numbers come off: a man this Apply touched takes this pull's figure, or none when he went back.
  const base = { ...(applied?.base ?? {}) };
  for (const id of new Set([...Object.keys(plan.typed), ...Object.keys(plan.min)])) {
    if (Object.hasOwn(plan.base ?? {}, id)) base[id] = plan.base[id];
    else delete base[id];
  }
  const out = Object.keys(set).length || minLeft ? { at: atIso, set, keys, base, pull: plan.pull ?? null } : null;
  return { changes: { proj, min: plan.min }, applied: out };
}

/** The overrides change a reverse makes: only men whose typed number is still what Apply set; anyone he has typed over since is left and named. Every applied minutes figure comes off, since only an Apply sets them. */
export function reverseChanges(applied, overrides, players) {
  const proj = {}, kept = [];
  const names = new Map(players.map((p) => [String(p.dk_id), p.name]));
  for (const [id, { to, prev }] of Object.entries(applied?.set ?? {})) {
    if (overrides.proj?.[id] === to) proj[id] = prev;
    else if (names.has(id)) kept.push(names.get(id));
  }
  const min = Object.fromEntries(Object.keys(overrides.min ?? {}).map((id) => [id, null]));
  return { changes: { proj, min }, restored: Object.keys(proj).length, restored_min: Object.keys(min).length, kept };
}
