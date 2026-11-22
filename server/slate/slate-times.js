// A slate's lock and tips, and the one tip rule (Adam 11-18: each team takes late news until its own game tips). Pure, and under server/ so the site's browser modules (server/slate/resend.js)
// load it as it is; tools/board_day.mjs re-exports it for the tools.
import { tipMs, slateRefMs } from "../board/board-util.js";

/** A parsed slate.json's lock and latest game tip in milliseconds, each null on its own when unreadable (a lock with no tips keeps the lock). Pure. */
export function slateTimes(slate, refMs) {
  const lockMs = tipMs(typeof slate?.lock === "string" ? slate.lock : "", refMs);
  const tips = (Array.isArray(slate?.games) ? slate.games : []).map((g) => tipMs(typeof g?.tip === "string" ? g.tip : "", refMs)).filter((x) => Number.isFinite(x));
  return { lockMs: Number.isFinite(lockMs) ? lockMs : null, lastTipMs: tips.length ? Math.max(...tips) : null };
}

/** Each team's own tip text: its games row's tip; a team with no games row takes its first board man's tip (11-13 audit, model group). Map team -> ms or NaN when it does not read. Pure. */
function ownTips(slate, refMs) {
  const out = new Map();
  for (const g of Array.isArray(slate?.games) ? slate.games : []) {
    const tip = tipMs(typeof g?.tip === "string" ? g.tip : "", refMs);
    for (const t of [g?.away, g?.home]) if (typeof t === "string") out.set(t, tip);
  }
  for (const p of Array.isArray(slate?.players) ? slate.players : []) if (typeof p?.team === "string" && !out.has(p.team) && typeof p.tip === "string") out.set(p.team, tipMs(p.tip, refMs));
  return out;
}

/** Each team's own cut from a parsed slate.json: Map team -> its game's tip in ms (ownTips), the slate's lock when that tip does not read, null with neither. Pure. */
export function teamTips(slate, refMs) {
  const { lockMs } = slateTimes(slate, refMs), out = new Map();
  for (const [t, tip] of ownTips(slate, refMs)) out.set(t, Number.isFinite(tip) ? tip : lockMs);
  return out;
}

/** The slate's cuts for tippedAt: { tips (teamTips), lockMs (null when it does not read), unread (teams whose own tip does not read), firstTipMs (the earliest readable tip, null with none) }. Pure. */
export function teamCuts(slate, refMs) {
  const own = ownTips(slate, refMs), read = [...own.values()].filter((x) => Number.isFinite(x));
  return { tips: teamTips(slate, refMs), lockMs: slateTimes(slate, refMs).lockMs, unread: new Set([...own].filter(([, x]) => !Number.isFinite(x)).map(([t]) => t)), firstTipMs: read.length ? Math.min(...read) : null };
}

/**
 * A team's cut: its own tip; else the slate's lock (a team not on the slate's games, or a tip that does not read); else, with the lock unreadable too, the slate's EARLIEST readable tip (fails closed:
 * no team is judged open past the first game; 11-13 audit, model group); NaN when nothing reads. `own` says the team is in the tips map (as before); `by`: "tip" | "lock" | "first_tip" | null. Pure.
 */
export function teamCut(cuts, team) {
  const own = cuts?.tips?.get(team);
  if (Number.isFinite(own)) return { ms: own, own: true, by: cuts?.unread?.has(team) ? "lock" : "tip" };
  if (Number.isFinite(cuts?.lockMs)) return { ms: cuts.lockMs, own: false, by: "lock" };
  if (Number.isFinite(cuts?.firstTipMs)) return { ms: cuts.firstTipMs, own: false, by: "first_tip" };
  return { ms: NaN, own: false, by: null };
}

/** The one rule: a team counts as tipped at atMs when atMs is at or after its cut (teamCut: its tip, else the lock, else the earliest tip); with no readable cut at all it counts as tipped (fails closed). Pure. */
export const tippedAt = (cuts, team, atMs) => { const { ms } = teamCut(cuts, team); return !Number.isFinite(ms) || atMs >= ms; };

/**
 * A named slate's teams whose game has not tipped at nowMs, sorted (news, resend and reversal go on for them after lock; a game whose tip does not read is cut at the lock). None when the slate's
 * name has no date or its lock cannot be read (fails closed, as depth-store.js lockState). Pure.
 */
export function openTeams(slateName, slateData, nowMs) {
  const ref = slateRefMs(slateName);
  if (ref === null) return [];
  const cuts = teamCuts(slateData, ref + 6 * 3600e3);
  if (!Number.isFinite(cuts.lockMs)) return [];
  return [...cuts.tips.keys()].filter((t) => !tippedAt(cuts, t, nowMs)).sort();
}
