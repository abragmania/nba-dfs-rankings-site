// Which game totals and team totals deserve attention on the games strip. Pure functions; no page or file access.
//
// The rule (tiers), a graded heat scale run separately over the game totals (O/U) and over every team implied total:
//  1. Nulls are dropped (each null is "none"). With fewer than 2 values, the single value is "top".
//  2. mean = the mean of the values, R = max - mean. If R is 0 every value equals the max and all are "top".
//  3. Each value scores s = (v - mean) / R, so the max scores 1.
//  4. The max, and anything tied with it, is "top". Every other value is "lit" if s >= 0.5, "soft" if 0.3 <= s < 0.5, else "none".
//  5. "solo" is only for a true outlier: at least 3 values besides the max (values not tied with it), AND the max is at least
//     2 population standard deviations above the next value (max - second >= 2 * SD of the values besides the max), AND that
//     SD is above 0. Then the max is "solo" and everything else is "none".
const EPS = 1e-9;

export function tiers(values) {
  const out = values.map(() => "none");
  const idx = values.map((v, i) => i).filter((i) => typeof values[i] === "number" && Number.isFinite(values[i]));
  if (idx.length === 0) return out;
  if (idx.length === 1) { out[idx[0]] = "top"; return out; }
  const nums = idx.map((i) => values[i]);
  const max = Math.max(...nums);
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const R = max - mean;
  if (R <= EPS) { for (const i of idx) out[i] = "top"; return out; }
  const others = nums.filter((v) => v < max - EPS);
  let solo = false;
  if (others.length >= 3) {
    const om = others.reduce((a, b) => a + b, 0) / others.length;
    const sd = Math.sqrt(others.reduce((a, b) => a + (b - om) ** 2, 0) / others.length);
    solo = sd > EPS && max - Math.max(...others) >= 2 * sd - EPS;
  }
  for (const i of idx) {
    const v = values[i];
    if (v >= max - EPS) { out[i] = solo ? "solo" : "top"; continue; }
    if (solo) continue;
    const s = (v - mean) / R;
    out[i] = s >= 0.5 - EPS ? "lit" : s >= 0.3 - EPS ? "soft" : "none";
  }
  return out;
}

// Round to 0.1 first, then pick "point" or "points" from the rounded number (a 0.95 gap reads "1 point", never "1 points").
const pts = (n) => { const r = Math.round(n * 10) / 10; return `${r} point${r === 1 ? "" : "s"}`; };

/** Hover text for each value ("" for a plain one): `noun` is "game total" or "team total". */
export function notes(values, noun) {
  const t = tiers(values);
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => b - a); // same filter as tiers()
  return values.map((v, i) => {
    if (t[i] === "none") return "";
    const below = nums.find((x) => x < v - EPS);
    if (t[i] === "solo" || t[i] === "top") {
      const tied = nums.filter((x) => Math.abs(x - v) < EPS).length > 1; // same tie test as tiers()
      const clear = tied ? ", tied" : below === undefined ? "" : `, ${pts(v - below)} clear of the next`;
      return `Highest ${noun} on the slate${clear}`;
    }
    return `${pts(nums[0] - v)} behind the highest ${noun} on the slate`;
  });
}
