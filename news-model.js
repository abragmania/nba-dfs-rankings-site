// The News tab's data (Adam picked the mock-up 11-09): for each game of the slate its two teams, each team's starting five (Confirmed or Expected, and who said so), bench and
// Out men with their status, injury note, TwoGun's and our minutes, his own mark and the change since the last pull, plus the log of announcements, newest first. Pure and
// DOM-free (tested in node; the same file runs on the public site). Every field comes from the slate file, the lineup read (news/lineups/latest.json, its monster_news.cards) or the
// console; one that is not there is null and drawn as a dash, never a stand-in. A lineup read too old to act on (staleOf) gives no Confirmed or Expected and no sources' statuses: the
// five is then TwoGun's own, and the board's status and the injury notes still show. Men are joined to cards by the DraftKings id the lineup read stored (matchMan), Out-list men
// (who have no id on the slate) by the Out entry's name the read stored (out_as); Out claims are the proposals' own (lineup-proposals.js claimsFor); TwoGun's minutes are tgMin, never his applied number.
import { staleOf, tgMin, claimsFor } from "./lineup-proposals.js";

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
const outChip = (status) => (String(status ?? "").trim() ? (/^out$/i.test(status) ? { word: "Out", cls: "ou" } : statusChip(status)) : { word: "—", cls: "xx" });

const KINDS = [[/^out$/i, "OUT"], [/question/i, "Q"], [/doubt/i, "D"], [/probable/i, "PROB"], [/playing/i, "IN"], [/^note$/i, "NOTE"], [/^starting$/i, "START"]];
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
const shortWord = (c) => (c ? c.body ?? c.word ?? null : null);

/**
 * The log's entries from the lineup read's Monster cards: [{ at (ms or null), time (its label), kind, team, text, effect, flag, src, id }], newest first, a card with no time last.
 * `effect` says what the report did, and only where the pulls can say it: the pulls compared are pull_changes.prev and .pull. A report between them is followed by TwoGun's move of
 * his minutes, else "no change since the <prev> pull"; one after the newest pull is "not yet in the numbers"; one older than the earlier pull makes no claim. `flag` (the amber dot,
 * "not yet accounted for") is true for the last two kinds that have news to show: a report between the pulls with no move, a report after the newest pull, and a report that a man on
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
    let effect = "not on this slate", flag = false;
    if (p) {
      const tg = tgMin(p), tgText = isNum(tg) ? `TG ${tg.toFixed(1)} min` : null, mv = p.pull_move, join = (x) => [tgText, x].filter(Boolean).join(", ");
      if (!known || at < pc.prev) effect = tgText ?? "—"; // older than the pulls compared, or no comparison: no claim
      else if (at > pc.now) { effect = join(`reported after the ${t(pc.now)} pull, not yet in the numbers`); flag = true; }
      else if (mv?.min) effect = `TG ${mv.min.from.toFixed(1)} → ${mv.min.to.toFixed(1)} min${mv.proj ? `, proj ${mv.proj.from.toFixed(1)} → ${mv.proj.to.toFixed(1)}` : ""}`;
      else { effect = join(`no change since the ${t(pc.prev)} pull`); flag = true; }
    } else if (o) {
      const back = kind !== "OUT" && kind !== "NOTE";
      if (back && known && at >= pc.prev) { effect = `on the Out list; this report says ${c.word ?? c.label ?? "something else"}: not yet accounted for`; flag = true; }
      else effect = `on the Out list (usual ${isNum(o.usual_minutes) ? o.usual_minutes.toFixed(1) : "?"} min struck)`;
    }
    return { at, time: timeLabel(at, { day, precision: c.precision, log: true }), kind, team: c.team, text: `${c.name}: ${c.body ?? c.word ?? c.label ?? ""}`, effect, flag, src: "Monster", id: c.id };
  });
  return entries.sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity));
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
  return { monster: iso(latest?.sources?.monster?.fetched_at), rotowire: iso(latest?.sources?.rotowire?.fetched_at), pullPrev: pc ? stampMs(pc.prev) : null, pullNow: pc ? stampMs(pc.pull) : null };
}

const money = (n) => (isNum(n) ? `$${(n / 1000).toFixed(1)}K` : null);
const SOURCE = [["monster", "Monster"], ["rotowire", "RotoWire"]];

/**
 * One team: { code, five: { kind: "confirmed" | "expected" | "disagree" | "uncompared" (a man with no id on the slate, so the fives cannot be compared) | "twogun", by: [the sources whose five is the one shown], differs: [sources whose five is not], at: { source: read ms },
 * unmatched: [names in the five with no id on the slate] }, asOf, day, starters, bench, outs, counts }. A man a fresh read says is Out (the proposals' claims: Out in a five, on MAY NOT
 * PLAY, or in Monster's news) is chipped Out and is not in the five.
 */
export function teamModel({ code, players, out, latest, stale, cards, view, asOf = {}, day = null }) {
  const mine = (players ?? []).filter((p) => p.team === code);
  const block = stale ? {} : latest?.teams?.[code] ?? {};
  const ok = (b) => b?.state === "ok" && Array.isArray(b.men);
  const usable = SOURCE.filter(([k]) => ok(block[k]));
  const confirmed = usable.filter(([k]) => block[k].confirmed);
  const use = confirmed.length ? confirmed : usable;
  const idsOf = (k) => new Set(block[k].men.filter((m) => m.id != null && m.status !== "Out").map((m) => String(m.id)));
  const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
  const claims = stale || !latest ? null : claimsFor(latest, code);
  const claimedOut = (id) => Boolean(claims?.out.has(String(id)));
  // A man the five shows whom another feed says is Out is not settled: the Out claim comes from a different feed than a claim that he is in a five (the proposals' outVsFive test), or
  // every Out claim on him is a near-name match, which the proposals refuse to act on. The feeds saying Out are named.
  const FEED = { monster: "Monster", rotowire: "RotoWire", monster_news: "Monster news" };
  const unsettledFeeds = (id) => {
    const outs = claims?.out.get(String(id));
    if (!outs) return [];
    const clash = (claims.five.get(String(id)) ?? []).some((f) => outs.some((o) => o.key !== f.key));
    return clash || outs.every((o) => o.near) ? [...new Set(outs.map((o) => FEED[o.key] ?? o.key))] : [];
  };
  let five = new Set(), by = [], differs = [], unmatched = [], uncompared = false;
  if (use.length) {
    const [k0, n0] = use[0];
    five = idsOf(k0); by = [n0];
    // A name-match miss (a man with no id on the slate) in either source means two fives cannot be compared by their ids: that is not a disagreement.
    uncompared = use.length > 1 && use.some(([k]) => block[k].men.some((m) => m.id == null));
    if (!uncompared) for (const [k, n] of use.slice(1)) (same(idsOf(k), five) ? by : differs).push(n);
    else by = use.map(([, n]) => n);
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
  const row = (p) => {
    const word = claimedOut(p.dk_id) ? "Out" : srcStatus.get(String(p.dk_id)) ?? (p.injury_status && p.injury_status !== "Available" ? p.injury_status : null);
    const mv = p.pull_move ?? null, card = cardById.get(String(p.dk_id));
    return {
      id: String(p.dk_id), name: p.name, pos: Array.isArray(p.positions) && p.positions.length ? p.positions.join("/") : null, salary: money(p.salary), status: statusChip(word),
      note: shortWord(card), noteAt: atOf(card), notePrecision: card?.precision ?? "minute", // the newest report on him: his note and any change of status carry its time
      tg: isNum(tgMin(p)) ? tgMin(p) : null, ours: isNum(p.min_ours) ? p.min_ours : null, mark: markOf(view, code, p.dk_id),
      delta: mv && (mv.min || mv.proj) ? { min: mv.min ?? null, proj: mv.proj ?? null } : null, out: false,
    };
  };
  const inFive = (p) => (source.kind === "twogun" ? p.starter === true : five.has(String(p.dk_id)) && !claimedOut(p.dk_id));
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
export function newsModel({ slate, latest, nowMs, view, tip = (t) => t, tipAt = () => null }) {
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
  const log = feedEntries({ cards: cards.filter((c) => teams.has(c.team)), players: slate?.players, out: slate?.out, pullChanges: slate?.pull_changes, day });
  return { games, log, stale, hasRead: Boolean(latest), asOf, day, orphans: [...orphanTeams.values()] };
}
