// GPP ownership rules, the one copy (pure ES module: the board page and the optimizer both load it). A rule is
// { dir: "min" | "max", side: "under" | "over", count, pct }: at least or at most `count` men strictly under (<) or strictly
// over (>) `pct` percent projected owned (the man's proj_own, TwoGun's OWN). Every rule binds at once and one man counts toward
// each rule he meets. A man with no figure counts toward no rule, on either side of any line.
import { SLOTS } from "./slots.js";

const N = SLOTS.length;
/** The most rules one build takes (the panel stops at four, settings-panel.js MAX_LOW_RULES). */
export const RUN_MAX_RULES = 8;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isCount = (v) => Number.isInteger(v) && v >= 0;
const isPct = (v) => isNum(v) && v >= 0;
const onlyKeys = (r, keys) => Object.keys(r).every((k) => keys.includes(k));

/** A rule in its one shape, from the current shape or the older { count, underPct } (read as at least, under); null when it is neither. */
export function toRule(r) {
  if (r == null || typeof r !== "object" || Array.isArray(r)) return null;
  if ("underPct" in r && onlyKeys(r, ["count", "underPct"])) return isCount(r.count) && isPct(r.underPct) ? { dir: "min", side: "under", count: r.count, pct: r.underPct } : null;
  if (!onlyKeys(r, ["dir", "side", "count", "pct"])) return null;
  if ((r.dir !== "min" && r.dir !== "max") || (r.side !== "under" && r.side !== "over") || !isCount(r.count) || !isPct(r.pct)) return null;
  return { dir: r.dir, side: r.side, count: r.count, pct: r.pct };
}

/** True when a man with this projected ownership counts toward the rule. */
export const ownHits = (own, rule) => isNum(own) && (rule.side === "under" ? own < rule.pct : own > rule.pct);
/** How many of these men each rule counts, one count per rule. */
export const ruleCounts = (rules, men) => Int32Array.from(rules, (rule) => men.filter((p) => ownHits(p.proj_own, rule)).length);

/** The search's tables over men in search order: hit[r][i] when rule r counts man i; suffix[r][i] how many from man i on it counts (length n + 1). */
export function ruleTables(rules, men) {
  const hit = rules.map((rule) => men.map((p) => ownHits(p.proj_own, rule)));
  const suffix = hit.map((h) => {
    const c = new Int32Array(men.length + 1);
    for (let i = men.length - 1; i >= 0; i--) c[i] = c[i + 1] + (h[i] ? 1 : 0);
    return c;
  });
  return { hit, suffix };
}

/** True when `have` counted men meet the rule. */
export const ruleMet = (rule, have) => (rule.dir === "min" ? have >= rule.count : have <= rule.count);
/** How many men short of (at least) or past (at most) the rule `have` counted men are; 0 when it is met. */
export const ruleShort = (rule, have) => (rule.dir === "min" ? Math.max(0, rule.count - have) : Math.max(0, have - rule.count));

/**
 * False when k more men, all taken from a list holding `hit` men the rule counts and `miss` it does not, cannot leave it met with
 * `have` already counted. At least: at most min(k, hit) more can count. At most: at least k - miss of the k must be counted men.
 */
export function ruleReachable(rule, have, k, hit, miss) {
  return rule.dir === "min" ? have + Math.min(k, hit) >= rule.count : have + Math.max(0, k - miss) <= rule.count;
}

const men = (n) => `${n} ${n === 1 ? "man" : "men"}`;
/** The rule as words: "at least 2 men under 5% owned". */
export const ruleWords = (r) => `${r.dir === "min" ? "at least" : "at most"} ${men(r.count)} ${r.side} ${r.pct}% owned`;
/** The rule as a chip: "≥2 <5%", "≤2 >30%". */
export const ruleChip = (r) => `${r.dir === "min" ? "≥" : "≤"}${r.count} ${r.side === "under" ? "<" : ">"}${r.pct}%`;
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** The same rule twice. */
export const sameRule = (a, b) => a.dir === b.dir && a.side === b.side && a.count === b.count && a.pct === b.pct;

/** Why at-least rule a and rule b cannot both hold, in words, or null when this pair shows no plain contradiction. */
function pairClash(a, b) {
  if (a.dir !== "min") return null;
  // Every man a counts, b counts too (under p is under q when q >= p; over p is over q when q <= p), so b's at most is under a's at least.
  if (b.dir === "max" && b.side === a.side && a.count > b.count && (a.side === "under" ? b.pct >= a.pct : b.pct <= a.pct)) {
    return a.pct === b.pct ? "the same men count toward both" : `every man ${a.side} ${a.pct}% is also ${b.side} ${b.pct}%`;
  }
  // No man is both under p and over q when p <= q, so the two at-leasts need a.count + b.count different men.
  if (b.dir === "min" && b.side !== a.side && a.count + b.count > N) {
    const [u, o] = a.side === "under" ? [a, b] : [b, a];
    if (u.pct <= o.pct) return `no man is both under ${u.pct}% and over ${o.pct}%, and a lineup holds ${N}`;
  }
  return null;
}

/**
 * The plain contradiction in a set of rules, as one sentence naming the rules, or null. Covered: an at-least over a lineup's size,
 * an at-least above an at-most that counts every man it counts, and two at-leasts on lines no man meets both of that need more than
 * a lineup. Anything subtler is left to the search, which says no lineup was found.
 */
export function ownConflict(rules) {
  for (const r of rules) if (r.dir === "min" && r.count > N) return `${capital(ruleWords(r))} cannot be met: a lineup holds ${N}.`;
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const why = pairClash(rules[i], rules[j]) ?? pairClash(rules[j], rules[i]);
      if (why) return `${capital(ruleWords(rules[i]))} and ${ruleWords(rules[j])} cannot both hold: ${why}.`;
    }
  }
  return null;
}

/**
 * The rules a build was sent: a list, or the older single rule. { rules } or { error } in one sentence. The shape is checked in
 * every mode; `conflicts` (GPP, where the rules bind) also refuses a plain contradiction.
 */
export function readOwnRules(value, { conflicts = true } = {}) {
  if (value == null) return { rules: [] };
  const list = Array.isArray(value) ? value : [value];
  if (list.length > RUN_MAX_RULES) return { error: `At most ${RUN_MAX_RULES} ownership rules; this run has ${list.length}.` };
  const rules = [];
  for (const [i, r] of list.entries()) {
    const rule = toRule(r);
    if (!rule) return { error: `${list.length === 1 ? "The ownership rule" : `Ownership rule ${i + 1}`} must be {dir: "min" or "max", side: "under" or "over", count: a whole number, pct: a percentage}.` };
    rules.push(rule);
  }
  const clash = conflicts ? ownConflict(rules) : null;
  return clash ? { error: clash } : { rules };
}

/**
 * Late swap (global G62, degrade before refusing): an at-most rule the men already in the entry break is held to what they hold, so the
 * open slots add no more counted men. { rules, note }: the rules to search under, and the note naming each rule held, or null.
 */
export function liftForHeld(rules, held) {
  const have = ruleCounts(rules, held), lifted = [];
  const out = rules.map((r, x) => {
    if (r.dir !== "max" || have[x] <= r.count) return r;
    lifted.push(`${ruleWords(r)} was held to ${have[x]}`);
    return { ...r, count: have[x] };
  });
  return { rules: out, note: lifted.length ? `The men already in the entry break an ownership rule, so for this fill ${lifted.join(" and ")}, the number they already hold; the open slots add no more such men.` : null };
}

/** The note when rules are on and some men this build could use have no projected ownership (they count toward no rule); null otherwise. */
export function noFigureNote(usable, rules) {
  if (!rules.length) return null;
  const blank = usable.filter((p) => !isNum(p.proj_own)).length;
  if (!blank) return null;
  const one = blank === 1;
  return `${blank} of the ${usable.length} players this build could use ${one ? "has" : "have"} no projected ownership, so no ownership rule counts ${one ? "him" : "them"}.`;
}
