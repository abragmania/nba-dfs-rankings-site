// Which injury status a board row shows when the news and TwoGun disagree (Adam, 11-10, after Jarrett Allen's IN at 6:12 PM ET reached the news panel and not his row).
// RULE (11-10): a man's newest Monster news card that gives a status (Playing = Available, Questionable, Doubtful, Probable) is the ruling the row shows, in place of TwoGun's injury_status, with these exceptions:
// (1) TwoGun's status stands when it last changed AFTER the card: `tgSince` is the time of the earliest saved pull in the unbroken run of his current status (status-since.js walks the pulls back, a move to calm
// counts, a minutes-only pull after a move does not reset it), so a Q card at 4:30 then TwoGun Available at 6:00 shows Available, and a Playing card at 4:30 then TwoGun Doubtful at 5:00 stays Doubtful through a
// minutes-only pull at 5:30. A TwoGun status that has been the same since before the card is a lag and never beats it, however old the card. With no `tgSince` (no saved pulls) the card wins. (2) A card never overrides
// TwoGun's Out, and a news ruling is never shown for a man the board holds Out (the console's Out, news-applied or Adam's own: viewOut), so a news IN cannot hide an Out he has. (3) A card that says what TwoGun already
// says changes nothing. A stale lineup read gives no card (the caller passes none). Where a lineup page's own flag and a card disagree, the one read or reported later wins (teamModel). A news Out still beats his typed
// numbers and S, and Adam's own Out is never touched: this file only changes the word shown. Pure.

const WORDS = [[/^playing$/i, "Available"], [/^question/i, "Questionable"], [/^doubt/i, "Doubtful"], [/^probable$/i, "Probable"]];
import { isOut } from "./figures.js";
const same = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
const calm = (s) => !String(s ?? "").trim() || same(s, "Available");

/** The status word a card gives, or null when its label is not a status the row shows (Out, Note, Starting, Has Returned ...). */
export const cardWord = (card) => WORDS.find(([re]) => re.test(String(card?.label ?? "")))?.[1] ?? null;

/** card: the man's newest card ({ label, body, at }); tgStatus: TwoGun's injury_status; tgSince: ms TwoGun's current status last changed (status-since.js) or null; viewOut: the board holds him Out.
 *  Returns { word, at, note } for the status to show in place of TwoGun's, or null to keep TwoGun's. */
export function newsRuling({ card, tgStatus, tgSince = null, viewOut = false }) {
  const word = cardWord(card);
  const at = Date.parse(card?.at ?? "");
  if (!word || !Number.isFinite(at) || viewOut) return null;
  if (isOut(tgStatus)) return null;
  if (Number.isFinite(tgSince) && tgSince > at) return null;
  if (same(word, tgStatus) || (calm(word) && calm(tgStatus))) return null;
  return { word, at, note: statusNote(card) };
}

const PLAY_PHRASE = /\b(?:not\s+)?expected\s+to\s+play\b/gi; // Probable already means "expected to play" and Doubtful "not expected to play": a note never repeats them (Adam 11-13)
const EDGE = /^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g;
/** A card's body without the play phrases and the separators they leave; null when nothing is left. */
export function cleanBody(body) {
  const s = String(body ?? "").replace(PLAY_PHRASE, " ").replace(/\s*([,;])(?:\s*[,;])+/g, "$1").replace(EDGE, "").replace(/\s+/g, " ").trim();
  return s || null;
}
/** The short note a status card gives a row: "Probable: ankle" or "Doubtful: hamstring" (status, then the body part; the coach's sentence after " - " is left to the hover), else the card's words, else its badge word. null with no card. */
export function statusNote(card) {
  if (!card) return null;
  const word = cardWord(card);
  if (word === "Probable" || word === "Doubtful") {
    const part = cleanBody(cleanBody(card.body)?.split(/\s+-\s+/)[0]);
    return part ? `${word}: ${part}` : word;
  }
  return cleanBody(card.body) ?? card.word ?? null;
}

/** The newest status-giving card of each man, by dk_id: a card with no time never wins. A newer Out card is kept too (it gives no word, so it blocks an older IN). */
export function newestStatusCards(cards) {
  const by = new Map();
  for (const c of cards ?? []) {
    if (c?.dk_id == null || !(cardWord(c) || isOut(c.label))) continue;
    const t = Date.parse(c.at ?? "");
    if (!Number.isFinite(t)) continue;
    const old = by.get(String(c.dk_id));
    if (!old || t > Date.parse(old.at)) by.set(String(c.dk_id), c);
  }
  return by;
}
