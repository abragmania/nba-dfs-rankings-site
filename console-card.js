// The console's reach outside its own screen: the calls the player card (card-role.js), the lineup bar and the board's own cells
// (board-marks.js) make to read and write the same work the console holds.
import { calc, plain } from "./console-model.js";
import { keyOf, outsOf } from "./console-engine.js";
import * as M from "./console-moves.js";
import { applyDirect } from "./console-applybox.js";
import { marksOf, newsOwned } from "./console-marks.js";
import { hashOf } from "./lineup-proposals.js";

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
  const held = (fn) => { const was = c.holdSend; c.holdSend = true; try { return fn(); } finally { c.holdSend = was; } };
  /** The teams marked as changed and waiting to go, as they were before a move that may be taken back. */
  const keepSets = () => ({ touched: new Set(c.touched ?? []), pending: new Set(c.pending ?? []) });
  /** Takes back every step after the history entry `base` with nothing sent: history cut there (no redo of half a move) and the changed-team sets as they were. */
  const backOut = (base, sets) => {
    const from = c.G.hist.indexOf(base); // by the entry: an index goes stale when the 80-step cap drops the oldest
    if (from < 0) return;
    if (c.G.hi > from) held(() => M.restore(c, from));
    c.G.hist.length = Math.min(c.G.hist.length, from + 1);
    c.touched = sets.touched; c.pending = sets.pending;
  };
  /** A move from the player card: held for its Apply, with where it started kept from the first one, so a refused Apply can take them all back. */
  const cardMove = (fn) => { c.cardStart ??= { base: M.histMark(c), sets: keepSets(), carried: false }; return held(fn); };
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
    /**
     * The scenario each team is on, his marks included, for the lineup proposals (lineup-proposals.js): { team: { roles: { id: role }, outs: [id],
     * min: { id: minutes }, marks, news } }. marks are his own: { out: [men he marked Out beyond TwoGun's], s: [men he marked S], typed: [men with typed
     * minutes or DK/min], in: [men he put back in], benched: [men he sent to the bench or out of the rotation] }; news never undoes one (Adam, 11-07).
     * A move the lineup news made (an applied news entry's men) is the news's, never his mark. Throws when the console cannot load.
     */
    async lineupView(slate) {
      await ensure(slate);
      if (!c.model) throw new Error(c.loadError ?? "the console could not load");
      const view = {};
      for (const [code, T] of Object.entries(c.model.TEAMS)) {
        const S = c.model.ST[code], outs = [...S.outs], rows = calc(T, S, outs).rows;
        const mine = S.pins[keyOf(S.outs)] ?? {}, tonight = new Set(outsOf(T.tonightKey));
        const byNews = newsOwned(S); // the news's only while a man is exactly as it left him; anything else is his own mark
        const flips = (roles) => Object.keys(mine.r ?? {}).filter((id) => roles.includes(mine.r[id]) && !byNews.r.has(id));
        const marks = {
          out: S.outs.filter((id) => !tonight.has(id) && !byNews.out.has(id)), s: flips(["starter"]), typed: [...new Set([...Object.keys(mine.m ?? {}), ...Object.keys(mine.d ?? {})])],
          in: [...tonight].filter((id) => !S.outs.includes(id)), benched: flips(["bench_plus", "bench", "oor"]), // a man he put back in; a man he sent to the bench or out of the rotation
        };
        view[code] = { outs: [...outs], roles: Object.fromEntries(rows.map((r) => [r.id, r.role])), min: Object.fromEntries(rows.filter((r) => typeof r.min === "number").map((r) => [r.id, r.min])), marks, news: structuredClone(S.news ?? {}) };
      }
      return view;
    },
    /**
     * For the board's rows (board-marks.js), each man on the slate by his id: { team, role, out, starterBy (why the app starts him: "yours", "chart"
     * or "twogun"), marks (marksOf: his own marks with their live figures) }. Throws when the console cannot load.
     */
    async boardView(slate) {
      await ensure(slate);
      if (!c.model) throw new Error(c.loadError ?? "the console could not load");
      const view = {};
      for (const [code, T] of Object.entries(c.model.TEAMS)) {
        const S = c.model.ST[code], marks = marksOf(T, S), chart = Boolean(T.depth);
        for (const r of calc(T, S, S.outs).rows) {
          const mine = marks[r.id]?.r?.v === "starter" && !marks[r.id].r.news; // a start the confirmed news set is the news's, not his
          view[r.id] = { team: code, role: r.role, out: r.out, starterBy: r.role !== "starter" ? null : mine ? "yours" : chart ? "chart" : "twogun", tgStarter: r.p.starter === true, marks: marks[r.id] ?? null };
        }
      }
      return view;
    },
    /** One undo chip (console-marks.js): his mark of `kind` on the man comes off. */
    dropMark: (team, id, kind) => M.dropMark(c, team, id, kind),
    /**
     * One lineup proposal applied by itself (lineup-bar.js, Adam 11-07): the console's role moves on the scenario the team is on, then the entry saved
     * under the proposal's id with the men it moved, so its undo X takes back only those; the change goes to the board by the console's own send.
     * A move that fails is saved as failed with the reason, so it is not tried again on the same news. Returns the entry. Throws when the console cannot load.
     */
    async autoApplyProposal(slate, proposal) {
      await ensure(slate);
      if (!c.model) throw new Error(c.loadError ?? "the console could not load");
      const T = c.model.TEAMS[proposal.team], S = c.model.ST[proposal.team];
      const base = { sig: hashOf(String(proposal.signature)), at: new Date().toISOString(), text: proposal.text.slice(0, 600) };
      if (!T) return base;
      const from = M.histMark(c), sets = keepSets(), cur = () => c.model.ST[proposal.team], roleOf = (id) => calc(T, cur(), cur().outs).rows.find((r) => r.id === id)?.role, men = [];
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
            if (M.setRole(c, a.team, a.id, a.role) === null && roleOf(a.id) !== a.role) throw new Error(`${a.id} is not on the console for ${a.team}`);
            men.push({ id: a.id, kind: a.role === "out" ? "out" : "r" });
          }
        }
        // Each man with what the news set on him (to): he stays the news's only while he is still that (console-marks.js newsOwned).
        const flips = cur().pins[keyOf(cur().outs)]?.r ?? {};
        const withTo = [...new Map(men.map((m) => [`${m.kind}${m.id}`, m])).values()].map((m) => (m.kind === "out" ? { ...m, to: "out" } : flips[m.id] !== undefined ? { ...m, to: flips[m.id] } : null)).filter(Boolean);
        entry = { ...base, state: "applied", men: withTo };
        if (!withTo.length) throw new Error("the news moved nobody");
      } catch (e) {
        backOut(from, sets); // nothing half done is left behind, not even on the redo branch
        entry = { ...base, state: "failed", men: [], why: String(e.message).slice(0, 600) };
      }
      M.setNews(c, proposal.team, proposal.id, entry);
      M.foldHistory(c, from);
      return entry;
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
        if (e.notes && start && !start.carried && M.histMark(c) === end) backOut(start.base, start.sets);
        throw e;
      } finally {
        c.cardOwned?.delete(start);
      }
    },
  };
}
