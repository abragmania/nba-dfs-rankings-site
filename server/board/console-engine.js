// The scenario console's model. Pure ES module, no clock, no disk: the page and the server (console-apply.js) run the same arithmetic,
// so what the page shows is what Apply sends. A missing input stays null on the man and is named in `missing`; it is never stood in for.
//
// Tonight is TwoGun's board, exactly. For any other scenario S, minutes are Tonight + M(S) - M(Tonight), floored at 0. M is worked from
// scratch: every man playing starts at his usual minutes, then each sitter in team order gives his usual minutes by his shares, rescaled
// to the men playing who are still under their ceiling; what goes over a ceiling goes back in his pool and is shared again, up to 8 passes.
// S empty starts from min_healthy exactly on the row basis.
// Where TwoGun's minutes are in use, Tonight is TwoGun's own (tgTonightOf): a man our feeds have Out whom TwoGun still plays is in the base on his TwoGun minutes and, sitting, hands out exactly
// those minutes (his TwoGun figure is his usual figure and his pool in both runs of M; the money review of 11-20, round 2, item 3). Minutes nobody can take are named on the team foot.
//
// His minutes are king (Adam, 11-06): there is no team total to reach. A man with minutes typed (pins.m) has them, any number from 0 to 48,
// never rescaled. A man flipped to a role (pins.r, console-roles.js) has that role's figure (man.role_min, from the inputs), Out of rotation 0.
// Neither receives a sitter's hand-out, and what either gives up is handed to nobody. Every other man has the rule above, worked with the
// typed and flipped men left out of the hand-outs; a team on Tonight with nothing typed or flipped is the board to the digit. The team's total
// is shown for reference only.
//
// A team: { men: [{ id, name, pos ("PG/SG"), order (his place in TwoGun's row), min (Tonight's minutes), healthy (his usual minutes), cap, usg
//   (his share of the team's usage Tonight, or for a man out, what he comes back with), rate (Tonight's DK points per minute), recipe, out }],
//   tonight: [ids out], healthy_exact, tables: { sitter: { id: weight } } (TwoGun's if_he_sits),
//   handouts: { sitter: { m: { id: percent }, u: { id: percent } } } (his edits), combos: { "a+b": { m: { id: gain }, u: { id: gain } } } }.
// Pins: { m: minutes, u: usage, d: rate, p: projection }, each { id: value }, and r: { id: role } (his role flips). A pin always wins, the ceiling included.
import { isNum } from "./figures.js";
import { FLIP_ROLES, liveFlips, resolveRoles } from "./console-roles.js";
import { oursUse, rolesFromEngine, fiveIsSet, chartUse, oursFor, sourceOf, injuredPlayNote, chartUsualNote } from "./console-ours.js";
import { MINUTE_SOURCES, SOURCE_LABEL, defaultSourceOf, settleTyped } from "./depth-chart.js";
import { newsFlips } from "./role-marks.js";
import { typedVerdicts as judgeTyped, unstampedNote, heldNote } from "./typed-aside.js";
import { changeOn, withStanding } from "./console-tier.js";

export const TEAM_USAGE = 100;
/** A usage total this close to 100 is on it; further off is named on the page. A working tolerance. */
export const TOTAL_ROUNDING = 0.1;
/** The most minutes the model hands a man with no cap of his own, unless his usual or Tonight's figure is above it. A pin may go past it. */
export const DEFAULT_CAP = 40;
/** How far a man's points per minute follow his per-minute usage when he has no scoring share (Adam 11-19: his scoring share, man.scoring_share, else this, named on his detail by scoring_why). */
export const RATE_USAGE_SHARE = 0.15;
/** The share of the proportional usage change his rate follows: his scoring share, else RATE_USAGE_SHARE. */
export const usageShareOf = (man) => (isNum(man.scoring_share) ? man.scoring_share : RATE_USAGE_SHARE);
/** The rate's multiplier stays inside this range; a man who reaches an end has it named. */
export const RATE_MULTIPLIER = { min: 0.7, max: 1.3 };
/** A man under this many minutes, Tonight or in the scenario, keeps his rate: his per-minute usage is too thin to read. */
export const LOW_MINUTES = 5;
/** The stated order a sitter's hand-out is looked for in; the first source with an answer wins. */
export const HANDOUT_ORDER = ["saved", "recipe", "twogun_table", "closeness"];
/** How many times one sitter's minutes over the ceilings are shared again. */
export const HANDOUT_PASSES = 8;

const EPS = 1e-9;
const POS_GROUP = { PG: "g", SG: "g", G: "g", SF: "w", F: "w", PF: "b", C: "b" };
const own = (o, k) => o != null && Object.hasOwn(o, k);

export const keyOf = (ids) => [...ids].sort().join("+");
export const outsOf = (key) => (key ? key.split("+") : []);
export const emptyPins = () => ({ m: {}, u: {}, d: {}, p: {}, r: {} });

/** The engine's team from the inputs route's team and his saved record for it (its lineup news entries ride along: role-marks.js newsFlips reads them, Adam 9:30 AM 11-20). */
export const teamFor = (input, record) => ({ news: record?.news && typeof record.news === "object" && !Array.isArray(record.news) ? record.news : null, stamps: record?.stamps && typeof record.stamps === "object" && !Array.isArray(record.stamps) ? record.stamps : null, men: input.men, tonight: input.tonight ?? [], healthy_exact: Boolean(input.healthy_exact), tables: input.tables ?? {}, handouts: record?.handouts ?? {}, combos: record?.combos ?? {}, tier: input.tier, depth: input.depth ?? null, depth_moves: Array.isArray(record?.depth_moves) ? record.depth_moves : null, role_marks: record?.role_marks && typeof record.role_marks === "object" && !Array.isArray(record.role_marks) ? record.role_marks : null, mark_at: record?.mark_at ?? null, source_default: defaultSourceOf(input), source_set: record?.sourceSet ?? MINUTE_SOURCES.includes(record?.source), source: MINUTE_SOURCES.includes(record?.source) ? record.source : defaultSourceOf(input) });

const positions = (man) => (typeof man.pos === "string" ? man.pos.split("/").filter(Boolean) : []);

/** Position closeness of two men: 3 when they share a position, 2 when they share a group (guard, wing, big), else 1. */
export function closeness(a, b) {
  const pa = positions(a), pb = positions(b);
  if (pa.some((p) => pb.includes(p))) return 3;
  const groups = new Set(pa.map((p) => POS_GROUP[p]).filter(Boolean));
  return pb.some((p) => groups.has(POS_GROUP[p])) ? 2 : 1;
}

const hasWeight = (w) => w != null && Object.values(w).some((v) => v > 0);
/** A man's usual minutes: min_healthy where the pull has it, else Tonight's. */
const usualOf = (p) => (isNum(p.healthy) ? p.healthy : isNum(p.min) ? p.min : null);
const figureOf = (p, kind) => (kind === "m" ? usualOf(p) : p.usg);
/** His ceiling: the higher of his row cap (else the default), his usual minutes and Tonight's. */
export const ceilingOf = (p) => Math.max(isNum(p.cap) ? p.cap : DEFAULT_CAP, isNum(p.healthy) ? p.healthy : 0, isNum(p.min) ? p.min : 0);

// One function per source below his saved edits. Each answers { id: weight } for a sitter, or null when it has nothing.
const LOWER_SOURCES = {
  // The board row's own answer to where a man's minutes go when he sits. It speaks of minutes, so usage goes on down the order.
  recipe: (team, sitter, kind) => (kind === "m" ? team.men.find((x) => x.id === sitter)?.recipe ?? null : null),
  // TwoGun's saved table holds minutes only too.
  twogun_table: (team, sitter, kind) => (kind === "m" ? team.tables?.[sitter] ?? null : null),
  // Closeness times the square root of minutes for minutes, and closeness times usage for usage.
  closeness: (team, sitter, kind) => {
    const s = team.men.find((x) => x.id === sitter);
    if (!s) return null;
    const out = {};
    for (const j of team.men) {
      if (j.id === sitter) continue;
      const v = figureOf(j, kind);
      if (isNum(v)) out[j.id] = closeness(j, s) * (kind === "m" ? Math.sqrt(v) : v);
    }
    return out;
  },
};

/**
 * Who gets a sitter's minutes (kind "m") or usage (kind "u"): { weights: { id: weight }, source, rest_from }. The one place the order
 * is applied (HANDOUT_ORDER). A source counts only if it names a man playing (`playing`: a Set of ids, or all men), so a recipe naming only
 * men who are out falls to the next. His saved percents, a 0 among them, are held as written, and the men he did not name share what is
 * left in the next source's proportions; saved percents over 100 are scaled down to 100.
 */
export function handoutShares(team, sitter, kind, playing = null) {
  let base = null, from = null;
  for (const name of HANDOUT_ORDER) {
    if (name === "saved") continue;
    const w = LOWER_SOURCES[name](team, sitter, kind);
    const named = w && playing ? Object.fromEntries(Object.entries(w).filter(([id]) => playing.has(id))) : w;
    if (hasWeight(named)) { base = w; from = name; break; }
  }
  const saved = team.handouts?.[sitter]?.[kind];
  if (!saved || !Object.keys(saved).length) return { weights: base ?? {}, source: from, rest_from: null };
  const fixed = Object.values(saved).reduce((s, v) => s + v, 0);
  const weights = {};
  const baseTotal = base ? Object.entries(base).filter(([id]) => !own(saved, id)).reduce((s, [, v]) => s + v, 0) : 0;
  if (base && fixed < 100 && baseTotal > 0) for (const [id, v] of Object.entries(base)) if (!own(saved, id)) weights[id] = (v / baseTotal) * (100 - fixed);
  for (const [id, v] of Object.entries(saved)) weights[id] = v;
  return { weights, source: "saved", rest_from: from };
}

/** A sitter's shares renormalised among the men playing: [[man, fraction]]. With nobody named playing, in proportion to their own figure. */
function sharesAmong(team, sitter, kind, playing, values) {
  const usable = playing.filter((p) => values[p.id] !== null);
  const { weights } = handoutShares(team, sitter, kind, new Set(usable.map((p) => p.id)));
  let w = usable.map((p) => (own(weights, p.id) ? weights[p.id] : 0));
  let total = w.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    w = usable.map((p) => figureOf(p, kind) || 1);
    total = w.reduce((a, b) => a + b, 0);
  }
  return total > 0 ? usable.map((p, i) => [p, w[i] / total]) : [];
}

/** M(S): every man playing on his usual minutes, then each sitter's usual minutes handed out in team order to the men playing and not
 *  `closed` (typed or flipped: they take no hand-out). A man with no figure is left out. `figs`: { id: minutes } that stand for a man's usual figure, as start and as pool (round 2, item 3).
 *  The minutes each sitter left that nobody could take ride on the answer as its non-enumerable `left` ({ sitter id: minutes }). */
export function minutesFromScratch(team, outSet, closed = new Set(), figs = {}) {
  const usual = (p) => (own(figs, p.id) ? figs[p.id] : usualOf(p));
  const live = team.men.filter((p) => !outSet.has(p.id));
  const takers = live.filter((p) => !closed.has(p.id));
  const m = {}, lost = {};
  for (const p of live) m[p.id] = usual(p);
  const sitters = team.men.filter((p) => outSet.has(p.id)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const s of sitters) {
    let pool = usual(s) ?? 0;
    const shares = sharesAmong(team, s.id, "m", takers, m);
    for (let pass = 0; pass < HANDOUT_PASSES && pool > 1e-6; pass++) {
      const open = shares.filter(([p, f]) => f > 0 && m[p.id] < ceilingOf(p) - EPS);
      const sum = open.reduce((a, [, f]) => a + f, 0);
      if (sum <= 0) break;
      let left = 0;
      for (const [p, f] of open) {
        const want = m[p.id] + pool * (f / sum), lim = ceilingOf(p);
        if (want > lim) { left += want - lim; m[p.id] = lim; } else m[p.id] = want;
      }
      pool = left;
    }
    if (pool > 1e-6) lost[s.id] = pool;
  }
  Object.defineProperty(m, "left", { value: lost, enumerable: false });
  return m;
}

/** Pins stay as he set them; everyone else shares what is left in proportion to his figure, up to his ceiling, passing on what he cannot take. */
function fitKind(team, outSet, modelled, pins, total, ceiling) {
  const out = {};
  const live = team.men.filter((p) => !outSet.has(p.id));
  let fixed = 0;
  for (const p of live) if (own(pins, p.id)) { out[p.id] = pins[p.id]; fixed += pins[p.id]; }
  const open = live.filter((p) => !own(pins, p.id) && modelled[p.id] !== null);
  for (const p of open) out[p.id] = 0;
  for (const p of live) if (!(p.id in out)) out[p.id] = null;
  for (const p of team.men) if (outSet.has(p.id)) out[p.id] = 0;
  const target = Math.max(0, total - fixed);
  for (let round = 0; round < team.men.length + 2; round++) {
    const left = target - open.reduce((s, p) => s + out[p.id], 0);
    if (left < EPS) break;
    const room = open.filter((p) => out[p.id] < ceiling(p) - EPS);
    if (!room.length) break;
    const weigh = room.reduce((s, p) => s + modelled[p.id], 0);
    for (const p of room) {
      const share = weigh > 0 ? modelled[p.id] / weigh : 1 / room.length;
      out[p.id] = Math.min(ceiling(p), out[p.id] + left * share);
    }
  }
  return out;
}

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const pinsOnPlaying = (team, outSet, pins) => Object.fromEntries(Object.entries(pins ?? {}).filter(([id]) => team.men.some((p) => p.id === id && !outSet.has(id))));

/**
 * The Tonight the TwoGun-minutes arithmetic starts from (the money review of 11-20, round 2, item 1): where TwoGun's minutes are in use (the TwoGun source, or Ours with no engine inputs), only the Tonight men
 * TwoGun itself has at 0 or does not list (no tg_min above 0). A man our feeds have Out whom TwoGun still plays is then handed out like an added sitter, his saved hand-outs included, so his TwoGun minutes
 * do not go to nobody. Where the engine's minutes are in use the Console's Tonight stands (Ours unchanged). A man with no tg_min field (an older fixture) stays in it. Pure.
 */
export function tgTonightOf(team, tonightSet) {
  if (sourceOf(team) !== "twogun" && oursUse(team).ok) return tonightSet;
  return new Set([...tonightSet].filter((id) => !(team.men.find((p) => p.id === id)?.tg_min > 0)));
}

/** The scenario's minutes before typed and flipped men: Tonight exact (TwoGun's own Tonight, tgTonightOf), Healthy exact on the row basis, a saved combination table's gains,
 *  or the rule at the head of this file with `closed` (typed and flipped men) taking no hand-out. */
export const modelledMinutes = (team, outSet, tonightSet0, closed = new Set()) => modelledWork(team, outSet, tonightSet0, closed).fig;

/**
 * modelledMinutes' work: { fig: { id: minutes }, gain: { id: what this scenario's sitters hand him beyond Tonight's } (a man a standing mark moved takes it on top of his role figure, round 2, item 4),
 * lost: { sitter id: minutes nobody could take } (a sitter added beyond Tonight only) }. A feed-Out man TwoGun plays is on his TwoGun minutes in both runs (round 2, item 3).
 */
function modelledWork(team, outSet, tonightSet0, closed) {
  const tonightSet = tgTonightOf(team, tonightSet0);
  const figure = (fn) => Object.fromEntries(team.men.map((p) => [p.id, outSet.has(p.id) ? 0 : fn(p)]));
  const tonight = (p) => (tonightSet.has(p.id) ? 0 : tonightSet0.has(p.id) && isNum(p.tg_min) ? p.tg_min : isNum(p.min) ? p.min : null); // a feed-Out man TwoGun plays: TwoGun's own minutes are his Tonight figure
  const none = (fig) => ({ fig, gain: {}, lost: {} });
  if (sameSet(outSet, tonightSet)) return none(figure(tonight));
  if (outSet.size === 0 && team.healthy_exact) return none(figure((p) => (isNum(p.healthy) ? p.healthy : null)));
  const combo = outSet.size >= 2 ? team.combos?.[keyOf([...outSet])]?.m : null;
  if (combo) return { fig: figure((p) => { const t = tonight(p); return t === null ? null : Math.max(0, t + (own(combo, p.id) ? combo[p.id] : 0)); }), gain: { ...combo }, lost: {} };
  const figs = Object.fromEntries(team.men.filter((p) => tonightSet0.has(p.id) && !tonightSet.has(p.id) && isNum(p.tg_min)).map((p) => [p.id, p.tg_min])); // his TwoGun Tonight figure, start and pool alike
  const now = minutesFromScratch(team, outSet, closed, figs), base = minutesFromScratch(team, tonightSet, new Set([...closed, ...Object.keys(figs)]), figs); // in the base he stays on his TwoGun figure, taking no hand-out, so sitting he hands out exactly it
  const gain = Object.fromEntries(team.men.filter((p) => !outSet.has(p.id)).map((p) => [p.id, (now[p.id] ?? 0) - (base[p.id] ?? 0)]));
  const lost = Object.fromEntries(Object.entries(now.left).filter(([id, v]) => !tonightSet.has(id) && v > 0.05));
  return { fig: figure((p) => { const t = tonight(p); return t === null ? null : Math.min(ceilingOf(p), Math.max(0, t + gain[p.id])); }), gain, lost };
}

/** A flipped man's minutes for his role: { min, basis }. Out of rotation is 0; the others are his figure from the inputs, null with the reason when missing. */
export function roleMinutes(p, role) {
  if (role === "oor") return { min: 0, basis: "out of rotation", median: false };
  const f = p.role_min?.[role];
  return f && (isNum(f.min) || f.min === null) ? { min: f.min, basis: f.basis ?? null, median: f.median === true && isNum(f.min) } : { min: null, basis: "no role figure for him in the inputs", median: false };
}

/**
 * The scenario's minutes: { minutes, basis: { id: why, for a typed or flipped man } }. Typed minutes as typed; a flipped man on his role's
 * figure; everyone else the modelled figure with typed and flipped men taking no hand-out. Nothing is rescaled to any total.
 */
function minutesFor(team, outSet, tonightSet, pins, flips, implicit = {}, consoleIds = null, calls = {}, flipMoved = implicit) { // consoleIds: every Console-typed man, kept or set aside: no Minutes-page number of his is read (console-tier.js pageVerdicts); calls: callsOf's; flipMoved: the men his own flips moved
  const typed = pinsOnPlaying(team, outSet, pins), moved = movedOf(implicit, flips, calls); // his flips, his standing marks on TwoGun, and the men they moved; only his own flips go to the chart as flips
  // the lead's ruling (round 2, item 4): only his typed minutes, his in-scenario flips and the men those flips moved are closed to a sitter's hand-out; a standing-mark call, or a man the marks moved, takes it on top of his role figure
  const shut = [...Object.keys(flips), ...Object.keys(flipMoved).filter((id) => !own(calls, id))];
  const edits = settleTyped(typed, (rest) => modelledMinutes(team, outSet, tonightSet, new Set([...Object.keys(rest), ...shut]))); // a man typed at his own figure is no edit: he takes his hand-out and nobody moves
  const closed = new Set([...Object.keys(edits), ...shut]);
  const work = modelledWork(team, outSet, tonightSet, closed), modelled = work.fig;
  const minutes = {}, basis = {}, flag = {}, label = {}, median = new Set(), fromOurs = new Set();
  const src = sourceOf(team), ours = src === "twogun" ? null : oursFor(team, outSet, flips, edits, src === "ours_edits", consoleIds); // the settled edits: a man typed at his own figure is no edit and moves nobody
  const flipFig = src === "twogun" ? null : src === "ours_edits" ? ours : oursFor(team, outSet, flips, {}, true, consoleIds); // a flipped man's chart figure is the rule's figure for him in his new role
  const pageAside = {}; // his Minutes-page numbers the plan set aside (console-tier.js), shown on the man with their restore
  // Adam 9:30 AM 11-20: on plain Ours the lineup news's own flips are in `ours` (console-tier.js), so the team is rebuilt on their five; a man one of them moved takes the team plan's figure like everyone else
  const byNews = src === "ours" ? newsFlips(team.news, flips) : {};
  for (const p of team.men) {
    if (outSet.has(p.id)) { minutes[p.id] = 0; continue; }
    // typed minutes never move a man in the bench order (Adam 6:28 PM 11-18): his label carries the engine's bench spot, worked as if nothing were typed (console-chart.js sorts the bench by it)
    if (own(typed, p.id)) { minutes[p.id] = typed[p.id]; basis[p.id] = "typed"; const sp = (ours ?? flipFig)?.[p.id]?.label?.spot; label[p.id] = { kind: "typed", value: typed[p.id], spot: isNum(sp) ? sp : null }; continue; }
    const chartOwn = src === "ours_edits" && own(implicit, p.id) && !own(flips, p.id) ? ours?.[p.id] : null; // on Ours + my edits a man a flip moved has the chart's own figure
    if (chartOwn && isNum(chartOwn.min)) { minutes[p.id] = chartOwn.min; basis[p.id] = chartOwn.basis; flag[p.id] = chartOwn.flag ?? null; label[p.id] = chartOwn.label ?? null; fromOurs.add(p.id); if (chartOwn.median) median.add(p.id); continue; }
    if (own(moved, p.id) && !(own(byNews, p.id) && ours?.[p.id])) {
      const f = flipFig?.[p.id] ?? roleMinutes(p, moved[p.id]); // the chart's figure, a null one included, only when ours feeds the optimizer (TwoGun stays as it was); a call is on his resolved role's figure (callsOf)
      const takes = !flipFig && !closed.has(p.id) && isNum(f.min) && isNum(work.gain[p.id]) && Math.abs(work.gain[p.id]) > EPS; // TwoGun's arithmetic: a mark's man takes a sitter's hand-out on top of his role figure (round 2, item 4)
      minutes[p.id] = takes ? Math.min(ceilingOf(p), Math.max(0, f.min + work.gain[p.id])) : f.min; flag[p.id] = f.flag ?? null; label[p.id] = f.label ?? null;
      basis[p.id] = own(calls, p.id) ? `${f.basis ?? "no basis"}; ${calls[p.id].why}` : own(implicit, p.id) && !own(flips, p.id) ? `${f.basis}; moved by your role flip` : f.basis;
      if (f.median) median.add(p.id);
      continue;
    }
    const o = ours?.[p.id];
    if (o?.aside) pageAside[p.id] = o.aside;
    if (o) { minutes[p.id] = o.min; basis[p.id] = o.basis; flag[p.id] = o.flag ?? null; label[p.id] = o.label ?? null; if (isNum(o.min)) fromOurs.add(p.id); if (o.median) median.add(p.id); continue; } // a missing chart figure stays missing, with its reason: TwoGun's number never stands in for it (R1)
    if (ours) { minutes[p.id] = null; basis[p.id] = "the minutes engine has no inputs for him"; flag[p.id] = null; continue; } // on an Ours source TwoGun's number never stands in for the engine's (R1); the team note counts him
    minutes[p.id] = modelled[p.id];
  }
  return { minutes, basis, flag, label, median, fromOurs, pageAside, totalNote: ours?.totalNote ?? null, lostNote: ours ? null : lostNoteOf(team, work.lost) };
}

/** G62 (round 2, item 4): minutes a sitter left that nobody could take (every teammate typed, flipped or at his ceiling), one team-foot sentence, or null. */
function lostNoteOf(team, lost) {
  const name = (id) => team.men.find((p) => p.id === id)?.name ?? id, parts = Object.entries(lost ?? {}).map(([id, v]) => `${(Math.round(v * 10) / 10).toFixed(1)} of ${name(id)}'s minutes`);
  return parts.length ? `${parts.join(" and ")} went to nobody: every teammate who could take them is typed, flipped or at his ceiling.` : null;
}

/**
 * Adam 9:46-9:47 AM 11-20 (typed-aside.js): each typed number on a man playing, kept or set aside by a later role change across the starter line: { kept: { id: v }, aside: { id: { value, was, now, at, by, words } },
 * unstamped: [names] (no stamp on record: kept, counted). roles: the scenario's (worked as if nothing were typed); the newest call on him is his flip's (the news's time for a news flip) or his standing mark's.
 */
function typedVerdicts(team, outSet, typed, roles, flips, planHas = () => true) {
  return judgeTyped(typed, { skip: (id) => outSet.has(id), stampOf: (id) => team.stamps?.m?.[team.scenario_key]?.[id], roleOf: (id) => roles[id], nameOf: (id) => team.men.find((p) => p.id === id)?.name ?? id,
    changeOf: (id) => changeOn(team, flips, id), planHas }); // stamps kept per scenario, as the pins (the money review of 11-20, finding 1)
}

/**
 * The team foot's hand-out note, or null. (1) G62, the lead 11-20: hand-outs for a man Out on the Tonight the arithmetic starts from (tgTonightOf: on TwoGun's minutes, TwoGun's own Tonight, so a feed-Out
 * man TwoGun plays is handed out and his hand-outs count) do nothing anywhere (his minutes and usage are already shared out in Tonight's figures; usageFor hands out only a man added beyond it), so they
 * are named, kept for when he is Out beyond it again. (2) Hand-out and combination minute edits count only on TwoGun (modelledMinutes runs only there): named when the engine's minutes are in use.
 */
export function handoutNote(team, engineOk) {
  const name = (id) => team.men.find((p) => p.id === id)?.name ?? id, list = (ns) => (ns.length <= 1 ? ns.join("") : `${ns.slice(0, -1).join(", ")} and ${ns.at(-1)}`);
  const has = (o, k = "m") => Object.keys(o?.[k] ?? {}).length > 0, tonight = tgTonightOf(team, new Set(team.tonight ?? []));
  const idle = Object.entries(team.handouts ?? {}).filter(([id, h]) => tonight.has(id) && (has(h) || has(h, "u"))).map(([id]) => name(id));
  const idleLine = idle.length ? `Your hand-outs for ${list(idle)} do not apply: ${idle.length === 1 ? "he is" : "they are"} Out on Tonight itself, so ${idle.length === 1 ? "his" : "their"} minutes and usage are already shared out.` : null;
  const src = sourceOf(team);
  const names = src === "twogun" || !engineOk ? [] : [...Object.entries(team.handouts ?? {}).filter(([id, h]) => has(h) && !tonight.has(id)).map(([id]) => name(id)), ...Object.entries(team.combos ?? {}).filter(([, c]) => has(c)).map(([k]) => outsOf(k).map(name).join(" + "))];
  const srcLine = names.length ? `Your hand-out minutes for ${names.join(", ")} do not apply on ${SOURCE_LABEL[src]}; they count on TwoGun's minutes.` : null;
  return [idleLine, srcLine].filter(Boolean).join(" ") || null;
}

/** Why the usage total misses 100, with the fix; null when it is on it or no man has a figure. Only typed usage can miss: the fit places the rest. */
function usageMiss(total) {
  if (total === null) return null;
  const off = total - TEAM_USAGE;
  if (Math.abs(off) <= TOTAL_ROUNDING) return null;
  if (off > 0) return `Typed usage is ${off.toFixed(1)} over ${TEAM_USAGE}. Lower a typed figure.`;
  return `Every man with a usage figure is typed, ${(-off).toFixed(1)} short of ${TEAM_USAGE}. Raise a typed figure or clear one.`;
}

/** A man's usage before anything is handed out: his Tonight share scaled by his minutes, so his per-minute usage is where it was. */
export function usageStart(p, m, outTonight = false) {
  if (!isNum(p.usg)) return null;
  const m0 = outTonight ? p.healthy : p.min;
  return isNum(m) && isNum(m0) && m0 > 0 ? p.usg * (m / m0) : p.usg;
}

/**
 * The scenario's usage. Each man starts at his Tonight share scaled by his minutes, so a pure minutes change leaves his per-minute usage
 * where it was. What that leaves short of 100 is the real redistribution: it goes out from whoever gave usage up (a man added to the out
 * list, or typed or flipped to 0 minutes), by their shares. Then the fit to 100 around his usage pins. `keep`: rates stay where they are, when nothing
 * but minutes changed, or when a man giving usage up or coming back has no usage figure, since the sums would then read a hole as a shift.
 */
/**
 * The Tonight usage shares as TwoGun's own Tonight has them (tgTonightOf), when it differs from the Console's: { usg: { id: share }, min: (man) => his TwoGun Tonight minutes, skipped: [names] }, or null (no
 * man our feeds have Out whom TwoGun plays, or nobody on that floor with a usage percent). The inputs' shares (console-inputs.js attachUsage) leave our feeds' Outs off the floor; on TwoGun's minutes such a
 * man plays his TwoGun minutes in the base and gives his share up as an added sitter (round 2, item 1). The shares are worked over the men with a usage percent, as attachUsage works them; a man on the
 * floor with none (a two-way man with no league row) has no share and is named (round 2, item 2). Pure.
 */
function tgUsage(team, full, base) {
  const extra = new Set([...full].filter((id) => !base.has(id)));
  if (!extra.size) return null;
  const min = (p) => (extra.has(p.id) ? p.tg_min : p.min), floor = team.men.filter((p) => !base.has(p.id) && isNum(min(p)) && min(p) > 0);
  const known = floor.filter((p) => isNum(p.usg_pct)), denom = known.reduce((s, p) => s + p.usg_pct * min(p), 0);
  if (!(denom > 0)) return null;
  const usg = Object.fromEntries(team.men.map((p) => [p.id, base.has(p.id) ? p.usg ?? null : known.includes(p) ? (TEAM_USAGE * p.usg_pct * min(p)) / denom : floor.includes(p) ? null : p.usg ?? null]));
  return { usg, min, skipped: floor.filter((p) => !isNum(p.usg_pct)).map((p) => p.name) };
}

/** G62 (round 2, item 2): the men TwoGun's Tonight usage was shared without, one team-foot sentence, or null. */
const usageSkipNote = (names) => (names?.length ? `${names.join(", ")} ${names.length === 1 ? "has" : "have"} no usage figure in this season's league table, so TwoGun's Tonight usage is shared without ${names.length === 1 ? "him" : "them"}.` : null);

function usageFor(team, outSet, tonightSet0, m, pins, flips) {
  const tonightSet = tgTonightOf(team, tonightSet0), tg = tgUsage(team, tonightSet0, tonightSet); // round 2, item 1: on TwoGun's minutes a feed-Out man TwoGun plays gives his usage up as an added sitter
  const usgOf = (p) => (tg ? tg.usg[p.id] : p.usg), asTg = (p) => (tg ? { ...p, usg: usgOf(p), min: tg.min(p) } : p);
  const uPins = pinsOnPlaying(team, outSet, pins.u);
  const start = {};
  for (const p of team.men) start[p.id] = outSet.has(p.id) ? 0 : usageStart(asTg(p), m[p.id], tonightSet.has(p.id));
  const gaveUp = team.men.filter((p) => !outSet.has(p.id) && (own(pins.m, p.id) || own(flips, p.id)) && m[p.id] === 0 && !own(uPins, p.id));
  const added = team.men.filter((p) => outSet.has(p.id) && !tonightSet.has(p.id));
  const back = team.men.filter((p) => tonightSet.has(p.id) && !outSet.has(p.id));
  const givers = [...added, ...gaveUp];
  const moved = givers.length > 0 || back.length > 0 || Object.keys(uPins).length > 0;
  const hole = [...givers, ...back].some((p) => !isNum(usgOf(p)));
  const values = { ...start };
  const held = team.men.reduce((s, p) => s + (outSet.has(p.id) ? 0 : own(uPins, p.id) ? uPins[p.id] : start[p.id] ?? 0), 0);
  const short = TEAM_USAGE - held;
  const combo = added.length && outSet.size >= 2 ? team.combos?.[keyOf([...outSet])]?.u : null;
  const takers = team.men.filter((p) => !outSet.has(p.id) && !gaveUp.includes(p));
  if (combo) {
    for (const p of takers) if (own(combo, p.id) && values[p.id] !== null) values[p.id] += combo[p.id];
  } else if (short > 0) {
    const whole = givers.reduce((s, g) => s + (usgOf(g) ?? 0), 0);
    for (const g of givers) {
      if (!(usgOf(g) > 0)) continue;
      for (const [p, f] of sharesAmong(team, g.id, "u", takers.filter((x) => !own(uPins, x.id)), values)) values[p.id] += short * (usgOf(g) / whole) * f;
    }
  }
  const fitted = fitKind(team, outSet, values, uPins, TEAM_USAGE, () => Infinity);
  return { shown: fitted, rate: fitted, keep: !moved || hole, asTg, tonight: tonightSet, note: usageSkipNote(tg?.skipped) }; // asTg and tonight: the basis the rates are judged against (round 2, item 1)
}

/**
 * The rate at usage u and minutes m, and whether the multiplier hit an end of its range. Per-minute usage against Tonight's, followed by his scoring share (usageShareOf).
 * Where the usage step applies: usage_x (his per-minute usage over Tonight's) and rate_x (the multiplier held to its range).
 */
export function rateAt(man, u, m, outTonight = false) {
  if (!isNum(man.rate)) return { rate: null, clamped: false };
  const m0 = outTonight ? man.healthy : man.min;
  if (!isNum(u) || !isNum(m) || !isNum(man.usg) || !isNum(m0) || man.usg <= 0 || m < LOW_MINUTES || m0 < LOW_MINUTES) return { rate: man.rate, clamped: false };
  const usageX = (u / m) / (man.usg / m0), raw = 1 + usageShareOf(man) * (usageX - 1);
  const held = Math.min(RATE_MULTIPLIER.max, Math.max(RATE_MULTIPLIER.min, raw));
  return { rate: man.rate * held, clamped: held !== raw, usage_x: usageX, rate_x: held };
}

const sum = (rows, k) => {
  const known = rows.map((r) => r[k]).filter(isNum);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
};

const OFF_SCENARIO = { m: false, u: false, d: false, p: false, r: false };

/**
 * Men a flip or a mark moved without his touching them (a starter pushed out of the five, a backup pulled in): where the chart names the five, whoever's resolved role differs from the same outs with no flips
 * (bare: and no standing marks, the round-2 review, so a mark's move reaches the minutes on TwoGun) and who holds no call himself (flips, calls). Outs stay out. { id: role }.
 */
function implicitFlips(team, outSet, flips, roles, calls = {}, bare = false) {
  if (!fiveIsSet(team) || (!Object.keys(flips).length && !Object.keys(calls).length)) return {};
  const plain = resolveRoles(bare ? unmarked(team) : team, outSet, {}).roles, out = {};
  for (const p of team.men) if (!outSet.has(p.id) && !own(flips, p.id) && !own(calls, p.id) && roles[p.id] !== plain[p.id] && FLIP_ROLES.includes(roles[p.id])) out[p.id] = roles[p.id];
  return out;
}

const standingOf = (team) => team.role_marks ?? team.tier?.role_marks ?? {}; // his standing role marks, by id, as console-tier.js withStanding reads them
/** The team with no standing role marks: the baseline a mark's move is measured from. */
const unmarked = (team) => ({ ...team, role_marks: {}, ...(team.tier ? { tier: { ...team.tier, role_marks: {} } } : {}) });
/** A Starter call says the man plays (the round-2 review): a call the five rule benched is at least Bench, never Out of rotation's 0 minutes. */
const playsOn = (call, now) => (call === "starter" && now === "oor" ? "bench" : now);

/**
 * The calls whose minutes follow the role the resolver gave the man (the review of 11-20, money; rounds 1 and 2), { id: { role, why } }:
 * every live flip his resolved role overruled, by his newer standing mark ("your newer standing mark") or by the five-starter rule; and, on the TwoGun source with the engine's inputs (bare), every standing mark
 * that stands with no flip over it ("your role mark"; the five rule's words when it benched his Starter mark). The roles come from console-roles.js resolveRoles; Out men carry none.
 */
function callsOf(team, outSet, flips, roles, bare) {
  const won = withStanding(team, flips), out = {}, onTeam = new Set(team.men.map((p) => p.id));
  const five = "the five-starter rule benched his Starter call";
  if (bare) for (const [id, mark] of Object.entries(standingOf(team))) {
    if (!onTeam.has(id) || outSet.has(id) || own(flips, id) || won[id] !== mark || !FLIP_ROLES.includes(roles[id])) continue;
    out[id] = { role: playsOn(mark, roles[id]), why: roles[id] === mark || mark !== "starter" ? "your role mark" : five };
  }
  for (const [id, r] of Object.entries(flips)) {
    if (roles[id] === r || !FLIP_ROLES.includes(roles[id])) continue;
    const mark = won[id] !== r;
    out[id] = { role: playsOn(mark ? won[id] : r, roles[id]), why: mark ? "your newer standing mark" : five };
  }
  return out;
}
/** Every man whose minutes are a role's figure: the men a call moved (implicit), his flips, and the calls on their resolved roles (callsOf). */
const movedOf = (implicit, flips, calls) => ({ ...implicit, ...flips, ...Object.fromEntries(Object.entries(calls).map(([id, c]) => [id, c.role])) });

/**
 * The scenario: { rows: [{ id, out, role, min, min_basis, min_label (the engine's short basis, tiers.js label; null off the engine), min_median (his flipped minutes are a position median, not his own), usg, rate, formula, proj, pinned: { m, u, d, p, r }, clamped, back_on_zero, missing: [...] }],
 * totals: { min, usg, proj, usg_off, usg_why, proj_missing }, roles_note }. role: console-roles.js's role; min_basis: "typed", a flipped man's role
 * figure basis, or null for the model's. min is the team's total for reference only. usg_off is the difference from 100; a total no man has a figure
 * for is null. usg_why: why typed usage misses 100, with the fix; null when nothing is wrong. Nothing here refuses Apply.
 */
export function scenario(team0, outs = [], pins = emptyPins()) {
  const team = { ...team0, scenario_key: keyOf(outs) }; // the scenario whose pins and stamps these are (console-tier.js callTimes)
  const known = new Set(team.men.map((p) => p.id));
  const outSet = new Set(outs.filter((id) => known.has(id))), tonightSet = new Set(team.tonight ?? []);
  const flips = liveFlips(team, outSet, pins.r);
  const { roles, note: rolesNote } = resolveRoles(team, outSet, pins.r);
  const bare = sourceOf(team) === "twogun" && oursUse(team).ok && Object.keys(standingOf(team)).length > 0; // the round-2 review: on TwoGun his standing marks move the five, so they move the minutes too
  const benched = callsOf(team, outSet, flips, roles, bare), implicit = implicitFlips(team, outSet, flips, roles, benched, bare);
  const moved = movedOf(implicit, flips, benched), typedIds = Object.keys(pins.m ?? {}), flipMoved = implicitFlips(team, outSet, flips, roles); // flipMoved: the men his own flips moved, marks aside (round 2, item 4)
  let tv = typedVerdicts(team, outSet, pins.m ?? {}, roles, flips), mp = { ...pins, m: tv.kept }; // his typed numbers a later role change set aside (Adam 9:46 AM 11-20)
  let mf = minutesFor(team, outSet, tonightSet, mp.m, flips, implicit, typedIds, benched, flipMoved);
  const noFig = new Set(Object.keys(tv.aside).filter((id) => !isNum(mf.minutes[id]))); // the money review of 11-20, finding 2: no figure in the new role, so his number stands, named
  if (noFig.size) { tv = typedVerdicts(team, outSet, pins.m ?? {}, roles, flips, (id) => !noFig.has(id)); mp = { ...pins, m: tv.kept }; mf = minutesFor(team, outSet, tonightSet, mp.m, flips, implicit, typedIds, benched, flipMoved); }
  const { minutes: m, basis, flag, label, median, fromOurs, pageAside, totalNote, lostNote } = mf;
  const use = oursUse(team), clean = oursFor(team, outSet, flips, {}, false, typedIds); // his flips are not read here (no edits), the lineup news's own are (console-tier.js), as on the board
  const oursNote = sourceOf(team) !== "twogun" && !use.ok ? `${team.source_set ? "Ours minutes are chosen" : "Ours is the default"} but ${use.why ?? "this team has no minutes engine inputs"}, so TwoGun's minutes are in use.` : null; // the chart's minutes on this scenario's outs alone, for the "Ours" column beside TwoGun's
  const u = usageFor(team, outSet, tonightSet, m, mp, moved);
  const rows = team.men.map((p) => {
    const oc = clean?.[p.id], oursFields = { ours_min: isNum(oc?.min) ? oc.min : null, ours_basis: oc?.basis ?? (use.ok ? "the minutes engine has no inputs for him" : use.why), ours_median: false, ours_tier: oc?.tier ?? null, ours_flag: oc?.flag ?? null };
    if (outSet.has(p.id)) return { id: p.id, out: true, role: "out", ...oursFields, min_from_ours: false, min_flag: null, min_label: null, min: 0, min_basis: null, min_median: false, usg: 0, rate: isNum(p.rate) ? p.rate : null, formula: 0, proj: 0, pinned: OFF_SCENARIO, clamped: false, back_on_zero: false, missing: [] };
    const pinned = { m: own(mp.m, p.id), u: own(pins.u, p.id), d: own(pins.d, p.id), p: own(pins.p, p.id), r: own(flips, p.id) };
    const held = pinned.d ? { rate: pins.d[p.id], clamped: false }
      : p.rate_source === "typed" ? { rate: p.rate, clamped: false } // a DK/min he typed on the board is held like a pin: no usage scaling
      : u.keep && !pinned.u ? { rate: isNum(p.rate) ? p.rate : null, clamped: false }
      : rateAt(u.asTg(p), u.rate[p.id], m[p.id], u.tonight.has(p.id)); // judged against the Tonight usageFor worked on (TwoGun's own where its minutes are in use: round 2, item 1)
    const formula = isNum(m[p.id]) && isNum(held.rate) ? m[p.id] * held.rate : null;
    const proj = pinned.p ? pins.p[p.id] : formula;
    const backOnZero = tonightSet.has(p.id) && !pinned.m && !pinned.r && !(m[p.id] > 0);
    const missing = [];
    if (m[p.id] === null) missing.push(basis[p.id] ? `min: ${basis[p.id]}` : "min");
    if (u.shown[p.id] === null) missing.push("usg");
    if (held.rate === null) missing.push("rate");
    if (proj === null) missing.push("proj");
    if (held.clamped) missing.push("rate clamped");
    if (backOnZero) missing.push("back on 0 minutes; pin his minutes");
    return { id: p.id, out: false, role: roles[p.id], min_aside: tv.aside[p.id] ?? pageAside[p.id] ?? null, ...oursFields, min_from_ours: fromOurs.has(p.id), min_flag: flag[p.id] ?? null, min_label: label[p.id] ?? null, min: m[p.id], min_basis: basis[p.id] ?? null, min_median: median.has(p.id), usg: u.shown[p.id], rate: held.rate, formula, proj, pinned, clamped: held.clamped, usage_x: held.usage_x ?? null, rate_x: held.rate_x ?? null, back_on_zero: backOnZero, missing };
  });
  const playing = rows.filter((r) => !r.out); // a man out is on 0 by the scenario, which says nothing about whether the figure is known
  const min = sum(playing, "min"), usg = sum(playing, "usg");
  const news = newsFlips(team.news, flips), hasMarks = Object.keys(pinsOnPlaying(team, outSet, mp.m)).length > 0 || Object.keys(flips).some((id) => !own(news, id)); // the news's own flips re-share the team (Adam 9:30 AM 11-20)
  const plainNote = sourceOf(team) === "ours" && use.ok && hasMarks ? `Plain Ours does not re-share around typed or flipped men: this team shows ${min === null ? "no" : min.toFixed(1)} minutes.` : null;
  return {
    rows,
    totals: {
      min, usg, proj: sum(rows, "proj"),
      usg_off: usg === null ? null : usg - TEAM_USAGE,
      usg_why: usageMiss(usg),
      proj_missing: rows.filter((r) => r.proj === null).length,
    },
    roles_note: [rolesNote, oursNote, totalNote ?? clean?.totalNote, plainNote, unstampedNote(tv.unstamped), heldNote(tv.held), lostNote, u.note].filter(Boolean).join(" ") || null,
    chart_note: clean ? chartUsualNote(clean, (id) => team.men.find((p) => p.id === id)?.name ?? id, sourceOf(team), (id) => team.tier?.men?.[id]?.chart_usual ?? null) : null, // the no-games chart usual's own foot note (Ours against the table)
    handout_note: handoutNote(team, use.ok),
    injured_note: injuredPlayNote(team, outSet, roles, clean), // its own field, for the panel foot: never joined into roles_note, whose readers split on periods
  };
}
