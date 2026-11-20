// The board's saves to the server: the picks and the overrides. Moved out of board.js unchanged (file split, 11-17).
// Saves go out one at a time, in order, so quick clicks cannot reach the server out of order. After a failed save the
// page reloads the picks from the server (the saved file is the truth) instead of restoring an older local copy.
// The picks are kept per mode (Adam 11-14; his yes 5:14 PM ET 11-19 and "yes go" 12:42 PM ET 11-20): S.picks is { Cash: { locked, excluded },
// GPP: { ... } }, a save sends the open mode's lists with its mode, and the server replaces only that mode's (store.js savePicks).
import { overlayRows, mergeBodies, isChanges } from "./instant-overrides.js";

export const PICK_MODES = Object.freeze(["Cash", "GPP"]);
/** The page's picks from a picks answer (store.js readPicks): each mode's own lists. An answer without both modes' lists throws: who is
 *  locked is then unknown, never "nobody". Pure. */
export function picksByMode(answer) {
  const bad = PICK_MODES.filter((m) => !Array.isArray(answer?.[m]?.locked) || !Array.isArray(answer?.[m]?.excluded));
  if (bad.length) throw new Error(`the saved picks came back without the ${bad.join(" and ")} lists`);
  // A mode the server could not read keeps its `unreadable` (review 11-20, money): its swaps are off and its lock and exclude marks show unknown, never blank.
  return Object.fromEntries(PICK_MODES.map((m) => [m, { locked: answer[m].locked, excluded: answer[m].excluded, ...(answer[m].unreadable ? { unreadable: answer[m].unreadable } : {}) }]));
}
/** The foot line for picks still carried from before the split (store.js readPicks `carried`), or "" with none. Pure. */
export const carriedLine = (c) => (c && Array.isArray(c.modes) && c.modes.length ? `${c.locked} locked and ${c.excluded} excluded from before Cash and GPP were kept apart, carried into ${c.modes.join(" and ")}; a change in a mode makes its lists its own.` : "");
/** The foot words for a mode that could not be read, or that a save had to empty (store.js `unreadable` / `replaced`, slate/mode-file.js;
 *  review 11-20), each until that mode saves; "" with none. noun: "locks and excludes" or "working lineup". Pure. */
export function troubleLine(a, noun) {
  const out = [];
  for (const [m, why] of Object.entries(a?.unreadable ?? {})) out.push(`The ${m} ${noun} could not be read (${why}); ${noun === "working lineup" ? "it shows empty" : `${m} builds refuse`} until a change in ${m} saves new ones, the old file kept beside it.`);
  for (const [m, r] of Object.entries(a?.replaced ?? {})) out.push(`The ${m} ${noun} could not be read and ${noun.endsWith("s") ? "were" : "was"} emptied${r?.at ? ` at ${new Date(r.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET` : ""}; the old file is kept at ${r?.copy ?? "an unknown place"}.`);
  return out.join(" ");
}
/** The page's foot facts from a picks or working answer: { carried, unreadable, replaced }. Pure. */
export const footOf = (a) => ({ carried: a?.carried ?? null, unreadable: a?.unreadable ?? null, replaced: a?.replaced ?? null });

/** `S` is the board's state object; mode() is the optimizer's mode now (the picks a click changes); the rest are the page's own functions,
 *  called as the page defines them. */
export function createSaves({ S, api, toast, mode: modeNow, renderRows, renderPick, renderDropNote, renderCarried = () => {}, applyPlayers, reread = async () => { throw new Error("no way to read the slate again on this page"); } }) { // reread(name): the slate's rows from the server, taken onto the board
  let saveQueue = Promise.resolve();
  // ---------- overrides (Adam, 5:20 PM ET 2026-10-29; server/slate/overrides.js) ----------
  // Every write goes to the server, one request at a time and in order, and the page takes the players it answers (the saved
  // file is the truth). A refused write shows its sentence and puts the rows back as the server last gave them.
  let ovQueue = Promise.resolve();
  let ovSaves = 0; // moves with every override write and its answer, so a refresh fetched across one is not drawn over it
  /** One promise for "the picks and override saves now queued", the same object until either queue gains a link, so the
   *  panel's until-unchanged wait (picksSettled) covers both: a build reads the saved locks and the saved overrides. */
  let settledOf = [], settledP = Promise.resolve();
  function settled() {
    if (settledOf[0] !== saveQueue || settledOf[1] !== ovQueue) { settledOf = [saveQueue, ovQueue]; settledP = Promise.all(settledOf); }
    return settledP;
  }
  /** Saves the open mode's lists; the other mode's are never sent, so they cannot be changed from here. The mode is taken at the click. */
  function savePicks(next) {
    const mode = modeNow();
    S.picks = { ...S.picks, [mode]: next }; renderRows(); renderPick();
    const name = S.name, body = JSON.stringify({ mode, locked: next.locked, excluded: next.excluded });
    saveQueue = saveQueue.then(async () => {
      try {
        const out = await api(`/api/slate/${encodeURIComponent(name)}/picks`, { method: "POST", headers: { "content-type": "application/json" }, body });
        if (out?.replaced_unreadable) toast(out.replaced_unreadable, "err");
        if (name !== S.name) return;
        const left = Array.isArray(out?.dropped) ? out.dropped : []; // men off the slate the other mode's saved lists still hold
        if (S.dropped.length || S.rosterDropped.length || left.length) { S.dropped = left; S.rosterDropped = []; renderDropNote(); }
        S.picksFoot = footOf(out); renderCarried();
      } catch (e) {
        toast(`Could not save picks: ${e.message}`, "err");
        try {
          const saved = await api(`/api/slate/${encodeURIComponent(name)}/picks`);
          if (name === S.name) { S.picks = picksByMode(saved); S.picksFoot = footOf(saved); renderRows(); renderPick(); renderCarried(); }
        } catch (e2) { toast(`Could not reload picks: ${e2.message}`, "err"); }
      }
    });
  }
  // Show then settle (Adam 1:35 PM 11-20, instant-overrides.js): a change is put on his row at the click, then sent. `pend` holds every change not yet
  // answered, in click order ({ name, body, what, sent, done }); `server` holds the server's own row for each man shown with a guess, so a refusal puts
  // exactly that back. Plain changes waiting together go as one request (a reset alone); a request the server refuses as a bad value (400) is sent
  // again one change at a time, so only the refused change is put back.
  let pend = [], server = new Map();
  const mine = () => pend.filter((e) => e.name === S.name).map((e) => e.body);
  /** The rows with his changes still on their way put on them. rows: the server's (an answer, a new pull, a load). */
  function overlay(rows) {
    const out = overlayRows(rows, mine());
    server = out.server;
    return out.rows;
  }
  /** The rows with every guess taken off: each guessed man's server row. */
  const bare = (rows) => rows.map((p) => server.get(String(p.dk_id)) ?? p);
  /** The rows shown again from the server's rows and what is still pending; a man with nothing pending shows the server's row. */
  function reshow() {
    S.players = overlay(bare(S.players));
    S.byId = new Map(S.players.map((p) => [p.dk_id, p]));
    renderRows(); renderPick();
  }
  async function post(name, body) {
    // GitHub's data is being brought down (the server answers 409 SYNC_RUNNING): his change is kept as it is and sent again after a few seconds, up to three times, never redrawn away.
    for (let tries = 0; ; tries++) {
      try {
        return await api(`/api/slate/${encodeURIComponent(name)}/overrides`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      } catch (e) {
        if (e.code !== "SYNC_RUNNING" || tries >= 2) throw e;
        toast("A sync is running; your change is sent again in a few seconds.");
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
  }
  /** One request for `batch` (entries of one slate): answered, the server's rows are taken (applyPlayers lays what is still pending over them); refused, his row is put back and the toast says why. */
  async function sendBatch(batch) {
    const name = batch[0].name, what = [...new Set(batch.map((x) => x.what))].join(" and ");
    let out;
    try {
      out = await post(name, batch.length === 1 ? batch[0].body : mergeBodies(batch.map((e) => e.body)));
    } catch (e) {
      await failed(batch, e, name, what);
      return;
    }
    pend = pend.filter((e) => !batch.includes(e));
    for (const e of batch) e.done(true);
    if (name !== S.name) return;
    if (!Array.isArray(out?.players)) { toast(`Saved ${what}, but the server's answer held no player list; the slate is read again.`, "err"); await again(name); return; }
    try { applyPlayers(out.players); } catch (e) { toast(`Saved ${what}, but the board could not draw the server's answer (${e.message}).`, "err"); } // a draw error, never a save error
  }
  /** The slate's rows read again after a save whose outcome is not known; never rejects. */
  async function again(name) {
    try { await reread(name); } catch (e) { toast(`The slate could not be read again (${e.message}); what the server holds is not shown.`, "err"); }
  }
  /** A request that did not come back answered. A status the server refused (4xx, not 409) wrote nothing: a batch refused as a bad value is sent again one change at a time,
   *  else his row is put back. No status, a 5xx or a 409 left after the sync tries is unknown (review 11-20): the guess comes off and the slate is read again. */
  async function failed(batch, e, name, what) {
    const refused = Number.isInteger(e?.status) && e.status >= 400 && e.status < 500 && e.status !== 409;
    if (refused && batch.length > 1 && (e.code === "BAD_OVERRIDE" || e.code === "BUMP_NO_PROJECTION")) { for (const one of batch) await sendBatch([one]); return; } // nothing was written: each change alone, so only the bad one is put back
    pend = pend.filter((x) => !batch.includes(x));
    if (refused) toast(`Could not save ${what}: ${e.message}.${name === S.name ? " Put back as the board had it." : ""}`, "err");
    else toast(`Not known whether ${what} saved (${e?.message ?? e}).${name === S.name ? " The slate is read again to show what the server holds." : ""}`, "err");
    if (name === S.name) { reshow(); if (!refused) await again(name); }
    for (const x of batch) x.done(refused ? false : null);
  }
  /** The next request: the first change not yet sent, with the plain changes for the same slate waiting right behind it. */
  async function sendNext() {
    const i = pend.findIndex((e) => !e.sent);
    if (i < 0) return;
    const batch = [pend[i]];
    if (isChanges(pend[i].body)) for (const e of pend.slice(i + 1)) { if (e.sent) continue; if (e.name !== pend[i].name || !isChanges(e.body)) break; batch.push(e); }
    for (const e of batch) e.sent = true;
    await sendBatch(batch);
  }
  /** His change: on the rows at once (the slate on show), to the server in click order. `body` is plain ({ own }, { bump }, { stars }, { proj }, { reset }, { resetAll }),
   *  worked out from the row as shown. Resolves true when the server kept it, false when it refused, null when not known. A change made on a slate no longer on show still goes to the slate it was made on. */
  function saveOverride(body, what) {
    ovSaves++;
    const e = { name: S.name, body, what, sent: false, done: null };
    const kept = new Promise((r) => { e.done = r; });
    pend.push(e);
    if (e.name === S.name) reshow();
    ovQueue = ovQueue.then(sendNext).catch((err) => toast(`Your change could not be finished: ${err.message}`, "err")); // the line goes on after any throw
    return kept;
  }
  return { settled, savePicks, saveOverride, overlay, bare, pending: () => pend.length, saveCount: () => ovSaves, countSave: () => { ovSaves++; } };
}
