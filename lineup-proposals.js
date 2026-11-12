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
/** Pages whose "confirmed" mark only backs another page until a real confirmed card has been seen (RotoGrinders, 11-11): it can join an agreement, never stand alone. */
export const BACKS_ONLY = Object.freeze(["rotogrinders"]);
/** Pages that carry no injury statuses: their five says nothing about who is Out, so it never counts against an Out claim. */
export const NO_STATUS = Object.freeze(["rotogrinders"]);
const ORDER = ["monster", "monster_news", "rotowire", "rotogrinders"]; // the order sources are named in
const LABEL = { monster: "Monster", monster_news: "Monster", rotowire: "RotoWire", rotogrinders: "RotoGrinders" };
export const STALE_MIN = 90;
/** The one age test of a lineup read: null while it is fresh, else { ageMin } (null when its time is unknown). Used by the proposals, the bar and the board's S chips. */
export function staleOf(latest, nowMs) {
  const gen = Date.parse(latest?.generated_at ?? "");
  return Number.isNaN(gen) || (nowMs - gen) / 60000 > STALE_MIN ? { ageMin: Number.isNaN(gen) ? null : Math.round((nowMs - gen) / 60000) } : null;
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

/** The Out claims and the in-five claims on one team, by man id: { out: Map(id -> [claim]), five: Map(id -> [claim]) }. A claim is { key, at, lineup, detail, name, near }. */
export function claimsFor(latest, team, skip = new Set()) {
  const out = new Map(), five = new Map();
  const add = (map, m, claim) => { if (m.id != null) map.set(m.id, [...(map.get(m.id) ?? []), { ...claim, name: m.name, near: m.match === "near" }]); };
  const block = latest.teams?.[team] ?? {};
  for (const key of LINEUP_KEYS) {
    const b = block[key];
    if (skip.has(key) || !okBlock(b)) continue;
    const at = sourceTime(latest, key), lineup = b.confirmed ? "confirmed" : "projected";
    for (const m of b.men) add(m.status === "Out" ? out : five, m, { key, at, lineup, detail: m.status === "Out" ? `${String(m.flag ?? "Out").slice(0, DETAIL_MAX)} in its five` : null });
    for (const m of Array.isArray(b.may_not_play) ? b.may_not_play : []) if (m.status === "Out") add(out, m, { key, at, lineup: null, detail: `${String(m.flag ?? "Out").slice(0, DETAIL_MAX)} on MAY NOT PLAY` });
  }
  const news = latest.monster_news;
  if (news?.status === "ok") for (const m of Array.isArray(news.out) ? news.out : []) if (m.team === team) add(out, m, { key: "monster_news", at: news.fetched_at ?? null, lineup: null, detail: String(m.detail ?? "Out").slice(0, DETAIL_MAX) });
  return { out, five };
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
  const oks = LINEUP_KEYS.filter((k) => !skip.has(k) && okBlock(b[k]));
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
export function fiveFor(latest, team, { skip = new Set(), names = new Map() } = {}) {
  const none = (why, refused = false) => ({ ids: [], used: [], kind: null, named: {}, outs: [], cut: [], dropped: null, why, refused });
  const blocks = latest?.teams?.[team];
  if (!blocks) return none(null);
  const nameOf = (id, fb) => names.get(String(id)) ?? fb ?? "a man not on this slate";
  const { first, q, dropped } = settledFive(latest, team, skip); // the bar refuses on the first vote's conflict before it drops an unmatched page, so does this
  const claims = claimsFor(latest, team, skip), clash = outVsFive(claims); // a page not read makes no claim
  if (clash.length) return none(`${clash.map((c) => nameOf(c.id, c.outs[0].name)).join(", ")} ${clash.length > 1 ? "are" : "is"} Out in one feed and in the five in another; no five used`, true);
  if (first.conflict || q.conflict) return none(`${first.conflict ?? q.conflict}; no five used`, true);
  const usedMen = q.used.flatMap((k) => blocks[k].men), unmatched = [...new Set(usedMen.filter((m) => m.id == null).map((m) => m.name))], unknown = [...new Set(usedMen.filter(unknownStatus).map((m) => m.name))];
  if (unmatched.length) return none(`${unmatched.join(", ")} in a lineup ${unmatched.length > 1 ? "are" : "is"} not matched to a slate player; no five used`, true);
  if (unknown.length) return none(`${unknown.join(", ")} in a lineup ${unknown.length > 1 ? "have" : "has"} a status that was not recognised; no five used`, true);
  const outIds = [...q.five].filter((id) => claims.out.has(id)), ids = [...q.five].filter((id) => !claims.out.has(id));
  if (!ids.length) {
    const read = q.used.map((k) => LABEL[k]);
    return none(q.five.size ? "every man in the five is Out; no five used" : !read.length ? "no lineup page could be used; no five used" : read.length === 1 ? `only ${read[0]}'s lineup was read; one page alone does not set the five`
      : blocks[q.used[0]].men.length === 0 ? "the confirmed five is empty; no five used" : `${read.join(" and ")} share no man two of them name; no five used`);
  }
  const kind = q.used.every((k) => blocks[k].confirmed) ? "confirmed" : q.used.some((k) => blocks[k].confirmed) ? "partly confirmed" : "projected";
  const named = Object.fromEntries(ids.map((id) => [id, q.used.filter((k) => blocks[k].men.some((m) => m.id === id))]));
  return { ids, used: q.used, kind, named, outs: outIds.map((id) => nameOf(id, claims.out.get(id)[0].name)), cut: (q.cut ?? []).map((id) => nameOf(id)), dropped, why: null, refused: false };
}

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

function checkRow(slate, team, kind, text, detail) {
  return { id: `${slate}|${team}|${kind}`, kind, team, text, sides: [], signature: JSON.stringify({ kind, detail }) };
}

/**
 * { proposals, conflicts, stale }. `latest`: latest.json; `players`: the slate's rows (dk_id, name, minutes, base_minutes); `view`: see the top; `nowMs`: the clock.
 * Each proposal: { id, kind, team, player: { id, name } (the first man), players?: [the men to start], bench?: [{ id, name }], text, sources: [{ key, label, at, lineup, detail }],
 * twogun: { minutes }, actions: [{ fn: "setRole", team, id, role: "out" } | { fn: "setStarters", team, starters: [id], bench: [id] }], noApply?, nearApply?, signature }.
 */
export function makeProposals({ latest, players, view = null, nowMs = Date.now() }) {
  const none = { proposals: [], conflicts: [], stale: null };
  if (!isObj(latest?.teams) || !Array.isArray(players) || !isObj(view)) return none;
  const slate = latest.slate ?? "", byId = new Map(players.map((p) => [String(p.dk_id), p]));
  const stale = staleOf(latest, nowMs);
  const nameOf = (id, fallback) => byId.get(id)?.name ?? fallback ?? "a player not on this slate"; // never a raw id in the words (G62: said, not dropped)
  const proposals = [], conflicts = [];
  for (const team of Object.keys(latest.teams)) {
    const v = view[team];
    if (!v) continue;
    const claims = claimsFor(latest, team), consoleOut = new Set(v.outs ?? []), roles = v.roles ?? {};
    const marks = v.marks ?? {}, markedOut = new Set(marks.out ?? []), markedS = new Set(marks.s ?? []), typed = new Set(marks.typed ?? []), markedIn = new Set(marks.in ?? []), benched = new Set(marks.benched ?? []);
    const settled = settledFive(latest, team);
    let q = settled.first;
    const clash = outVsFive(claims);
    if (q.conflict || clash.length) {
      const names = clash.map((c) => nameOf(c.id, c.outs[0].name));
      conflicts.push(conflictRow(slate, team, latest, q.conflict ?? `${names.join(", ")} ${clash.length > 1 ? "are" : "is"} Out in one feed and in the five in another`, names));
      continue;
    }
    for (const [id, cl] of claims.out) {
      const p = byId.get(id), typedProj = isNum(p?.ovr?.projection) && v.appliedTo?.[id] !== p.ovr.projection; // his own number, not one an Apply wrote
      if (consoleOut.has(id) || !(v.min?.[id] > 0 || (roles[id] !== undefined && (typed.has(id) || typedProj || markedS.has(id))))) continue; // the console has him out, or does not know him, or he is on no minutes with nothing of Adam's holding a number or an S up
      if (markedIn.has(id)) continue; // he put him back in himself: no Out
      const sources = [...new Map(cl.map((c) => [c.key, { key: c.key, label: LABEL[c.key], at: c.at, lineup: c.lineup, detail: c.detail }])).values()].sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
      const name = nameOf(id, cl[0].name), near = cl.some((c) => c.near);
      proposals.push({
        id: `${slate}|${team}|out|${id}`, kind: "out", team, player: { id, name },
        text: `${labelsOf(sources)}: Out: ${name}${typed.has(id) || typedProj || markedS.has(id) ? ` — overrides your ${[typed.has(id) || typedProj ? "typed numbers" : "", markedS.has(id) ? "S" : ""].filter(Boolean).join(" and ")}` : ""}`, // an override of his own marks is said in the row, not left to the hover
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
      q = settled.q;
    }
    const usedMen = q.used.flatMap((k) => latest.teams[team][k].men);
    const unmatched = [...new Set(usedMen.filter((m) => m.id == null).map((m) => m.name))];
    const unknown = [...new Set(usedMen.filter(unknownStatus).map((m) => `${m.name} (${statusWords(m.status)})`))];
    if (unmatched.length) conflicts.push(checkRow(slate, team, "unmatched", `${team}: ${unmatched.join(", ")} in a lineup ${unmatched.length > 1 ? "are" : "is"} not matched to a slate player; no start proposed.`, unmatched));
    if (unknown.length) conflicts.push(checkRow(slate, team, "unknown", `${team}: ${unknown.join(", ")} in a lineup ${unknown.length > 1 ? "have" : "has"} a status that was not recognised; no start proposed.`, unknown));
    if (unmatched.length || unknown.length) continue;
    if ([...markedS].some((id) => !q.five.has(id))) continue; // a man he marked S is not in the sources' five: their five contradicts his mark
    const outNow = (id) => consoleOut.has(id) || markedOut.has(id) || claims.out.has(id);
    // A man he sent to the bench or out of the rotation is never proposed to start.
    const incoming = [...q.q].filter((id) => roles[id] !== undefined && roles[id] !== "starter" && !outNow(id) && !benched.has(id)).sort((a, b) => (v.min?.[b] ?? 0) - (v.min?.[a] ?? 0) || a.localeCompare(b));
    if (!incoming.length) continue;
    const missing = Object.entries(roles).filter(([id, r]) => r === "starter" && !outNow(id) && !q.five.has(id)).map(([id]) => id).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    if (missing.some((id) => typed.has(id))) continue; // the five would bench a man whose numbers he typed: his mark wins
    if (Object.entries(roles).filter(([id, r]) => r === "starter" && !outNow(id) && q.five.has(id)).length + incoming.length > 5) continue; // never a start with no one going to the bench
    if (missing.length && missing.length !== incoming.length) {
      conflicts.push(conflictRow(slate, team, latest, `the console starts ${missing.map((id) => nameOf(id)).join(", ")}, not in the five, and ${incoming.length} men are to start`, missing));
      continue;
    }
    const sources = q.used.filter((k) => incoming.some((id) => idsOf(latest.teams[team][k]).has(id))).map((k) => ({ key: k, label: LABEL[k], at: sourceTime(latest, k), lineup: latest.teams[team][k].confirmed ? "confirmed" : "projected", detail: null }));
    const word = sources.every((s) => s.lineup === "confirmed") ? "confirmed" : sources.some((s) => s.lineup === "confirmed") ? "one confirmed" : "projected";
    const ins = incoming.map((id) => ({ id, name: nameOf(id) })), outs = missing.map((id) => ({ id, name: nameOf(id) }));
    const tg = incoming.map((id) => mins(tgMin(byId.get(id)))).join(", ");
    proposals.push({
      id: `${slate}|${team}|starter|${hashOf(JSON.stringify([...q.five].sort()))}`, kind: "starter", team, player: ins[0], players: ins, bench: outs,
      text: `${labelsOf(sources)}: START: ${ins.map((m) => m.name).join(", ")}${outs.length ? ` · Bench: ${outs.map((m) => m.name).join(", ")}` : ""}`,
      detail: `${word[0].toUpperCase()}${word.slice(1)}; TwoGun has ${ins.length > 1 ? "them at" : "him at"} ${tg} min${ins.length === 1 ? `; the console has him on ${roles[incoming[0]] === "bench_plus" ? "Bench+" : roles[incoming[0]]}` : ""}`,
      sources, twogun: { minutes: tgMin(byId.get(incoming[0])) ?? null },
      actions: [{ fn: "setStarters", team, starters: incoming, bench: missing }], // console-card.js autoApplyProposal: the five-starter move that puts these men in and those out
      signature: JSON.stringify({ kind: "starter", in: incoming, out: missing, s: sources.map((s) => [s.key, s.lineup]) }),
    });
  }
  if (stale) for (const p of proposals) p.noApply = `the lineup read is ${stale.ageMin == null ? "of unknown age" : `${stale.ageMin} minutes old`}, so nothing from it is made by itself until the next pull`;
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
