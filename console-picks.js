// The one-click pick of whom a Starter mark replaces (PROJECT.md, Starter marks, Adam 3:53-3:54 PM 11-20): when his standing Starter mark puts a man in a full five, the five men he could replace show as
// small name buttons on one line, the man the rule benches lit; a click on another records the pick with the mark (role_picks, saved as the mark's `replaces`; console-moves.js saveRoles), a click on the
// lit pick returns to the rule's choice. The rule is role-marks.js trimToFive, the same for the board's engine and the Console. The Console's Starters list and the player card (card-role.js) draw it.
import { esc } from "./board-util.js";
import { keyOf, teamFor } from "./console-engine.js";
import { chipName } from "./console-model.js";
import { liveFlips } from "./console-roles.js";
import { tierFive, tierUse } from "./console-tier.js";
import { mutate } from "./console-moves.js";

/**
 * His standing Starter marks that took a place in a full five on the scenario on show: { id: { gone (the man benched), dflt (the rule's choice), picked (his pick is in force), mine (his pick, in force or not, or
 * null), from: [the five men he could replace], names: { id: name } } }. {} for a team without the engine's inputs or with no marks. T, S: the console model's team and his work on it. Pure.
 */
export function pickChoices(T, S) {
  if (!S?.role_marks || !Object.values(S.role_marks).includes("starter") || !tierUse(T).ok) return {};
  const key = keyOf(S.outs), team = { ...teamFor(T, S), scenario_key: key }, outSet = new Set(S.outs), { claims } = tierFive(team, outSet, liveFlips(team, outSet, S.pins?.[key]?.r ?? {}));
  const name = (id) => (T.byId[id] ? chipName(T, T.byId[id]) : T.tier?.men?.[id]?.name ?? id), out = {}, at = (x) => { const i = (T.tier?.order ?? []).indexOf(x); return i < 0 ? 1e9 : i; };
  for (const [id, cl] of Object.entries(claims ?? {})) if (S.role_marks[id] === "starter" && T.byId[id]) out[id] = { ...cl, from: [...cl.from].sort((a, b) => at(a) - at(b)), mine: S.role_picks?.[id] ?? null, names: Object.fromEntries([id, ...cl.from].map((x) => [x, name(x)])) }; // tonight's order
  return out;
}

/**
 * The line of name buttons for one man (ch: pickChoices's), or "". attrs: the click's data attributes, "data-rpick" on the Console (with data-ri and data-team) or "data-crpick" on the player card. The man
 * benched is lit; amber (rpk-mine; a bare "set" class is taken by another page's grid) when it is his pick. A click on the lit man sends "" (the rule's choice again, also clearing a pick that no longer applies); on another man, his id. Pure.
 */
export function pickLineHtml(team, id, ch, { attr = "data-rpick", label = "Replaces", off = null } = {}) { // off: the team's game has started (console-tipped.js): every button disabled, its hover saying why
  if (!ch?.from?.length) return "";
  const nm = (x) => esc(ch.names?.[x] ?? x), rule = nm(ch.dflt);
  const btn = (x) => {
    const on = x === ch.gone, title = off ?? (on ? (ch.picked ? `Your pick: ${ch.names?.[x] ?? x} goes to the bench for him. Click to go back to the rule's choice (${ch.names?.[ch.dflt] ?? ch.dflt})` : `The rule's choice: ${ch.names?.[x] ?? x} goes to the bench for him`) : `Click: he takes ${ch.names?.[x] ?? x}'s place instead`);
    return `<button type="button" class="rpk-b${on ? " on" : ""}${on && ch.picked ? " rpk-mine" : ""}" ${attr}="${on ? "" : esc(x)}" data-ri="${esc(id)}" data-team="${esc(team)}" title="${esc(title)}"${off || (on && ch.mine == null) ? " disabled" : ""}>${nm(x)}</button>`;
  };
  return `<div class="rpk"><span class="rpk-l" title="Whom his Starter mark replaces in the five; the rule's choice is ${rule}">${esc(label)}</span>${ch.from.map(btn).join("")}</div>`;
}

/** His pick of whom his Starter mark on `id` replaces: `pickId` (a man of the team), or null for the rule's choice again. One Undo step, saved with his role marks. False when nothing changes. */
export function setPick(c, t, id, pickId) {
  const T = c.model?.TEAMS?.[t], S = c.model?.ST?.[t], to = pickId == null || pickId === "" ? null : String(pickId);
  if (!T || !S || S.role_marks?.[id] !== "starter" || !T.byId[id] || (to !== null && (!T.byId[to] || to === id)) || (S.role_picks?.[id] ?? null) === to) return false;
  const nm = (x) => chipName(T, T.byId[x]);
  mutate(c, `${t} ${nm(id)} Starter mark replaces ${to ? nm(to) : "the rule's choice"}`, () => { const p = { ...(S.role_picks ?? {}) }; if (to) p[id] = to; else delete p[id]; S.role_picks = p; });
  return true;
}
