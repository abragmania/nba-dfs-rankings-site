// The console's moves on his work: history and ripple, saving, pins, roles, who is out, hand-outs. Each takes the console's shared state `c`.
import { keyOf, outsOf, usageStart } from "./console-engine.js";
import { calc, chipName, hasPins, label, pinsOf, recordOf, savedFor, sgn } from "./console-model.js";
import { FN, fmtv } from "./console-cmd.js";
import { COLS } from "./console-render.js";
import { PIN_MAX } from "./override-limits.js";
import { roleMove, ROLE_LABEL } from "./console-roles.js";
import { EMPTY_RECORD } from "./figures.js";

const THR = { m: 0.05, u: 0.05, d: 0.004, p: 0.05 };
const STEP = { m: [0.5, 2], u: [0.5, 2], d: [0.01, 0.05], p: [0.1, 1] };
const EMPTY_RECORD_TEXT = JSON.stringify(EMPTY_RECORD());

export const snap = (c) => JSON.stringify({ ST: c.model.ST, cur: c.G.cur });

export function pushHist(c, text) {
  const G = c.G;
  G.hist = G.hist.slice(0, G.hi + 1);
  G.hist.push({ label: text, s: snap(c) });
  if (G.hist.length > 80) G.hist.shift();
  G.hi = G.hist.length - 1;
}

function vals(c) {
  const o = {};
  for (const [code, T] of Object.entries(c.model.TEAMS)) {
    for (const r of calc(T, c.model.ST[code], c.model.ST[code].outs).rows) {
      const b = `${code}|${r.id}|`;
      o[`${b}m`] = r.min; o[`${b}u`] = r.usg; o[`${b}d`] = r.out ? null : r.rate; o[`${b}p`] = r.proj;
    }
  }
  return o;
}

/** Every cell that moved flashes, green up and red down, and carries its delta for a moment. */
function ripple(c, before) {
  for (const inp of c.el.querySelectorAll("input.ed[data-team]")) {
    const k = inp.dataset.k, o = before[`${inp.dataset.team}|${inp.dataset.i}|${k}`], n = parseFloat(inp.dataset.v);
    if (o === undefined || o === null || Number.isNaN(n)) continue;
    const d = n - o;
    if (Math.abs(d) <= THR[k]) continue;
    inp.classList.add(d > 0 ? "rip" : "ripdn");
    const dt = inp.nextElementSibling;
    if (dt) { dt.textContent = k === "d" ? `${d > 0 ? "+" : ""}${d.toFixed(2)}` : sgn(d); dt.className = `dt ${d > 0 ? "up" : "dn"}`; }
  }
}

/** Saves every team whose work changed, one write at a time and in order. A failed save stays on show until a later one works, and refuses Apply's preview. */
export function saveDirty(c) {
  const name = c.slate;
  for (const [code, S] of Object.entries(c.model.ST)) {
    const text = JSON.stringify(recordOf(S));
    if (text === (c.lastSaved[code] ?? EMPTY_RECORD_TEXT)) continue;
    c.lastSaved[code] = text;
    c.saveQueue = c.saveQueue.then(async () => {
      try {
        await c.api(`/api/slate/${encodeURIComponent(name)}/scenarios`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ team: code, record: JSON.parse(text) }) });
        if (c.saveErrs[code] && name === c.slate) { delete c.saveErrs[code]; c.drawBar(); }
      } catch (e) {
        if (name === c.slate) { c.saveErrs[code] = `${code} not saved: ${e.message}`; c.lastSaved[code] = "unsaved"; c.drawBar(); }
        c.toast(`Could not save the console: ${e.message}`, "err");
      }
    });
  }
}

export function mutate(c, text, fn) {
  const before = vals(c);
  c.G.roleMoves = null; // the five-starter note names only the move that made it
  fn();
  pushHist(c, text);
  c.G.editing = false;
  c.render();
  ripple(c, before);
  saveDirty(c);
}

export function restore(c, i) {
  const G = c.G;
  if (i < 0 || i >= G.hist.length) return;
  const before = vals(c), o = JSON.parse(G.hist[i].s);
  Object.assign(c.model.ST, o.ST);
  G.cur = o.cur; G.hi = i; G.editing = false; G.roleMoves = null;
  c.render();
  ripple(c, before);
  saveDirty(c);
}
export const undo = (c) => restore(c, c.G.hi - 1);
export const redo = (c) => restore(c, c.G.hi + 1);

const nameOf = (c, t, id) => chipName(c.model.TEAMS[t], c.model.TEAMS[t].byId[id]);

export function setPin(c, t, id, k, raw) {
  const S = c.model.ST[t];
  if (S.outs.includes(id)) return;
  const v = Math.max(0, Math.min(PIN_MAX[k], Math.round(raw * 1000) / 1000));
  mutate(c, `${t} ${nameOf(c, t, id)} ${FN[k]} = ${fmtv(k, v)}`, () => { pinsOf(S, keyOf(S.outs))[k][id] = v; });
}
export function clearPin(c, t, id, k) {
  const S = c.model.ST[t], pn = pinsOf(S, keyOf(S.outs));
  const ks = k ? [k] : COLS.filter((x) => pn[x][id] !== undefined);
  if (!ks.some((x) => pn[x][id] !== undefined)) return false;
  mutate(c, `${t} ${nameOf(c, t, id)} pin cleared ${k ? FN[k] : "(all)"}`, () => { for (const x of ks) delete pn[x][id]; });
  return true;
}
export function clearPinAt(c, tm, sk, k, id) {
  mutate(c, `${tm} ${nameOf(c, tm, id)} pin cleared ${FN[k]}`, () => { delete c.model.ST[tm].pins[sk][k][id]; });
}
/** The Out chip, O key and command box: out is the role menu's Out (the five-starter rule and his pins carried); back in, he leaves the
 *  out list on the role the rule gives him, the pins carried the same way. */
export function toggleOut(c, t, id) {
  const T = c.model.TEAMS[t], S = c.model.ST[t];
  if (!S.outs.includes(id)) return setRole(c, t, id, "out");
  const key = keyOf(S.outs), next = keyOf(S.outs.filter((x) => x !== id));
  mutate(c, `${t} ${nameOf(c, t, id)} back in${opensSaved(S, key, next) ? " (opened saved scenario)" : ""}`, () => {
    S.outs = S.outs.filter((x) => x !== id);
    carryPins(S, T, key, next, {});
  });
  return [];
}

/** Whether moving from `from` to `to` lands on a scenario that already holds pins of its own. */
const opensSaved = (S, from, to) => from !== to && hasPins(S.pins[to]);

/**
 * The work on show moves with a role change that moves the scenario. A target with no pins of its own takes the source's whole; a
 * target that has pins (a saved scenario, or Tonight with his typed numbers) keeps them and takes only this move's role changes
 * (`changes`: { id: role, or null to take a flip off }). A source holding typed pins is always kept; one with none that is neither saved,
 * on show from an earlier pull, Healthy nor Tonight is dropped.
 */
function carryPins(S, T, from, to, changes) {
  if (from === to) return;
  if (!hasPins(S.pins[to])) S.pins[to] = structuredClone(pinsOf(S, from));
  else {
    const r = pinsOf(S, to).r;
    for (const [id, role] of Object.entries(changes)) if (role === null) delete r[id]; else r[id] = role;
  }
  // Typed numbers are never lost: a scenario left holding typed pins (minutes, usage, DK/min, projection) is kept, and shows only as a
  // "pins not on show" note. An unsaved scenario left with role flips alone, or nothing, is dropped.
  const typed = ["m", "u", "d", "p"].some((k) => Object.keys(S.pins[from]?.[k] ?? {}).length);
  if (!typed && from !== "" && from !== T.tonightKey && !S.saved.includes(from) && !(S.shown ?? []).includes(from)) delete S.pins[from];
}

/** What one role move changed in the flips: { id: new role, or null where a flip came off }. */
function flipChanges(before, after) {
  const out = {};
  for (const id of new Set([...Object.keys(before ?? {}), ...Object.keys(after)])) if ((before ?? {})[id] !== after[id]) out[id] = after[id] ?? null;
  return out;
}

/**
 * Flips a man's role (console-roles.js), the five-starter rule with it. Out moves him into the scenario's outs, any other role out of
 * them; his other pins, and everyone's, come along. Returns the men the rule moved as [{ id, from, to }], also kept on c.G.roleMoves for
 * the page to name; an unchanged role does nothing and returns null.
 */
export function setRole(c, t, id, role) {
  const T = c.model.TEAMS[t], S = c.model.ST[t], key = keyOf(S.outs);
  const rows = calc(T, S, S.outs).rows, mine = rows.find((r) => r.id === id);
  if (!mine || mine.role === role) return null;
  const res = roleMove(T, S.outs, pinsOf(S, key).r, id, role, Object.fromEntries(rows.map((r) => [r.id, r.min])));
  const also = res.moved.map((m) => `${nameOf(c, t, m.id)} to ${ROLE_LABEL[m.to]}`).join(", ");
  const flips = Object.fromEntries(Object.entries(res.flips).filter(([fid]) => T.byId[fid])); // a man no longer on the team keeps no flip
  const next = keyOf(res.outs), opened = opensSaved(S, key, next);
  mutate(c, `${t} ${nameOf(c, t, id)} ${ROLE_LABEL[role]}${also ? ` (${also})` : ""}${opened ? " (opened saved scenario)" : ""}`, () => {
    const changes = flipChanges(pinsOf(S, key).r, flips);
    S.outs = res.outs;
    if (next === key) pinsOf(S, next).r = flips;
    else if (opened) carryPins(S, T, key, next, changes);
    else { carryPins(S, T, key, next, changes); pinsOf(S, next).r = flips; }
    c.G.roleMoves = { team: t, moved: res.moved };
  });
  return res.moved;
}
export function setScenario(c, t, key) {
  mutate(c, `${t} scenario: ${label(c.model.TEAMS[t], key)}`, () => { c.model.ST[t].outs = outsOf(key); });
}
export function cycleScenario(c, dir) {
  const code = c.G.cur, T = c.model.TEAMS[code], S = c.model.ST[code], list = savedFor(T, S), i = list.indexOf(keyOf(S.outs)), n = list.length;
  setScenario(c, code, list[((i < 0 ? 0 : i + dir) + n) % n]);
}
export const firstPlaying = (c, code) => (c.model.TEAMS[code].pl.find((p) => !c.model.ST[code].outs.includes(p.id)) ?? c.model.TEAMS[code].pl[0])?.id;
export function jumpTeam(c, code) {
  c.G.cur = code; c.G.view = "team"; c.G.focus = { team: code, id: firstPlaying(c, code), k: "m" }; c.G.editing = false;
  c.render();
}
export function stepTeam(c, dir) {
  const codes = Object.keys(c.model.TEAMS), i = codes.indexOf(c.G.cur), n = codes.length;
  jumpTeam(c, codes[(i + dir + n) % n]);
}
export function adjust(c, inp, dir, big) {
  const k = inp.dataset.k, v = parseFloat(inp.dataset.v);
  if (Number.isNaN(v) || inp.readOnly) return;
  setPin(c, inp.dataset.team, inp.dataset.i, k, v + dir * STEP[k][big ? 1 : 0]);
}
export function resetScenario(c) {
  const code = c.G.cur;
  mutate(c, `${code} scenario reset`, () => { delete c.model.ST[code].pins[keyOf(c.model.ST[code].outs)]; });
}
export function setView(c, v) {
  c.G.view = v;
  if (v === "team" && c.G.focus) c.G.cur = c.G.focus.team;
  c.render();
}
export function saveScenario(c) {
  const code = c.G.cur, k = keyOf(c.model.ST[code].outs);
  if (!savedFor(c.model.TEAMS[code], c.model.ST[code]).includes(k)) mutate(c, `${code} saved scenario ${label(c.model.TEAMS[code], k)}`, () => { c.model.ST[code].saved.push(k); });
}
export function removeScenario(c, key) {
  const code = c.G.cur;
  mutate(c, `${code} removed saved scenario`, () => {
    const S = c.model.ST[code];
    S.saved = S.saved.filter((k) => k !== key);
    S.shown = (S.shown ?? []).filter((k) => k !== key);
    delete S.pins[key];
  });
}
export function setShare(c, t, sitter, kind, to, pct) {
  mutate(c, `${t} ${nameOf(c, t, sitter)} hands ${pct}% ${FN[kind]} to ${nameOf(c, t, to)}`, () => {
    const h = c.model.ST[t].handouts[sitter] ??= {};
    (h[kind] ??= {})[to] = pct;
  });
}
export function clearShare(c, t, sitter) {
  mutate(c, `${t} ${nameOf(c, t, sitter)} hand-out edits cleared`, () => { delete c.model.ST[t].handouts[sitter]; });
}
/** The current figures of a scenario with two or more out, as its combination table: what each man gained or lost over Tonight, so the table gives the same minutes back. */
export function saveCombo(c, t, key) {
  const T = c.model.TEAMS[t], S = c.model.ST[t], rows = calc(T, S, outsOf(key)).rows, m = {};
  for (const r of rows) {
    if (r.out) continue;
    if (typeof r.min === "number" && typeof r.p.min === "number" && Math.abs(r.min - r.p.min) > 1e-9) m[r.id] = Math.round((r.min - r.p.min) * 1000) / 1000;
  }
  const u = comboUsageGains(T, rows);
  mutate(c, `${t} saved combination table`, () => { S.combos[key] = { m, u }; });
}
export function clearCombo(c, t, key) {
  mutate(c, `${t} combination table cleared`, () => { delete c.model.ST[t].combos[key]; });
}

/** A combination table's usage: each man's gain over his minutes-scaled start, a loss among them, so saving it moves nobody's rate. */
export function comboUsageGains(T, rows) {
  const tonight = new Set(T.tonight), u = {};
  for (const r of rows) {
    if (r.out || typeof r.usg !== "number") continue;
    const start = usageStart(T.men.find((p) => p.id === r.id), r.min, tonight.has(r.id));
    if (typeof start === "number" && Math.abs(r.usg - start) > 1e-9) u[r.id] = Math.round((r.usg - start) * 1e6) / 1e6;
  }
  return u;
}
