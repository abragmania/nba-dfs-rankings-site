// Adam 10:25 AM 11-18: "bench+ = averaged 20min or more in games off the bench this season (as a starting point)", "min 5 games". Pure; tiers.js re-exports it; tests/bench_plus_split.test.mjs.
//  A game counts off the bench only when its box says he did not start (started false); a game with no start flag is left out and counted, never read as a bench game (the review of 11-18).
import { MINUTES_CAP } from "./team-fill.js";

export const BENCH_PLUS_MEAN = 20;
export const BENCH_PLUS_MIN_GAMES = 5;
const EPS = 1e-9, r1 = (v) => Math.round(v * 10) / 10, games = (n) => `${n} game${n === 1 ? "" : "s"}`;

/**
 * Whether a man is Bench+ by default: his mean over this season's games off the bench is BENCH_PLUS_MEAN or more over at least BENCH_PLUS_MIN_GAMES of them. rows: [{ min (overtime-scaled), started
 * (true, false, or unknown) }]; read: false when no box-score game of his was read (box scores unusable, or he is not matched to them). Returns { ok, mean (null with none), n, unknown, words }. Pure.
 */
export function benchPlusBy(rows, { read = true } = {}) {
  if (!read) return { ok: false, mean: null, n: 0, unknown: 0, words: "no box-score games read" };
  const off = rows.filter((r) => r.started === false).map((r) => r.min), unknown = rows.filter((r) => r.started !== true && r.started !== false).length;
  const n = off.length, mean = n ? off.reduce((s, v) => s + v, 0) / n : null, left = unknown ? `; ${games(unknown)} with no start flag left out` : "";
  if (n < BENCH_PLUS_MIN_GAMES) return { ok: false, mean, n, unknown, words: `${games(n)} off the bench this season, under the ${BENCH_PLUS_MIN_GAMES} needed${left}` };
  const ok = mean >= BENCH_PLUS_MEAN - EPS, shown = !ok && r1(mean) >= BENCH_PLUS_MEAN ? (Math.floor(mean * 100) / 100).toFixed(2) : String(r1(mean)); // floored: 19.96 and 19.996 never read as "20 ... under the 20 needed"
  const words = `${shown} a game in ${n} games off the bench this season`;
  return { ok, mean, n, unknown, words: ok ? `${words}${left}` : `${words}, under the ${BENCH_PLUS_MEAN} needed${left}` };
}

/** A man's own mean off the bench as a Bench+ figure: only over BENCH_PLUS_MIN_GAMES or more such games (Adam's "min 5 games"; the lead, 11-18), capped at MINUTES_CAP; null otherwise. Pure. */
export function benchMean(rows) {
  const off = rows.filter((r) => r.started === false).map((r) => r.min);
  return off.length >= BENCH_PLUS_MIN_GAMES ? Math.min(off.reduce((s, v) => s + v, 0) / off.length, MINUTES_CAP) : null;
}
