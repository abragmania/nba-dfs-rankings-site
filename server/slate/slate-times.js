// A slate's lock and tips, and the one tip rule (Adam 11-18: each team takes late news until its own game tips). Pure, and under server/ so the site's browser modules (server/slate/resend.js)
// load it as it is; tools/board_day.mjs re-exports it for the tools.
import { tipMs, slateRefMs } from "../board/board-util.js";

/** A parsed slate.json's lock and latest game tip in milliseconds, each null on its own when unreadable (a lock with no tips keeps the lock). Pure. */
export function slateTimes(slate, refMs) {
  const lockMs = tipMs(typeof slate?.lock === "string" ? slate.lock : "", refMs);
  const tips = (Array.isArray(slate?.games) ? slate.games : []).map((g) => tipMs(typeof g?.tip === "string" ? g.tip : "", refMs)).filter((x) => Number.isFinite(x));
  return { lockMs: Number.isFinite(lockMs) ? lockMs : null, lastTipMs: tips.length ? Math.max(...tips) : null };
}

/** Each team's own cut from a parsed slate.json: Map team -> its game's tip in ms, the slate's lock when that tip does not read, null with neither. Pure. */
export function teamTips(slate, refMs) {
  const { lockMs } = slateTimes(slate, refMs), out = new Map();
  for (const g of Array.isArray(slate?.games) ? slate.games : []) {
    const tip = tipMs(typeof g?.tip === "string" ? g.tip : "", refMs), cut = Number.isFinite(tip) ? tip : lockMs;
    for (const t of [g?.away, g?.home]) if (typeof t === "string") out.set(t, cut);
  }
  return out;
}

/** The slate's cuts for tippedAt: { tips (teamTips), lockMs (null when it does not read) }. Pure. */
export const teamCuts = (slate, refMs) => ({ tips: teamTips(slate, refMs), lockMs: slateTimes(slate, refMs).lockMs });

/** A team's cut: its own tip, else the slate's lock (a team not on the slate's games, or a tip that does not read); NaN when neither reads. `own` says whether it is the team's own tip. Pure. */
export function teamCut(cuts, team) {
  const own = cuts?.tips?.get(team);
  if (Number.isFinite(own)) return { ms: own, own: true };
  return { ms: Number.isFinite(cuts?.lockMs) ? cuts.lockMs : NaN, own: false };
}

/** The one rule: a team counts as tipped at atMs when atMs is at or after its cut (teamCut); with no readable cut at all it counts as tipped (fails closed). Pure. */
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
