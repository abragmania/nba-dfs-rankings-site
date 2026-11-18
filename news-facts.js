// The Console's news list (Adam 2:58-3:25 PM 11-17: one plain list of tonight's news, newest first, filterable by team): the News tab's items cleaned into facts. Pure and DOM-free (tested in node;
// the same file runs on the public site). It reads what newsModel already built (model.log: feedEntries from Monster's cards, foundEntries from the 5-minute lineup check's finds) and the proposals'
// conflict rows; it fetches nothing. Rules: a card is one fact; the check's "+A -B" lines become START facts, the same fact from several sources one fact with a chip each; the vague notes
// ("a man's status changed", "may-not-play list changed", "a new report") and the "Monster news: X new to Out" roll-up are folded into the fact they support (a source chip), never shown as lines of
// their own; every fold is counted (G62) and the count is shown at the foot. A source conflict is a line only after it has held (conflictHold). Nothing here is dropped without a count.
import { tgMin } from "./lineup-proposals.js";
import { timeLabel } from "./news-model.js";

const ms = (iso) => { const t = Date.parse(iso ?? ""); return Number.isNaN(t) ? null : t; };
const LOOK_KEYS = ["monster", "rotowire", "rotogrinders"];

/** How long a source conflict must have held before it shows (Adam 3:25 PM 11-17: "don't pop up disagreements in my face ... unless they persist for a while"): in every lineup check across at least this many minutes. */
export const CONFLICT_HOLD_MIN = 15;
/** The 5-minute lineup check's cadence; a run of checks with a gap of more than two of them (a missed or paused check) is not "every check", so it does not count. */
export const CHECK_EVERY_MIN = 5;
const SAME_CHECK_MS = 2 * 60_000; // looks of the three pages within this of each other are one check

/**
 * Whether the lineup read's conflicts have held long enough to show, from the checks' own stamps and no page clock: the saved read is rewritten only when a check finds a difference, so the
 * newest source read time (`since`) is when the pages last changed; each check since then recorded a look (latest.look[source].history, the check's own stamp) and found nothing new, so the
 * same disagreement stood in all of them. Held when, from `since`, there are at least three checks, no gap between them over two cadences, and the newest is CONFLICT_HOLD_MIN or more after `since`.
 * A Pull now rewrites the read and restarts the count (never early, only late). With no looks (the public site) nothing holds. Returns { held, since, checks, newest, why }.
 */
export function conflictHold(latest, nowMs) {
  const none = (why, extra = {}) => ({ held: false, since: null, checks: 0, newest: null, why, ...extra });
  if (!latest || typeof latest !== "object") return none("no lineup read");
  const reads = [...LOOK_KEYS.map((k) => ms(latest.sources?.[k]?.fetched_at) ?? ms(latest.sources?.[k]?.last_good_at)), ms(latest.monster_news?.changed_at) ?? ms(latest.monster_news?.fetched_at)].filter((t) => t !== null);
  if (!reads.length) return none("no read time");
  const since = Math.max(...reads);
  const stamps = LOOK_KEYS.flatMap((k) => (Array.isArray(latest.look?.[k]?.history) ? latest.look[k].history.map(ms) : [])).filter((t) => t !== null && t <= nowMs && t >= since - SAME_CHECK_MS).sort((a, b) => a - b);
  const checks = [];
  for (const t of stamps) if (!checks.length || t - checks[checks.length - 1] > SAME_CHECK_MS) checks.push(t);
  if (!checks.length) return none("no check since the read", { since });
  const run = checks[0] - since > SAME_CHECK_MS ? [since, ...checks] : checks; // a read with no check at its own moment starts the run at the read
  const newest = run[run.length - 1], gapOk = run.every((t, i) => i === 0 || t - run[i - 1] <= 2 * CHECK_EVERY_MIN * 60_000);
  const held = run.length >= 3 && gapOk && newest - since >= CONFLICT_HOLD_MIN * 60_000;
  return { held, since, checks: run.length, newest, why: held ? null : !gapOk ? "a check is missing in between" : run.length < 3 ? "fewer than three checks since" : `held ${Math.round((newest - since) / 60000)} of ${CONFLICT_HOLD_MIN} minutes` };
}

const KIND_OF_WORD = [[/^out$/i, "OUT"], [/question/i, "Q"], [/doubt/i, "D"], [/probable/i, "P"], [/^(available|playing|active|starting)$/i, "IN"]];
const kindOfWord = (w) => KIND_OF_WORD.find(([re]) => re.test(String(w ?? "").trim()))?.[1] ?? "NOTE";
const CARD_KIND = { PROB: "P" };
const SOURCES = { Monster: "Monster", RotoWire: "RotoWire", RotoGrinders: "RotoGrinders", "Monster news": "Lineup check" };
const VAGUE = /(status changed|list changed|new report)$/i;
const lower = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const addSrc = (f, s) => { if (s && !f.srcs.includes(s)) f.srcs.push(s); };

/** "+Terrence Shannon -Jonathan Kuminga" -> { plus: ["Terrence Shannon"], minus: ["Jonathan Kuminga"] }; a name with a hyphen inside stays whole. */
function moves(part) {
  const out = { plus: [], minus: [] };
  for (const tok of part.split(/\s(?=[+-]\S)/)) { const m = /^([+-])(\S.*)$/.exec(tok.trim()); if (m) out[m[1] === "+" ? "plus" : "minus"].push(m[2].trim()); }
  return out;
}

/**
 * The facts of the news list: { facts, folded: { vague, attached, repeats, rollup, byTeam }, held, watching, since }. `log`: newsModel's log (feed and found entries); `players`: the slate's rows (minutes for
 * a start); `conflicts`: makeProposals' conflict rows not hidden by him; `latest`, `nowMs`: for conflictHold; `day`: the slate's Eastern date. Each fact: { id, at, time, team, kind (OUT, Q, D, P, IN, START, BENCH,
 * NOTE, INFO, CHECK), name, detail, mins, react, srcs, title, plain?, conflict? }, newest first (no time last). A conflict shows only once held; one still being watched is counted in `watching`.
 */
export function newsFacts({ log = [], players = [], conflicts = [], latest = null, nowMs = Date.now(), day = null }) {
  const folded = { vague: 0, attached: 0, repeats: 0, rollup: 0, byTeam: {} }; // byTeam: vague notes per team, for the team page's own foot line
  const facts = [], byKey = new Map();
  const mine = new Map((players ?? []).map((p) => [`${p.team}|${lower(p.name)}`, p]));
  const minsOf = (team, name) => { const p = mine.get(`${team}|${lower(name)}`), v = p ? tgMin(p) : null; return Number.isFinite(v) ? v.toFixed(1) : null; };
  const push = (f, key) => { if (key && byKey.has(key)) return byKey.get(key); facts.push(f); if (key) byKey.set(key, f); return f; };
  const feed = log.filter((e) => !e.found), found = log.filter((e) => e.found);
  for (const e of feed) {
    const kind = CARD_KIND[e.kind] ?? e.kind, key = `${e.team}|${lower(e.name)}|${kind}|${lower(e.said)}`;
    if (byKey.has(key)) { const was = byKey.get(key); folded.repeats++; if ((e.at ?? -Infinity) > (was.at ?? -Infinity)) Object.assign(was, { at: e.at, time: e.time, mins: e.mins, react: e.react, title: e.title, effectTitle: e.effectTitle }); continue; } // the same man's same report posted twice: the newest stands, counted
    push({ id: `c:${e.id}`, at: e.at, time: e.time, team: e.team, kind, name: e.name, detail: e.said ?? (kind === "INFO" || kind === "NOTE" ? e.word ?? null : null), mins: e.mins ?? null, react: e.react ?? null, srcs: [e.src ?? "Monster"], title: e.title, effectTitle: e.effectTitle }, key);
  }
  const support = (team, at) => facts.filter((f) => f.team === team && f.at != null && f.at <= at + SAME_CHECK_MS && at - f.at <= 60 * 60_000).sort((a, b) => b.at - a.at)[0] ?? null;
  for (const e of found) {
    const m = /^(Monster news|Monster|RotoWire|RotoGrinders): (.*)$/.exec(String(e.raw ?? "")), label = m ? SOURCES[m[1]] : null, body = m ? m[2] : String(e.raw ?? "");
    if (m?.[1] === "Monster news") { // the roll-up of Monster's own cards ("X new to Out, Y new to Questionable"): each man is already a fact; the match gets the check's chip
      for (const part of body.split(", ")) {
        const r = /^(.+) (\S+) to (\S.*)$/.exec(part);
        if (!r) { push({ id: `f:${e.id}:${part}`, at: e.at, time: e.time, team: e.team || null, kind: "NOTE", name: null, plain: part, detail: null, mins: null, react: null, srcs: [label], title: e.title }); continue; }
        const kind = kindOfWord(r[3]), hit = facts.find((f) => lower(f.name) === lower(r[1]) && f.kind === kind && f.at != null && Math.abs(f.at - e.at) <= 90 * 60_000);
        if (hit) { addSrc(hit, label); folded.rollup++; continue; }
        const p = (players ?? []).find((x) => lower(x.name) === lower(r[1]));
        push({ id: `f:${e.id}:${r[1]}`, at: e.at, time: e.time, team: p?.team ?? null, kind, name: r[1], detail: r[2] === "new" ? null : `was ${r[2]}`, mins: p ? minsOf(p.team, r[1]) : null, react: null, srcs: [label], title: e.title });
      }
      continue;
    }
    const plus = [], minus = [];
    for (const part of body.split(", ")) {
      if (/^[+-]\S/.test(part)) { const mv = moves(part); plus.push(...mv.plus); minus.push(...mv.minus); } else if (VAGUE.test(part)) {
        folded.vague++;
        folded.byTeam[e.team] = (folded.byTeam[e.team] ?? 0) + 1;
        const hit = support(e.team, e.at);
        if (hit) { addSrc(hit, label); folded.attached++; }
      } else push({ id: `f:${e.id}:${part}`, at: e.at, time: e.time, team: e.team || null, kind: "NOTE", name: null, plain: part, detail: null, mins: null, react: null, srcs: [label].filter(Boolean), title: e.title });
    }
    const paired = plus.length === minus.length;
    plus.forEach((name, i) => {
      const f = push({ id: `f:${e.team}:${e.at}:in:${lower(name)}`, at: e.at, time: e.time, team: e.team, kind: "START", name, detail: paired ? `in for ${minus[i]}` : minus.length === 1 ? `in for ${minus[0]}` : "added to the five", mins: minsOf(e.team, name), react: null, srcs: [], title: e.title }, `s:${e.team}|${e.at}|${lower(name)}`);
      addSrc(f, label);
    });
    if (!paired && minus.length !== 1) minus.forEach((name) => { const f = push({ id: `f:${e.team}:${e.at}:out:${lower(name)}`, at: e.at, time: e.time, team: e.team, kind: "BENCH", name, detail: "out of the five", mins: minsOf(e.team, name), react: null, srcs: [], title: e.title }, `b:${e.team}|${e.at}|${lower(name)}`); addSrc(f, label); });
  }
  const hold = conflictHold(latest, nowMs), shownRows = hold.held ? conflicts : [];
  for (const r of shownRows) push({ id: r.id, at: hold.since, time: timeLabel(hold.since, { day, log: true }), team: r.team ?? null, kind: "CHECK", name: null, plain: r.text, detail: null, sides: r.sides ?? [], mins: null, react: null, srcs: [], title: r.text, conflict: { id: r.id, signature: r.signature } });
  facts.sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity));
  return { facts, folded, held: shownRows.length, watching: hold.held ? 0 : conflicts.length, since: hold.since, hold };
}
