// His own marks on a team (Adam, 11-07) and what each man would be without one: typed minutes (m), typed DK/min (d), a role he set (r: S, or
// a starter sent to the bench) and an Out or back-in he set against TwoGun's list (out). Each mark's undo chip drops it and the man goes back
// to what the app has live; `live` is that figure, for the chip's hover. Pure, no page: the console and the board both read it.
import { keyOf } from "./console-engine.js";
import { calc } from "./console-model.js";

/** The work with one pin taken off the scenario on show. */
function without(S, k, id) {
  const key = keyOf(S.outs), pins = structuredClone(S.pins[key] ?? {});
  if (pins[k]) delete pins[k][id];
  return { ...S, pins: { ...S.pins, [key]: pins } };
}
const rowOf = (T, S, id) => calc(T, S, S.outs).rows.find((r) => r.id === id) ?? null;

/**
 * { id: { m?: { v, live }, d?: { v, live }, r?: { v: role, live: role }, out?: { v: "out" | "in", live: "playing" | "out" } } } for every man
 * with a mark on the scenario on show. live is null when the app has no figure for him without the mark; news is the lineup news's words when the news made it.
 */
export function marksOf(T, S) {
  const key = keyOf(S.outs), pins = S.pins[key] ?? {}, out = {}, outs = new Set(S.outs), tonight = new Set(T.tonight ?? []);
  const at = (id) => (out[id] ??= {});
  for (const id of Object.keys(pins.m ?? {})) if (T.byId[id] && !outs.has(id)) at(id).m = { v: pins.m[id], live: rowOf(T, without(S, "m", id), id)?.min ?? null };
  for (const id of Object.keys(pins.d ?? {})) if (T.byId[id] && !outs.has(id)) at(id).d = { v: pins.d[id], live: rowOf(T, without(S, "d", id), id)?.rate ?? null };
  for (const id of Object.keys(pins.r ?? {})) if (T.byId[id] && !outs.has(id)) at(id).r = { v: pins.r[id], live: rowOf(T, without(S, "r", id), id)?.role ?? null };
  for (const id of outs) if (T.byId[id] && !tonight.has(id)) at(id).out = { v: "out", live: "playing" };
  for (const id of tonight) if (T.byId[id] && !outs.has(id)) at(id).out = { v: "in", live: "out" };
  // A change the lineup news made by itself (lineup-bar.js) and that still stands as it left it is not his: it says so, with the news it came from.
  const owned = newsOwned(S);
  for (const e of Object.values(S.news ?? {})) if (e.state === "applied") for (const m of e.men) if (owned[m.kind]?.has(m.id) && out[m.id]?.[m.kind]) out[m.id][m.kind].news = e.text;
  return out;
}

const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const ROLE_WORD = { starter: "starter", bench_plus: "bench", bench: "bench", oor: "not in the rotation", out: "out" };
/** The undo chip's hover for one mark: "live: 31.5", "live: bench". */
export function liveText(kind, mark) {
  if (mark.live === null || mark.live === undefined) return "live: no figure";
  if (kind === "m") return `live: ${f1(mark.live)}`;
  if (kind === "d") return `live: ${mark.live.toFixed(2)}`;
  if (kind === "r") return `live: ${ROLE_WORD[mark.live] ?? mark.live}`;
  return `live: ${mark.live}`;
}

/** Whether a man is exactly as a news entry left him: still Out, or his flip still the one it set (`to`). */
const asLeft = (m, flips, outs) => (m.kind === "out" ? outs.has(m.id) : m.to !== undefined && flips[m.id] === m.to);
const onShow = (S) => ({ flips: S.pins[keyOf(S.outs)]?.r ?? {}, outs: new Set(S.outs) });

/**
 * The men the lineup news still owns on a team: { out: Set, r: Set }. A man is the news's only while its entry is applied and he is exactly as it left
 * him; once he is anything else, what he is now is Adam's own mark (Adam, 11-07: marks win). Pure.
 */
export function newsOwned(S) {
  const { flips, outs } = onShow(S), own = { out: new Set(), r: new Set() };
  for (const e of Object.values(S.news ?? {})) if (e.state === "applied") for (const m of e.men) if (asLeft(m, flips, outs)) own[m.kind].add(m.id);
  return own;
}

/** Whether every man an entry moved is still as it left him (the undo X takes a man back only then). */
export const stillAsLeft = (S, e) => { const { flips, outs } = onShow(S); return e.men.every((m) => asLeft(m, flips, outs)); };
/** One man of an entry still as it left him. */
export const manAsLeft = (S, m) => { const { flips, outs } = onShow(S); return asLeft(m, flips, outs); };

/**
 * After Ctrl+Z or Ctrl+Y the news records follow the screen: an applied entry whose men are no longer as it left them is "reverted" (taken back with
 * Ctrl+Z; never applied again), and a reverted one whose men are as it left them again is "applied" only when the restore reached the step it was
 * reverted from (memo.mayReturn), so his own later Out is never handed to the news. memo.reverted(key) records that step. True when an entry changed. Mutates S.news.
 */
export function alignNews(S, memo = {}) {
  let changed = false;
  for (const [key, e] of Object.entries(S.news ?? {})) {
    if (e.state !== "applied" && e.state !== "reverted") continue;
    const left = stillAsLeft(S, e);
    if (e.state === "applied" && !left) { S.news[key] = { ...e, state: "reverted" }; memo.reverted?.(key); changed = true; }
    else if (e.state === "reverted" && left && memo.mayReturn?.(key)) { S.news[key] = { ...e, state: "applied" }; changed = true; }
  }
  return changed;
}
