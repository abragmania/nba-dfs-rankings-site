// The console's reach outside its own screen: the calls the player card (card-role.js), the lineup bar and the board's own cells
// (board-marks.js) make to read and write the same work the console holds.
import { oursUse } from "./console-ours.js";
import { calc, plain } from "./console-model.js";
import { keyOf, outsOf } from "./console-engine.js";
import * as M from "./console-moves.js";
import { applyDirect } from "./console-applybox.js";
import { marksOf, newsOwned } from "./console-marks.js";
import { hashOf } from "./lineup-proposals.js";

/** A step with its send held: the moves of a proposal and of the player card are not sent by themselves. */
const heldBy = (c, fn) => { const was = c.holdSend; c.holdSend = true; try { return fn(); } finally { c.holdSend = was; } };
/** The teams marked as changed and waiting to go, as they were before a move that may be taken back. */
const keepSets = (c) => ({ touched: new Set(c.touched ?? []), pending: new Set(c.pending ?? []) });
/** Takes back every step after the history entry `base` with nothing sent: history cut there (no redo of half a move) and the changed-team sets as they were. */
function backOut(c, base, sets) {
  const from = c.G.hist.indexOf(base); // by the entry: an index goes stale when the 80-step cap drops the oldest
  if (from < 0) return;
  if (c.G.hi > from) heldBy(c, () => M.restore(c, from));
  c.G.hist.length = Math.min(c.G.hist.length, from + 1);
  c.touched = sets.touched; c.pending = sets.pending;
}

/**
 * The scenario each team is on, his marks included, for the lineup proposals (lineup-proposals.js): { team: { roles: { id: role }, outs: [id],
 * min: { id: minutes }, marks, news } }. marks are his own: { out: [men he marked Out beyond TwoGun's], s: [men he marked S], typed: [men with typed
 * minutes or DK/min], in: [men he put back in], benched: [men he sent to the bench or out of the rotation] }; how news treats them is the rule in lineup-proposals.js.
 * newsOut: the men an applied news Out still holds exactly as it left them; tonightOut: TwoGun's own Out list (both for server/slate/news-reverse.js). appliedTo: { id: the number an Apply wrote }, so a number an Apply wrote is not called his.
 * A move the lineup news made (an applied news entry's men) is the news's, never his mark. No page: the app's server reads it too (server/slate/news-apply.js).
 */
export function lineupViewOf(c) {
  const view = {};
  for (const [code, T] of Object.entries(c.model.TEAMS)) {
    const S = c.model.ST[code], outs = [...S.outs], rows = calc(T, S, outs).rows;
    const mine = S.pins[keyOf(S.outs)] ?? {}, tonight = new Set(outsOf(T.tonightKey));
    const byNews = newsOwned(S); // the news's only while a man is exactly as it left him; anything else is his own mark
    const flips = (roles) => Object.keys(mine.r ?? {}).filter((id) => roles.includes(mine.r[id]) && !byNews.r.has(id));
    const marks = {
      out: S.outs.filter((id) => !tonight.has(id) && !byNews.out.has(id)), s: flips(["starter"]), typed: [...new Set([...Object.keys(mine.m ?? {}), ...Object.keys(mine.d ?? {})])],
      in: [...tonight].filter((id) => !S.outs.includes(id)), benched: flips(["bench_plus", "bench", "oor"]), // a man he put back in; a man he sent to the bench or out of the rotation
      typedMin: { ...(mine.m ?? {}) }, typedRate: { ...(mine.d ?? {}) }, // which he typed, and the number: minutes (m) or DK per minute (d); `typed` above is both
    };
    view[code] = { outs: [...outs], roles: Object.fromEntries(rows.map((r) => [r.id, r.role])), min: Object.fromEntries(rows.filter((r) => typeof r.min === "number").map((r) => [r.id, r.min])), marks, news: structuredClone(S.news ?? {}), newsOut: [...byNews.out], tonightOut: [...tonight], appliedTo: c.applied?.set ?? {} };
  }
  return view;
}

/**
 * One lineup proposal applied: the console's role moves on the scenario the team is on, then the entry saved under the proposal's id with the men it moved, so its undo X takes back
 * only those. A move that fails is saved as failed with the reason, so it is not tried again on the same news. `atIso`: the entry's time. No page: the app's server applies through this (server/slate/news-apply.js).
 * Returns the entry.
 */
export function applyProposal(c, proposal, atIso = new Date().toISOString()) {
  const T = c.model.TEAMS[proposal.team], S = c.model.ST[proposal.team];
  const base = { sig: hashOf(String(proposal.signature)), at: atIso, text: proposal.text.slice(0, 600) };
  if (!T || !S) return base;
  const from = M.histMark(c), sets = keepSets(c), cur = () => c.model.ST[proposal.team], roleOf = (id) => calc(T, cur(), cur().outs).rows.find((r) => r.id === id)?.role, men = [];
  // An Out moves the team to a new scenario: the one he was on is kept even with role flips alone, so a reversal or his undo finds his S as it stood (a scenario with no typed numbers would otherwise be dropped).
  if (proposal.kind === "out") { const here = keyOf(S.outs); if (here !== T.tonightKey && here !== "" && S.pins[here] && !(S.shown ?? []).includes(here)) (S.shown ??= []).push(here); }
  let entry;
  try {
    for (const a of proposal.actions) {
      if (a.fn === "setStarters") {
        for (const [i, id] of a.starters.entries()) {
          const benchId = a.bench[i] ?? null;
          const moved = M.swapStarter(c, a.team, id, benchId);
          if (moved === null && roleOf(id) !== "starter") throw new Error(`${id} is not on the console for ${a.team}`);
          men.push({ id, kind: "r" }, ...(benchId ? [{ id: benchId, kind: "r" }] : []), ...(moved ?? []).filter((m) => m.id !== id && m.id !== benchId).map((m) => ({ id: m.id, kind: "r" })));
        }
      } else {
        const was = a.role === "out" ? cur().pins[keyOf(cur().outs)]?.r?.[a.id] : undefined; // the flip he had, so an undo or a reversal puts it back whichever scenario he lands on
        if (M.setRole(c, a.team, a.id, a.role) === null && roleOf(a.id) !== a.role) throw new Error(`${a.id} is not on the console for ${a.team}`);
        men.push({ id: a.id, kind: a.role === "out" ? "out" : "r", ...(was !== undefined ? { was } : {}) });
      }
    }
    // Each man with what the news set on him (to): he stays the news's only while he is still that (console-marks.js newsOwned).
    const flips = cur().pins[keyOf(cur().outs)]?.r ?? {};
    const withTo = [...new Map(men.map((m) => [`${m.kind}${m.id}`, m])).values()].map((m) => (m.kind === "out" ? { ...m, to: "out" } : flips[m.id] !== undefined ? { ...m, to: flips[m.id] } : null)).filter(Boolean);
    entry = { ...base, state: "applied", men: withTo };
    if (!withTo.length) throw new Error("the news moved nobody");
  } catch (e) {
    backOut(c, from, sets); // nothing half done is left behind, not even on the redo branch
    entry = { ...base, state: "failed", men: [], why: String(e.message).slice(0, 600) };
  }
  M.setNews(c, proposal.team, proposal.id, entry);
  M.foldHistory(c, from);
  return entry;
}

/** The card's calls. ensure(slate) loads the console's work for that slate without showing it. A man is found by his id, else by name and team (a man from the Out list has no slate id). */
export function cardApi(c, ensure) {
  const find = (who) => {
    for (const [code, T] of Object.entries(c.model.TEAMS)) {
      const p = (who.id != null && T.byId[String(who.id)]) || T.pl.find((x) => x.team === who.team && plain(x.name) === plain(who.name ?? ""));
      if (p) return { code, T, p };
    }
    return null;
  };
  /** The player card's own moves are not sent by themselves: its Apply checks and sends them in one step (applyDirect), so a refusal means nothing went. */
  const held = (fn) => heldBy(c, fn);
  /** A move from the player card: held for its Apply, with where it started kept from the first one, so a refused Apply can take them all back. */
  const cardMove = (fn) => { c.cardStart ??= { base: M.histMark(c), sets: keepSets(c), carried: false }; return held(fn); };
  return {
    /** { team, id, man, row (the scenario's row for him), moves (the five-starter rule's last moves on his team), saveErr, applied }, or null when he is not on any team of the slate. Throws when the console cannot load. */
    async manView(slate, who) {
      await ensure(slate);
      if (!c.model) throw new Error(c.loadError ?? "the console could not load");
      const hit = find(who);
      if (!hit) return null;
      const S = c.model.ST[hit.code];
      const row = calc(hit.T, S, S.outs).rows.find((r) => r.id === hit.p.id);
      const moves = c.G.roleMoves?.team === hit.code ? c.G.roleMoves.moved.map((m) => ({ ...m, name: hit.T.byId[m.id]?.name ?? m.id })) : [];
      return { team: hit.code, id: hit.p.id, man: hit.p, row, moves, saveErr: c.saveErrs[hit.code] ?? null, applied: c.applied };
    },
    /** The scenario each team is on (lineupViewOf). Throws when the console cannot load. */
    async lineupView(slate) {
      await ensure(slate);
      if (!c.model) throw new Error(c.loadError ?? "the console could not load");
      return lineupViewOf(c);
    },
    /**
     * For the board's rows (board-marks.js), each man on the slate by his id: { team, role, out, starterBy (why the app starts him: "yours", "chart" = the minutes engine's five
     * or "twogun"), marks (marksOf: his own marks with their live figures) }. Throws when the console cannot load.
     */
    async boardView(slate) {
      await ensure(slate);
      if (!c.model) throw new Error(c.loadError ?? "the console could not load");
      const view = {};
      for (const [code, T] of Object.entries(c.model.TEAMS)) {
        const S = c.model.ST[code], marks = marksOf(T, S), chart = oursUse(T).ok;
        for (const r of calc(T, S, S.outs).rows) {
          const mine = marks[r.id]?.r?.v === "starter" && !marks[r.id].r.news; // a start the confirmed news set is the news's, not his
          view[r.id] = { team: code, role: r.role, out: r.out, starterBy: r.role !== "starter" ? null : mine ? "yours" : chart ? "chart" : "twogun", tgStarter: r.p.starter === true, marks: marks[r.id] ?? null };
        }
      }
      return view;
    },
    /** One undo chip (console-marks.js): his mark of `kind` on the man comes off. */
    dropMark: (team, id, kind) => M.dropMark(c, team, id, kind),
    /** The public site's page applies a proposal to the visitor's own copy (applyProposal; on the app the server applies, server/slate/news-apply.js). Throws when the console cannot load. */
    async autoApplyProposal(slate, proposal) {
      await ensure(slate);
      if (!c.model) throw new Error(c.loadError ?? "the console could not load");
      return applyProposal(c, proposal);
    },
    /** The send's state for the board's line (console-auto.js syncWords reads it). */
    syncState: () => ({ ...(c.sync ?? { state: "ok" }), pending: [...(c.pending ?? [])].sort() }),
    /** The undo X on a lineup-news note (console-moves.js undoNews). */
    undoNews: (team, key) => M.undoNews(c, team, key),
    /** The player card's moves: held for its Apply (applyNow), never sent by themselves. */
    setRole: (team, id, role) => cardMove(() => M.setRole(c, team, id, role)),
    setPin: (team, id, k, v) => cardMove(() => M.setPin(c, team, id, k, v)),
    clearPin: (team, id, k) => cardMove(() => M.clearPin(c, team, id, k)),
    /** The board's Min and DK/m TON cells (board-marks.js): his typed number, sent at once. False when the man is Out in the console. */
    setMark: (team, id, k, v) => M.setPin(c, team, id, k, v),
    /** The card's Apply: checks and sends in one step. When the check refuses (err.notes), the card's held moves are taken back, so "nothing sent" stays true; a failure of any other kind leaves them on show and waiting. */
    async applyNow(team) {
      // One send owns the moves made since the last send (its start); a move made after this point opens a new start of its own. A refusal takes back only this send's moves,
      // and only when no other send has carried them and nothing has been done since (the history is where this send found it); otherwise they stay and the refusal says so.
      const start = c.cardStart, end = M.histMark(c);
      c.cardStart = null;
      if (start) (c.cardOwned ??= new Set()).add(start);
      try {
        return await applyDirect(c, team);
      } catch (e) {
        if (e.notes && start && !start.carried && M.histMark(c) === end) backOut(c, start.base, start.sets);
        throw e;
      } finally {
        c.cardOwned?.delete(start);
      }
    },
  };
}
