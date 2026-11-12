// The console's moves on his work: history and ripple, saving, pins, roles, who is out, hand-outs. Each takes the console's shared state `c`.
import { oursUse } from "./console-ours.js";
import { keyOf, outsOf, usageStart } from "./console-engine.js";
import { calc, canonRecord, chipName, dropCopies, hasPins, label, moveTo, noteOuts, pinsOf, recordOf, savedFor, sgn } from "./console-model.js";
import { FN, fmtv } from "./console-cmd.js";
import { COLS } from "./console-render.js";
import { PIN_MAX } from "./override-limits.js";
import { roleMove, ROLE_LABEL, swapStarterMove } from "./console-roles.js";
import { EMPTY_RECORD } from "./figures.js";
import { MINUTE_SOURCES, SOURCE_LABEL } from "./depth-chart.js";
import { alignNews, endNewsOuts, manAsLeft, marksOf, stillAsLeft } from "./console-marks.js";

const THR = { m: 0.05, u: 0.05, d: 0.004, p: 0.05 };
const STEP = { m: [0.5, 2], u: [0.5, 2], d: [0.01, 0.05], p: [0.1, 1] };
const EMPTY_RECORD_TEXT = JSON.stringify(EMPTY_RECORD());

/** A history snapshot: his work without the lineup-news record, which no undo or redo ever changes (it would let news apply twice). */
export const snap = (c) => JSON.stringify({ ST: Object.fromEntries(Object.entries(c.model.ST).map(([code, S]) => [code, { ...S, news: undefined }])), cur: c.G.cur });
/** One team's work as the send compares it: who is out and every pin. */
const teamState = (S) => JSON.stringify([keyOf(S.outs), S.pins, S.source ?? null]);
/** The teams a step changed join c.touched: only those (and teams the board already holds an Apply for) are sent (console-auto.js). */
function touch(c, before, { track = false } = {}) {
  c.touched ??= new Set();
  c.pending ??= new Set();
  for (const [code, S] of Object.entries(c.model.ST)) {
    dropCopies(S); // a scenario left holding the same marks as the one on show is not kept
    if (before[code] !== teamState(S)) { c.touched.add(code); c.pending.add(code); }
    if (track && c.model.TEAMS[code] && before[code] !== undefined) {
      const wasKey = JSON.parse(before[code])[0];
      noteOuts(c.model.TEAMS[code], S, wasKey); // who he put Out or back in, kept as its own record
      if (!c.inNewsUndo) endNewsOuts(S, wasKey, { reverted: (key) => (c.G.revertedAt ??= new Map()).set(key, c.G.hist[c.G.hi]) }); // his own hand took a man off Out: the news's Out on him is over, unless Ctrl+Z returns to the step before this one
    }
    if (S.tonight !== undefined && keyOf(S.outs) !== S.tonight) S.sticky = true; // off Tonight once: where he is stays saved (console-model.js recordOf)
  }
}
const states = (c) => Object.fromEntries(Object.entries(c.model.ST).map(([code, S]) => [code, teamState(S)]));
/** The send after a step, unless the caller holds it (the player card sends with its own check, console-card.js). */
const kick = (c) => { if (c.holdSend) return; c.cardStart = null; for (const s of c.cardOwned ?? []) s.carried = true; c.auto?.kick(); }; // anything sent from here on carries the card's moves, so they can no longer be taken back as unsent

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
    c.saveGen = (c.saveGen ?? 0) + 1; // a save of his own is under way: a read of the server's records during it is not comparable (console.js refresh)
    c.saveQueue = c.saveQueue.then(async () => {
      try {
        await c.api(`/api/slate/${encodeURIComponent(name)}/scenarios`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ team: code, record: JSON.parse(text) }) });
        (c.serverSeen ??= {})[code] = canonRecord(JSON.parse(text)); // what the server holds for the team is now what this page wrote
        if (c.saveErrs[code] && name === c.slate) { delete c.saveErrs[code]; c.drawBar(); }
      } catch (e) {
        if (name === c.slate) { c.saveErrs[code] = `${code} not saved: ${e.message}`; c.lastSaved[code] = "unsaved"; c.drawBar(); }
        c.toast(`Could not save the console: ${e.message}`, "err");
      }
    });
  }
}

export function mutate(c, text, fn) {
  const before = vals(c), was = states(c);
  c.G.roleMoves = null; // the five-starter note names only the move that made it
  fn();
  touch(c, was, { track: true });
  pushHist(c, text);
  c.G.editing = false;
  c.render();
  ripple(c, before);
  saveDirty(c);
  kick(c); // the change goes to the board by itself (console-auto.js)
}

export function restore(c, i) {
  const G = c.G;
  if (i < 0 || i >= G.hist.length) return;
  const before = vals(c), was = states(c), o = JSON.parse(G.hist[i].s), leaving = G.hist[G.hi];
  // A reverted news entry remembers the history step it was reverted from, and goes back to applied only when a restore reaches that step again. A step he has since overwritten is gone, so the entry stays reverted.
  const anchors = (G.revertedAt ??= new Map());
  const memo = { reverted: (key) => anchors.set(key, leaving), mayReturn: (key) => { const at = G.hist.indexOf(anchors.get(key)); return at >= 0 && i === at; } }; // only the very step, so a redo past it never hands his own later Out to the news
  for (const [code, S] of Object.entries(o.ST)) {
    const T = c.model.TEAMS[code];
    if (!T) continue;
    const next = c.model.ST[code] = { ...S, news: c.model.ST[code]?.news ?? {}, sticky: Boolean(S.sticky || c.model.ST[code]?.sticky) }; // the news record is not part of history; once he has been off Tonight, where he is stays saved
    moveTo(T, next, next.outs, next.tonight ?? T.tonightKey); // a step taken before a pull lands on the current Tonight, pins carried
    alignNews(next, memo); // and the news records follow the screen: reverted, or applied again
  }
  touch(c, was);
  G.cur = o.cur; G.hi = i; G.editing = false; G.roleMoves = null;
  c.render();
  ripple(c, before);
  saveDirty(c);
  kick(c);
}
export const undo = (c) => restore(c, c.G.hi - 1);
export const redo = (c) => restore(c, c.G.hi + 1);

const nameOf = (c, t, id) => chipName(c.model.TEAMS[t], c.model.TEAMS[t].byId[id]);

/** His typed number on a man. False, with nothing changed, when the man is Out in the scenario on show (a typed number on an Out man is never used). */
export function setPin(c, t, id, k, raw) {
  const S = c.model.ST[t];
  if (S.outs.includes(id)) return false;
  const v = Math.max(0, Math.min(PIN_MAX[k], Math.round(raw * 1000) / 1000));
  mutate(c, `${t} ${nameOf(c, t, id)} ${FN[k]} = ${fmtv(k, v)}`, () => { pinsOf(S, keyOf(S.outs))[k][id] = v; });
  return true;
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
/** A role he set on a man comes off: the man goes back to the role the app gives him. False when he had none. */
export function clearFlip(c, t, id) {
  const S = c.model.ST[t], r = pinsOf(S, keyOf(S.outs)).r;
  if (!Object.hasOwn(r, id)) return false;
  mutate(c, `${t} ${nameOf(c, t, id)} role mark cleared`, () => { delete r[id]; });
  return true;
}
/** The S toggle (Adam, 11-07): a man not starting is marked S; a man he marked S whom the app would not start loses the mark; any other
 *  starter goes to the bench (the chart puts him first there, depth-chart.js). */
export function toggleStarter(c, t, id) {
  const T = c.model.TEAMS[t], S = c.model.ST[t];
  const row = calc(T, S, S.outs).rows.find((r) => r.id === id);
  if (!row) return null;
  if (row.role !== "starter") return setRole(c, t, id, "starter");
  const mark = marksOf(T, S)[id]?.r;
  if (mark?.v === "starter" && mark.live !== "starter") return clearFlip(c, t, id);
  return setRole(c, t, id, "bench");
}
/** An undo chip: drops one of his marks on a man (marksOf's kinds m, d, r, out), and the man goes back to what the app has live. */
export function dropMark(c, t, id, kind) {
  if (kind === "m" || kind === "d") return clearPin(c, t, id, kind);
  if (kind === "r") return clearFlip(c, t, id);
  if (kind === "out") return toggleOut(c, t, id);
  return false;
}
/** One lineup-news entry saved on its team (lineup-bar.js). Not a history step: undo and redo never touch the news record. */
export function setNews(c, t, key, entry) {
  const S = c.model.ST[t];
  (S.news ??= {})[key] = entry;
  saveDirty(c);
  c.render();
}
/** The undo X on a lineup-news note: what that entry moved goes back (an Out back in, a role it set off), and it is kept as undone so it never
 *  applies again. `ends` replaces how the entry is left: the server's reversal (server/slate/news-reverse.js) leaves it { state: "reversed", at, text }, so it can apply again. One history step. False when there is nothing applied under that key. */
export function undoNews(c, t, key, ends = { state: "undone" }) {
  const S = c.model.ST[t], e = S.news?.[key];
  if (!e || e.state !== "applied") return false;
  const base = histMark(c);
  const tonight = new Set(c.model.TEAMS[t].tonight ?? []);
  const asLeftBefore = new Set(Object.entries(S.news).filter(([k, en]) => k !== key && en.state === "applied" && en.men.some((m) => m.kind === "r") && stillAsLeft(S, en)).map(([k]) => k)); // the starts this undo can leave behind: one he has already taken off is his, and stays off
  c.inNewsUndo = true; // these moves are the undo's own, never his hand ending the entry
  try {
    for (const m of e.men) {
      const cur = c.model.ST[t]; // a move may put a new team object in place
      if (!manAsLeft(cur, m)) continue; // he is not as the news left him: what he is now is his own mark, and stays
      if (m.kind === "out" && !tonight.has(m.id)) {
        toggleOut(c, t, m.id);
        if (m.was !== undefined && setRole(c, t, m.id, m.was) === null) { const S2 = c.model.ST[t]; mutate(c, `${t} ${nameOf(c, t, m.id)} role back`, () => { pinsOf(S2, keyOf(S2.outs)).r[m.id] = m.was; }); } // the flip he had when the Out applied comes back on the scenario he lands on, whatever that scenario held
      } else if (m.kind === "out") mutate(c, `${t} ${nameOf(c, t, m.id)} news Out undone`, () => { cur.mine.out = cur.mine.out.filter((x) => x !== m.id); }); // TwoGun has him Out too now: he stays Out, never "back in", for as long as TwoGun says so; a history step, so Ctrl+Z then Ctrl+Y keeps it
      else if (m.kind === "r") clearFlip(c, t, m.id);
    }
  } finally { c.inNewsUndo = false; }
  setNews(c, t, key, { ...e, ...ends });
  // A confirmed start applied on the scenario he has left: its flips stayed there, so the entry is ended, and the proposal returns at the next read that still confirms it (autoPlan).
  const cur = c.model.ST[t];
  for (const k of asLeftBefore) { const en = cur.news[k]; if (en?.state === "applied" && !stillAsLeft(cur, en)) setNews(c, t, k, { ...en, state: "reversed", at: ends.at ?? new Date().toISOString(), text: `${en.text}; taken off when the Out came back`.slice(0, 600) }); }
  foldHistory(c, base);
  return true;
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
  if (S.pins[from] && !(S.left ??= []).includes(from)) S.left.push(from); // a copy he left by moving: dropCopies may drop it once it holds nothing different
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
/** Which minutes feed the optimizer (depth-chart.js MINUTE_SOURCES): one team, or every team that has a chart. It is saved with his work and takes Ctrl+Z like any move. */
export function setSource(c, t, source, all = false) {
  if (!MINUTE_SOURCES.includes(source)) return;
  const codes = (all ? Object.keys(c.model.TEAMS) : [t]).filter((code) => oursUse(c.model.TEAMS[code]).ok && (c.model.ST[code].source ?? "twogun") !== source);
  if (!codes.length) return;
  mutate(c, `${all ? "all teams" : t} minutes: ${SOURCE_LABEL[source]}`, () => { for (const code of codes) c.model.ST[code].source = source; });
}
/**
 * A starter in and a named man out, as one role move (the lineup news's start): `inId` becomes a Starter and `outId` (the man the news sources leave out of the
 * five) goes to the Bench. On a chart team exactly those two change; only a team with no chart has the five-starter rule, and when that would bench a different man
 * (the starter with the fewest minutes), that man's flip is put back as it was. One history step; Ctrl+Z takes it back. Returns the men moved, or null when nothing changed.
 */
export function swapStarter(c, t, inId, outId) {
  const T = c.model.TEAMS[t], S = c.model.ST[t], key = keyOf(S.outs);
  const rows = calc(T, S, S.outs).rows;
  const res = swapStarterMove(T, S.outs, pinsOf(S, key).r, inId, outId, Object.fromEntries(rows.map((r) => [r.id, r.min]))); // the pure move (console-roles.js): through the chart where the team has one
  if (res === null) return null;
  if (res.backIn) {
    // He is Out here: back in on a non-starting role first (the scenario moves once), then the swap in the scenario he is back in, so both flips land there; one history step.
    const base = histMark(c), first = setRole(c, t, res.backIn.id, res.backIn.role);
    if (first === null) return null;
    const second = swapStarter(c, t, inId, outId);
    foldHistory(c, base);
    return [...first, ...(second ?? [])];
  }
  if (res.call) return setRole(c, t, res.call.id, res.call.role); // the plain role move
  const flips = Object.fromEntries(Object.entries(res.flips).filter(([fid]) => T.byId[fid]));
  mutate(c, `${t} ${nameOf(c, t, inId)} Starter (${nameOf(c, t, outId)} to Bench)`, () => {
    pinsOf(S, key).r = flips;
    c.G.roleMoves = { team: t, moved: res.moved };
  });
  return res.moved;
}
/** The history entry a move starts from; hold it across the move (foldHistory, console-card.js backOut). */
export const histMark = (c) => c.G.hist[c.G.hi];
/** Folds every history step after the entry `base` into one (the last), so a move made of several steps (scenario, roles) is undone with one Ctrl+Z. */
export function foldHistory(c, base) {
  const G = c.G, from = G.hist.indexOf(base); // found by the entry: an index goes stale when the 80-step cap drops the oldest
  if (from < 0 || G.hi - from < 2) return;
  G.hist.splice(from + 1, G.hi - from - 1);
  G.hi = from + 1;
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
