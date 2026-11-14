// The News tab's data (Adam picked the mock-up 11-09): for each game of the slate its two teams, each team's starting five (Confirmed or Expected, and who said so), bench and
// Out men with their status, injury note, TwoGun's and our minutes, his own mark and the change since the last pull, plus the log of announcements, newest first. Pure and
// DOM-free (tested in node; the same file runs on the public site). Every field comes from the slate file, the lineup read (news/lineups/latest.json, its monster_news.cards) or the
// console; one that is not there is null and drawn as a dash, never a stand-in. A lineup read too old to act on (staleOf) gives no Confirmed or Expected and no sources' statuses: the
// five is then TwoGun's own, and the board's status and the injury notes still show. Men are joined to cards by the DraftKings id the lineup read stored (matchMan), Out-list men
// (who have no id on the slate) by the Out entry's name the read stored (out_as); Out claims are the proposals' own (lineup-proposals.js claimsFor); TwoGun's minutes are tgMin, never his applied number.
import { staleOf, withFreshness, blockFresh, outVsFive, tgMin, claimsFor, NO_STATUS, BACKS_ONLY } from "./lineup-proposals.js";
import { newsRuling, newestStatusCards, statusNote, cleanBody } from "./news-status.js";
import { isOut } from "./figures.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const stampMs = (s) => { const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})([+-]\d{2})(\d{2})$/.exec(String(s ?? "")); return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}${m[5]}:${m[6]}`) : NaN; };

const ET_CLOCK = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const ET_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const ET_MD = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
/** The Eastern date of a moment, "2026-11-07". */
export const etDay = (ms) => ET_DAY.format(new Date(ms));
/**
 * A moment as the News tab says it, in ET: "7:05 PM" ("7:05p" compact); with the date ("Nov 8, 1:01 AM") when its Eastern day is not `day` (the slate's); only the date ("Nov 6") for a
 * time the site gave in whole days (`precision: "day"`), never a clock minute made up. null for no time.
 */
export function timeLabel(ms, { day = null, precision = "minute", compact = false, log = false } = {}) {
  if (!isNum(ms)) return null;
  if (precision === "day") return ET_MD.format(new Date(ms));
  const t = ET_CLOCK.format(new Date(ms)), c = compact ? t.replace(/ ([AP])M$/, (m, x) => x.toLowerCase()) : t;
  const other = day && etDay(ms) !== day;
  if (log) return other ? `${ET_MD.format(new Date(ms))} ${t.replace(/ ([AP])M$/, (m, x) => x.toLowerCase())}` : t; // the log column: the full clock, or a short date and clock on another day
  return other ? `${ET_MD.format(new Date(ms))}, ${c}` : c;
}
const dayOf = (slate) => /^(\d{4}-\d{2}-\d{2})/.exec(String(slate?.slate ?? ""))?.[1] ?? null;

/** A status word as the chip says it and its class: Active, Probable, Questionable, Doubtful, Out, GTD, Has returned; any other word is kept as written (never a colour code). */
export function statusChip(word) {
  const w = String(word ?? "").replace(/\s*\(undetermined\)/i, "").trim();
  const low = w.toLowerCase();
  if (!w || low === "available" || low === "active" || low === "playing" || low === "starting" || low === "off injury report") return { word: "Active", cls: "ok" };
  if (low === "out" || low === "off") return { word: "Out", cls: "ou" };
  if (low === "probable") return { word: "Probable", cls: "pr" };
  if (low === "questionable") return { word: "Questionable", cls: "qu" };
  if (low === "doubtful") return { word: "Doubtful", cls: "db" };
  if (low === "gtd" || low === "game-time decision") return { word: "GTD", cls: "qu" };
  if (low === "has returned") return { word: "Has returned", cls: "rt" };
  return { word: w, cls: "xx" };
}
/** An Out-list man's chip: the word TwoGun gave, a dash when it gave none (never a green Active). */
const outChip = (status) => (String(status ?? "").trim() ? (isOut(status) ? { word: "Out", cls: "ou" } : statusChip(status)) : { word: "—", cls: "xx" });

const KINDS = [[{ test: isOut }, "OUT"], [/question/i, "Q"], [/doubt/i, "D"], [/probable/i, "PROB"], [/playing/i, "IN"], [/^note$/i, "NOTE"], [/^starting$/i, "START"]];
const kindOf = (label) => KINDS.find(([re]) => re.test(String(label ?? "")))?.[1] ?? "INFO";
const atOf = (c) => { const v = Date.parse(c?.at ?? ""); return Number.isNaN(v) ? null : v; };
/** The newest card of each man, by his id and by team|out_as (the Out-list name): a card with no time is only used when he has no other. */
function cardIndex(cards) {
  const byId = new Map(), byName = new Map();
  const better = (old, c) => !old || (atOf(c) ?? -Infinity) > (atOf(old) ?? -Infinity);
  for (const c of cards ?? []) {
    if (c.dk_id != null && better(byId.get(String(c.dk_id)), c)) byId.set(String(c.dk_id), c);
    const k = c.out_as ? `${c.team}|${c.out_as}` : null; // an Out-list man has no id: the lineup read stored the name of his Out entry
    if (k && better(byName.get(k), c)) byName.set(k, c);
  }
  return { byId, byName };
}
/** What a card says in short when it has no body: the site's own badge word ("Has Returned", "Starting"). */
const shortWord = statusNote; // "Probable: ankle", "Doubtful: hamstring"; any other card its own words (news-status.js)

/** The word that leads a log row's announcement, by the card's kind; a kind with none leads with "Note". */
const LEAD_OF = { OUT: "Out", Q: "Questionable", D: "Doubtful", PROB: "Probable", IN: "Playing", START: "START" };
/** The injury words of a card made short and tidy for a row: the coach's sentence after " - " is left to the hover, "g league" is "G League". null with no words. */
export function tidyInjury(body) {
  const s = String(cleanBody(body) ?? "").split(/\s+-\s+/)[0].replace(/\bg league\b/gi, "G League").replace(/\btwoway\b/gi, "two-way").replace(/\s+/g, " ").trim();
  return s || null;
}
/** A move of a figure for a row: "30.9 → 30.8 ▼" (no arrow when it did not change). */
const moveText = (x) => `${x.from.toFixed(1)} → ${x.to.toFixed(1)}${x.to > x.from ? " ▲" : x.to < x.from ? " ▼" : ""}`;

/**
 * The log's entries from the lineup read's Monster cards: [{ at (ms or null), time (its label), kind, team, text, effect, flag, src, id }], newest first, a card with no time last.
 * `effect` says what the report did, in plain words with arrows and icons (`effectTitle` is its hover), and only where the pulls can say it: the pulls compared are pull_changes.prev and .pull. A report between them is followed by TwoGun's move of
 * his minutes, else "TwoGun hasn't moved him yet"; one after the newest pull is "Newer than your last pull"; one older than the earlier pull makes no claim. `text` leads with Out / START / Questionable ...; `title` is the card's whole words. `flag` (amber,
 * "TwoGun has not reacted yet") is true for the last two kinds that have news to show: a report between the pulls with no move, a report after the newest pull, and a report that a man on
 * the Out list is back (any card but an Out) newer than the earlier pull. Without a pull comparison nothing is flagged. Ours does not count: only TwoGun's move does.
 */
export function feedEntries({ cards, players, out, pullChanges, day = null }) {
  const byId = new Map((players ?? []).map((p) => [String(p.dk_id), p]));
  const outBy = new Map((out ?? []).map((o) => [`${o.team}|${o.name}`, o]));
  const pc = pullChanges?.state === "ready" ? { prev: stampMs(pullChanges.prev), now: stampMs(pullChanges.pull) } : null;
  const t = (ms) => timeLabel(ms, { day });
  const entries = (Array.isArray(cards) ? cards : []).map((c) => {
    const at = atOf(c), p = c.dk_id != null ? byId.get(String(c.dk_id)) : null, o = c.out_as ? outBy.get(`${c.team}|${c.out_as}`) : null, kind = kindOf(c.label);
    const known = pc && Number.isFinite(pc.prev) && Number.isFinite(pc.now) && at != null;
    let effect = "Not on tonight's slate", effectTitle = "No player on this slate matches this report", flag = false;
    if (p) {
      const tg = tgMin(p), mins = isNum(tg) ? `${tg.toFixed(1)} min` : null, mv = p.pull_move;
      if (!known || at < pc.prev) { effect = mins ?? "—"; effectTitle = "TwoGun's minutes for him now; this report is older than the pulls compared, so no change is claimed"; } // older than the pulls compared, or no comparison: no claim
      else if (at > pc.now) { effect = "🕒 Newer than your last pull — press Pull now"; effectTitle = `Reported after the ${t(pc.now)} pull, so it is not in the numbers yet${mins ? `; TwoGun has him at ${mins}` : ""}`; flag = true; }
      else if (mv?.min) { effect = `Minutes ${moveText(mv.min)}${mv.proj ? ` · pts ${moveText(mv.proj)}` : ""}`; effectTitle = "TwoGun's move between the last two pulls"; }
      else { effect = `⚠️ TwoGun hasn't moved him yet${mins ? ` (${mins})` : ""}`; effectTitle = `No change in TwoGun's minutes since the ${t(pc.prev)} pull`; flag = true; }
    } else if (o) {
      const back = kind !== "OUT" && kind !== "NOTE";
      if (back && known && at >= pc.prev) { effect = `⚠️ Listed Out, report says ${c.word ?? c.label ?? "something else"} — check him`; effectTitle = "He is on TwoGun's Out list but this report says otherwise; TwoGun has not changed him yet"; flag = true; }
      else { effect = `🚫 Out${isNum(o.usual_minutes) ? ` · usually ${o.usual_minutes.toFixed(1)} min` : ""}`; effectTitle = "On TwoGun's Out list; his usual minutes are taken off the board"; }
    }
    const body = c.body ?? null, said = tidyInjury(body), gl = /g[ -]?league/i.test(`${c.word ?? ""} ${c.label ?? ""} ${body ?? ""}`); // a G League assignment or two-way deal means he is not with the team: never "Playing"
    const lead = gl ? "G League" : LEAD_OF[kind];
    const glSaid = said?.replace(/^G League\s*/, "") ?? "";
    const text = gl ? `G League: ${c.name}${glSaid ? ` — ${glSaid}` : ""}` : lead ? `${lead}: ${c.name}${said ? ` — ${said}` : ""}` : `Note: ${c.name} — ${[c.word ?? c.label, said].filter(Boolean).join(", ")}`;
    return { at, time: timeLabel(at, { day, precision: c.precision, log: true }), kind: gl ? "NOTE" : kind, team: c.team, text, title: `${c.name}: ${[c.word ?? c.label, body].filter(Boolean).join(" — ")}`, effect, effectTitle, flag, src: "Monster", id: c.id };
  });
  return entries.sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity));
}

/**
 * The lineup changes the app's own 5-minute lineup check found (latest.json found_by_check, written by server/pullnow/lineup-sync.js): log rows with their time and "found by the 5-minute lineup check".
 * A find for a team not on the slate, or one with no readable time, is left out of the log. Same row shape as feedEntries. Pure.
 */
export function foundEntries(found, teams, day = null) {
  return (Array.isArray(found) ? found : []).map((f, i) => {
    const at = Date.parse(f?.at ?? "");
    if (!Number.isFinite(at) || typeof f?.text !== "string" || (f.team != null && !teams.has(f.team))) return null;
    return { at, time: timeLabel(at, { day, log: true }), kind: "NOTE", team: f.team ?? "", text: `Lineup: ${f.text}`, title: `${f.text} (found ${timeLabel(at, { day })} ET)`, effect: `found by the ${f.by === "5-minute lineup check" ? "5-minute lineup check" : String(f.by ?? "lineup check")}`, effectTitle: "The app read the lineup pages itself and saw this change; no pull was pressed", flag: false, src: "Lineups", id: `found-${f.at}-${i}` };
  }).filter(Boolean);
}

/**
 * The News tab's foot lines about the 5-minute lineup check (G62, G64: at the bottom, not the main view): when it last looked and what it found, a site it could not read and why, a site or team whose saved five it kept
 * (check_failed), and a damaged finds file. `latest`: the lineup read with the check's finds file attached (server/slate/news-lineups.js). [] with nothing to say. Pure.
 */
export function checkFoot(latest, day = null) {
  const out = [], lc = latest?.last_check, name = { monster: "Monster", rotowire: "RotoWire", rotogrinders: "RotoGrinders", monster_news: "Monster news" };
  if (lc?.at) {
    const at = Date.parse(lc.at);
    out.push(`Lineup check (${lc.how ?? "5-minute check"}) at ${timeLabel(at, { day }) ?? "?"} ET: ${lc.result ?? "no result"}${lc.skipped_count ? `; ${lc.skipped_count} part${lc.skipped_count === 1 ? "" : "s"} of the pages not usable (${(lc.skipped_first ?? []).join("; ")}${lc.skipped_count > (lc.skipped_first ?? []).length ? "; …" : ""})` : ""}.`);
    for (const f of lc.failed ?? []) out.push(`${name[f.src] ?? f.src} was not read by the check: ${f.why}.`);
  }
  for (const [src, s] of Object.entries(latest?.sources ?? {})) if (s?.check_failed) out.push(`${name[src] ?? src}: the saved read from before was kept (${s.check_failed.why}).`);
  const teams = Object.entries(latest?.teams ?? {}).flatMap(([t, b]) => Object.entries(b ?? {}).filter(([k, v]) => v?.check_failed && !latest?.sources?.[k]?.check_failed).map(([k, v]) => `${t} ${name[k] ?? k}: ${v.check_failed.why}`));
  if (teams.length) out.push(`Saved fives kept because the page no longer listed them: ${teams.join("; ")}.`);
  for (const p of latest?.card_status_problems ?? []) out.push(`Status cards: ${p}.`);
  for (const s of latest?.card_status_skipped ?? []) out.push(`Status card for ${s.name ?? s.id} set aside: ${s.why}.`);
  if (latest?.found_unreadable) out.push(`The lineup check's finds could not be shown: ${latest.found_unreadable}.`);
  return out;
}

/** A man's mark in words from the console's marks for his team: Out, Bench, S, or his typed minutes (m) or DK per minute (d); null with none. */
export function markOf(view, team, id) {
  const m = view?.[team]?.marks;
  if (!m) return null;
  const has = (k) => Array.isArray(m[k]) && m[k].includes(String(id));
  if (has("out")) return "Out";
  if (has("benched")) return "Bench";
  if (has("s")) return "S";
  if (has("typed")) {
    const tm = m.typedMin?.[String(id)], tr = m.typedRate?.[String(id)];
    return isNum(tm) ? `m ${tm.toFixed(1)}` : isNum(tr) ? `d ${tr.toFixed(2)}` : "typed";
  }
  return null;
}

/** When each lineup page was read, in ms (null when the file has none): the pages carry no announced time, so the News tab shows it as "as of" beside the five; and the two pulls the last-pull change compares (the column head names the earlier). Cards carry their own announced time. */
export function asOfTimes({ slate, latest }) {
  const iso = (t) => { const v = Date.parse(t ?? ""); return Number.isNaN(v) ? null : v; };
  const pc = slate?.pull_changes?.state === "ready" ? slate.pull_changes : null;
  return { monster: iso(latest?.sources?.monster?.fetched_at), rotowire: iso(latest?.sources?.rotowire?.fetched_at), rotogrinders: iso(latest?.sources?.rotogrinders?.fetched_at), pullPrev: pc ? stampMs(pc.prev) : null, pullNow: pc ? stampMs(pc.pull) : null };
}

const money = (n) => (isNum(n) ? `$${(n / 1000).toFixed(1)}K` : null);
const SOURCE = [["monster", "Monster"], ["rotowire", "RotoWire"], ["rotogrinders", "RotoGrinders"]];

/**
 * One team: { code, five: { kind: "confirmed" | "expected" | "disagree" | "uncompared" (a man with no id on the slate, so the fives cannot be compared) | "twogun", by: [the sources whose five is the one shown], differs: [sources whose five is not], at: { source: read ms },
 * unmatched: [names in the five with no id on the slate] }, asOf, day, starters, bench, outs, counts }. A man a fresh read says is Out (the proposals' claims: Out in a five, on MAY NOT
 * PLAY, or in Monster's news) is chipped Out and is not in the five.
 */
export function teamModel({ code, players, out, latest, stale, cards, view, asOf = {}, day = null }) {
  const mine = (players ?? []).filter((p) => p.team === code);
  const block = latest?.teams?.[code] ?? {}; // with every source stale the fives are still not used (usable), but the kept Outs are (claims)
  const ok = (b) => b?.state === "ok" && Array.isArray(b.men);
  const usable = SOURCE.filter(([k]) => ok(block[k]) && blockFresh(latest, k, block[k])); // a source no longer fresh gives no five, only its kept Outs (claimsFor)
  const confirmed = usable.filter(([k]) => block[k].confirmed && (!BACKS_ONLY.includes(k) || usable.some(([j]) => j !== k && block[j].confirmed))); // a back-only page's confirmed mark never stands alone
  const use = confirmed.length ? confirmed : usable;
  const idsOf = (k) => new Set(block[k].men.filter((m) => m.id != null && m.status !== "Out").map((m) => String(m.id)));
  const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
  const claims = !latest ? null : claimsFor(latest, code), contested = new Set(claims ? outVsFive(claims).map((c) => String(c.id)) : []); // a man two fresh feeds dispute, or a kept Out a fresh five cancelled, is not shown or counted as Out
  const doubtfulOnly = (id) => (claims?.out.get(String(id)) ?? []).every((c) => /^Doubtful\b/.test(c.detail ?? "")); // a Doubtful card made every Out claim: the row says Doubtful
  const claimedOut = (id) => Boolean(claims?.out.has(String(id))) && !contested.has(String(id));
  // A man the five shows whom another feed says is Out is not settled: the Out claim comes from a different feed than a claim that he is in a five (the proposals' outVsFive test), or
  // every Out claim on him is a near-name match, which the proposals refuse to act on. The feeds saying Out are named.
  const FEED = { monster: "Monster", rotowire: "RotoWire", rotogrinders: "RotoGrinders", monster_news: "Monster news" };
  const unsettledFeeds = (id) => {
    const outs = claims?.out.get(String(id));
    if (!outs) return [];
    const clash = (claims.five.get(String(id)) ?? []).some((f) => !NO_STATUS.includes(f.key) && outs.some((o) => o.key !== f.key)); // a page with no statuses cannot contradict an Out
    return clash || outs.every((o) => o.near) ? [...new Set(outs.map((o) => FEED[o.key] ?? o.key))] : [];
  };
  let five = new Set(), by = [], differs = [], unmatched = [], uncompared = false;
  if (use.length) {
    // A name-match miss (a man with no id on the slate) in any source means fives cannot be compared by their ids: that is not a disagreement.
    uncompared = use.length > 1 && use.some(([k]) => block[k].men.some((m) => m.id == null));
    // The five shown is the one most of the pages agree on (Monster's, then the page order, on a tie), so with three pages two that agree outvote one.
    const agree = (a) => use.filter(([k]) => !uncompared && same(idsOf(k), idsOf(a[0]))).length;
    const [k0, n0] = uncompared ? use[0] : use.reduce((best, u) => (agree(u) > agree(best) ? u : best), use[0]);
    five = idsOf(k0); by = [n0];
    if (uncompared) by = use.map(([, n]) => n);
    else for (const [k, n] of use) if (k !== k0) (same(idsOf(k), five) ? by : differs).push(n);
    for (const id of five) for (const n of unsettledFeeds(id)) if (!differs.includes(n)) differs.push(n);
    unmatched = block[k0].men.filter((m) => m.id == null).map((m) => m.name);
  }
  const keyOfName = Object.fromEntries(SOURCE.map(([k, n]) => [n, k]));
  const source = use.length
    ? { kind: uncompared ? "uncompared" : differs.length ? "disagree" : confirmed.length ? "confirmed" : "expected", by, differs, at: Object.fromEntries(by.map((n) => [n, asOf[keyOfName[n]] ?? null])), unmatched }
    : { kind: "twogun", by: [], differs: [], at: {}, unmatched: [] };
  const srcStatus = new Map(); // dk_id -> a status word a lineup source gave him
  for (const [k] of usable) for (const m of block[k].men) if (m.id != null && m.status && m.status !== "Out" && m.status !== "Starting" && m.status !== "Playing" && m.status !== "Off injury report") srcStatus.set(String(m.id), m.status);
  const { byId: cardById, byName: cardByName } = cardIndex((cards ?? []).filter((c) => c.team === code));
  const statusCards = newestStatusCards((cards ?? []).filter((c) => c.team === code));
  const srcReadAt = Math.max(asOf.monster ?? -Infinity, asOf.rotowire ?? -Infinity, asOf.rotogrinders ?? -Infinity);
  const row = (p) => {
    // The newest news ruling shows on the row unless a lineup page read after the card says otherwise (news-status.js holds the rule).
    const ruled = stale ? null : newsRuling({ card: statusCards.get(String(p.dk_id)), tgStatus: p.injury_status, tgSince: p.status_since ?? null, viewOut: markOf(view, code, p.dk_id) === "Out" || (view?.[code]?.newsOut ?? []).includes(String(p.dk_id)) });
    const fromSource = srcStatus.get(String(p.dk_id)), useRuling = ruled && !(fromSource && srcReadAt > ruled.at);
    const tgWord = p.injury_status && p.injury_status !== "Available" ? p.injury_status : null;
    const word = claimedOut(p.dk_id) ? (doubtfulOnly(p.dk_id) ? "Doubtful" : "Out") : useRuling ? ruled.word : fromSource ?? tgWord;
    const mv = p.pull_move ?? null, card = cardById.get(String(p.dk_id));
    return {
      id: String(p.dk_id), name: p.name, pos: Array.isArray(p.positions) && p.positions.length ? p.positions.join("/") : null, salary: money(p.salary), status: statusChip(word),
      note: shortWord(card), noteAt: atOf(card), notePrecision: card?.precision ?? "minute", // the newest report on him: his note and any change of status carry its time
      tg: isNum(tgMin(p)) ? tgMin(p) : null, ours: isNum(p.min_ours) ? p.min_ours : null, mark: markOf(view, code, p.dk_id),
      delta: mv && (mv.min || mv.proj) ? { min: mv.min ?? null, proj: mv.proj ?? null } : null, out: false,
    };
  };
  const inFive = (p) => (source.kind === "twogun" ? p.starter === true : five.has(String(p.dk_id)) && !claimedOut(p.dk_id) && !contested.has(String(p.dk_id))); // a disputed man is neither Out nor in the five
  const byMin = (a, b) => (tgMin(b) ?? -1) - (tgMin(a) ?? -1) || a.name.localeCompare(b.name);
  const starters = mine.filter(inFive).sort(byMin).map(row), bench = mine.filter((p) => !inFive(p)).sort(byMin).map(row);
  const outs = (out ?? []).filter((o) => o.team === code).sort((a, b) => (b.usual_minutes ?? -1) - (a.usual_minutes ?? -1)).map((o) => {
    const card = cardByName.get(`${code}|${o.name}`);
    return {
      id: null, name: o.name, pos: null, salary: o.salary_text ?? null, status: outChip(o.status), note: o.reason ?? shortWord(card),
      noteAt: !o.reason || kindOf(card?.label) === "OUT" ? atOf(card) : null, notePrecision: card?.precision ?? "minute", // the card's time only beside the card's own words, or an Out report; never beside TwoGun's reason for another report
      tg: null, usual: isNum(o.usual_minutes) ? o.usual_minutes : null, ours: null, mark: null, delta: null, out: true,
    };
  });
  const questionable = [...starters, ...bench].filter((r) => ["qu", "db"].includes(r.status.cls)).length;
  return { code, five: source, asOf, day, starters, bench, outs, counts: { onSlate: starters.length + bench.length, out: outs.length, questionable } };
}

/**
 * The page's model. slate: the slate as the board holds it (games, players with pull_move and min_ours, out, pull_changes); latest: the lineup read or null; nowMs: the server's
 * clock; view: the console's lineupView; tip(text) -> "7:30 PM ET" and tipAt(text) -> ms (board-util). Returns { games, log, stale, hasRead, asOf, day, orphans } where orphans lists
 * the teams that have players or Out men on the slate but no game row, so none of them vanish: [{ team, players, outs }].
 */
export function newsModel({ slate, latest: latestIn, nowMs, view, tip = (t) => t, tipAt = () => null }) {
  const latest = withFreshness(latestIn, nowMs); // each source judged on its own
  const stale = latest ? Boolean(staleOf(latest, nowMs)) : true;
  const cards = Array.isArray(latest?.monster_news?.cards) ? latest.monster_news.cards : [];
  const asOf = asOfTimes({ slate, latest }), day = dayOf(slate);
  const games = (slate?.games ?? []).map((g) => {
    const t0 = tipAt(g.tip), status = !isNum(t0) ? null : nowMs < t0 ? "Pregame" : "Started";
    const make = (code) => teamModel({ code, players: slate.players, out: slate.out, latest, stale, cards, view, asOf, day });
    return { game: g.game, away: make(g.away), home: make(g.home), tip: tip(g.tip), status, line: g.line ?? null };
  });
  const inGames = new Set((slate?.games ?? []).flatMap((g) => [g.home, g.away]));
  const orphanTeams = new Map();
  for (const p of slate?.players ?? []) if (!inGames.has(p.team)) orphanTeams.set(p.team, { team: p.team, players: (orphanTeams.get(p.team)?.players ?? 0) + 1, outs: orphanTeams.get(p.team)?.outs ?? 0 });
  for (const o of slate?.out ?? []) if (!inGames.has(o.team)) orphanTeams.set(o.team, { team: o.team, players: orphanTeams.get(o.team)?.players ?? 0, outs: (orphanTeams.get(o.team)?.outs ?? 0) + 1 });
  const teams = new Set([...inGames, ...orphanTeams.keys()]);
  const log = [...feedEntries({ cards: cards.filter((c) => teams.has(c.team)), players: slate?.players, out: slate?.out, pullChanges: slate?.pull_changes, day }), ...foundEntries(latest?.found_by_check, teams, day)].sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity));
  return { games, log, stale, hasRead: Boolean(latest), asOf, day, orphans: [...orphanTeams.values()], foot: checkFoot(latest, day) };
}
