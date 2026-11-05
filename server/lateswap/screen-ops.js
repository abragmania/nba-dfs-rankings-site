// The Late swap screen's steps on its saved state (entries late swap), and with screen-model.js the only code that knows the engine's
// shapes: each takes the saved wrapper { state, spotSync, syncNotes, uploadName, ... } and a request, calls the engine, and returns
// { saved, outcomes, error, ... }. Pure: no fs, no clock (nowMs is passed in). No decision lives here: every legality, freeze, removal-
// stays-in-its-spot and out-man rule is the engine's. A man who is Out or gone makes the engine answer status "confirm"; the screen
// goes ahead only when the request names every man the engine asked about (confirmOut with confirmMen), so a stale click never confirms
// a different lineup.
import { startState, reuploadEntries, moveEntries, settleRows, dropRows, spotNames, lineupOf, sameLineup, restoreUsable, confirmOutMan, unusableIn } from "./maps.js";
import { removeAndReoptimize, removeAndLockBackup, handSwap, resetSpots, assignLineup } from "./actions.js";
import { contextFor, nameOf, outAlert } from "./entry-state.js";
import { exportChanged, exportAll } from "./export.js";
import { mapFp } from "./screen-model.js";
import { suggestShell, shellSummary } from "./shell.js";

const refused = (saved, error) => ({ saved, outcomes: [], error });

/** The engine's slate argument: the newest pull's players and its Out list as the slate file has it (the engine reads the men who have left
 *  the board from the state itself). */
export const slateFor = (name, players, out = []) => ({ name, players, out });

/** A first upload or a fresh file: { saved, report, error }. The engine refuses, in words, a file with no entries, no man on the slate,
 *  another night's Game Info date, or no readable salary table. slate = { name, players, out }. */
export function uploadText(saved, text, slate, name, atIso) {
  if (typeof text !== "string" || text.includes("�")) return { saved, error: "The file has characters that could not be read (a broken download). Save it from DraftKings again and drop it once more." };
  const read = saved ? reuploadEntries(saved.state, text, slate) : startState(text, slate, { empty: true }); // a new slate starts with nothing filled in
  if (!read.ok) return { saved, error: read.error };
  return { saved: { ...(saved ?? { spotSync: {}, syncNotes: [], exportedAt: null }), state: read.state, uploadName: name ?? null, uploadedAt: atIso }, report: read.report ?? null, error: null };
}

const sameSet = (ids, allowed) => ids.every((id) => allowed.includes(id));
const alertIds = (alert) => alert.men.map((m) => m.dk_id);

/** What the engine says to applying spots.json's lineup to a spot now, as { kind, outcome?, alert?, why? }: "same" (nothing to do), "apply",
 *  "pending" (an Out or gone man, or a man taken out of this spot earlier, so the screen asks), "refused" (the engine's real refusal). */
const incompleteSlots = (row) => !Array.isArray(row.slots) || row.slots.length !== 8 || !row.slots.every((id) => typeof id === "string" && id);

function inspect(saved, spot, row, { slate, nowMs, ctx }) {
  const s = saved.state;
  if (incompleteSlots(row)) return { kind: "incomplete", why: `the Lineups tab's lineup ${row.lineup_id} for ${spot} does not hold 8 men` };
  if (sameLineup(lineupOf(s, spot), row.slots)) return { kind: "same" };
  const r = assignLineup(s, { spot, lineup: row.slots, slate, nowMs });
  const o = r.outcomes?.[0];
  if (r.error || !o) return { kind: "error", why: r.error ?? "no answer" };
  if (o.status === "flagged") return { kind: "refused", why: o.reason }; // a lineup the engine refuses can never go in: it never offers a go-ahead
  const back = row.slots.filter((id) => unusableIn(s, spot).includes(id));
  // An Out or gone man in a lineup from the Lineups tab always waits for a click, whatever go-aheads the spot holds from before.
  const alert = outAlert(row.slots, ctx);
  if (alert || o.status === "confirm") return { kind: "pending", alert: alert ?? o.alert, back, outcome: o };
  if (back.length) return { kind: "pending", alert: null, back, outcome: o };
  return { kind: "apply", outcome: o, state: r.state };
}

const nameFor = (saved, id, ctx) => (ctx ? nameOf(id, ctx, saved.state.entries) : id);

/** The note for a lineup that was applied: which spot, which saved lineup, who came out and who went in, with the slot. */
function appliedNote(spot, row, o) {
  const moves = (o.moves ?? []).map((m) => `${m.slot}: ${m.out?.name ?? "empty"} out, ${m.in?.name ?? "empty"} in`).join("; ");
  return `${spot} now holds saved lineup ${row.lineup_id} from the Lineups tab${moves ? ` (${moves})` : ""}.`;
}

/**
 * Applies spots.json's lineups that changed since the last time they were applied (the Lineups tab is live here): { saved, notes, pending }.
 * Nothing is confirmed here. A lineup holding a man who is Out or gone, or a man taken out of that spot earlier, is left unapplied and comes
 * back in pending [{ spot, lineupId, alert, back }] with its stamp unconsumed, so the screen asks and asks again. A stamp is consumed only by a
 * lineup applied or one the engine really refused; a slate that cannot be read (no players, a bad name) changes nothing and consumes nothing.
 * Every applied lineup returns a note naming spot, lineup and who changed.
 */
export function syncSpots(saved, spotsFile, { slate, nowMs, dry = false }) {
  const probe = contextFor(saved.state, slate, nowMs);
  if (probe.error) return { saved, notes: [], pending: [], skipped: probe.error };
  const names = new Set(spotNames(saved.state));
  let cur = saved;
  const spotSync = { ...saved.spotSync }, pendingSync = { ...(saved.pendingSync ?? {}) }, notes = [], pending = [];
  // dry: only look. After an action nothing from the Lineups tab is applied in the same answer (an action may have changed what waits there),
  // and no stamp is used up; the next read applies what can be applied.
  // A stamp that has once waited (pendingSync) keeps waiting, even if what held it back has gone: only Use anyway, or an action on that spot,
  // ends it. So a lineup the screen asked about is never applied later by a read nobody was watching.
  for (const [spot, row] of Object.entries(spotsFile)) {
    if (!names.has(spot) || row?.assigned_at == null) continue;
    // A lineup that cannot be a lineup (not 8 men, or a hole in them) is shown on every read, noted once.
    if (incompleteSlots(row)) {
      pending.push({ spot, lineupId: String(row.lineup_id), alert: null, back: [], incomplete: true });
      if (spotSync[spot] !== row.assigned_at && !dry) { notes.push(`${spot}: the Lineups tab's lineup ${row.lineup_id} does not hold 8 men, so it was not applied.`); spotSync[spot] = row.assigned_at; }
      continue;
    }
    if (spotSync[spot] === row.assigned_at) continue;
    const held = pendingSync[spot] === row.assigned_at;
    const it = inspect(cur, spot, row, { slate, nowMs, ctx: probe.ctx });
    if (it.kind === "error") { notes.push(`${spot}: the Lineups tab's lineup could not be checked (${it.why}); it will be looked at again.`); continue; }
    if (it.kind === "pending" || (held && it.kind === "apply")) {
      if (!dry) pendingSync[spot] = row.assigned_at;
      pending.push({ spot, lineupId: String(row.lineup_id), alert: it.alert ?? null, back: (it.back ?? []).map((id) => ({ dk_id: id, name: nameFor(cur, id, probe.ctx) })), held: it.kind === "apply" });
      continue;
    }
    if (dry) continue;
    spotSync[spot] = row.assigned_at; delete pendingSync[spot];
    if (it.kind === "refused") { notes.push(`${spot}: saved lineup ${row.lineup_id} was not applied: ${it.why}`); continue; }
    if (it.kind === "apply") { cur = { ...cur, state: it.state }; notes.push(appliedNote(spot, row, it.outcome)); }
  }
  return { saved: dry ? saved : { ...cur, spotSync, pendingSync }, notes: dry ? [] : notes, pending };
}

/** An action on a spot ends the wait of a lineup the Lineups tab had given it: the stamp is used up, so no later read applies it. A spot given
 *  its row for the first time by this action shows a waiting lineup of the Lineups tab as pending too, rather than taking it later on a read. */
function settleStamps(before, after, body, outcomes, spotsFile) {
  const touched = new Set((outcomes ?? []).filter((o) => o.status !== "flagged" && o.status !== "confirm").map((o) => o.spot));
  if (["allow", "confirmMan", "syncConfirm", "setLineup", "undoSpot"].includes(body.op) && body.spot) touched.add(body.spot);
  const spotSync = { ...after.spotSync }, pendingSync = { ...(after.pendingSync ?? {}) };
  for (const spot of touched) if (Object.hasOwn(pendingSync, spot)) { spotSync[spot] = pendingSync[spot]; delete pendingSync[spot]; }
  for (const spot of Object.keys(after.state.spots)) {
    if (Object.hasOwn(before.state.spots, spot) || !Object.hasOwn(spotsFile, spot)) continue; // a row made just now, for a spot the Lineups tab also holds a lineup for
    const stamp = spotsFile[spot]?.assigned_at;
    if (stamp != null && spotSync[spot] !== stamp) pendingSync[spot] = stamp;
  }
  return { ...after, spotSync, pendingSync };
}

const spotsIn = (state, scope) => (scope?.type === "all" ? { type: "chosen", spots: spotNames(state) } : scope);

/** Puts back every man taken out of the given spots, so a later re-fill may use them again. */
function allowAgain(state, spots) {
  let st = state;
  for (const spot of spots) for (const man of unusableIn(st, spot)) st = restoreUsable(st, { spot, man }).state;
  return st;
}

/** Runs an engine action; when it asks about an Out or gone man and the request names every man asked about, runs it again with the go-ahead. */
function confirmable(run, body) {
  const first = run(false);
  const asks = (first.outcomes ?? []).filter((o) => o.status === "confirm");
  if (!asks.length || body.confirmOut !== true) return first;
  const named = Array.isArray(body.confirmMen) ? body.confirmMen : [];
  return asks.every((o) => sameSet(alertIds(o.alert), named)) ? run(true) : first;
}

/**
 * One atomic change of the entries-to-spots map: pairs [[entryId, spot | null]], made from the map body.mapFp names. A spot must exist,
 * unless it is in `allowedNew`. Nothing is changed unless every pair is good. The answer carries what was there before (prior), for one-step
 * undo, and how many mapped rows were overwritten.
 */
function applyPairs(saved, pairs, body, allowedNew) {
  const s = saved.state;
  if (!Array.isArray(pairs) || !pairs.length || !pairs.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === "string" && (p[1] === null || typeof p[1] === "string"))) return refused(saved, "A fill is a list of [entry, spot] pairs.");
  if (typeof body.mapFp !== "string" || body.mapFp !== mapFp(s)) return refused(saved, "The entries' spots changed since this screen drew them, so nothing was filled. Look them over and try again.");
  const known = new Set(spotNames(s)), allowed = new Set(allowedNew);
  const bad = pairs.find((p) => p[1] !== null && !known.has(p[1]) && !allowed.has(p[1]));
  if (bad) return refused(saved, `No spot called ${bad[1]}; nothing was filled.`);
  if (pairs.some(([id]) => !Object.hasOwn(s.entrySpots, id))) return refused(saved, "A named entry is not in the file; nothing was filled.");
  const prior = pairs.map(([id]) => [id, s.entrySpots[id] ?? null]);
  const overwritten = pairs.filter(([, spot], k) => prior[k][1] != null && prior[k][1] !== spot).length;
  const groups = new Map();
  for (const [id, spot] of pairs) groups.set(spot, [...(groups.get(spot) ?? []), id]);
  const priorProposals = Object.fromEntries(pairs.filter(([id]) => Object.hasOwn(s.proposals, id)).map(([id]) => [id, s.proposals[id]]));
  // The whole batch is moved first, then rows are settled once: a spot emptied for a moment by one group is not rebuilt from the next group's
  // entries, and an emptied spot keeps its row and its lineup.
  let st = s;
  for (const [spot, ids] of groups) { const r = moveEntries(st, { entryIds: ids, spot }); if (r.error) return refused(saved, r.error); st = r.state; }
  const before = new Set(Object.keys(st.spots));
  st = settleRows(st);
  const madeRows = Object.keys(st.spots).filter((n) => !before.has(n));
  if (Array.isArray(body.dropRows)) st = dropRows(st, body.dropRows); // an undo drops the rows its fill made, and only those
  // An undo hands back the suggestions the fill cleared, for the rows that are empty again.
  const back = body.restoreProposals && typeof body.restoreProposals === "object" ? Object.entries(body.restoreProposals).filter(([id]) => st.entrySpots[id] == null && Object.hasOwn(st.entrySpots, id)) : [];
  if (back.length) st = { ...st, proposals: { ...st.proposals, ...Object.fromEntries(back) } };
  return { saved: { ...saved, state: st }, outcomes: [], error: null, mapResult: { count: pairs.length, overwritten, prior, priorProposals, madeRows, mapFp: mapFp(st) } };
}

/**
 * One action of the screen. body.op: assign, acceptProposals, setLineup, syncConfirm, confirmMan, remove, swap, reset, undoSpot, undoAll,
 * allow, dismissNotes. args: { slate, nowMs, lineups, spotsFile }. confirmOut with confirmMen goes ahead for men the engine asked about.
 * Returns { saved, outcomes, error, confirms, overMax, spotWrite }: error is the engine's refusal in words (nothing changed); confirms lists
 * the spots waiting on a go-ahead, each with the alert.
 */
export function applyOp(saved, body, args) {
  const out = applyOpInner(saved, body, args);
  if (out.error || out.saved === saved) return out;
  return { ...out, saved: settleStamps(saved, out.saved, body, out.outcomes, args.spotsFile ?? {}) };
}

function applyOpInner(saved, body, { slate, nowMs, lineups = [], spotsFile = {} }) {
  const s = saved.state;
  const done = (r, extra = {}) => {
    if (r.error) return refused(saved, r.error);
    const confirms = (r.outcomes ?? []).filter((o) => o.status === "confirm").map((o) => ({ spot: o.spot, alert: o.alert }));
    return { saved: { ...saved, state: r.state }, outcomes: r.outcomes ?? [], error: null, confirms, overMax: r.overMax ?? [], ...extra };
  };
  switch (body.op) {
    case "assign": {
      const r = moveEntries(s, { entryIds: body.entryIds, spot: body.spot ?? null, derive: true });
      return r.error ? refused(saved, r.error) : { saved: { ...saved, state: r.state }, outcomes: [], error: null };
    }
    case "mapSet": return applyPairs(saved, body.pairs, body, Array.isArray(body.newSpots) ? body.newSpots : []);
    case "autoFill": {
      // Only unmapped rows, only when asked; the spots it needs are made here and named in the answer (the one place a name appears unasked).
      if (typeof body.mapFp !== "string" || body.mapFp !== mapFp(s)) return refused(saved, "The entries' spots changed since this screen drew them, so nothing was filled. Look them over and try again.");
      const plan = suggestShell(s.entries, s.entrySpots, Object.keys(s.spots));
      if (!plan.pairs.length) return refused(saved, "Every row has a spot already; nothing to fill.");
      const r = applyPairs(saved, plan.pairs, body, plan.created);
      return r.error ? r : { ...r, mapResult: { ...r.mapResult, created: plan.created, summary: shellSummary(plan.counts) } };
    }
    case "acceptProposals": {
      let st = s;
      for (const spot of new Set(Object.values(s.proposals))) {
        const ids = Object.keys(s.proposals).filter((id) => s.proposals[id] === spot && s.entrySpots[id] == null);
        if (ids.length) st = moveEntries(st, { entryIds: ids, spot, derive: true }).state;
      }
      return { saved: { ...saved, state: st }, outcomes: [], error: null };
    }
    case "setLineup": {
      const l = lineups.find((x) => String(x.id) === String(body.lineupId));
      if (!l) return refused(saved, "No saved lineup with that id.");
      const real = (l.reasons ?? []).filter((x) => !/^No longer on this slate/.test(x)); // a man gone from the slate is the engine's to alert, not ours to refuse
      if (l.legal === false && real.length) return refused(saved, `That saved lineup cannot hold a spot: ${real.join(" ")}`);
      const r = confirmable((ok) => assignLineup(s, { spot: body.spot, lineup: l.slots, confirmOut: ok, slate, nowMs }), body);
      if (r.error) return refused(saved, r.error);
      const o = r.outcomes[0];
      if (o?.status === "confirm") return { saved, outcomes: r.outcomes, error: null, confirms: [{ spot: o.spot, alert: o.alert }], confirm: o.alert };
      if (o?.status === "flagged") return { saved, outcomes: r.outcomes, error: o.reason };
      return { saved: { ...saved, state: r.state }, outcomes: r.outcomes, error: null, spotWrite: { spot: body.spot, lineupId: String(l.id) } };
    }
    case "syncConfirm": {
      // The Lineups tab's lineup for this spot, held back for an Out or gone man or a man taken out of the spot: applied on the go-ahead.
      if (!Object.hasOwn(spotsFile, body.spot)) return refused(saved, `The Lineups tab holds no lineup for ${body.spot}.`);
      const probe = contextFor(s, slate, nowMs);
      if (probe.error) return refused(saved, probe.error);
      const row = spotsFile[body.spot], it = inspect(saved, body.spot, row, { slate, nowMs, ctx: probe.ctx });
      if (it.kind === "incomplete") return refused(saved, `${it.why}, so it cannot be applied.`);
      if (it.kind === "same") return { saved: { ...saved, spotSync: { ...saved.spotSync, [body.spot]: row.assigned_at } }, outcomes: [], error: null };
      if (it.kind === "apply" && saved.pendingSync?.[body.spot] === row.assigned_at && body.confirmOut === true) { // it waited once and nothing holds it back now: the go-ahead applies it
        return { saved: { ...saved, state: it.state, spotSync: { ...saved.spotSync, [body.spot]: row.assigned_at }, pendingSync: Object.fromEntries(Object.entries(saved.pendingSync).filter(([k]) => k !== body.spot)) }, outcomes: [it.outcome], error: null, notes: [appliedNote(body.spot, row, it.outcome)] };
      }
      if (it.kind !== "pending") return refused(saved, it.kind === "refused" ? it.why : "That lineup needs no go-ahead now.");
      const named = Array.isArray(body.confirmMen) ? body.confirmMen : [];
      if (body.confirmOut !== true || !sameSet([...(it.alert ? alertIds(it.alert) : []), ...it.back], named)) return { saved, outcomes: [it.outcome], error: null, confirms: [{ spot: body.spot, alert: it.alert, back: it.back }] };
      const r = assignLineup(s, { spot: body.spot, lineup: row.slots, confirmOut: true, slate, nowMs });
      if (r.error || r.outcomes[0]?.status === "flagged") return refused(saved, r.error ?? r.outcomes[0].reason);
      return { saved: { ...saved, state: r.state, spotSync: { ...saved.spotSync, [body.spot]: row.assigned_at }, pendingSync: Object.fromEntries(Object.entries(saved.pendingSync ?? {}).filter(([k]) => k !== body.spot)) }, outcomes: r.outcomes, error: null, notes: [appliedNote(body.spot, row, r.outcomes[0])] };
    }
    case "confirmMan": {
      const r = confirmOutMan(s, { spot: body.spot, man: body.man });
      return r.error ? refused(saved, r.error) : { saved: { ...saved, state: r.state }, outcomes: [], error: null };
    }
    case "remove": {
      const base = { man: body.man, backup: body.backup ?? undefined, scope: spotsIn(s, body.scope), slate, nowMs };
      return done(confirmable((ok) => (body.backup ? removeAndLockBackup(s, { ...base, confirmOut: ok }) : removeAndReoptimize(s, base)), body));
    }
    case "swap": return done(confirmable((ok) => handSwap(s, { spot: body.spot, slot: body.slot, inId: body.inId, confirmOut: ok, slate, nowMs }), body));
    case "reset": return done(confirmable((ok) => resetSpots(s, { scope: spotsIn(s, body.scope), man: body.man ?? null, confirmOut: ok, slate, nowMs }), body));
    case "undoSpot": {
      const r = confirmable((ok) => resetSpots(s, { scope: { type: "one", spot: body.spot }, confirmOut: ok, slate, nowMs }), body);
      if (r.error) return refused(saved, r.error);
      const o = r.outcomes[0];
      const state = o && o.status !== "flagged" && o.status !== "confirm" ? allowAgain(r.state, [body.spot]) : r.state;
      return done({ ...r, state });
    }
    case "undoAll": {
      const r = confirmable((ok) => resetSpots(s, { scope: { type: "chosen", spots: spotNames(s) }, confirmOut: ok, slate, nowMs }), body);
      if (r.error) return refused(saved, r.error);
      const okSpots = r.outcomes.filter((o) => o.status !== "flagged" && o.status !== "confirm").map((o) => o.spot);
      return done({ ...r, state: allowAgain(r.state, okSpots) });
    }
    case "allow": {
      const r = restoreUsable(s, { spot: body.spot, man: body.man });
      return r.error ? refused(saved, r.error) : { saved: { ...saved, state: r.state }, outcomes: [], error: null };
    }
    case "dismissNotes": {
      // Only the notes the page drew are dismissed: one that arrived after it was drawn is still there to be seen.
      if (!Array.isArray(body.notes)) return refused(saved, "Say which notes are dismissed.");
      return { saved: { ...saved, syncNotes: (saved.syncNotes ?? []).filter((n) => !body.notes.includes(n)) }, outcomes: [], error: null };
    }
    default: return refused(saved, `Unknown action ${JSON.stringify(body.op ?? null)}.`);
  }
}

/** The upload file: the engine's export result. kind "changed" | "all"; spots (optional) narrows either to those spots. */
export function exportFile(saved, body, { slate, nowMs }) {
  if (body.kind !== "all" && body.kind !== "changed") return { ok: false, error: "Say what to export: changed or all." };
  if (body.spots != null && (!Array.isArray(body.spots) || !body.spots.length)) return { ok: false, error: "Pick at least one spot." };
  const args = { slate, nowMs, spots: body.spots ?? null };
  return body.kind === "all" ? exportAll(saved.state, args) : exportChanged(saved.state, args);
}
