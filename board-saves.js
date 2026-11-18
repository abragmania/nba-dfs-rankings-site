// The board's saves to the server: the picks and the overrides. Moved out of board.js unchanged (file split, 11-17).
// Saves go out one at a time, in order, so quick clicks cannot reach the server out of order. After a failed save the
// page reloads the picks from the server (the saved file is the truth) instead of restoring an older local copy.
/** `S` is the board's state object; the rest are the page's own functions, called as the page defines them. */
export function createSaves({ S, api, toast, renderRows, renderPick, renderDropNote, applyPlayers }) {
  let saveQueue = Promise.resolve();
  // ---------- overrides (Adam, 5:20 PM ET 2026-10-29; server/slate/overrides.js) ----------
  // Every write goes to the server, one at a time and in order, and the page redraws from the players it answers (the saved
  // file is the truth). A refused write shows its sentence and redraws the rows as they were. `body` may be a function, worked
  // out when the request is sent (a star toggle reads the star the previous answer left, so a double-click toggles twice).
  let ovQueue = Promise.resolve();
  let ovSaves = 0; // moves with every override write and its answer, so a refresh fetched across one is not drawn over it
  /** One promise for "the picks and override saves now queued", the same object until either queue gains a link, so the
   *  panel's until-unchanged wait (picksSettled) covers both: a build reads the saved locks and the saved overrides. */
  let settledOf = [], settledP = Promise.resolve();
  function settled() {
    if (settledOf[0] !== saveQueue || settledOf[1] !== ovQueue) { settledOf = [saveQueue, ovQueue]; settledP = Promise.all(settledOf); }
    return settledP;
  }
  function savePicks(next) {
    S.picks = next; renderRows(); renderPick();
    const name = S.name, body = JSON.stringify(next);
    saveQueue = saveQueue.then(async () => {
      try {
        await api(`/api/slate/${encodeURIComponent(name)}/picks`, { method: "POST", headers: { "content-type": "application/json" }, body });
        if ((S.dropped.length || S.rosterDropped.length) && name === S.name) { S.dropped = []; S.rosterDropped = []; renderDropNote(); }
      } catch (e) {
        toast(`Could not save picks: ${e.message}`, "err");
        try {
          const saved = await api(`/api/slate/${encodeURIComponent(name)}/picks`);
          if (name === S.name) { S.picks = { locked: saved.locked, excluded: saved.excluded }; renderRows(); renderPick(); }
        } catch (e2) { toast(`Could not reload picks: ${e2.message}`, "err"); }
      }
    });
  }
  function saveOverride(body, what) {
    const name = S.name;
    ovSaves++;
    const run = ovQueue.then(async () => {
      try {
        // The slate changed while this waited its turn. A worked-out body reads the slate on show, so it cannot be sent; a plain
        // one goes to the slate it was made on (the address below), so what was typed is never lost.
        if (name !== S.name && typeof body === "function") { toast("Not saved: the slate changed."); return false; }
        const sent = typeof body === "function" ? body() : body;
        // GitHub's data is being brought down (the server answers 409 SYNC_RUNNING): his typed value is kept as it is and sent again after a few seconds, up to three times, never redrawn away.
        let out;
        for (let tries = 0; ; tries++) {
          try {
            out = await api(`/api/slate/${encodeURIComponent(name)}/overrides`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sent) });
            break;
          } catch (e) {
            if (e.code !== "SYNC_RUNNING" || tries >= 2) throw e;
            toast("A sync is running; your change is sent again in a few seconds.");
            await new Promise((r) => setTimeout(r, 4000));
          }
        }
        if (name === S.name) applyPlayers(out.players);
        return true;
      } catch (e) {
        toast(`Could not save ${what}: ${e.message}`, "err");
        if (name === S.name) renderRows();
        return false;
      }
    });
    ovQueue = run;
    return run;
  }
  return { settled, savePicks, saveOverride, saveCount: () => ovSaves, countSave: () => { ovSaves++; } };
}
