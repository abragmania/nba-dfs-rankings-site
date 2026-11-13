// Lineup proposals (Adam, 11-06): what the news sources say against what the console shows for Tonight. Pure ES module shared by the page and
// the tests; it reads nothing and applies nothing. Input is news/lineups/latest.json (tools/lineups_read.mjs), the slate's players (names and
// TwoGun's minutes), `view`, the console's Tonight scenario { <team>: { roles: { id: role }, outs: [id], min: { id: minutes on screen } } } and `nowMs`.
// Without a view nothing is proposed: whether a man starts or plays comes only from the console. view[team].marks are his own marks; the rule for them is under Applying below.
//   "out"     a man Out by Monster's player news, Monster's lineup page, RotoWire or RotoGrinders, whom the console still has playing (minutes above 0).
//   "starter" the men at least two lineup sources list in the five (both when only two are read), or one source lists with its lineup Confirmed / Verified, or
//             the five two or more confirmed pages agree on, whom the console does not
//             start: ONE proposal for the team, its action `setStarters` naming every man to start and every console starter the sources' five leaves
//             out (who replaces whom is not decided here; the five that results is).
// Rows that are not proposals (kind "conflict", "unmatched" or "unknown", Dismiss only): the sources disagree about a team (confirmed fives that
// differ and no two of them agree, or a man Out in one feed and in another's five); a man in a used five has no id on the slate; a man in a used five has a status that was
// not recognised; the console's starters left out of the five and the men to start do not match in number.
// Applying: there is no Apply button. isAuto says which proposals apply themselves (an Out; a start only from confirmed lineups) and autoPlan which of those are new; the rest are words only.
// The rule on his marks (Adam, 11-09): a man a source rules Out goes Out over his typed minutes, typed DK/min and S, and the note says what it overrode; only a man he put back in himself gets no Out.
// A start never overrides a mark: no start for a man he benched, none on a team where a man he marked S is not in the sources' five, none that benches a man he typed numbers for.
// A proposal built from a name matched only nearly (match "near") on an Out has `nearApply` (no Apply); when the read is over 90 minutes old, or
// of unknown age, every proposal has `noApply` and `stale` says so.
/** A source's words on a man are cut to this many characters, so no proposal grows past what the saved record holds. */
const DETAIL_MAX = 160;
/** The lineup pages, in the order they are named and the order that breaks a tie (Monster first). One copy; the other modules import it. */
export const LINEUP_KEYS = Object.freeze(["monster", "rotowire", "rotogrinders"]);
/** The pages' names as shown (R-audit item 6: one copy; engine, inputs, lineup-sync and board-marks import it). */
export const LINEUP_LABEL = Object.freeze({ monster: "Monster", rotowire: "RotoWire", rotogrinders: "RotoGrinders" });
/** Pages whose "confirmed" mark only backs another page until a real confirmed card has been seen (RotoGrinders, 11-11): it can join an agreement, never stand alone. */
export const BACKS_ONLY = Object.freeze(["rotogrinders"]);
/** Pages that carry no injury statuses: their five says nothing about who is Out, so it never counts against an Out claim. */
export const NO_STATUS = Object.freeze(["rotogrinders"]);
const ORDER = ["monster", "monster_news", "rotowire", "rotogrinders"]; // the order sources are named in
const LABEL = { ...LINEUP_LABEL, monster_news: "Monster" };
export const STALE_MIN = 90;
const msOf = (iso) => { const t = Date.parse(iso ?? ""); return Number.isNaN(t) ? null : t; };
/** The ET clock time of a read, for "kept from <source>'s <time> read". */
export const etTime = (ms) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(ms));
/**
 * Each source judged on its own (Adam 11-13): { monster|rotowire|rotogrinders|monster_news: { fresh, readMs (its last good read at or before nowMs: the latest of latest.json's fetched time and the ok looks), ageMin } }.
 * A look is latest.look[key] = { at, ok, ok_at, history: [ok look times, oldest first] } (server/slate/lineup-look.js); only ok looks count, so a failed one refreshes nothing, and the newest one at or before nowMs is taken, so a replay between two looks sees the earlier.
 * A time later than nowMs is ignored, never a negative age. A source whose latest.json entry is not ok counts through its last_good_at and its looks. A fixture with no sources entry falls back to generated_at.
 */
export function freshnessOf(latest, nowMs) {
  const out = {}, gen = msOf(latest?.generated_at);
  const upTo = (t) => (t !== null && t <= nowMs ? t : null);
  for (const key of [...LINEUP_KEYS, "monster_news"]) {
    const e = key === "monster_news" ? latest?.monster_news : latest?.sources?.[key];
    if (key === "monster_news" && !e) continue;
    const times = [];
    if (e === undefined) times.push(upTo(gen));
    else if (e && (e.status === undefined || e.status === "ok")) times.push(upTo(msOf(e.fetched_at) ?? gen));
    else if (e?.last_good_at) times.push(upTo(msOf(e.last_good_at))); // a failed read's source keeps its blocks from its last good read (tools/lineups_read.mjs carryFailed)
    const lk = latest?.look?.[key];
    if (lk) {
      const hist = Array.isArray(lk.history) ? lk.history.map(msOf) : [];
      times.push(...hist.map(upTo), upTo(msOf(lk.ok_at) ?? (lk.ok === true ? msOf(lk.at) : null)));
    }
    const readMs = Math.max(-Infinity, ...times.filter((t) => t !== null));
    const known = Number.isFinite(readMs);
    out[key] = { fresh: known && (nowMs - readMs) / 60000 <= STALE_MIN, readMs: known ? readMs : null, ageMin: known ? Math.round((nowMs - readMs) / 60000) : null };
  }
  return out;
}
/** latest with its per-source freshness at nowMs attached (latest.freshness, and the moment as freshness_now); claimsFor, the vote and fiveFor read it. */
export const withFreshness = (latest, nowMs) => (latest && typeof latest === "object" ? { ...latest, freshness: freshnessOf(latest, nowMs), freshness_now: nowMs } : latest);
/** The read with its freshness: as it is when it already carries one, else worked out at nowMs. */
export const ensureFreshness = (latest, nowMs) => (latest?.freshness ? latest : withFreshness(latest, nowMs));
/** A latest that carries its freshness: the one it has, else worked out at its own moment, else now (a direct caller that passed a raw read). */
const fresh0 = (latest) => (latest?.freshness ? latest : withFreshness(latest, Date.now()));
/** Whether a source is fresh in this read. */
export const isFresh = (latest, key) => fresh0(latest)?.freshness?.[key]?.fresh !== false;
/**
 * Whether one team's block of a source is fresh: its source is, and a block carried alone (check_failed on the block, the page gave no usable five for that team) is judged by its own last_good_at, never by the source's look.
 * A block marked at the same moment as its source (a whole-source carry: carryAndMark, carryFailed) is judged by the source's freshness, looks included.
 */
export function blockFresh(latest, key, b) {
  const l = fresh0(latest);
  if (l?.freshness?.[key]?.fresh === false) return false;
  if (!b?.check_failed) return true;
  if (b.check_failed.at !== undefined && b.check_failed.at === l.sources?.[key]?.check_failed?.at) return true;
  const at = msOf(b.last_good_at);
  return at !== null && ((l.freshness_now ?? Date.now()) - at) / 60000 <= STALE_MIN;
}
/** The time (ms) a source's block was last read well: a block carried alone by its own last_good_at, else the source's. Null when unknown. */
export function keptMs(latest, key, b = null) {
  const l = fresh0(latest), f = l?.freshness?.[key];
  const alone = b?.check_failed && msOf(b.last_good_at) !== null && !(b.check_failed.at !== undefined && b.check_failed.at === l.sources?.[key]?.check_failed?.at);
  return alone ? msOf(b.last_good_at) : f?.readMs ?? null;
}
/** The words for an Out kept from a source that is no longer fresh, or null. */
export const keptWords = (latest, key, b = null) => {
  const l = fresh0(latest), f = l?.freshness?.[key];
  if (f && f.fresh !== false && !(b && !blockFresh(l, key, b))) return null;
  const ms = keptMs(l, key, b);
  return `kept from ${LABEL[key]}'s ${ms == null ? "last (time unknown)" : etTime(ms)} read`;
};
/**
 * The whole-read age test: null while any lineup source is fresh, else { ageMin } of the newest source read (null when unknown). A stale source drops only its own part (freshnessOf); the whole read is
 * stale only when every lineup source is. Used by the bar's line, the news page and the checks that need some fresh source at all.
 */
export function staleOf(latest, nowMs) {
  const present = LINEUP_KEYS.filter((k) => latest?.sources?.[k] !== undefined || latest?.look?.[k]);
  if (!present.length) {
    const gen = Date.parse(latest?.generated_at ?? "");
    return Number.isNaN(gen) || (nowMs - gen) / 60000 > STALE_MIN ? { ageMin: Number.isNaN(gen) ? null : Math.round((nowMs - gen) / 60000) } : null;
  }
  const f = freshnessOf(latest, nowMs);
  if (present.some((k) => f[k].fresh)) return null;
  const ages = present.map((k) => f[k].ageMin).filter((a) => a !== null);
  return { ageMin: ages.length ? Math.min(...ages) : null };
}
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
/** A source's block for a team that can be used: it says ok and carries a men list. A block without one counts as missing. */
const okBlock = (b) => b?.state === "ok" && Array.isArray(b.men);
/** TwoGun's own minutes for a man: a board row carries his typed minutes in `minutes` and TwoGun's in `base_minutes`. */
export const tgMin = (p) => (p && "tg_minutes" in p ? p.tg_minutes : p && "base_minutes" in p ? p.base_minutes : p?.minutes); // tg_minutes: the row carries our minutes (proj_source "ours") // a typed row carries his number in minutes and TwoGun's in base_minutes, null when TwoGun gave none: never his number as TwoGun's (player-table.js minOtherOf reads it the same way)
/** A short stable hash (djb2, base 36): a start proposal's id is the sources' five alone, so a changed five is new news and the same five from another source is not (Adam, 11-07). */
export const hashOf = (text) => { let h = 5381; for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0; return h.toString(36); };
const mins = (v) => (isNum(v) ? `${Math.round(v * 10) / 10}` : "—");

const sourceTime = (latest, key) => (key === "monster_news" ? latest.monster_news?.fetched_at : latest.sources?.[key]?.fetched_at) ?? null;
const labelsOf = (sources) => [...new Set(sources.map((s) => LABEL[s.key]))].join(" + ");
export const unknownStatus = (m) => String(m.status ?? "").startsWith("UNKNOWN");
/** An unrecognised status as words only: "UNKNOWN(Q #123456 Questionable)" becomes "Q Questionable"; a colour code is never shown. */
export const statusWords = (s) => String(s ?? "").replace(/^UNKNOWN\((.*)\)$/, "$1").replace(/\s*#[0-9A-Fa-f]{3,8}\b/g, "").replace(/\s+/g, " ").trim() || "unreadable";

/**
 * The Out claims and the in-five claims on one team, by man id: { out: Map(id -> [claim]), five: Map(id -> [claim]), dropped }. A claim is { key, at, lineup, detail, name, near, held }; held marks an Out kept from a source (or a team block)
 * that is no longer fresh. A held Out stands only while no fresh status-bearing source (not RotoGrinders: NO_STATUS) lists the man in its five, projected or confirmed; one that does is set aside and listed in dropped: [{ id, key, by: [sources], name }], never a clash or a proposal.
 */
export function claimsFor(latestIn, team, skip = new Set()) {
  const latest = fresh0(latestIn);
  const out = new Map(), five = new Map(), dropped = [];
  const add = (map, m, claim) => { if (m.id != null) map.set(m.id, [...(map.get(m.id) ?? []), { ...claim, name: m.name, near: m.match === "near" }]); };
  const block = latest.teams?.[team] ?? {};
  for (const key of LINEUP_KEYS) {
    const b = block[key];
    if (skip.has(key) || !okBlock(b)) continue;
    const at = sourceTime(latest, key), lineup = b.confirmed ? "confirmed" : "projected", held = !blockFresh(latest, key, b); // a source no longer fresh keeps its Outs, never its five
    for (const m of b.men) { if (m.status !== "Out" && held) continue; add(m.status === "Out" ? out : five, m, { key, at, lineup, held, detail: m.status === "Out" ? `${String(m.flag ?? "Out").slice(0, DETAIL_MAX)} in its five` : null }); }
    for (const m of Array.isArray(b.may_not_play) ? b.may_not_play : []) if (m.status === "Out") add(out, m, { key, at, lineup: null, held, detail: `${String(m.flag ?? "Out").slice(0, DETAIL_MAX)} on MAY NOT PLAY` });
  }
  const news = latest.monster_news; // a news read that failed or expired keeps its last good Out list (last_good_at, tools/lineups_read.mjs carryFailed)
  if (news && (news.status === "ok" || (news.last_good_at && Array.isArray(news.out)))) for (const m of Array.isArray(news.out) ? news.out : []) if (m.team === team) add(out, m, { key: "monster_news", at: news.last_good_at ?? news.fetched_at ?? null, lineup: null, held: !isFresh(latest, "monster_news"), detail: String(m.detail ?? "Out").slice(0, DETAIL_MAX) });
  for (const [id, cl] of out) {
    const by = (five.get(id) ?? []).filter((c) => !NO_STATUS.includes(c.key)).map((c) => c.key);
    const keep = by.length ? cl.filter((c) => !c.held) : cl;
    if (by.length) for (const c of cl.filter((x) => x.held)) dropped.push({ id, key: c.key, by: [...new Set(by)], name: c.name });
    if (keep.length) out.set(id, keep); else out.delete(id);
  }
  return { out, five, dropped };
}

/** Two feeds disagree about a man when one has him Out and a different feed lists him in its five. */
export function outVsFive(claims) {
  const rows = [];
  for (const [id, outs] of claims.out) {
    const fives = (claims.five.get(id) ?? []).filter((f) => !NO_STATUS.includes(f.key) && outs.some((o) => o.key !== f.key));
    if (fives.length) rows.push({ id, outs, fives });
  }
  return rows;
}

const idsOf = (b) => new Set(b.men.map((m) => m.id).filter((id) => id != null));
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/**
 * The five for one team: { q: ids that qualify to start, five: ids counted as the sources' five, used: sources in play, pages: the pages read, vote: true for a projected vote, conflict: text|null }.
 * `skip`: pages left out (one with a man not matched to a slate player). Confirmed: the five two or more confirmed pages agree on; else a lone confirmed page (never one in BACKS_ONLY); else, when
 * all three are confirmed and differ, Monster's; two confirmed that differ with no third are a conflict. Projected: the men at least two pages name, ranked by page count and cut to five, a tie at the
 * cut broken by Monster's five.
 */
function qualifying(latest, team, skip = new Set()) {
  const b = latest.teams?.[team] ?? {};
  const oks = LINEUP_KEYS.filter((k) => !skip.has(k) && okBlock(b[k]) && blockFresh(latest, k, b[k])); // a source (or a team block carried alone) no longer fresh is left out of the vote
  const confs = oks.filter((k) => b[k].confirmed);
  const none = { q: new Set(), five: new Set(), used: oks, pages: oks, conflict: null };
  const pick = (used, q) => ({ q, five: q, used, pages: oks, conflict: null });
  if (confs.length) {
    const best = confs.map((k) => confs.filter((j) => sameSet(idsOf(b[k]), idsOf(b[j])))).reduce((a, c) => (c.length > a.length ? c : a), []);
    // a group that beats a confirmed Monster must hold two pages that are not back-only; otherwise Monster's five stands
    const beats = !confs.includes("monster") || best.includes("monster") || best.filter((k) => !BACKS_ONLY.includes(k)).length >= 2;
    if (best.length >= 2 && beats) return pick(best, idsOf(b[best[0]]));
    if (best.length >= 2 && !beats) return pick(["monster"], idsOf(b.monster));
    const solo = confs.filter((k) => !BACKS_ONLY.includes(k));
    if (confs.length >= 2 && confs.includes("monster")) return pick(["monster"], idsOf(b.monster)); // two or three confirmed and none agree: a confirmed Monster wins (Adam 11-11)
    if (solo.length === 1) return pick(solo, idsOf(b[solo[0]]));
    if (solo.length >= 2) return { ...none, conflict: "the confirmed lineups differ and no two agree" };
  }
  if (oks.length >= 2) { // projected fives (or a confirmed mark that only backs): the men at least two pages name; a man a page marks Out is not counted (Adam 11-12)
    const count = new Map(), outAny = new Set(oks.flatMap((k) => b[k].men.filter((m) => m.status === "Out" && m.id != null).map((m) => m.id))); // a man any page marks Out takes no place in the vote
    for (const k of oks) for (const m of b[k].men) if (m.id != null && !outAny.has(m.id)) count.set(m.id, (count.get(m.id) ?? 0) + 1);
    const mon = b.monster && oks.includes("monster") ? idsOf(b.monster) : new Set();
    const ranked = [...count].filter(([, n]) => n >= 2).sort((x, y) => y[1] - x[1] || Number(mon.has(y[0])) - Number(mon.has(x[0])));
    const q = new Set(ranked.slice(0, 5).map(([id]) => id));
    return { q, five: q, used: oks, pages: oks, vote: true, cut: ranked.slice(5).map(([id]) => id), conflict: null };
  }
  return none;
}

/**
 * The vote as the lineup bar and the minutes engine both use it (one copy): { first: qualifying() on every page, q: the five in force, dropped: null or { pages, names } when pages holding a man
 * not matched to a slate player were left out of the vote because two clean pages remained }.
 */
export function settledFive(latest, team, skip = new Set()) {
  const first = qualifying(latest, team, skip);
  let q = first, dropped = null;
  const dirty = first.used.filter((k) => latest.teams[team][k].men.some((m) => m.id == null));
  if (dirty.length) {
    const q2 = qualifying(latest, team, new Set([...skip, ...dirty]));
    if (q2.pages.length >= 2 && !q2.conflict) {
      dropped = { pages: dirty, names: [...new Set(dirty.flatMap((k) => latest.teams[team][k].men.filter((m) => m.id == null).map((m) => m.name)))] };
      q = q2;
    }
  }
  return { first, q, dropped };
}

/**
 * The five the minutes engine plays from, decided by the same vote as the bar (one owner; Adam 11-12): { ids: DraftKings ids in the five (a man any page marks Out left out), used: pages, kind:
 * "confirmed" | "partly confirmed" | "projected", named: id -> page keys, outs: names left out as Out, cut: names the vote cut at five, dropped (settledFive), why: null, or the words for no five }.
 * No five (ids empty, why set) on: the vote's conflict, a man Out on one page and in another's five (the bar's clash), a status not recognised, a man with no slate id, or no man two pages agree on.
 * skip: page keys not read (fetched at or after lock). names: id -> name for the words. Pure.
 */
export function fiveFor(latestIn, team, { skip = new Set(), names = new Map() } = {}) {
  const latest = fresh0(latestIn); // each source judged on its own: a read that carries no freshness is worked out here, never taken as fresh
  const none = (why, refused = false) => ({ ids: [], used: [], kind: null, named: {}, outs: [], cut: [], dropped: null, contested: [], contestedIds: [], why, refused });
  const blocks = latest?.teams?.[team];
  if (!blocks) return none(null);
  const nameOf = (id, fb) => names.get(String(id)) ?? fb ?? "a man not on this slate";
  const { first, q, dropped } = settledFive(latest, team, skip); // the bar refuses on the first vote's conflict before it drops an unmatched page, so does this
  const claims = claimsFor(latest, team, skip), clash = outVsFive(claims), contested = new Set(clash.map((c) => c.id)); // a page not read makes no claim
  // Fresh sources that clash on a man (Out in one, in another's five) flag that man only: he is neither Out nor in the five; the others stand (Adam 11-13).
  const flagged = clash.map((c) => nameOf(c.id, c.outs[0].name));
  if (first.conflict || q.conflict) return none(`${first.conflict ?? q.conflict}; no five used`, true);
  const usedMen = q.used.flatMap((k) => blocks[k].men), unmatched = [...new Set(usedMen.filter((m) => m.id == null).map((m) => m.name))], unknown = [...new Set(usedMen.filter(unknownStatus).map((m) => m.name))];
  if (unmatched.length) return none(`${unmatched.join(", ")} in a lineup ${unmatched.length > 1 ? "are" : "is"} not matched to a slate player; no five used`, true);
  if (unknown.length) return none(`${unknown.join(", ")} in a lineup ${unknown.length > 1 ? "have" : "has"} a status that was not recognised; no five used`, true);
  const outIds = [...q.five].filter((id) => claims.out.has(id) && !contested.has(id)), ids = [...q.five].filter((id) => !claims.out.has(id) && !contested.has(id));
  if (!ids.length) {
    const read = q.used.map((k) => LABEL[k]);
    return none(q.five.size ? "every man in the five is Out; no five used" : !read.length ? "no lineup page could be used; no five used" : read.length === 1 ? `only ${read[0]}'s lineup was read; one page alone does not set the five`
      : blocks[q.used[0]].men.length === 0 ? "the confirmed five is empty; no five used" : `${read.join(" and ")} share no man two of them name; no five used`);
  }
  const kind = q.used.every((k) => blocks[k].confirmed) ? "confirmed" : q.used.some((k) => blocks[k].confirmed) ? "partly confirmed" : "projected";
  const named = Object.fromEntries(ids.map((id) => [id, q.used.filter((k) => blocks[k].men.some((m) => m.id === id))]));
  return { ids, used: q.used, kind, named, outs: outIds.map((id) => nameOf(id, claims.out.get(id)[0].name)), cut: (q.cut ?? []).map((id) => nameOf(id)), dropped, contested: flagged, contestedIds: [...contested], why: null, refused: false };
}

/**
 * The men who fill the places a short five leaves open (Adam 11-13): the first `open` ids of tonight's order that are not in the five (`taken`), not disputed and not in `skip` (Out, benched). One copy:
 * the minutes engine (minutes/order.js tonightOrder) and the lineup bar (makeProposals) both pick the fifth starter here, so they name the same man. Pure; ids compared as strings.
 */
export function openPlaces(orderIds, { taken = [], disputed = [], skip = [], open = 0 } = {}) {
  const no = new Set([...taken, ...disputed, ...skip].map(String));
  return orderIds.map(String).filter((id) => !no.has(id)).slice(0, Math.max(0, open));
}

const OLD_ORDER = "the console's chart order is from an older lineup read; it refreshes at the next pull";

const sideText = (b, name) => (okBlock(b) ? `${name}${b.confirmed ? " (confirmed)" : " (projected)"}: ${b.men.map((m) => m.name).join(", ")}` : `${name}: ${b?.note ?? "not read"}`);

function conflictRow(slate, team, latest, why, names) {
  const b = latest.teams?.[team] ?? {};
  return {
    id: `${slate}|${team}|conflict`, kind: "conflict", team,
    text: `${team}: the sources disagree (${why}); nothing proposed.`,
    sides: LINEUP_KEYS.map((k) => sideText(b[k], LABEL[k])),
    signature: JSON.stringify({ why, names, m: okBlock(b.monster) ? b.monster.men.map((m) => m.name) : null, r: okBlock(b.rotowire) ? b.rotowire.men.map((m) => m.name) : null, ...(okBlock(b.rotogrinders) ? { g: b.rotogrinders.men.map((m) => m.name) } : {}) }),
  };
}

/** One man two fresh sources disagree on: a foot row naming him and both claims. The id carries his id, so the team's other rows are unaffected. */
function contestedRow(slate, team, c, name, starts = false) {
  const words = (cl) => `${LABEL[cl.key]}${cl.lineup ? ` (${cl.lineup})` : ""}`;
  const outs = c.outs.map(words).join(" + "), fives = c.fives.map(words).join(" + ");
  return {
    id: `${slate}|${team}|conflict|${c.id}`, kind: "conflict", team,
    text: `${team}: ${name} is Out in ${outs} but in the five in ${fives}; he is not marked Out and the pages do not start him${starts ? ", but the console still shows him as a starter" : ""}; the other men stand.`,
    sides: [`Out: ${outs}`, `In the five: ${fives}`], signature: JSON.stringify({ kind: "contested", id: c.id, o: c.outs.map((x) => x.key), f: c.fives.map((x) => x.key) }),
  };
}

function checkRow(slate, team, kind, text, detail) {
  return { id: `${slate}|${team}|${kind}`, kind, team, text, sides: [], signature: JSON.stringify({ kind, detail }) };
}

/**
 * { proposals, conflicts, stale }. `latest`: latest.json; `players`: the slate's rows (dk_id, name, minutes, base_minutes); `view`: see the top; `nowMs`: the clock.
 * Each proposal: { id, kind, team, player: { id, name } (the first man), players?: [the men to start], bench?: [{ id, name }], text, sources: [{ key, label, at, lineup, detail }],
 * twogun: { minutes }, actions: [{ fn: "setRole", team, id, role: "out" } | { fn: "setStarters", team, starters: [id], bench: [id] }], noApply?, nearApply?, signature }.
 */
export function makeProposals({ latest: latestIn, players, view = null, nowMs = Date.now() }) {
  const none = { proposals: [], conflicts: [], stale: null };
  if (!isObj(latestIn?.teams) || !Array.isArray(players) || !isObj(view)) return none;
  const latest = withFreshness(latestIn, nowMs);
  const slate = latest.slate ?? "", byId = new Map(players.map((p) => [String(p.dk_id), p]));
  const stale = staleOf(latest, nowMs);
  const nameOf = (id, fallback) => byId.get(id)?.name ?? fallback ?? "a player not on this slate"; // never a raw id in the words (G62: said, not dropped)
  const proposals = [], conflicts = [], stuck = [];
  for (const team of Object.keys(latest.teams)) {
    const v = view[team];
    if (!v) continue;
    const claims = claimsFor(latest, team), consoleOut = new Set(v.outs ?? []), roles = v.roles ?? {};
    const undone = new Set(Object.values(v.news ?? {}).filter((e) => e?.state === "undone").flatMap((e) => (e.men ?? []).filter((m) => m.kind === "out").map((m) => String(m.id))));
    const marks = v.marks ?? {}, markedOut = new Set(marks.out ?? []), markedS = new Set(marks.s ?? []), typed = new Set(marks.typed ?? []), markedIn = new Set(marks.in ?? []), benched = new Set(marks.benched ?? []);
    const settled = settledFive(latest, team);
    let q = settled.first;
    if (q.conflict) { // the confirmed fives differ and no two agree: the team's five cannot be told
      conflicts.push(conflictRow(slate, team, latest, q.conflict, []));
      continue;
    }
    // Fresh sources that clash on a man flag him alone, with both claims; he is neither Out nor started, and the team's other proposals go on (Adam 11-13).
    const clash = outVsFive(claims), contested = new Set(clash.map((c) => c.id));
    for (const c of clash) conflicts.push(contestedRow(slate, team, c, nameOf(c.id, c.outs[0].name), roles[c.id] === "starter" && !consoleOut.has(c.id)));
    const without = (x) => ({ ...x, q: new Set([...x.q].filter((id) => !contested.has(id))), five: new Set([...x.five].filter((id) => !contested.has(id))) });
    q = without(q);
    for (const [id, cl] of claims.out) {
      if (contested.has(id)) continue;
      const p = byId.get(id), typedProj = isNum(p?.ovr?.projection) && v.appliedTo?.[id] !== p.ovr.projection; // his own number, not one an Apply wrote
      if (consoleOut.has(id) || !(v.min?.[id] > 0 || (roles[id] !== undefined && (typed.has(id) || typedProj || markedS.has(id))))) continue; // the console has him out, or does not know him, or he is on no minutes with nothing of Adam's holding a number or an S up
      if (markedIn.has(id)) continue; // he put him back in himself: no Out
      const sources = [...new Map(cl.map((c) => [c.key, { key: c.key, label: LABEL[c.key], at: c.at, lineup: c.lineup, detail: c.detail, ...(c.held ? { kept: keptWords(latest, c.key, latest.teams?.[team]?.[c.key]) } : {}) }])).values()].sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
      const name = nameOf(id, cl[0].name), near = cl.some((c) => c.near);
      proposals.push({
        id: `${slate}|${team}|out|${id}`, kind: "out", team, player: { id, name },
        text: `${labelsOf(sources)}: Out: ${name}${typed.has(id) || typedProj || markedS.has(id) ? ` — overrides your ${[typed.has(id) || typedProj ? "typed numbers" : "", markedS.has(id) ? "S" : ""].filter(Boolean).join(" and ")}` : ""}${sources.some((x) => x.kept) ? ` (${sources.filter((x) => x.kept).map((x) => x.kept).join("; ")})` : ""}`, // an override of his own marks is said in the row, not left to the hover
        detail: `TwoGun still has him at ${mins(tgMin(p))} min`,
        sources, twogun: { minutes: tgMin(p) ?? null },
        actions: [{ fn: "setRole", team, id, role: "out" }],
        ...(near ? { nearApply: "the source's name for him matched only nearly, so it is not made by itself; check him by hand" } : {}),
        signature: JSON.stringify({ kind: "out", id, s: sources.map((s) => [s.key, s.detail]) }),
      });
    }
    // A page with a man not matched to a slate player is left out of the vote when two clean pages remain, and the check says so; with fewer it refuses (G62).
    if (settled.dropped) {
      conflicts.push(checkRow(slate, team, "unmatched", `${team}: ${settled.dropped.pages.map((k) => LABEL[k]).join(" + ")}'s lineup left out of the vote (${settled.dropped.names.join(", ")} not matched to a slate player); the other pages decide.`, settled.dropped.names));
      q = without(settled.q);
    }
    const usedMen = q.used.flatMap((k) => latest.teams[team][k].men);
    const unmatched = [...new Set(usedMen.filter((m) => m.id == null).map((m) => m.name))];
    const unknown = [...new Set(usedMen.filter(unknownStatus).map((m) => `${m.name} (${statusWords(m.status)})`))];
    if (unmatched.length) conflicts.push(checkRow(slate, team, "unmatched", `${team}: ${unmatched.join(", ")} in a lineup ${unmatched.length > 1 ? "are" : "is"} not matched to a slate player; no start proposed.`, unmatched));
    if (unknown.length) conflicts.push(checkRow(slate, team, "unknown", `${team}: ${unknown.join(", ")} in a lineup ${unknown.length > 1 ? "have" : "has"} a status that was not recognised; no start proposed.`, unknown));
    if (unmatched.length || unknown.length) continue;
    if ([...markedS].some((id) => !q.five.has(id))) continue; // a man he marked S is not in the sources' five: their five contradicts his mark
    const hardOut = (id) => consoleOut.has(id) || markedOut.has(id) || (claims.out.has(id) && !contested.has(id));
    const outNow = (id) => hardOut(id) || contested.has(id); // a contested man is neither started nor benched here, unless the five is short and a man fills in (below)
    // A disputed man leaves the five short: the open place goes to the next man in tonight's chart order (view.order, the engine's), as in minutes/order.js; the disputed man goes to the head of the bench.
    const idFive = [...q.five];
    // A man he put back in (a mark, or a news Out he undid) plays in the engine though a source claims him Out (engine.js whoIsGone putIn): he counts as playing and may fill.
    const putBack = (id) => markedIn.has(id) || undone.has(id);
    // The engine's five leaves out every man a source claims Out, put back or not (fiveFor), so the open places are counted that way; a put-back man may then be a fill by his place on the chart.
    const live = [...q.five].filter((id) => !consoleOut.has(id) && !markedOut.has(id) && !contested.has(id) && !claims.out.has(id)).length;
    // The chart order is the console's tonight order; it is used only when it was built from this very read (view.orderAt = the read's generated_at), never an older one (a page that loaded its inputs earlier), and only when the engine used the pages' five.
    const orderOk = Array.isArray(v.order) && v.orderAt != null && v.orderAt === latest.generated_at;
    const engineNo = v.five && v.five.applied === false ? `the engine did not use this five${v.five.why ? ` (${v.five.why})` : ""}` : null;
    const short = contested.size > 0 && live < 5;
    const fill = short && orderOk && !engineNo ? openPlaces(v.order.filter((id) => roles[String(id)] !== undefined), { taken: [...q.five].filter((id) => !claims.out.has(id)), disputed: contested, skip: [...consoleOut, ...markedOut, ...[...claims.out.keys()].filter((id) => !putBack(id)), ...benched], open: 5 - live }) : [];
    const s = { team, ids: [...contested].filter((id) => roles[id] === "starter" && !consoleOut.has(id) && !markedOut.has(id)), why: Array.isArray(v.order) ? (orderOk ? engineNo : OLD_ORDER) : "the console carries no chart order for this team", old: Array.isArray(v.order) && !orderOk, head: Boolean(v.five?.applied), skip: false };
    if (short) stuck.push(s);
    if (fill.length) q = { ...q, q: new Set([...q.q, ...fill]), five: new Set([...q.five, ...fill]) };
    // A man he sent to the bench or out of the rotation is never proposed to start.
    const incoming = [...q.q].filter((id) => roles[id] !== undefined && roles[id] !== "starter" && (!outNow(id) || fill.includes(id)) && !benched.has(id)).sort((a, b) => (v.min?.[b] ?? 0) - (v.min?.[a] ?? 0) || a.localeCompare(b));
    if (!incoming.length) { s.why ??= fill.length ? "the man to fill the place already starts in the console" : "no man on the chart's order is free to fill the place"; continue; }
    const missing = Object.entries(roles).filter(([id, r]) => r === "starter" && !hardOut(id) && (fill.length || !contested.has(id)) && !q.five.has(id)).map(([id]) => id).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    if (missing.some((id) => typed.has(id))) { s.why ??= `his typed numbers on ${missing.filter((id) => typed.has(id)).map((id) => nameOf(id)).join(", ")} hold the five`; continue; } // the five would bench a man whose numbers he typed: his mark wins
    if (Object.entries(roles).filter(([id, r]) => r === "starter" && !outNow(id) && q.five.has(id)).length + incoming.length > 5) { s.why ??= "starting the fill would leave six starters"; continue; } // never a start with no one going to the bench
    if (missing.length && missing.length !== incoming.length) {
      conflicts.push(conflictRow(slate, team, latest, `the console starts ${missing.map((id) => nameOf(id)).join(", ")}, not in the five, and ${incoming.length} men are to start`, missing));
      s.skip = true; // this team already has a row with its reason
      continue;
    }
    const named = fill.length ? [...idFive, ...incoming] : incoming; // a fill man is on no page: the pages behind the start are those naming the agreed men
    const sources = q.used.filter((k) => named.some((id) => idsOf(latest.teams[team][k]).has(id))).map((k) => ({ key: k, label: LABEL[k], at: sourceTime(latest, k), lineup: latest.teams[team][k].confirmed ? "confirmed" : "projected", detail: null }));
    const word = sources.every((s) => s.lineup === "confirmed") ? "confirmed" : sources.some((s) => s.lineup === "confirmed") ? "one confirmed" : "projected";
    const allFill = fill.length > 0 && incoming.every((id) => fill.includes(id));
    const ins = incoming.map((id) => ({ id, name: nameOf(id) })), outs = missing.map((id) => ({ id, name: nameOf(id) }));
    const tg = incoming.map((id) => mins(tgMin(byId.get(id)))).join(", ");
    proposals.push({
      id: `${slate}|${team}|starter|${hashOf(JSON.stringify(idFive.sort()))}`, kind: "starter", team, player: ins[0], players: ins, bench: outs,
      text: allFill ? `START: ${ins.map((m) => m.name).join(", ")} (next on the chart; ${[...contested].map((id) => nameOf(id)).join(", ")} disputed)${outs.length ? ` · Bench: ${outs.map((m) => m.name).join(", ")}` : ""}` // no page named him: none is credited
        : `${labelsOf(sources)}: START: ${ins.map((m) => m.name).join(", ")}${outs.length ? ` · Bench: ${outs.map((m) => m.name).join(", ")}` : ""}`,
      detail: `${allFill ? "" : `${word[0].toUpperCase()}${word.slice(1)}; `}${fill.length && !allFill ? `${fill.map((id) => nameOf(id)).join(", ")} fills the open place (next on the chart; ${[...contested].map((id) => nameOf(id)).join(", ")} disputed); ` : ""}TwoGun has ${ins.length > 1 ? "them at" : "him at"} ${tg} min${ins.length === 1 ? `; the console has him on ${roles[incoming[0]] === "bench_plus" ? "Bench+" : roles[incoming[0]]}` : ""}`,
      sources, twogun: { minutes: tgMin(byId.get(incoming[0])) ?? null },
      actions: [{ fn: "setStarters", team, starters: incoming, bench: missing }], // console-card.js autoApplyProposal: the five-starter move that puts these men in and those out
      signature: JSON.stringify({ kind: "starter", in: incoming, out: missing, s: sources.map((s) => [s.key, s.lineup]) }),
    });
  }
  // A disputed man the console still starts, whom no offered proposal benches (a start for this five was already applied, a typed number holds him, or no chart order was usable): said, never silent (G62).
  const news = Object.fromEntries(Object.entries(view).map(([t, v]) => [t, v?.news ?? {}])), offered = autoPlan({ proposals }, news);
  const offeredIds = new Set([...offered.apply, ...offered.info].map((p) => p.id));
  for (const { team, ids, why, old, head, skip } of stuck) {
    if (skip) continue;
    for (const id of ids) {
      if (proposals.some((p) => p.kind === "starter" && p.team === team && offeredIds.has(p.id) && p.bench.some((b) => b.id === id))) continue;
      const name = nameOf(id, null);
      conflicts.push({
        id: `${slate}|${team}|conflict|${id}|starts`, kind: "conflict", team,
        text: old ? `${team}: ${name} is disputed between the pages; ${OLD_ORDER}.`
          : `${team}: the console still starts ${name}, whom the pages dispute; ${head ? "the engine has him at the head of the bench, but " : ""}no start is offered to move him (${why ?? "a start for this five may already have been applied"}).`,
        sides: [], signature: JSON.stringify({ kind: "contested-starts", id, why: why ?? null }),
      });
    }
  }
  // an Out kept from a stale source stays in force (Adam 11-13): only the others wait
  if (stale) for (const p of proposals.filter((x) => !(x.kind === "out" && x.sources.every((src) => src.kept)))) p.noApply = `the lineup read is ${stale.ageMin == null ? "of unknown age" : `${stale.ageMin} minutes old`}, so nothing from it is made by itself until the next pull`;
  for (const p of proposals) p.auto = isAuto(p);
  return { proposals, conflicts, stale };
}

/** Whether a proposal applies itself (Adam, 11-07): an Out from any source does; a start only when every lineup behind it is confirmed. A projected
 *  start, a name matched only nearly, or a stale read is information only. */
export function isAuto(p) {
  if (p.noApply || p.nearApply) return false;
  if (p.kind === "out") return true;
  return p.kind === "starter" && p.sources.length > 0 && p.sources.every((s) => s.lineup === "confirmed") && p.sources.some((s) => !BACKS_ONLY.includes(s.key) || p.sources.length > 1);
}

/**
 * What the bar does with a read: { apply: [proposals to apply now], info: [proposals shown as words only] }. `news`: { team: { id: entry } }, the console's
 * record (console-card.js). A proposal applies once per id: once applied or undone it is never offered or applied again, whatever he did since; a failed one
 * is tried again only when its news changes; an Out the news itself reversed (state "reversed", server/slate/news-reverse.js) applies again if a source rules him Out again.
 */
export function autoPlan(result, news = {}) {
  const apply = [], info = [];
  for (const p of result.proposals) {
    const e = news[p.team]?.[p.id];
    if (e && e.state !== "reversed" && (e.state !== "failed" || e.sig === hashOf(String(p.signature)))) continue; // sig is the hash of its news (console-card.js)
    (p.auto ? apply : info).push(p);
  }
  return { apply, info };
}

/** What stays on the bar after his dismissals: `dismissed` is { id: signature }; a row returns when its sources change (its signature differs). */
export function visible(result, dismissed = {}) {
  const keep = (r) => dismissed[r.id] !== r.signature;
  return { ...result, proposals: result.proposals.filter(keep), conflicts: result.conflicts.filter(keep) };
}
