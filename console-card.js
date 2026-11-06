// The console's reach outside its own screen: the A / B layout choice (remembered per browser), dragging a man between the B
// layout's lanes, and the calls the player card makes (card-role.js) to read and write the same work the console holds.
import { calc, plain } from "./console-model.js";
import * as M from "./console-moves.js";
import { applyDirect } from "./console-applybox.js";

const LAYOUT_KEY = "nbaboard.console.layout";
const store = () => { try { return window.localStorage; } catch { return null; } };

/** The layout he last chose on this browser: "a" (table) or "b" (lanes); "a" when none is stored or storage is off. */
export function layoutPref() {
  const v = store()?.getItem(LAYOUT_KEY);
  return v === "b" ? "b" : "a";
}
export function saveLayout(v) {
  try { store()?.setItem(LAYOUT_KEY, v); } catch (e) { console.warn("The console layout could not be remembered:", e.message); }
}

/** Drag and drop between lanes: a card dropped on a lane is the same role move as a button. */
export function wireDrag(c) {
  let drag = null;
  const laneOf = (e) => e.target.closest?.("[data-lane]");
  c.el.addEventListener("dragstart", (e) => {
    const card = e.target.closest?.("[data-drag]");
    if (!card || !c.model) return;
    drag = { team: card.dataset.team, id: card.dataset.drag };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", drag.id);
    card.classList.add("dragging");
  });
  c.el.addEventListener("dragend", (e) => { e.target.closest?.("[data-drag]")?.classList.remove("dragging"); drag = null; });
  c.el.addEventListener("dragover", (e) => {
    const lane = laneOf(e);
    if (!drag || !lane || lane.dataset.team !== drag.team) return;
    e.preventDefault();
    for (const l of c.el.querySelectorAll(".lane.over")) if (l !== lane) l.classList.remove("over");
    lane.classList.add("over");
  });
  c.el.addEventListener("dragleave", (e) => { if (!laneOf(e)?.contains(e.relatedTarget)) laneOf(e)?.classList.remove("over"); });
  c.el.addEventListener("drop", (e) => {
    const lane = laneOf(e);
    if (!drag || !lane || lane.dataset.team !== drag.team) return;
    e.preventDefault();
    const { team, id } = drag;
    drag = null;
    c.G.pick = null;
    if (!M.setRole(c, team, id, lane.dataset.lane)) c.render();
  });
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
    setRole: (team, id, role) => M.setRole(c, team, id, role),
    setPin: (team, id, k, v) => M.setPin(c, team, id, k, v),
    clearPin: (team, id, k) => M.clearPin(c, team, id, k),
    /** Sends every team's scenario on show to the board, as the console's Apply does, without its preview box; refused when it would hold anything back on `team`. */
    applyNow: (team) => applyDirect(c, team),
  };
}
