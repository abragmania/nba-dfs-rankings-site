// Board self-check 4 (G65): no man hidden by a lower-ranked source. The source of a man's Out is the ENGINE'S OWN reason (ours.marks.status.text, the words minutes/inputs.js newsOutsOf wrote), never a rebuilt claim.
// A man the board shows Out whose reason is lower-ranked than a source that has him in its five is a failure; a reason naming no known source while any page's five has him is a failure too; an equal-rank
// clash (TwoGun's board Out against a confirmed five) is a named conflict, neither pass nor failure: which source wins is Adam's call, not decided here.
// The ranking is the code's own (server/board/lineup-proposals.js), written once here:
//   Monster news Out (an injury card) 4 > TwoGun's board Out and a CONFIRMED Monster or RotoWire five 3 > a projected page, and RotoGrinders however confirmed (BACKS_ONLY: it never settles alone) 2;
//   within a rank the page order Monster, RotoWire, RotoGrinders breaks the tie (lineup-proposals.js: Monster wins a tie), by 0.1 a place.
// A man Adam marked Out himself passes. The lineup read is used only while fresh, as the engine does; otherwise each Out man is named as not compared.
import { nameKey } from "../lib/names.js";
import { LINEUP_KEYS, LINEUP_LABEL, BACKS_ONLY, staleOf } from "../board/lineup-proposals.js";

export const CHECK = "hidden_by_lower_source";
const RANK_NEWS = 4, RANK_BOARD = 3, RANK_PAGE_CONFIRMED = 3, RANK_PAGE = 2;

/** A claim's rank. key: "board" | "monster_news" | a page key; confirmed: the page's own confirmed mark. */
export function rankOf(key, confirmed = false) {
  if (key === "monster_news") return RANK_NEWS;
  if (key === "board") return RANK_BOARD;
  const place = LINEUP_KEYS.indexOf(key);
  return (confirmed && !BACKS_ONLY.includes(key) ? RANK_PAGE_CONFIRMED : RANK_PAGE) - 0.1 * Math.max(0, place);
}
const labelOf = (c) => (c.key === "board" ? "TwoGun's board" : c.key === "monster_news" ? "Monster news" : `${LINEUP_LABEL[c.key] ?? c.key}${c.confirmed ? " (confirmed)" : " (projected)"}`);
const ok = (b) => b?.state === "ok" && Array.isArray(b.men);
const best = (list) => list.reduce((a, b) => (b.rank > a.rank ? b : a));
const claim = (key, confirmed) => ({ key, confirmed, rank: rankOf(key, confirmed) });

/** The pages that list a man in their five, by name (a page's own Out marks are not read: the engine's reason is the Out source). [claim] */
export function fiveClaims(latest, team, name) {
  const k = nameKey(name), block = latest.teams?.[team] ?? {}, out = [];
  for (const key of LINEUP_KEYS) {
    const b = block[key];
    if (ok(b) && b.men.some((m) => m.status !== "Out" && nameKey(m.name) === k)) out.push(claim(key, b.confirmed === true));
  }
  return out;
}

/** The sources an engine reason names: [claim]. "TwoGun" is the board; "Monster news" the injury card; a page by its label (its confirmed mark read from the lineup read). [] when it names none. */
export function sourcesOfReason(text, latest, team) {
  const t = String(text ?? ""), out = [];
  if (/TwoGun/i.test(t)) out.push(claim("board", false));
  if (/Monster news/.test(t)) out.push(claim("monster_news", false));
  const pages = t.replace(/Monster news/g, "");
  for (const key of LINEUP_KEYS) if (new RegExp(`\\b${LINEUP_LABEL[key]}\\b`).test(pages)) out.push(claim(key, latest?.teams?.[team]?.[key]?.confirmed === true));
  return out;
}

/** The men the board shows Out: board rows the engine has not playing (his own Out aside) with the engine's reason, and the slate's Out list (TwoGun's board). [{ name, team, dk_id, reason, listed }] */
function outMen(slate, players) {
  const men = [], seen = new Set();
  for (const p of players) {
    if (p.ours?.playing !== false || p.ours?.marks?.status?.by === "you") continue;
    seen.add(`${p.team}|${nameKey(p.name)}`);
    men.push({ name: p.name, team: p.team, dk_id: String(p.dk_id), reason: p.ours?.marks?.status?.text ?? (p.ours?.why ?? []).join("; "), listed: false });
  }
  for (const o of Array.isArray(slate?.out) ? slate.out : []) {
    if (seen.has(`${o.team}|${nameKey(o.name)}`)) continue;
    men.push({ name: o.name, team: o.team, dk_id: null, reason: Array.isArray(o.sources) && o.sources.includes("twogun_row") ? "Out on TwoGun's board" : "", listed: true });
  }
  return men;
}

/** Returns the failures; adds to `un` (named groups of what could not be compared) and to `conflicts` (equal-rank clashes). */
export function checkHiddenByLowerSource({ slate, players, lineups, nowMs }, un, conflicts = []) {
  const men = outMen(slate, players), bad = [];
  if (!men.length) return bad;
  const latest = lineups?.state === "ok" ? lineups.latest : null, stale = latest ? staleOf(latest, nowMs) : null;
  if (!latest || stale) {
    const why = !lineups ? "no lineup read was given to the check" : stale ? `the lineup read is ${stale.ageMin ?? "of unknown"} minutes old and the engine does not use it` : `the lineup read is ${lineups.state}${lineups.why ? ` (${lineups.why})` : ""}`;
    for (const m of men) un.add(CHECK, `${why}, so a man shown Out cannot be compared with the lineup pages`, `${m.name} (${m.team})`, 1, 99);
    return bad;
  }
  for (const m of men) {
    const fives = fiveClaims(latest, m.team, m.name);
    if (!fives.length) continue;
    const outs = sourcesOfReason(m.reason, latest, m.team), f = best(fives), row = { check: CHECK, dk_id: m.dk_id, name: m.name, team: m.team, shown: "Out", expected: "playing" };
    if (!outs.length) { bad.push({ ...row, why: `${m.name} is shown Out with no known source for it (${m.reason || "no reason given"}), but ${labelOf(f)} has him in its five` }); continue; }
    const o = best(outs);
    if (o.rank < f.rank) bad.push({ ...row, why: `${m.name} is shown Out because ${outs.map(labelOf).join(" and ")} said so, but ${labelOf(f)}, which ranks higher, has him in its five` });
    else if (o.rank === f.rank) conflicts.push({ ...row, shown: "Out", expected: "undecided", why: `${m.name} is shown Out by ${outs.map(labelOf).join(" and ")}, but ${labelOf(f)} has him in its five; they rank the same, so nothing is decided here` });
  }
  return bad;
}
