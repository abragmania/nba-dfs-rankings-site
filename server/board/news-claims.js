// What a man's newest Monster status card does to the lineup read's Out claims (Adam 11-13): a Doubtful card counts as Out (minutes 0, his minutes to teammates as an Out man's), a Probable or Playing
// card counts as In, and an upgrade (Out or Doubtful to Probable, Playing, Available) takes effect on the first read that holds the card. Probable alone changes nothing: he is In. A newer Questionable card
// ends a Doubtful claim (he plays) but is not an upgrade to In. Pure.
// withCardStatus returns the read with: monster_news.out gaining the men whose newest card says Doubtful (detail "Doubtful: <body part>"; claimsFor/newsOutsOf/makeProposals read them like any Out claim);
// a lineup page that was read before that card and lists him in its five has him flagged Out in that page ("Doubtful (card)") so the older five does not dispute the newer word; the news page's Out claim and
// the lineup pages' Out flags dropping a man whose newest card is an IN word and is newer than that page's last read (a page read after the card is the later word and stands); news_upgrades { id: { word, at, from } }
// (always present, {} when empty) naming every man whose newest card is an IN word over an older Doubtful or Out card, for the reversal (news-reverse.js); and card_status_skipped [{ id, name, why }] for every
// card set aside (G62). A man whose TwoGun status last changed after the card, or whom TwoGun has Out, is left to TwoGun (news-status.js rule); a man in `typed` (his own typed number, minutes or S) is never made
// Doubtful. Adam's own Out mark is not in the read and is never touched. A card with no DraftKings id is not acted on (as for any Out).
import { cardWord, newestStatusCards, cleanBody } from "./news-status.js";
import { isOut } from "./figures.js";
import { LINEUP_KEYS, keptMs, withFreshness } from "./lineup-proposals.js";

/** Whether a source's block was last read well before `at` (unknown: no, the page then stands). */
const readBefore = (fl) => (key, team, at) => { const ms = keptMs(fl, key, fl.teams?.[team]?.[key]); return Number.isFinite(ms) && ms < at; };
const IN_WORDS = new Set(["Available", "Probable"]); // cardWord maps Playing to Available

/** The Doubtful note of a card: "Doubtful: hamstring". */
const doubtfulDetail = (card) => {
  const part = cleanBody(cleanBody(card.body)?.split(/\s+-\s+/)[0]);
  return part ? `Doubtful: ${part}` : "Doubtful";
};

/** latest: the lineup read; players: the slate's men (dk_id, injury_status, status_since) or []; typed: Set of dk_ids he typed minutes, a number or an S mark on. Returns a new read (the argument is not changed), or the argument itself when there are no cards. */
export function withCardStatus(latest, { players = [], typed = new Set() } = {}) {
  const cards = latest?.monster_news?.cards;
  const plain = () => ({ ...latest, news_upgrades: {}, card_status_skipped: [] }); // no card to act on: the same shape, nothing in it
  if (!Array.isArray(cards) || !cards.length) return plain();
  const news = latest.monster_news, newsUsable = news.status === "ok" || (news.last_good_at && Array.isArray(news.out));
  if (!newsUsable) return plain(); // a news read that failed and kept nothing gives no claim to add or drop
  const by = new Map(players.map((p) => [String(p.dk_id), p]));
  const read = structuredClone(latest), upgrades = {}, skipped = [], fl = withFreshness(latest, Number.MAX_SAFE_INTEGER); // each page's last good read, whatever its age
  if (!Array.isArray(read.monster_news.out)) read.monster_news.out = [];
  const tableAt = Date.parse(news.fetched_at ?? news.last_good_at ?? ""); // when the news page's own status table was read
  const atOf = (c) => Date.parse(c?.at ?? "");
  const skip = (card, why) => skipped.push({ id: String(card.dk_id), name: card.name ?? null, why });
  for (const [id, card] of newestStatusCards(cards)) {
    const word = cardWord(card), at = atOf(card);
    if (!word || !Number.isFinite(at)) continue; // an Out card gives no word: it blocks an older IN (newestStatusCards) and adds nothing
    const p = by.get(id);
    if (p && isOut(p.injury_status)) continue; // TwoGun's Out stands
    if (p && Number.isFinite(p.status_since) && p.status_since > at) { if (word === "Doubtful") skip(card, "TwoGun changed his status after the card"); continue; }
    if (word === "Doubtful") {
      if (typed.has(id)) { skip(card, "you typed minutes, a number or an S mark on him"); continue; }
      if (!read.monster_news.out.some((m) => String(m.id) === id)) read.monster_news.out.push({ name: card.name, team: card.team, id, match: card.match ?? "exact", status: "Out", detail: doubtfulDetail(card), doubtful: true });
      for (const key of LINEUP_KEYS) { // a five read before the card does not dispute the later word (the later-word test, as for an IN card)
        const b = read.teams?.[card.team]?.[key];
        if (!b || !readBefore(fl)(key, card.team, at)) continue;
        for (const m of (b.men ?? []).filter((x) => String(x.id) === id && x.status !== "Out")) { m.status_was = m.status ?? null; m.status = "Out"; m.flag = "Doubtful (card)"; }
      }
    } else if (word === "Questionable") {
      // Adam 11-13: a Questionable card after a Doubtful one puts him back at once, playable (his minutes come back) but not marked In: an upgrade for the reversal, no claim.
      const before = cards.filter((c) => String(c.dk_id) === id && cardWord(c) && atOf(c) < at).sort((x, y) => atOf(y) - atOf(x))[0];
      if (before && cardWord(before) === "Doubtful") upgrades[id] = { word, at, from: ["monster_news_card"] };
    } else if (IN_WORDS.has(word)) {
      const from = [];
      const olderBad = cards.some((c) => String(c.dk_id) === id && (isOut(c.label) || cardWord(c) === "Doubtful") && atOf(c) < at);
      const listed = read.monster_news.out.filter((m) => String(m.id) === id);
      // The news page's own status list is the later word when his Out turned on it after the card (out_since, tools/lineups_read.mjs outSinceMap); a card newer than the start of that run wins. A read from before out_since was kept: the list's read time against the card.
      const cardWins = (e) => { const since = Date.parse(e.out_since ?? ""); return Number.isFinite(since) ? at > since : tableAt < at; };
      if (listed.some((e) => !cardWins(e))) { skip(card, "the news page's own status list turned him Out after the card, so the Out stays"); continue; } // before any page block is touched
      if (listed.length) { read.monster_news.out = read.monster_news.out.filter((m) => String(m.id) !== id); from.push("monster_news"); }
      for (const key of LINEUP_KEYS) {
        const b = read.teams?.[card.team]?.[key];
        if (!b || !readBefore(fl)(key, card.team, at)) continue; // a page read after the card is the later word
        const wasOut = (b.men ?? []).filter((m) => String(m.id) === id && m.status === "Out");
        for (const m of wasOut) { m.status_was = "Out"; m.status = word === "Probable" ? "Probable" : "Playing"; }
        const mnp = Array.isArray(b.may_not_play) ? b.may_not_play.filter((m) => String(m.id) !== id) : null;
        if (mnp && mnp.length !== b.may_not_play.length) { b.may_not_play = mnp; from.push(key); }
        if (wasOut.length) from.push(key);
      }
      if (olderBad && !from.length) from.push("monster_news_card"); // nothing to remove (a Doubtful card made no claim in the read), but he was Doubtful or Out and is not now
      if (from.length) upgrades[id] = { word, at, from: [...new Set(from)] };
    }
  }
  read.news_upgrades = upgrades;
  read.card_status_skipped = skipped;
  return read;
}
