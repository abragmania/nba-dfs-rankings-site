// The Player list's Lock, Exclude and the panel's un-pick clicks, moved out of board.js (file split, 11-20) with the In / Out / All switch's toast
// (Adam 11-20): a man his click takes out of the view on show leaves the list at once, and a short toast says where he went (pool-view.js movedWord).
// Nothing about what is saved changes: the picks still go through board-saves.js savePicks, the open mode's lists only.
import { autoExcluded, excludeClick } from "./excluded.js";
import { movedWord } from "./pool-view.js";

/** deps: { S, api, toast, livePicks(), shown(), savePicks(next), panel, loadSlate(name) }; S.poolView is the view on show. */
export function createPickClicks({ S, api, toast, livePicks, shown, savePicks, panel, loadSlate }) {
  const isOut = (id) => shown().excluded.includes(id);
  /** After a click on him: the toast when he left the view on show. */
  function noteMove(id, wasOut) {
    const word = movedWord(S.poolView, wasOut, isOut(id));
    if (word) toast(`${word}: ${S.byId.get(id)?.name ?? "he"}`);
  }
  /** His un-exclude of a man excluded because he is not playing: his In on the Minutes page (the engine and outFor honour it, and it stays until he undoes it there), then the slate is read again. */
  async function putIn(id) {
    const p = S.byId.get(id);
    if (!p) { toast("He is not in the slate on this page."); return; }
    const stillOut = () => autoExcluded(S.players).includes(String(id));
    let refused = null;
    try {
      await api(`/api/minutes/${encodeURIComponent(S.name)}/team/${encodeURIComponent(p.team)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "in", id }) });
    } catch (e) { refused = e.message; }
    try { await loadSlate(S.name); } catch (e) { toast(`${p.name}: the slate could not be read again (${e.message}), so whether he is back is not known`, "err"); return; }
    // review 11-19: the toast says only what the new read shows (his own Out on the Console beats the Minutes page's In; clearing it is his, there)
    if (!stillOut()) toast(`${p.name} is In by your call, in Cash and GPP both; the Minutes page shows it and undoes it.`); // his In is one call for the slate, not per mode (review 11-20)
    else toast(`${p.name} is still Out${p.his === "out" ? " by your own Out mark (clear it on the Console or the Minutes page)" : ""}${refused ? `: ${refused}` : ""}.`, "err");
  }
  function toggle(id, kind) {
    const wasOut = isOut(id);
    if (kind === "excluded") { // Adam 11-19: an Out man comes back in through his In, never through the picks file; a LOCKED Out man's click is the plain swap (excluded.js excludeClick, review F2)
      const plan = excludeClick(id, livePicks(), S.players);
      if (plan.save) savePicks(plan.save);
      if (plan.putIn) { putIn(id); return; }
      if (plan.save.excluded.includes(id)) panel.dropMan(id); // an excluded man leaves the working lineup (a build would refuse him)
      noteMove(id, wasOut);
      return;
    }
    const other = kind === "locked" ? "excluded" : "locked";
    const live = livePicks(); // a save names only men on the slate: the server refuses any other
    const has = live[kind].includes(id);
    savePicks({ [kind]: has ? live[kind].filter((x) => x !== id) : [...live[kind], id], [other]: has ? live[other] : live[other].filter((x) => x !== id) });
    noteMove(id, wasOut);
  }
  /** The panel's un-pick: off both lists. */
  function unpick(id) {
    const wasOut = isOut(id), live = livePicks();
    savePicks({ locked: live.locked.filter((x) => x !== id), excluded: live.excluded.filter((x) => x !== id) });
    noteMove(id, wasOut);
  }
  return { toggle, unpick, putIn };
}
