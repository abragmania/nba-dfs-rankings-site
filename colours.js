// Per-slate team colours: pure functions, no page or file access.
//
// The rule (assignColours): every team on the slate gets ONE main colour so that no two teams' row shades look alike.
//  - A team may wear any of its own logo colours (palette: [t1, t2, optional t3]), each as it is or in a slightly shifted shade
//    (hue nudged up to 12 degrees, lightness a little up or down), so every team still looks like itself. Nothing outside the
//    logo's colours is ever used. Each candidate has a preference cost, used only to break ties:
//      cost 0  t1 as it is (lifted, if needed, so it reads on a dark page);
//      cost 1  a shifted shade of t1;
//      cost 2  t2 or t3 as they are;  cost 3  a shifted shade of t2 or t3.
//  - Quality is how far apart the teams are, as a distance in OKLab. Pair distances are capped at SEPARATION_GOAL, so once every
//    pair is that far apart nobody is nudged further; below the goal the arrangement with the largest smallest-distance wins
//    (then the next smallest, and so on: the five smallest capped distances are compared in order, rounded to 0.005).
//  - Among equally good arrangements, the lower total cost wins (t1 first, then shifted t1, then the secondary colours), then the
//    larger raw smallest distance, then the first found in team order (so the result is deterministic).
//  - Search: with BRUTE_LIMIT (50,000) combinations or fewer, every combination is tried; with this many candidates per team
//    that is only slates of up to about 4 teams. Every larger slate uses coordinate descent: start with every team on t1, then
//    make up to 8 passes over the teams in code order, switching a team's colour whenever that gives a better arrangement.
//    The result of the descent therefore depends on its path (team order and the t1 start); it is deterministic but not
//    guaranteed to be the best possible arrangement.
//  - A team's `second` colour (the far end of its row gradient) is its other logo colour when its main is t1, and otherwise a
//    slightly darker shade of the chosen main, so a colour that clashes with another team never comes back at the row's edge.
const SEPARATION_GOAL = 0.12;
const MIN_L = 0.62; // a main colour is lifted to at least this OKLab lightness (readable on black and navy)
const SHIFT_MIN_L = 0.54; // a deliberately darker shade may go this low
const BRUTE_LIMIT = 50000;
const HUE_SHIFT = 12; // degrees
const L_SHIFT = 0.1;

// ---------- colour maths (sRGB hex <-> OKLab) ----------
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLin = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToOklab(hex) {
  if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`not a #rrggbb colour: ${String(hex)}`);
  const n = parseInt(hex.slice(1), 16);
  const r = toLin(((n >> 16) & 255) / 255), g = toLin(((n >> 8) & 255) / 255), b = toLin((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

export function oklabToHex([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return "#" + lin.map((c) => Math.round(Math.min(1, Math.max(0, fromLin(Math.min(1, Math.max(0, c))))) * 255).toString(16).padStart(2, "0")).join("");
}

/** Perceptual distance between two hex colours (Euclidean in OKLab). */
export function distance(h1, h2) {
  const x = hexToOklab(h1), y = hexToOklab(h2);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** The colour with its lightness raised to `minL` if it is darker (hue and chroma kept); a light enough colour is returned as is. */
export function lift(hex, minL = MIN_L) {
  const [L, a, b] = hexToOklab(hex);
  return L >= minL ? hex.toLowerCase() : oklabToHex([minL, a, b]);
}

/** Hue turned by `dh` degrees and lightness moved by `dl`, chroma kept. */
function shade(hex, dh, dl) {
  const [L, a, b] = hexToOklab(hex);
  const C = Math.hypot(a, b), h = Math.atan2(b, a) + (dh * Math.PI) / 180;
  return oklabToHex([Math.min(0.9, Math.max(SHIFT_MIN_L, L + dl)), C * Math.cos(h), C * Math.sin(h)]);
}

/** A team's candidate colours in preference order: [{hex, cost, from}] where `from` is the palette index it came from. */
export function candidates(palette) {
  const out = [], seen = new Set();
  const add = (hex, cost, from) => { if (!seen.has(hex)) { seen.add(hex); out.push({ hex, cost, from }); } };
  const base = lift(palette[0]);
  add(base, 0, 0);
  for (const [dh, dl] of [[-HUE_SHIFT, 0], [HUE_SHIFT, 0], [0, -L_SHIFT], [0, L_SHIFT], [-HUE_SHIFT, -L_SHIFT], [HUE_SHIFT, L_SHIFT], [-HUE_SHIFT, L_SHIFT], [HUE_SHIFT, -L_SHIFT]]) add(shade(base, dh, dl), 1, 0);
  for (let i = 1; i < palette.length; i++) {
    const sec = lift(palette[i]);
    add(sec, 2, i);
    for (const [dh, dl] of [[-HUE_SHIFT, 0], [HUE_SHIFT, 0], [0, -L_SHIFT], [0, L_SHIFT]]) add(shade(sec, dh, dl), 3, i);
  }
  return out;
}

// ---------- the search ----------
const q = (x) => Math.round(Math.min(x, SEPARATION_GOAL) / 0.005);

/** Quality of one choice list: lower smallest capped distances compare first; higher is better. */
function score(picks, dist) {
  const n = picks.length, d = [];
  let raw = Infinity, cost = 0;
  for (let i = 0; i < n; i++) {
    cost += picks[i].cost;
    for (let j = i + 1; j < n; j++) { const v = dist(picks[i].hex, picks[j].hex); d.push(q(v)); if (v < raw) raw = v; }
  }
  d.sort((a, b) => a - b);
  return { head: d.slice(0, 5), cost, raw };
}
function better(a, b) { // is score a better than score b
  for (let i = 0; i < Math.max(a.head.length, b.head.length); i++) {
    const x = a.head[i] ?? Infinity, y = b.head[i] ?? Infinity;
    if (x !== y) return x > y;
  }
  if (a.cost !== b.cost) return a.cost < b.cost;
  return a.raw > b.raw + 1e-12;
}

/**
 * teams: team codes on the slate; palettes: { CODE: [hex, ...] } (a team missing from it, or with an empty list, gets `fallback`).
 * Returns { CODE: { main, second } } (an object with no prototype): main is the assigned colour; second is the far end of the row
 * gradient (see the rule at the top).
 */
export function assignColours(teams, palettes, fallback = "#8a8a93") {
  const codes = [...new Set(teams)].sort();
  const cands = codes.map((t) => candidates(palettes[t]?.length ? palettes[t] : [fallback]));
  const cache = new Map();
  const dist = (a, b) => { const k = a < b ? a + b : b + a; let v = cache.get(k); if (v === undefined) { v = distance(a, b); cache.set(k, v); } return v; };
  const combos = cands.reduce((p, c) => p * c.length, 1);
  let pick = cands.map(() => 0), best = null;
  if (combos <= BRUTE_LIMIT) {
    const idx = cands.map(() => 0);
    for (let n = 0; n < combos; n++) {
      const s = score(idx.map((i, t) => cands[t][i]), dist);
      if (!best || better(s, best)) { best = s; pick = [...idx]; }
      for (let t = idx.length - 1; t >= 0; t--) { if (++idx[t] < cands[t].length) break; idx[t] = 0; }
    }
  } else {
    best = score(pick.map((i, t) => cands[t][i]), dist);
    for (let pass = 0; pass < 8; pass++) {
      let changed = false;
      for (let t = 0; t < codes.length; t++) {
        for (let i = 0; i < cands[t].length; i++) {
          if (i === pick[t]) continue;
          const trial = [...pick]; trial[t] = i;
          const s = score(trial.map((x, u) => cands[u][x]), dist);
          if (better(s, best)) { best = s; pick = trial; changed = true; }
        }
      }
      if (!changed) break;
    }
  }
  const out = Object.create(null); // no inherited keys: a team code can never collide with an object property
  codes.forEach((t, k) => {
    const c = cands[k][pick[k]];
    const pal = palettes[t]?.length ? palettes[t] : [fallback];
    const second = c.from === 0 ? (pal[1] ? lift(pal[1]) : c.hex) : shade(c.hex, 0, -L_SHIFT);
    out[t] = { main: c.hex, second };
  });
  return out;
}
