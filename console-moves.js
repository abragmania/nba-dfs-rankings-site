// The console's moves on his work: history and ripple, saving, pins, roles, who is out, hand-outs. Each takes the console's shared state `c`.
import { oursUse } from "./console-ours.js";
import { keyOf, outsOf, usageStart, teamFor } from "./console-engine.js";
import { calc, canonRecord, chipName, dropCopies, hasPins, label, moveStamps, moveTo, noteOuts, pinsOf, recordOf, rolesText, savedFor, sgn, textSig } from "./console-model.js";
import { REPLAY_ROUNDS } from "./console-replay.js";
import { FN, fmtv } from "./console-cmd.js";
import { COLS } from "./console-render.js";
import { PIN_MAX } from "./override-limits.js";
import { roleMove, ROLE_LABEL, swapStarterMove } from "./console-roles.js";
import { EMPTY_RECORD } from "./figures.js";
import { MINUTE_SOURCES, SOURCE_LABEL } from "./depth-chart.js";
import { alignNews, endNewsOuts, manAsLeft, marksOf, stillAsLeft } from "./console-marks.js";
import { addMove } from "./depth-cols.js";
import { MARK_ROLES } from "./role-marks.js";
import { STAMP_ROLES } from "./typed-aside.js";
import { lockedSay } from "./console-tipped.js";

const THR = { m: 0.05, u: 0.05, d: 0.004, p: 0.05 };
const STEP = { m: [0.5, 2], u: [0.5, 2], d: [0.01, 0.05], p: [0.1, 1] };
const EMPTY_RECORD_TEXT = JSON.stringify(EMPTY_RECORD());

/** A history snapshot: his work without the lineup-news record, which no undo or redo ever changes (it would let news apply twice). */
export const snap = (c) => JSON.stringify({ ST: Object.fromEntries(Object.entries(c.model.ST).map(([code, S]) => [code, { ...S, news: undefined }])), cur: c.G.cur });
/** One team's work as the send compares it: who is out and every pin. */
const teamState = (S) => JSON.stringify([keyOf(S.outs), S.pins, S.source ?? null, S.depth_moves ?? null, rolesText(S.role_marks, S.role_picks), S.stamps ?? null]); // a depth-chart move, a role mark or its pick of whom he replaces is a change to send like any other
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
const kick = (c) => { if (c.holdSend) return; c.cardStart = null; for (const s of c.cardOwned ?? []) s.carried = true; c.auto?.kick(c.autoMove === true); }; // anything sent from here on carries the card's moves, so they can no longer be taken back as unsent

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

/** How long a save or a send waits while GitHub's data is being brought down (the server answers 409 SYNC_RUNNING) before it is tried again. */
export const SYNC_WAIT_MS = 4000;

/** The `seen` a save (one team) or a send (`teams`) carries: each team's record as this page last read or wrote it (c.serverSeen, console-model.js recordSig), so the server refuses work made on
 *  an older copy whatever wrote since (11-13 audit, state 1). {} for a team this page has not read. Pure. */
export function seenOf(c, teams, one = false) {
  const sigs = Object.fromEntries(teams.filter((t) => typeof c.serverSeen?.[t] === "string").map((t) => [t, textSig(c.serverSeen[t])]));
  if (one) return Object.hasOwn(sigs, teams[0]) ? { seen: sigs[teams[0]] } : {};
  return Object.keys(sigs).length ? { seen: sigs } : {};
}

/**
 * Saves every team whose work changed, one write at a time and in order. A failed save stays on show until a later one works, and refuses Apply's preview.
 * `auto`: no click of his started this save (a load, a pull, the lineup bar's news; c.autoMove marks those), so the server carries his_at and only a click moves it.
 * Each save names the team's his_at as this page last saw it (`base`) and its record as last seen (`seen`): the server refuses with CHANGED_ELSEWHERE when the disk's differs, and the page takes the other work (c.onConflict) instead of writing over it.
 * A SYNC_RUNNING refusal (GitHub's data is coming down) is tried again after SYNC_WAIT_MS, the change kept.
 */
/** A save of the team landed: its replay rounds start again; the foot line of a replay stays for the save that replay made, and goes with his next one. */
function savedAfterReplay(c, code) {
  if (c.replays) delete c.replays[code];
  if (c.replaying?.delete(code)) return;
  if (c.replayNotes?.[code]) { delete c.replayNotes[code]; c.drawBar(); }
}

export function saveDirty(c, auto = c.autoMove === true) {
  const name = c.slate;
  for (const [code, S] of Object.entries(c.model.ST)) {
    const text = JSON.stringify(recordOf(S));
    if (text === (c.lastSaved[code] ?? EMPTY_RECORD_TEXT)) continue;
    c.lastSaved[code] = text;
    c.saveGen = (c.saveGen ?? 0) + 1; // a save of his own is under way: a read of the server's records during it is not comparable (console.js refresh)
    c.saveQueue = c.saveQueue.then(async () => {
      try {
        const out = await c.api(`/api/slate/${encodeURIComponent(name)}/scenarios`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ team: code, record: JSON.parse(text), base: c.serverHisAt?.[code] ?? null, ...seenOf(c, [code], true), ...(auto ? { auto: true } : {}) }) });
        (c.serverSeen ??= {})[code] = canonRecord(JSON.parse(text)); // what the server holds for the team is now what this page wrote
        if (out && name === c.slate) { (c.serverHisAt ??= {})[code] = out.his_at ?? null; if (out.file_his_at !== undefined) c.serverFileHisAt = out.file_his_at; }
        if (c.saveErrs[code] && name === c.slate) { delete c.saveErrs[code]; c.drawBar(); }
        if (name === c.slate) savedAfterReplay(c, code);
      } catch (e) {
        if (name !== c.slate) return;
        if (e.code === "CHANGED_ELSEWHERE") { // the disk holds work this page has not seen: the next read lays his moves on it and saves again (console.js replayOnto), never a box or a toast
          c.lastSaved[code] = text;
          (c.conflicted ??= new Set()).add(code);
          c.replays ??= {};
          c.replays[code] = (c.replays[code] ?? 0) + 1;
          if (c.replays[code] > REPLAY_ROUNDS) { // the record kept changing under him: his change stays on show and goes with his next one, said at the team's foot
            c.replays[code] = 0; c.replaying?.delete(code);
            (c.replayNotes ??= {})[code] = [`${code}: your last change is not saved yet, because the saved work kept changing under it (the lineup news or another page); it is kept here and goes with your next change.`];
            c.drawBar();
            return;
          }
          c.onConflict?.(code);
          return;
        }
        if (e.code === "SYNC_RUNNING") { // GitHub's data is coming down: one timer, then the save is tried again; a send waits for it (console-auto.js previewAndSend)
          c.lastSaved[code] = "unsaved"; c.saveWaiting = true;
          clearTimeout(c.saveRetry);
          c.saveRetry = setTimeout(() => { c.saveWaiting = false; if (name === c.slate) { saveDirty(c, auto); c.auto?.kick(auto); } }, SYNC_WAIT_MS);
          c.drawBar();
          return;
        }
        c.saveErrs[code] = `${code} not saved: ${e.message}`; c.lastSaved[code] = "unsaved"; c.drawBar();
        c.toast(`Could not save the console: ${e.message}`, "err");
      }
    });
  }
}

export function mutate(c, text, fn) {
  const before = vals(c), was = states(c);
  c.G.roleMoves = null; // the five-starter note names only the move that made it
  c.stepAt = stepStamp(c); // one time for every stamp this step writes (typed-aside.js)
  try {
    fn();
    for (const [code, S] of Object.entries(c.model.ST)) if (was[code] !== undefined) stampFlips(c, S, was[code]);
  } finally { c.stepAt = null; }
  touch(c, was, { track: true });
  pushHist(c, text);
  c.G.editing = false;
  c.render();
  ripple(c, before);
  saveDirty(c);
  saveDepth(c); // queued with the saves, so the send below reads the saved chart
  saveRoles(c); // and his role marks, the same way
  kick(c); // the change goes to the board by itself (console-auto.js)
}

/**
 * His depth-chart moves (Adam 11-17) for every team whose list changed since this page last saved or read it go to the standing chart (POST /api/minutes/<slate>/team/<TEAM>, action depth), in the save line:
 * a send waits for it (previewAndSend awaits c.saveQueue), and the send's own refresh then reads the engine on the saved chart. A refusal stays on show like a failed save. The public site saves none (read-only).
 */
export function saveDepth(c) {
  if (c.readOnly) return;
  const name = c.slate;
  c.depthSaved ??= {};
  for (const [code, S] of Object.entries(c.model.ST)) {
    if (!Array.isArray(S.depth_moves)) continue;
    const text = JSON.stringify(S.depth_moves);
    if (text === c.depthSaved[code]) continue;
    c.depthSaved[code] = text;
    c.saveQueue = c.saveQueue.then(async () => {
      try {
        await c.api(`/api/minutes/${encodeURIComponent(name)}/team/${encodeURIComponent(code)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "depth", moves: JSON.parse(text) }) });
        if (c.saveErrs[`chart ${code}`] && name === c.slate) { delete c.saveErrs[`chart ${code}`]; c.drawBar(); }
      } catch (e) {
        if (name !== c.slate || lockedSay(c, code, "depth chart", e)) return; // the game has started: one foot line, no banner or toast (console-tipped.js)
        c.depthSaved[code] = "unsaved";
        c.saveErrs[`chart ${code}`] = `${code}'s depth chart not saved: ${e.message}`; c.drawBar();
        c.toast(`Could not save ${code}'s depth chart: ${e.message}`, "err");
      }
    });
  }
}

/**
 * His standing role marks (Adam 10:25 AM 11-18) for every team whose list changed since this page last saved or read it go to the standing chart (POST /api/minutes/<slate>/team/<TEAM>, action role), in
 * the save line as saveDepth's are: [{ key, role }] for tonight's men (the route keeps a mark on a man not on tonight's board). A refusal stays on show like a failed save. The public site saves none.
 */
export function saveRoles(c) {
  if (c.readOnly) return;
  const name = c.slate;
  c.rolesSaved ??= {};
  for (const [code, S] of Object.entries(c.model.ST)) {
    if (!S.role_marks) continue;
    const text = rolesText(S.role_marks, S.role_picks), T = c.model.TEAMS[code];
    if (c.rolesSaved[code] === undefined) { c.rolesSaved[code] = rolesText(T?.tier?.role_marks, T?.tier?.role_picks); if (text === c.rolesSaved[code]) continue; } // first sight: the inputs' list is what the server holds
    if (text === c.rolesSaved[code]) continue;
    c.rolesSaved[code] = text;
    const keyOf2 = (id) => T?.tier?.men?.[id]?.key ?? (/^(?=.*[a-z])[a-z0-9-]{1,80}$/.test(String(id)) ? String(id) : null), pick = (id, key) => { const k = S.role_picks?.[id] != null ? keyOf2(S.role_picks[id]) : null; return k && k !== key ? { replaces: k } : {}; }; // a pick on a man with no engine inputs is his chart key (role-marks.js picksById)
    const marks = Object.entries(S.role_marks).map(([id, role]) => { const key = T?.tier?.men?.[id]?.key ?? null; return { key, role, ...(role === "starter" && key ? pick(id, key) : {}) }; }).filter((m) => m.key);
    c.saveQueue = c.saveQueue.then(async () => {
      c.rolesBase ??= {};
      const base = c.rolesBase[code] ?? T?.tier?.role_marks_stamp ?? "[]"; // the marks as this page last read or saved them, read at send time (a quick second click follows the first save)
      try {
        const r = await c.api(`/api/minutes/${encodeURIComponent(name)}/team/${encodeURIComponent(code)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "role", marks, base }) });
        if (typeof r?.stamp === "string") c.rolesBase[code] = r.stamp;
        if (c.saveErrs[`roles ${code}`] && name === c.slate) { delete c.saveErrs[`roles ${code}`]; c.drawBar(); }
      } catch (e) {
        if (name !== c.slate || lockedSay(c, code, "role mark", e)) return; // the game has started: one foot line, no banner or toast (console-tipped.js)
        if (e.code === "MINUTES_ROLES_MOVED") { // another page or the other computer saved this team's marks since this page read them: the next refresh takes theirs, said
          c.rolesSaved[code] = "conflict";
          c.toast(`${code}'s role marks changed elsewhere (another page or the other computer), so your last mark on it was not written over them.`, "notice");
          c.onConflict?.(code);
          return;
        }
        c.rolesSaved[code] = "unsaved";
        c.saveErrs[`roles ${code}`] = `${code}'s role marks not saved: ${e.message}`; c.drawBar();
        c.toast(`Could not save ${code}'s role marks: ${e.message}`, "err");
      }
    });
  }
}

/** One move on our depth chart (Adam 11-17; depth-cols.js moveAt, stepMove or posMove): his newest move for that man; the minutes run again on the page at once and the list is saved before the send. False when there is no move. */
export function depthMove(c, t, move, text) {
  const S = c.model.ST[t];
  if (!move || !S || c.readOnly) return false;
  mutate(c, `${t} ${text}`, () => { S.depth_moves = addMove(S.depth_moves ?? c.model.TEAMS[t].tier?.depth?.moves ?? [], move); });
  return true;
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
    const next = c.model.ST[code] = { ...S, source: S.sourceSet ? S.source : T.source_default, news: c.model.ST[code]?.news ?? {}, sticky: Boolean(S.sticky || c.model.ST[code]?.sticky) }; // the news record is not part of history; once he has been off Tonight, where he is stays saved
    moveTo(T, next, next.outs, next.tonight ?? T.tonightKey); // a step taken before a pull lands on the current Tonight, pins carried
    alignNews(next, memo); // and the news records follow the screen: reverted, or applied again
  }
  touch(c, was);
  G.cur = o.cur; G.hi = i; G.editing = false; G.roleMoves = null;
  c.render();
  ripple(c, before);
  saveDirty(c);
  saveDepth(c); // Undo and Redo carry his depth-chart moves back to the chart file
  saveRoles(c); // and his role marks
  kick(c);
}
export const undo = (c) => restore(c, c.G.hi - 1);
export const redo = (c) => restore(c, c.G.hi + 1);

const nameOf = (c, t, id) => chipName(c.model.TEAMS[t], c.model.TEAMS[t].byId[id]);

/** His typed number on a man. False, with nothing changed, when the man is Out in the scenario on show (a typed number on an Out man is never used). */
export function setPin(c, t, id, k, raw) {
  const S = c.model.ST[t];
  if (S.outs.includes(id)) return false;
  const v = Math.max(0, Math.min(PIN_MAX[k], Math.round(raw * 1000) / 1000)), role = k === "m" ? roleNow(c, t, id) : null; // the role he holds as his minutes are typed (typed-aside.js)
  mutate(c, `${t} ${nameOf(c, t, id)} ${FN[k]} = ${fmtv(k, v)}`, () => { pinsOf(S, keyOf(S.outs))[k][id] = v; if (k === "m") stampTyped(c, S, id, role); });
  return true;
}
/** Adam 9:46 AM 11-20: his typed number a role change set aside comes back: it is stamped again now, in the role he holds now, so it wins until his role crosses the starter line again. One Undo step. False with none. */
export function restoreTyped(c, t, id) {
  const S = c.model.ST[t], v = S.pins[keyOf(S.outs)]?.m?.[id];
  if (v === undefined) return false;
  const role = roleNow(c, t, id);
  mutate(c, `${t} ${nameOf(c, t, id)} typed ${fmtv("m", v)} back`, () => stampTyped(c, S, id, role));
  return true;
}
/** A step's stamp time: the page's clock, or a headless caller's c.clock() (ms), and always later than the page's last step, so two steps never share a time and the strictly newer call wins (console-tier.js flipWins). */
function stepStamp(c) {
  const ms = Math.max(typeof c.clock === "function" ? c.clock() : Date.now(), (c.lastStampMs ?? -Infinity) + 1);
  c.lastStampMs = ms;
  return new Date(ms).toISOString();
}
/** The time a stamp written now carries: the step's (mutate), else a fresh one. */
const stampNow = (c) => c.stepAt ?? stepStamp(c);
/** The stamps of one scenario's pins of a kind (m or r), made when first written: { id: stamp }. Stamps are kept per scenario, as the pins are (the money review of 11-20, finding 1). */
const stampsAt = (S, k, key) => { S.stamps ??= {}; S.stamps[k] ??= {}; return (S.stamps[k][key] ??= {}); };
const roleNow = (c, t, id) => calc(c.model.TEAMS[t], c.model.ST[t], c.model.ST[t].outs).rows.find((r) => r.id === id)?.role ?? null;
/** His typed minutes' stamp (scenarios.js badStamps): the time and the role he held; a role with no figure (Out) leaves it unstamped, so his number stands, counted. */
function stampTyped(c, S, id, role) {
  const at = stampsAt(S, "m", keyOf(S.outs));
  if (STAMP_ROLES.includes(role)) at[id] = { at: stampNow(c), role }; else delete at[id];
}
/**
 * Every role flip on the scenario on show that a step made or changed carries the step's time (typed-aside.js: a flip after his typed number sets the number aside). On a move to another scenario a flip that
 * came with its pins keeps the stamp it carried (carryPins, moveStamps); only one with no stamp there takes the step's. wasText: the team's teamState before the step.
 */
function stampFlips(c, S, wasText) {
  const [k, pins, , , marksText] = JSON.parse(wasText), key = keyOf(S.outs), before = pins?.[k]?.r ?? {}, after = S.pins?.[key]?.r ?? {};
  for (const [id, role] of Object.entries(after)) if (before[id] !== role && (k === key || S.stamps?.r?.[key]?.[id] === undefined)) stampsAt(S, "r", key)[id] = stampNow(c);
  // a standing mark set or cleared on this page carries the step's time too, so a flip made after it on this page still wins (console-tier.js callTimes; the money review of 11-20, finding 5)
  const byId = (text) => new Map(JSON.parse(text ?? "[]").map(([id, role, pick]) => [id, [role, pick ?? null]])), was = byId(marksText), now = byId(rolesText(S.role_marks, S.role_picks)); // a pick has its own stamp: it never moves the role call's (the review of 11-21, money)
  for (const id of new Set([...was.keys(), ...now.keys()])) { const w = was.get(id) ?? [], n = now.get(id) ?? []; if (w[0] !== n[0]) (S.mark_at ??= {})[id] = stampNow(c); if (n[1] !== null && w[1] !== n[1]) (S.pick_at ??= {})[id] = stampNow(c); }
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
  if (S.role_marks?.[id] === "starter") { // his standing S mark: it comes off when the app would not start him without it, else he goes to Bench
    const rest = { ...S.role_marks };
    delete rest[id];
    if (calc(T, { ...S, role_marks: rest }, S.outs).rows.find((r) => r.id === id)?.role !== "starter") return clearStanding(c, t, id);
  }
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
        if (m.was !== undefined && setRole(c, t, m.id, m.was, { perNight: true }) === null) { const S2 = c.model.ST[t]; mutate(c, `${t} ${nameOf(c, t, m.id)} role back`, () => { pinsOf(S2, keyOf(S2.outs)).r[m.id] = m.was; }); } // the flip he had when the Out applied comes back on the scenario he lands on, whatever that scenario held
      } else if (m.kind === "out") mutate(c, `${t} ${nameOf(c, t, m.id)} news Out undone`, () => { cur.mine.out = cur.mine.out.filter((x) => x !== m.id); }); // Tonight has him Out too now (our feeds or his Minutes page): he stays Out, never "back in", for as long as Tonight has him; a history step, so Ctrl+Z then Ctrl+Y keeps it
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
  if (!hasPins(S.pins[to])) { S.pins[to] = structuredClone(pinsOf(S, from)); moveStamps(S, from, to); } // the copied pins keep their stamps (typed-aside.js)
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
export function setRole(c, t, id, role, { perNight = false } = {}) { // perNight: the lineup news's own role calls stay tonight's flips (it tracks and undoes them); his clicks write the standing mark
  const T = c.model.TEAMS[t], S = c.model.ST[t], key = keyOf(S.outs);
  const rows = calc(T, S, S.outs).rows, mine = rows.find((r) => r.id === id);
  if (!mine) return null;
  // Adam 10:25 AM 11-18: Starter, Bench+ or Bench on a man the engine knows is his standing mark (the chart file, saveRoles), which stands on later nights; Out and out of rotation stay tonight's
  const standing = !perNight && S.role_marks !== undefined && MARK_ROLES.includes(role) && Boolean(T.tier?.men?.[id]?.key);
  if (mine.role === role) { // the review of 11-18: a click on the role he already has writes the mark, so he can freeze it (Bench on a man who may cross 20)
    if (!standing || S.role_marks[id] === role) return null;
    mutate(c, `${t} ${nameOf(c, t, id)} ${ROLE_LABEL[role]} (kept as your mark)`, () => standMark(S, id, role));
    return [];
  }
  const res = roleMove(moveTeam(T, S), S.outs, pinsOf(S, key).r, id, role, Object.fromEntries(rows.map((r) => [r.id, r.min])));
  const also = res.moved.map((m) => `${nameOf(c, t, m.id)} to ${ROLE_LABEL[m.to]}`).join(", ");
  const flips = Object.fromEntries(Object.entries(res.flips).filter(([fid]) => T.byId[fid])); // a man no longer on the team keeps no flip
  const next = keyOf(res.outs), opened = opensSaved(S, key, next);
  mutate(c, `${t} ${nameOf(c, t, id)} ${ROLE_LABEL[role]}${also ? ` (${also})` : ""}${opened ? " (opened saved scenario)" : ""}`, () => {
    const changes = flipChanges(pinsOf(S, key).r, flips);
    S.outs = res.outs;
    if (next === key) pinsOf(S, next).r = flips;
    else if (opened) carryPins(S, T, key, next, changes);
    else { carryPins(S, T, key, next, changes); pinsOf(S, next).r = flips; }
    if (standing) standMark(S, id, role); // the standing mark, in place of tonight's flips on him in every scenario
    c.G.roleMoves = { team: t, moved: res.moved };
  });
  return res.moved;
}
/** The team a role move reads (console-roles.js roleMove, swapStarterMove): his work's view of it (teamFor: the news, stamps and his page's marks with their times, so the move sees the calls in force as calc
 *  does), on the scenario on show, with his source. */
const moveTeam = (T, S) => ({ ...T, ...teamFor(T, S), source: S.source, scenario_key: keyOf(S.outs) });
/** Adam 7:28 PM 11-19 ("q2 newest"): the newest role call on a man wins. A standing mark is newer than every per-night flip on him, so it takes his `r` flip off in every scenario of the team (a saved one
 *  coming back no longer lays an older flip over it); a flip made after the mark stays and wins in its own scenario. Other men's flips are untouched. The stamps' times decide which call is newer
 *  (console-tier.js flipWins); this clearing keeps the files tidy.
 *  An out-of-rotation call (`oor`, console-tier.js tierFive) is kept: the mark says his tier, not whether he plays. */
function dropFlipsOf(S, id) {
  for (const p of Object.values(S.pins ?? {})) if (p?.r && Object.hasOwn(p.r, id) && p.r[id] !== "oor") delete p.r[id];
}
/** His standing mark on a man, in place of tonight's flips on him (dropFlipsOf); any mark but Starter, or none (role null), takes his pick of whom he replaces off: the pick lives with a Starter mark. */
function standMark(S, id, role) {
  const r = { ...S.role_marks }; if (role) r[id] = role; else delete r[id]; S.role_marks = r;
  if (role !== "starter" && S.role_picks?.[id] != null) { const p = { ...S.role_picks }; delete p[id]; S.role_picks = p; }
  if (role) dropFlipsOf(S, id);
}
/** His standing role mark on a man comes off (Adam 10:25 AM 11-18): the man goes back to the role the app gives him. False when he had none. */
export function clearStanding(c, t, id) {
  const S = c.model.ST[t];
  if (!S.role_marks || !Object.hasOwn(S.role_marks, id)) return false;
  mutate(c, `${t} ${nameOf(c, t, id)} role mark cleared`, () => standMark(S, id, null));
  return true;
}
/** Which minutes feed the optimizer (depth-chart.js MINUTE_SOURCES): one team, or every team that has a chart. It is saved with his work and takes Ctrl+Z like any move. */
export function setSource(c, t, source, all = false) {
  if (!MINUTE_SOURCES.includes(source)) return;
  const codes = (all ? Object.keys(c.model.TEAMS) : [t]).filter((code) => oursUse(c.model.TEAMS[code]).ok && !(c.model.ST[code].sourceSet && c.model.ST[code].source === source)); // a click on the source a team follows by default still makes it his choice
  if (!codes.length) return;
  mutate(c, `${all ? "all teams" : t} minutes: ${SOURCE_LABEL[source]}`, () => { for (const code of codes) Object.assign(c.model.ST[code], { source, sourceSet: true }); });
}
/**
 * A starter in and a named man out, as one role move (the lineup news's start): `inId` becomes a Starter and `outId` (the man the news sources leave out of the
 * five) goes to the Bench. On a chart team exactly those two change; only a team with no chart has the five-starter rule, and when that would bench a different man
 * (the starter with the fewest minutes), that man's flip is put back as it was. One history step; Ctrl+Z takes it back. Returns the men moved, or null when nothing changed.
 */
export function swapStarter(c, t, inId, outId) {
  const T = c.model.TEAMS[t], S = c.model.ST[t], key = keyOf(S.outs);
  const rows = calc(T, S, S.outs).rows;
  const res = swapStarterMove(moveTeam(T, S), S.outs, pinsOf(S, key).r, inId, outId, Object.fromEntries(rows.map((r) => [r.id, r.min]))); // the pure move (console-roles.js): through the chart where the team has one
  if (res === null) return null;
  if (res.backIn) {
    // He is Out here: back in on a non-starting role first (the scenario moves once), then the swap in the scenario he is back in, so both flips land there; one history step.
    const base = histMark(c), first = setRole(c, t, res.backIn.id, res.backIn.role, { perNight: true });
    if (first === null) return null;
    const second = swapStarter(c, t, inId, outId);
    foldHistory(c, base);
    return [...first, ...(second ?? [])];
  }
  if (res.call) return setRole(c, t, res.call.id, res.call.role, { perNight: true }); // the plain role move (the news's start: tonight only)
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
