// Minutes restrictions from the news (Adam 1:34-1:35 PM 11-19, night note 11-14: Missi's 5:25 PM restriction note was ignored). Pure and DOM-free: the board, the console and the public site load it.
//  readRestriction(text): whether a note puts a man on a minutes restriction ("on"), takes him off one ("off"), or mentions one it cannot be read as either ("unclear"), and the number it gives.
//  restrictionsFor(cards, team, day): each man's restriction tonight from the Monster news cards (news/lineups/latest.json monster_news.cards); the newest note that reads on or off decides.
//  restrictionStep: the cap in the minutes plan (tiers.js manFinish). The cap is a ceiling only: his minutes are the lower of what the plan gives him and the cap; nobody is raised to it.
// Sources: Monster news cards only. TwoGun's board rows carry a status word and no note text, and the NBA injury report gives only a reason, so neither can say "restriction".
import { isoToEastern } from "./board-util.js";
import { etDay } from "./news-model.js";

/** Adam 1:35 PM 11-19: a restriction with no number caps him at 25 ("25 or less"); a number in the note caps him at that number instead, above 25 or not. */
export const MR_DEFAULT_CAP = 25;
const MIN_CAP = 1, MAX_CAP = 48; // a game's minutes; a number outside is not a cap

const MIN_W = String.raw`(?:minutes|minute|mins?)`;
const APPROX = String.raw`(?:about|around|roughly|approximately|approx\.?|only|~)?\s*`;
// Phrases that end a restriction, or say there is none. Matched first and cut out, so "no minutes restriction" is never read as one.
const OFF = [
  /\bno\s+(?:minutes?|playing[- ]time)\s+(?:restrictions?|limits?|limitations?|caps?)\b/gi,
  /\b(?:no|without\s+(?:a|any)?)\s*restrictions?\b/gi,
  /\b(?:no|without\s+(?:a|any)?)\s*limitations?\b/gi,
  /\brestrictions?\s+(?:has\s+been\s+|have\s+been\s+|was\s+|were\s+|is\s+|are\s+|being\s+|now\s+)?(?:lifted|removed|gone|over|ended|done)\b/gi,
  /\b(?:lifted|removed|ended)\s+(?:his|the|a|any)\s+(?:minutes?\s+)?restrictions?\b/gi,
  /\boff\s+(?:of\s+)?(?:his|the|a|any)\s+(?:minutes?\s+)?(?:restriction|limit)s?\b/gi,
  /\bfree\s+of\s+(?:a\s+|any\s+)?(?:minutes?\s+)?restrictions?\b/gi,
  /\bno\s+longer\s+(?:be\s+)?(?:on|under|has|have|having|facing|faces|face)\s+(?:a\s+|any\s+)?(?:minutes?\s+)?(?:restriction|limit)s?\b/gi,
  /\b(?:not|won't|will\s+not|isn't|is\s+not|wasn't|shouldn't|should\s+not|doesn't|does\s+not)\s+(?:be\s+|expected\s+to\s+(?:be\s+|have\s+|face\s+)?)?(?:(?:on|under|have|having|facing|face)\s+(?:a\s+|any\s+)?(?:minutes?\s+)?(?:restrictions?|limit(?:ed|s)?)|limited|restricted)\b/gi,
  /\bunrestricted\b/gi,
  /\bno\s+limits?\s+on\s+(?:his\s+)?minutes\b/gi,
  /\bno\s+longer\s+(?:be\s+)?(?:restricted|limited|on\s+a\s+(?:minutes?\s+)?restriction)\b/gi,
];
// A restriction told of a past game, or one about to end: not read as one tonight (review 11-19).
const PAST = /\b(?:was|were|had(?:\s+been)?)\s+(?:on|under|playing\s+(?:on|under))\s+(?:a\s+|any\s+)?(?:strict\s+|tight\s+)?(?:minutes?\s+|playing[- ]time\s+)?(?:restriction|limit)|\blast\s+(?:game|week|night|outing|time|season)\b|\bpreviously\b|\bcoming\s+off\b|\breturned\s+from\b|\b(?:expected|likely|set|slated)\s+to\s+be\s+lifted\b|\b(?:could|may|might|should|will)\s+be\s+lifted\b/i;
// Phrases that put a man on a restriction.
const ON = [
  /\bminutes?[- ](?:restrict(?:ion|ions|ed)|limit|limits|cap)\b/i,
  /\brestrict(?:ed|ion|ions)\s+(?:on\s+|in\s+)?(?:his\s+)?minutes\b/i,
  /\blimited\s+minutes\b/i,
  /\bon\s+a\s+(?:strict\s+|tight\s+|soft\s+|hard\s+|light\s+)?(?:restriction|limit)\b/i,
  /\bpitch\s+count\b/i,
  /\bplaying[- ]time\s+(?:restriction|limit)s?\b/i,
  new RegExp(String.raw`\b\d{1,2}[- ]minute\s+(?:restriction|limit|cap)\b`, "i"),
  new RegExp(String.raw`\b(?:limited|restricted|capped|held)\s+(?:to|at)\s+${APPROX}\d{1,2}(?:\s*(?:-|–|—|to)\s*\d{1,2})?\s*${MIN_W}`, "i"),
];
const MENTION = /restrict(?!ed\s+free\s+agen)|minutes?\s+(?:limit|cap)|pitch\s+count|limited\s+minutes/i;
const UNCLEAR = /\b(?:unclear|uncertain|unknown|undetermined|unsure|to\s+be\s+determined|tbd|remains\s+to\s+be\s+seen|whether)\b/i;
// Numbers the note ties to the limit: a range first, then a single figure (upper end of a range is the cap).
const RANGES = [
  new RegExp(String.raw`(?:~\s*)?\b(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})\s*${MIN_W}\b`, "gi"),
  new RegExp(String.raw`\bbetween\s+(\d{1,2})\s+and\s+(\d{1,2})\s*${MIN_W}\b`, "gi"),
];
// A cap is a minutes figure (review 11-19): the minutes word follows the number, bare only after an on-phrase that carries it ("a minutes restriction of 24"); never "held to 8 points" or "2 games".
const SINGLES = [
  new RegExp(String.raw`\b(?:limited|restricted|capped|held)\s+(?:to|at)\s+${APPROX}(\d{1,2})\s*${MIN_W}\b`, "gi"),
  new RegExp(String.raw`\b(?:restriction|limit|cap)\s+of\s+${APPROX}(\d{1,2})\s*${MIN_W}\b`, "gi"),
  new RegExp(String.raw`\bminutes?[- ](?:restriction|limit|cap)\s+of\s+${APPROX}(\d{1,2})(?!\d)(?!\s*(?:-|–|—|to)\s*\d)(?!\s*(?:${MIN_W}|[a-z]))`, "gi"),
  /\b(\d{1,2})[- ]minute\s+(?:restriction|limit|cap)\b/gi,
  new RegExp(String.raw`\b(?:no\s+more\s+than|not\s+more\s+than|at\s+most|a\s+max(?:imum)?\s+of|max(?:imum)?\s+of|under|below|fewer\s+than|less\s+than|up\s+to)\s+${APPROX}(\d{1,2})\s*${MIN_W}\b`, "gi"),
  new RegExp(String.raw`(?:~\s*|\b(?:about|around|roughly|approximately)\s+)(\d{1,2})\s*${MIN_W}\b`, "gi"),
  new RegExp(String.raw`\b(?:play|see|log|get|receive)\s+${APPROX}(\d{1,2})\s*${MIN_W}\b`, "gi"),
];

const okCap = (n) => Number.isInteger(n) && n >= MIN_CAP && n <= MAX_CAP;
const sentences = (text) => String(text ?? "").replace(/\s+/g, " ").split(/(?<=[.!?;])\s+(?=[A-Z"'(])/).map((s) => s.trim()).filter(Boolean);

/** The figures a restriction sentence ties to the limit: { cap, range: [lo, hi] | null, several: [numbers] | null }; cap null when it gives none (or several that disagree). */
export function restrictionNumber(sentence) {
  let s = String(sentence ?? "");
  const found = [];
  for (const re of RANGES) s = s.replace(re, (m, a, b) => { const lo = +a, hi = +b; if (okCap(lo) && okCap(hi) && lo < hi) found.push({ cap: hi, range: [lo, hi] }); return " "; }); // cut out, so "18-22 minutes" is not read again as 22
  for (const re of SINGLES) for (const m of s.matchAll(re)) { const n = +m[1]; if (okCap(n)) found.push({ cap: n, range: null }); }
  const caps = [...new Set(found.map((f) => f.cap))];
  if (!caps.length) return { cap: null, range: null, several: null };
  if (caps.length > 1) return { cap: null, range: null, several: caps };
  return { cap: caps[0], range: found.find((f) => f.range)?.range ?? null, several: null };
}

/** One sentence: "on", "off", "unclear" or null (no mention). */
function sentenceState(s) {
  let rest = s, off = false;
  for (const re of OFF) rest = rest.replace(re, () => { off = true; return " "; });
  const on = ON.some((re) => re.test(rest));
  if (on && (off || UNCLEAR.test(s) || PAST.test(s))) return "unclear";
  if (on) return "on";
  if (off) return "off";
  return MENTION.test(s) ? "unclear" : null;
}

/**
 * A note's word on a minutes restriction. Returns null when it does not mention one, else { state: "on" | "off" | "unclear", cap (the number it gives, a range's upper end; null with none),
 * range ([lo, hi] or null), several (the disagreeing figures when it gives more than one, else null), sentence (the deciding one, with the next when the number came from it) }. The last sentence
 * that reads on or off decides; "unclear" only when no sentence does. An "on" sentence with no figure takes one from the next sentence of the note when that sentence says nothing of a
 * restriction itself ("...on a minutes restriction. Expect about 20 minutes.", review 11-19). Pure.
 */
export function readRestriction(text) {
  const list = sentences(text);
  let last = null, unclear = null;
  list.forEach((s, i) => {
    const st = sentenceState(s);
    if (st === "on" || st === "off") last = { state: st, sentence: s, i }; else if (st === "unclear") unclear ??= s;
  });
  if (!last) return unclear ? { state: "unclear", cap: null, range: null, several: null, sentence: unclear } : null;
  if (last.state === "off") return { state: "off", cap: null, range: null, several: null, sentence: last.sentence };
  const own = restrictionNumber(last.sentence), next = list[last.i + 1];
  if (own.cap === null && !own.several && next && sentenceState(next) === null) {
    const n = restrictionNumber(next);
    if (n.cap !== null || n.several) return { state: "on", ...n, sentence: `${last.sentence} ${next}` };
  }
  return { state: "on", ...own, sentence: last.sentence };
}

const SOURCE = "Monster news";
const when = (at) => isoToEastern(at) ?? "time not given";
const noteText = (c) => [c.word, c.body].filter((x) => typeof x === "string" && x.trim()).join(". ");

/** The why line's head for a restriction in force: "Minutes restriction (Monster news, 5:25 PM ET): capped at 20" (and its range or Adam's default said). */
export function restrictionWords(mr) {
  const head = `Minutes restriction (${mr.source}, ${when(mr.at)})`;
  const newer = mr.newer_unread ? ` (a newer note, ${when(mr.newer_unread)}, could not be read; the earlier restriction still applies)` : ""; // review 11-19: said wherever the cap is
  if (mr.number !== null) return `${head}: capped at ${mr.cap}${mr.range ? `, the upper end of ${mr.range[0]}-${mr.range[1]} minutes` : ""}${newer}`;
  return `${head}, ${mr.several ? `several figures given (${mr.several.join(", ")}), so no number read` : "no number given"}: capped at ${mr.cap} (Adam's default)${newer}`;
}

// Names in a note's words (prose, so not lib/names.js's keys, which the page cannot load): accent-free lowercase words, a possessive's 's and the generational suffix dropped.
const SUFFIX = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
const plainText = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const words = (s) => plainText(s).replace(/['’]s\b/g, "").toLowerCase().replace(/['’.]/g, "").replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
const nameWords = (name) => { const w = words(name); while (w.length > 1 && SUFFIX.has(w.at(-1))) w.pop(); return w; };
const lastWord = (name) => { const w = plainText(name).replace(/[.,'’]/g, "").split(/\s+/).filter(Boolean); while (w.length > 1 && SUFFIX.has(w.at(-1).toLowerCase())) w.pop(); return w.at(-1) ?? ""; };
const flat = (s) => plainText(s).replace(/['’.]/g, ""); // positions are read on this one text
/** Where `sentence` names the man (character positions in flat(sentence)): his full name, or his last name as written (capitalised; `lastOk` false when another man in the pool shares it). */
function namedAt(sentence, name, lastOk = true) {
  const t = flat(sentence), at = [], full = nameWords(name).map((w) => w.replace(/[^a-z0-9]/g, "")).filter(Boolean), last = lastWord(name).replace(/[^A-Za-z0-9]/g, "");
  if (full.length) for (const m of t.matchAll(new RegExp(`(?<![A-Za-z])${full.join("[^A-Za-z0-9]+")}(?![A-Za-z])`, "gi"))) at.push(m.index);
  if (lastOk && last.length > 1) for (const m of t.matchAll(new RegExp(`(?<![A-Za-z])${last}(?![A-Za-z])`, "g"))) at.push(m.index);
  return at;
}
/** Where the restriction phrase starts in flat(sentence), or -1. */
const phraseAt = (sentence) => { const t = flat(sentence); const hits = ON.map((re) => t.search(re)).filter((i) => i >= 0); return hits.length ? Math.min(...hits) : -1; };

/** The men a note may name: tonight's board (with ids), the slate's Out list and the cards' own men (no id unless the card has one); one entry per team and name. */
function namePool(roster, cards) {
  const pool = new Map(), add = (name, team, id) => { if (typeof name !== "string" || !name.trim()) return; const k = `${team}|${nameWords(name).join(" ")}`; const e = pool.get(k); if (!e) pool.set(k, { name, team: team ?? null, id: id ? String(id) : null }); else if (!e.id && id) e.id = String(id); };
  for (const p of roster?.players ?? []) add(p.name, p.team, p.dk_id);
  for (const o of roster?.out ?? []) add(o.name, o.team, null);
  for (const c of cards) add(c?.name, c?.team, c?.dk_id);
  const list = [...pool.values()], lastCount = new Map();
  for (const p of list) lastCount.set(lastWord(p.name), (lastCount.get(lastWord(p.name)) ?? 0) + 1);
  return list.map((p) => ({ ...p, lastOk: lastCount.get(lastWord(p.name)) === 1 }));
}

/**
 * Whose restriction a card's deciding sentence is (the lead for Adam, 11-19: a card about one man may speak of a teammate's): the card's man when the sentence names no other man; when it names
 * one or more, the man named nearest before the restriction phrase (else nearest after it), so "With Duren on a minutes restriction, Cunningham..." is Duren's; that man must be on tonight's board
 * (an id), else nobody ({ unclear: names }). Returns { id, team, name } | { unclear: [names] }.
 */
export function subjectOf(card, sentence, pool) {
  const key = card.name ? nameWords(card.name).join(" ") : null, byName = key && !card.dk_id ? pool.find((p) => p.id && p.team === card.team && nameWords(p.name).join(" ") === key) : null; // review 11-19: a card with no id joins the board by name and team
  const self = { id: card.dk_id ? String(card.dk_id) : byName?.id ?? null, team: card.team, name: card.name ?? "a man" };
  if (!card.name) return self;
  const own = nameWords(card.name).join(" "), others = pool.filter((p) => nameWords(p.name).join(" ") !== own).map((p) => ({ p, at: namedAt(sentence, p.name, p.lastOk) })).filter((x) => x.at.length);
  if (!others.length) return self;
  const mine = namedAt(sentence, card.name), cands = [...(mine.length ? [{ p: self, at: mine, self: true }] : []), ...others], ph = phraseAt(sentence);
  const before = (x) => Math.max(-1, ...x.at.filter((i) => ph < 0 || i < ph)), after = (x) => Math.min(Infinity, ...x.at.filter((i) => ph >= 0 && i > ph));
  const pre = cands.filter((x) => before(x) >= 0).sort((a, b) => before(b) - before(a)), post = cands.filter((x) => after(x) < Infinity).sort((a, b) => after(a) - after(b));
  const pick = pre[0] ?? post[0];
  if (pick?.self) return self;
  if (pick?.p.id) return { id: pick.p.id, team: pick.p.team, name: pick.p.name };
  return { unclear: (pick ? [pick.p] : others.map((x) => x.p)).map((p) => p.name) };
}

/**
 * Each man's minutes restriction tonight for `team` from the news cards: { byId: Map dk_id -> { cap, number (the note's own figure or null), range, several, default (true with no number),
 * source, at, text, words }, notes: [text] }. The man is the one the deciding sentence is about (subjectOf; roster: { players, out } of the slate, for the names). The newest card that reads on or
 * off for a man decides (an "off" one clears him); a card that mentions a restriction but reads neither, or names men it cannot put on one board man, is named in the notes (G62) when no later card
 * decided; a card from before `day` (the slate's Eastern date) is not used, counted in the notes; a card about a man with no DraftKings id cannot be put on him, named. Pure.
 */
export function restrictionsFor(cards, team, day, roster = null) {
  const byId = new Map(), notes = [], older = [], noTime = [], per = new Map(), all = (Array.isArray(cards) ? cards : []).filter((c) => c && typeof c === "object"), pool = namePool(roster, all);
  for (const c of all) {
    const r = readRestriction(noteText(c));
    if (!r) continue;
    const ms = Date.parse(c.at ?? ""), name = c.name ?? "a man", mine = c.team === team;
    if (!Number.isFinite(ms)) { if (mine) noTime.push(name); continue; } // review 11-19: a note with no time cannot be ordered or put on a night
    const who = subjectOf(c, r.sentence, pool);
    if (who.unclear) { if (mine) notes.push(`Minutes restriction note in ${name}'s card (${SOURCE}, ${when(c.at)}) names ${who.unclear.join(", ")}, and cannot be put on one man on tonight's board, so it sets no flag or cap: "${r.sentence}"`); continue; }
    if (who.team !== team && !mine) continue;
    if (day && etDay(ms) < day) { if (mine) older.push(`${who.name} (${etDay(ms)})`); continue; }
    if (!who.id) { if (mine) notes.push(`Minutes restriction note on ${who.name} (${SOURCE}, ${when(c.at)}) not used: he is not matched to a man on tonight's board`); continue; }
    if (who.team !== team) continue; // another team's man named in this team's card: flagged on his own team's read
    if (!per.has(who.id)) per.set(who.id, []);
    per.get(who.id).push({ c, r, who: who.name, ms });
  }
  for (const [id, list] of per) {
    list.sort((a, b) => b.ms - a.ms);
    const k = list.findIndex((x) => x.r.state !== "unclear");
    for (const x of k < 0 ? list : list.slice(0, k)) notes.push(`Minutes restriction note on ${x.who} (${SOURCE}, ${when(x.c.at)}) not read as on or off, so it sets no flag or cap: "${x.r.sentence}"`);
    const d = list[k];
    if (!d || d.r.state !== "on") continue;
    const mr = { cap: d.r.cap ?? MR_DEFAULT_CAP, number: d.r.cap, range: d.r.range, several: d.r.several, default: d.r.cap === null, source: SOURCE, at: d.c.at ?? null, text: d.r.sentence, newer_unread: k > 0 ? list[0].c.at : null };
    byId.set(id, { ...mr, words: restrictionWords(mr) });
    if (d.r.several) notes.push(`${d.who}'s minutes restriction note (${SOURCE}, ${when(d.c.at)}) gives several figures (${d.r.several.join(", ")}), so no number is read: capped at ${MR_DEFAULT_CAP} (Adam's default)`);
  }
  if (noTime.length) notes.push(`${noTime.length} minutes restriction note${noTime.length === 1 ? "" : "s"} with no time, not used: ${noTime.join(", ")}`);
  if (older.length) notes.push(`${older.length} minutes restriction note${older.length === 1 ? "" : "s"} from before tonight not used (a restriction counts for its own night only): ${older.join(", ")}`);
  return { byId, notes };
}

/**
 * The cap in the plan (tiers.js manFinish), after the 36 cap and his overrides: every limit takes the lower of its own and the restriction's cap, so his minutes are the lower of what the plan gives
 * him and the cap, and freed minutes go to his teammates by the fill's rules. Every restricted man is "limited" (review 11-19): min(his figure, the cap), never topped up by the fill (a trim over 240 may
 * still take from him). A standing usual override is his figure and is cut the same way (`standing`: said); tonight's typed minutes replace all of it after the plan (figures.js).
 * mr: the man's restriction or null. lim: { value, cap, fillCeiling, max, limited, standing }. Returns lim unchanged with no restriction, else { ...lim (lowered), cut (minutes the cap took, 0 when under it), words }. Pure.
 */
export function restrictionStep(mr, lim) {
  if (!mr || !okCap(mr.cap)) return { ...lim, cut: 0, words: "" };
  const c = mr.cap, has = typeof lim.value === "number" && Number.isFinite(lim.value), cut = has && lim.value > c + 1e-9 ? lim.value - c : 0;
  const r1 = (v) => Math.round(v * 10) / 10;
  const words = !has ? `; ${mr.words}` : cut ? `; ${mr.words}: -${r1(cut)}${lim.standing ? ` (your standing figure ${r1(lim.value)} cut by tonight's restriction)` : ""}` : `; ${mr.words}: his ${r1(lim.value)} is under it, so it stands and takes no fill (the cap is a ceiling only)`;
  return { value: cut ? c : lim.value, cap: Math.min(lim.cap, c), fillCeiling: Math.min(lim.fillCeiling, c), max: Math.min(lim.max, c), limited: lim.limited || has, cut, words };
}
