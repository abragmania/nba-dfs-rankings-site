// The tiebreak inside a bench level (Adam 11:40 AM 11-18: "Make it a blended avearge of last 10 games and season minutes per game"), pure; depth-cols.js benchOrder and tiers.js benchOrderKey
// sort by it, the board's engine and the console alike. Runs in the browser too. Tests: tests/bench_plus_split.test.mjs.
//  His minutes a game over the team's last 10 games and his minutes a game this season, each over games he played, overtime-scaled, blended BLEND_LAST10_WEIGHT to the last 10.
//  One half missing (no game in the last 10): the other stands, said on his row. Neither (no game this season): no key, last in his level, said.

export const BLEND_LAST10_WEIGHT = 0.5; // the lead's working value (Adam named no weighting): half the last 10, half the season
const r1 = (v) => Math.round(v * 10) / 10;

/**
 * A man's bench-order key: rows: this season's played games [{ min (overtime-scaled) }]; last10: his minutes a game over the team's last 10 games (tiers.js recentOf), or null with no game there.
 * Returns { key (null with neither), last10, season, words (his row's words) }. Pure.
 */
export function benchBlend(rows, last10) {
  const season = rows?.length ? rows.reduce((s, r) => s + r.min, 0) / rows.length : null, l10 = Number.isFinite(last10) ? last10 : null;
  if (l10 !== null && season !== null) {
    const key = BLEND_LAST10_WEIGHT * l10 + (1 - BLEND_LAST10_WEIGHT) * season;
    return { key, last10: l10, season, words: `${r1(key)} a game, blend of last 10 and season minutes a game (${r1(l10)} and ${r1(season)})` };
  }
  if (season !== null) return { key: season, last10: null, season, words: `${r1(season)} a game, blend of last 10 and season minutes a game: no game in the team's last 10, so his season figure alone` };
  if (l10 !== null) return { key: l10, last10: l10, season: null, words: `${r1(l10)} a game, blend of last 10 and season minutes a game: no season figure, so his last 10 alone` };
  return { key: null, last10: null, season: null, words: "no game this season, so last in his level" };
}
