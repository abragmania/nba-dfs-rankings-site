// Lineup proposals (Adam, 11-06): what the news sources say against what the console shows for Tonight. Pure ES module shared by the page and
// the tests; it reads nothing and applies nothing. Input is news/lineups/latest.json (tools/lineups_read.mjs), the slate's players (names and
// TwoGun's minutes), `view`, the console's Tonight scenario { <team>: { roles: { id: role }, outs: [id], min: { id: minutes on screen } } } and `nowMs`.
// Without a view nothing is proposed: whether a man starts or plays comes only from the console. view[team].marks ({ out, s, typed }: his own marks)
// win over every source: no Out is proposed for a man he marked Out, marked S or typed numbers for, and no start is proposed for a team where a man he
// marked S is not in the sources' five.
//   "out"     a man Out by Monster's player news, Monster's lineup page or RotoWire, whom the console still has playing (minutes above 0).
//   "starter" the men both lineup sources list in the five, or one source lists with its lineup Confirmed / Verified, whom the console does not
//             start: ONE proposal for the team, its action `setStarters` naming every man to start and every console starter the sources' five leaves
//             out (who replaces whom is not decided here; the five that results is).
// Rows that are not proposals (kind "conflict", "unmatched" or "unknown", Dismiss only): the sources disagree about a team (two confirmed fives that
// differ, or a man Out in one feed and in another's five); a man in a used five has no id on the slate; a man in a used five has a status that was
// not recognised; the console's starters left out of the five and the men to start do not match in number.
// Applying (Adam, 11-07): there is no Apply button. isAuto says which proposals apply themselves (an Out; a start only from confirmed lineups) and
// autoPlan which of those are new; the rest are words only. Marks win: a man he put back in gets no Out, and a man he benched gets no start.
// A proposal built from a name matched only nearly (match "near") on an Out has `nearApply` (no Apply); when the read is over 90 minutes old, or
// of unknown age, every proposal has `noApply` and `stale` says so.
/** A source's words on a man are cut to this many characters, so no proposal grows past what the saved record holds. */
const DETAIL_MAX = 160;
const ORDER = ["monster", "monster_news", "rotowire"]; // the order sources are named in
const LABEL = { monster: "Monster", monster_news: "Monster", rotowire: "RotoWire" };
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
const tgMin = (p) => (isNum(p?.base_minutes) ? p.base_minutes : p?.minutes);
/** A short stable hash (djb2, base 36): a start proposal's id is the sources' five alone, so a changed five is new news and the same five from another source is not (Adam, 11-07). */
export const hashOf = (text) => { let h = 5381; for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0; return h.toString(36); };
const mins = (v) => (isNum(v) ? `${Math.round(v * 10) / 10}` : "?");

const sourceTime = (latest, key) => (key === "monster_news" ? latest.monster_news?.fetched_at : latest.sources?.[key]?.fetched_at) ?? null;
const labelsOf = (sources) => [...new Set(sources.map((s) => LABEL[s.key]))].join(" + ");
const unknownStatus = (m) => String(m.status ?? "").startsWith("UNKNOWN");
/** An unrecognised status as words only: "UNKNOWN(Q #123456 Questionable)" becomes "Q Questionable"; a colour code is never shown. */
export const statusWords = (s) => String(s ?? "").replace(/^UNKNOWN\((.*)\)$/, "$1").replace(/\s*#[0-9A-Fa-f]{3,8}\b/g, "").replace(/\s+/g, " ").trim() || "unreadable";

/** The Out claims and the in-five claims on one team, by man id: { out: Map(id -> [claim]), five: Map(id -> [claim]) }. A claim is { key, at, lineup, detail, name, near }. */
function claimsFor(latest, team) {
  const out = new Map(), five = new Map();
  const add = (map, m, claim) => { if (m.id != null) map.set(m.id, [...(map.get(m.id) ?? []), { ...claim, name: m.name, near: m.match === "near" }]); };
  const block = latest.teams?.[team] ?? {};
  for (const key of ["monster", "rotowire"]) {
    const b = block[key];
    if (!okBlock(b)) continue;
    const at = sourceTime(latest, key), lineup = b.confirmed ? "confirmed" : "projected";
    for (const m of b.men) add(m.status === "Out" ? out : five, m, { key, at, lineup, detail: m.status === "Out" ? `${String(m.flag ?? "Out").slice(0, DETAIL_MAX)} in its five` : null });
    for (const m of Array.isArray(b.may_not_play) ? b.may_not_play : []) if (m.status === "Out") add(out, m, { key, at, lineup: null, detail: `${String(m.flag ?? "Out").slice(0, DETAIL_MAX)} on MAY NOT PLAY` });
  }
  const news = latest.monster_news;
  if (news?.status === "ok") for (const m of Array.isArray(news.out) ? news.out : []) if (m.team === team) add(out, m, { key: "monster_news", at: news.fetched_at ?? null, lineup: null, detail: String(m.detail ?? "Out").slice(0, DETAIL_MAX) });
  return { out, five };
}

/** Two feeds disagree about a man when one has him Out and a different feed lists him in its five. */
function outVsFive(claims) {
  const rows = [];
  for (const [id, outs] of claims.out) {
    const fives = (claims.five.get(id) ?? []).filter((f) => outs.some((o) => o.key !== f.key));
    if (fives.length) rows.push({ id, outs, fives });
  }
  return rows;
}

const idsOf = (b) => new Set(b.men.map((m) => m.id).filter((id) => id != null));
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/** The five for one team: { q: ids that qualify to start, five: ids counted as the sources' five, used: sources in play, conflict: text|null }. */
function qualifying(latest, team) {
  const b = latest.teams?.[team] ?? {};
  const oks = ["monster", "rotowire"].filter((k) => okBlock(b[k]));
  const confs = oks.filter((k) => b[k].confirmed);
  const none = { q: new Set(), five: new Set(), used: oks, conflict: null };
  if (confs.length === 2 && !sameSet(idsOf(b.monster), idsOf(b.rotowire))) return { ...none, conflict: "both lineups are confirmed and they differ" };
  if (confs.length) {
    const q = new Set([...idsOf(b[confs[0]])].filter((id) => confs.every((k) => idsOf(b[k]).has(id))));
    return { q, five: q, used: confs, conflict: null };
  }
  if (oks.length === 2) return { q: new Set([...idsOf(b.monster)].filter((id) => idsOf(b.rotowire).has(id))), five: new Set([...idsOf(b.monster), ...idsOf(b.rotowire)]), used: oks, conflict: null };
  return none;
}

const sideText = (b, name) => (okBlock(b) ? `${name}${b.confirmed ? " (confirmed)" : " (projected)"}: ${b.men.map((m) => m.name).join(", ")}` : `${name}: ${b?.note ?? "not read"}`);

function conflictRow(slate, team, latest, why, names) {
  const b = latest.teams?.[team] ?? {};
  return {
    id: `${slate}|${team}|conflict`, kind: "conflict", team,
    text: `${team}: the sources disagree (${why}); nothing proposed.`,
    sides: [sideText(b.monster, "Monster"), sideText(b.rotowire, "RotoWire")],
    signature: JSON.stringify({ why, names, m: okBlock(b.monster) ? b.monster.men.map((m) => m.name) : null, r: okBlock(b.rotowire) ? b.rotowire.men.map((m) => m.name) : null }),
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
  const nameOf = (id, fallback) => byId.get(id)?.name ?? fallback ?? id;
  const proposals = [], conflicts = [];
  for (const team of Object.keys(latest.teams)) {
    const v = view[team];
    if (!v) continue;
    const claims = claimsFor(latest, team), consoleOut = new Set(v.outs ?? []), roles = v.roles ?? {};
    // His own marks win over any news (Adam, 11-07): a proposal that would undo or contradict one is dropped, never offered.
    const marks = v.marks ?? {}, markedOut = new Set(marks.out ?? []), markedS = new Set(marks.s ?? []), typed = new Set(marks.typed ?? []), markedIn = new Set(marks.in ?? []), benched = new Set(marks.benched ?? []);
    const q = qualifying(latest, team), clash = outVsFive(claims);
    if (q.conflict || clash.length) {
      const names = clash.map((c) => nameOf(c.id, c.outs[0].name));
      conflicts.push(conflictRow(slate, team, latest, q.conflict ?? `${names.join(", ")} ${clash.length > 1 ? "are" : "is"} Out in one feed and in the five in another`, names));
      continue;
    }
    for (const [id, cl] of claims.out) {
      if (consoleOut.has(id) || !(v.min?.[id] > 0)) continue; // the console has him out, or not playing, or does not know him
      if (markedIn.has(id)) continue; // he put him back in himself: no Out, ever. An Out is a fact otherwise: it applies over his typed numbers or S, and says so
      const p = byId.get(id);
      const sources = [...new Map(cl.map((c) => [c.key, { key: c.key, label: LABEL[c.key], at: c.at, lineup: c.lineup, detail: c.detail }])).values()].sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
      const name = nameOf(id, cl[0].name), near = cl.some((c) => c.near);
      proposals.push({
        id: `${slate}|${team}|out|${id}`, kind: "out", team, player: { id, name },
        text: `${labelsOf(sources)}: ${name} OUT (TwoGun still ${mins(tgMin(p))} min)${typed.has(id) || markedS.has(id) ? `; overrides your ${[typed.has(id) ? "typed numbers" : "", markedS.has(id) ? "S" : ""].filter(Boolean).join(" and ")}` : ""}`,
        sources, twogun: { minutes: tgMin(p) ?? null },
        actions: [{ fn: "setRole", team, id, role: "out" }],
        ...(near ? { nearApply: "the source's name for him matched only nearly, so it is not made by itself; check him by hand" } : {}),
        signature: JSON.stringify({ kind: "out", id, s: sources.map((s) => [s.key, s.detail]) }),
      });
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
      text: `${labelsOf(sources)}: ${ins.map((m) => m.name).join(", ")} ${ins.length > 1 ? "START" : "STARTS"}${outs.length ? `; ${outs.map((m) => m.name).join(", ")} to the bench` : ""} (${word}; TwoGun ${tg} min${ins.length === 1 ? `, console has him ${roles[incoming[0]] === "bench_plus" ? "Bench+" : roles[incoming[0]]}` : ""})`,
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
  return p.kind === "starter" && p.sources.length > 0 && p.sources.every((s) => s.lineup === "confirmed");
}

/**
 * What the bar does with a read: { apply: [proposals to apply now], info: [proposals shown as words only] }. `news`: { team: { id: entry } }, the console's
 * record (console-card.js). A proposal applies once per id: once applied or undone it is never offered or applied again, whatever he did since; a failed one
 * is tried again only when its news changes.
 */
export function autoPlan(result, news = {}) {
  const apply = [], info = [];
  for (const p of result.proposals) {
    const e = news[p.team]?.[p.id];
    if (e && (e.state !== "failed" || e.sig === hashOf(String(p.signature)))) continue; // sig is the hash of its news (console-card.js)
    (p.auto ? apply : info).push(p);
  }
  return { apply, info };
}

/** What stays on the bar after his dismissals: `dismissed` is { id: signature }; a row returns when its sources change (its signature differs). */
export function visible(result, dismissed = {}) {
  const keep = (r) => dismissed[r.id] !== r.signature;
  return { ...result, proposals: result.proposals.filter(keep), conflicts: result.conflicts.filter(keep) };
}
