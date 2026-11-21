// The board's saves to the server: the picks and the overrides. Moved out of board.js unchanged (file split, 11-17).
// Saves go out one at a time, in order, so quick clicks cannot reach the server out of order. After a failed save the
// page reloads the picks from the server (the saved file is the truth) instead of restoring an older local copy; after the last
// save of a mode is answered, that mode's lists are the server's answer (review 11-21 F2).
// The picks are kept per mode (Adam 11-14; his yes 5:14 PM ET 11-19 and "yes go" 12:42 PM ET 11-20): S.picks is { Cash: { locked, excluded },
// GPP: { ... } }, a save sends the open mode's lists with its mode, and the server replaces only that mode's (store.js savePicks).
import { overlayRows, mergeBodies, isChanges } from "./instant-overrides.js";
import { inMode } from "./mode-rows.js";

/** A pending change's body as the mode on show takes it (thumbs and stars per mode, Adam 1:24 PM 11-20): whole in its own mode; from the other mode only its
 *  shared typed numbers (proj, own), and a reset of the other mode not at all (its answer brings the shared part). null when nothing is left to show. Pure. */
export function bodyForShown(body, made, shown) {
  if (!made || made === shown) return body;
  if (!isChanges(body)) return null;
  const { bump, stars, ...shared } = body;
  return Object.keys(shared).length ? shared : null;
}

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
/** The foot words for each mode's thumbs and stars (server/slate/mode-marks.js marksTrouble, on the slate and every overrides answer as `marks`): ["", trouble], "" with none.
 *  Only what is wrong is said (lead's call, no clutter): a damaged part, a set started again; a normal carry-over from before the split shows nothing. Pure. */
export function marksLines(marks) {
  const out = [];
  for (const [m, why] of Object.entries(marks?.unreadable ?? {})) out.push(`The ${m} thumbs and stars could not be read (${why}); ${m} shows none and ${m} builds refuse until a thumb or star change in ${m} starts them again, the old file kept in the slate's history folder first.`);
  for (const [m, r] of Object.entries(marks?.replaced ?? {})) out.push(`The ${m} thumbs and stars could not be read and were started again${r?.at ? ` at ${new Date(r.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET` : ""}; the old file is kept at ${r?.copy ?? "an unknown place"}.`);
  return ["", out.join(" ")];
}
/** The page's foot facts from a picks or working answer: { carried, unreadable, replaced }. Pure. */
export const footOf = (a) => ({ carried: a?.carried ?? null, unreadable: a?.unreadable ?? null, replaced: a?.replaced ?? null });

/** The page's one store of server rows (one board per page): id -> the server's row, for each man shown with a guess of either instant layer. */
let shownGuess = () => null;
/** Whether a man's row on show carries a guess not yet answered: an override on its way (instant-overrides.js) or his typed minutes (instant-pins.js).
 *  The swap list marks him and holds its Use (review 11-21 F6). */
export const isGuessed = (id) => shownGuess()?.has(String(id)) === true;

/** The picks save line (createSaves' deps). Returns { savePicks(next), queue() -> the line's newest link }. */
function createPicksLine({ S, api, toast, modeNow, renderRows, renderPick, renderDropNote, renderCarried }) {
  let saveQueue = Promise.resolve();
  // Picks saves not yet finished, per slate and mode (review 11-21 F2): a save's answer or a read-back is taken onto a mode only when no later save
  // of that mode is queued, so it never draws over a newer click; Cash and GPP are counted apart, so neither clobbers the other.
  const picksQueued = new Map();
  const countPicks = (name, mode, by) => { const k = `${name}|${mode}`, n = (picksQueued.get(k) ?? 0) + by; if (n > 0) picksQueued.set(k, n); else picksQueued.delete(k); };
  /** Whether a save of mode `m` other than the one finishing now (of mode `self`) is still queued for the slate. */
  const laterPicks = (name, m, self) => (picksQueued.get(`${name}|${m}`) ?? 0) - (m === self ? 1 : 0) > 0;
  /** One mode's lists taken onto the page, redrawn only when they changed. */
  function takePicks(m, lists) {
    if (JSON.stringify(S.picks?.[m]) === JSON.stringify(lists)) return false;
    S.picks = { ...S.picks, [m]: lists };
    return true;
  }
  /** The saved picks read again: `modes` the modes to take, each only with no later save of it queued. Never rejects. */
  async function readPicksBack(name, self, modes) {
    try {
      const saved = await api(`/api/slate/${encodeURIComponent(name)}/picks`);
      if (name !== S.name) return;
      const by = picksByMode(saved);
      let moved = false;
      for (const m of modes) if (!laterPicks(name, m, self)) moved = takePicks(m, by[m]) || moved;
      S.picksFoot = footOf(saved); renderCarried();
      if (moved) { renderRows(); renderPick(); }
    } catch (e2) { toast(`Could not reload picks: ${e2.message}`, "err"); }
  }
  /** One picks save. Answered: the mode's lists are the server's (its answer holds both modes as saved, server.js handlePicks), once it is the last save of that mode queued.
   *  Failed: the saved picks are read back, each mode only when no later save of it is queued. */
  async function sendPicks(name, mode, body) {
    let out;
    try {
      out = await api(`/api/slate/${encodeURIComponent(name)}/picks`, { method: "POST", headers: { "content-type": "application/json" }, body });
    } catch (e) {
      toast(`Could not save picks: ${e.message}`, "err");
      await readPicksBack(name, mode, PICK_MODES);
      return;
    }
    if (out?.replaced_unreadable) toast(out.replaced_unreadable, "err");
    if (name !== S.name) return;
    const left = Array.isArray(out?.dropped) ? out.dropped : []; // men off the slate the other mode's saved lists still hold
    if (S.dropped.length || S.rosterDropped.length || left.length) { S.dropped = left; S.rosterDropped = []; renderDropNote(); }
    S.picksFoot = footOf(out); renderCarried();
    if (laterPicks(name, mode, mode)) return; // a newer click of this mode is on its way: its answer is the one taken
    let lists = null;
    try { lists = picksByMode(out)[mode]; } catch (e) { console.warn("the picks answer held no lists; they are read again:", e.message); }
    if (!lists) { await readPicksBack(name, mode, [mode]); return; }
    if (takePicks(mode, lists)) { renderRows(); renderPick(); }
  }
  /** Saves the open mode's lists; the other mode's are never sent, so they cannot be changed from here. The mode is taken at the click. */
  function savePicks(next) {
    const mode = modeNow();
    S.picks = { ...S.picks, [mode]: next }; renderRows(); renderPick();
    const name = S.name, body = JSON.stringify({ mode, locked: next.locked, excluded: next.excluded });
    countPicks(name, mode, 1);
    saveQueue = saveQueue.then(async () => {
      try { await sendPicks(name, mode, body); } finally { countPicks(name, mode, -1); }
    }).catch((e) => toast(`Your lock or exclude could not be finished: ${e.message}`, "err")); // the line goes on after any throw
  }
  /** A load's read of the picks (picksByMode's answer) for slate `name`: each mode with a save still on its way keeps `current` (the page's lists, null on another slate), so a Lock
   *  clicked during the read is never drawn over; its own answer then sets the mode (review 11-21 round 2, item 9). */
  const fromRead = (name, read, current) => Object.fromEntries(PICK_MODES.map((m) => [m, current?.[m] && (picksQueued.get(`${name}|${m}`) ?? 0) > 0 ? current[m] : read[m]]));
  return { savePicks, queue: () => saveQueue, fromRead };
}

/** `S` is the board's state object; mode() is the optimizer's mode now (the picks a click changes); the rest are the page's own functions,
 *  called as the page defines them. over(row): the typed-minutes layer's copy of a row with his numbers on it (board-marks.js over), the row itself with none. */
export function createSaves({ S, api, toast, mode: modeNow, renderRows, renderPick, renderDropNote, renderCarried = () => {}, applyPlayers, over = (row) => row, reread = async () => { throw new Error("no way to read the slate again on this page"); } }) { // reread(name): the slate's rows from the server, taken onto the board
  const picks = createPicksLine({ S, api, toast, modeNow, renderRows, renderPick, renderDropNote, renderCarried });
  // ---------- overrides (Adam, 5:20 PM ET 2026-10-29; server/slate/overrides.js) ----------
  // Every write goes to the server, one request at a time and in order, and the page takes the players it answers (the saved
  // file is the truth). A refused write shows its sentence and puts the rows back as the server last gave them.
  let ovQueue = Promise.resolve();
  let ovSaves = 0; // moves with every override write and its answer, so a refresh fetched across one is not drawn over it
  /** One promise for "the picks and override saves now queued", the same object until either queue gains a link, so the
   *  panel's until-unchanged wait (picksSettled) covers both: a build reads the saved locks and the saved overrides. */
  let settledOf = [], settledP = Promise.resolve();
  function settled() {
    if (settledOf[0] !== picks.queue() || settledOf[1] !== ovQueue) { settledOf = [picks.queue(), ovQueue]; settledP = Promise.all(settledOf); }
    return settledP;
  }
  // Show then settle (Adam 1:35 PM 11-20, instant-overrides.js): a change is put on his row at the click, then sent. `pend` holds every change not yet
  // answered, in click order ({ name, body, what, sent, done }); `server` is the one store of server rows (review 11-21 F4): the server's own row for each
  // man shown with a guess of either layer (an override here, his typed minutes in instant-pins.js), so a refusal puts exactly that back and no guess is
  // ever taken as the server's. Plain changes waiting together go as one request (a reset alone); a request the server refuses as a bad value (400) is sent
  // again one change at a time, so only the refused change is put back.
  let pend = [], server = new Map();
  shownGuess = () => server;
  const mine = () => pend.filter((e) => e.name === S.name).map((e) => bodyForShown(e.body, e.mode, modeNow())).filter(Boolean);
  /** The rows with his changes still on their way put on them, overrides first, then his typed minutes. rows: the server's (an answer, a new pull, a load),
   *  each first shown in the mode on show (mode-rows.js inMode: that mode's thumbs and stars), so a Cash/GPP switch is restack() alone. */
  function overlay(given) {
    const now = modeNow(), rows = given.map((p) => inMode(p, now));
    const out = overlayRows(rows, mine()), store = out.server;
    const shown = out.rows.map((p, i) => {
      const q = over(p);
      if (q !== p && p && !store.has(String(p.dk_id))) store.set(String(p.dk_id), rows[i]); // overlayRows keeps the order of `rows`
      return q;
    });
    server = store;
    return shown;
  }
  /** The rows with every guess taken off: each guessed man's server row. */
  const bare = (rows) => rows.map((p) => server.get(String(p.dk_id)) ?? p);
  /** The rows on show built again from the server's rows and what is still pending, with no draw; a man with nothing pending shows the server's row. */
  function restack() {
    S.players = overlay(bare(S.players));
    S.byId = new Map(S.players.map((p) => [p.dk_id, p]));
  }
  function reshow() {
    restack();
    renderRows(); renderPick();
  }
  /** A server answer's players for the rows on show (board.js applyPlayers), with take(row, answer) its taking of one man's figures (slate-refresh.js takeAnswer):
   *  { kind: "unknown" } with no list or an empty one, an unknown outcome to read again, never "nobody" (review 11-21 F11); { kind: "reload", fresh } when the
   *  server's men are not the board's; else { kind: "rows", fresh, rows }: the SERVER rows with the answer taken (never a guess), then every guess laid on again. */
  function answerRows(players, take) {
    if (!Array.isArray(players) || !players.length) return { kind: "unknown" };
    const fresh = new Map(players.map((p) => [p.dk_id, p]));
    if (fresh.size !== S.byId.size || [...fresh.keys()].some((id) => !S.byId.has(id))) return { kind: "reload", fresh };
    return { kind: "rows", fresh, rows: overlay(bare(S.players).map((p) => (fresh.has(p.dk_id) ? take(p, fresh.get(p.dk_id)) : p))) };
  }
  async function post(name, body, mode) {
    // GitHub's data is being brought down (the server answers 409 SYNC_RUNNING): his change is kept as it is and sent again after a few seconds, up to three times, never redrawn away.
    for (let tries = 0; ; tries++) {
      try {
        return await api(`/api/slate/${encodeURIComponent(name)}/overrides`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, mode }) }); // mode: whose thumbs and stars the change is (server.js handleOverrides)
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
      out = await post(name, batch.length === 1 ? batch[0].body : mergeBodies(batch.map((e) => e.body)), batch[0].mode);
    } catch (e) {
      await failed(batch, e, name, what);
      return;
    }
    if (out?.replaced_unreadable) toast(out.replaced_unreadable, "err"); // his mode's thumbs and stars could not be read: the old file is kept aside and the mode starts from this change
    if (out?.marks && name === S.name && S.slate) { S.slate = { ...S.slate, marks: out.marks }; renderCarried(); } // the foot's carried and unreadable lines follow the saved file
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
    if (isChanges(pend[i].body)) for (const e of pend.slice(i + 1)) { if (e.sent) continue; if (e.name !== pend[i].name || e.mode !== pend[i].mode || !isChanges(e.body)) break; batch.push(e); } // one request is one mode's
    for (const e of batch) e.sent = true;
    await sendBatch(batch);
  }
  /** His change: on the rows at once (the slate on show), to the server in click order. `body` is plain ({ own }, { bump }, { stars }, { proj }, { reset }, { resetAll }),
   *  worked out from the row as shown. Resolves true when the server kept it, false when it refused, null when not known. A change made on a slate no longer on show still goes to the slate it was made on. */
  function saveOverride(body, what, mode = modeNow()) {
    ovSaves++;
    const e = { name: S.name, mode, body, what, sent: false, done: null }; // the mode is taken at the click (a caller that waits first, as Reset all's confirm does, passes the one it took): a thumb or star is that mode's
    const kept = new Promise((r) => { e.done = r; });
    pend.push(e);
    if (e.name === S.name) reshow();
    ovQueue = ovQueue.then(sendNext).catch((err) => toast(`Your change could not be finished: ${err.message}`, "err")); // the line goes on after any throw
    return kept;
  }
  return { settled, savePicks: picks.savePicks, picksFromRead: picks.fromRead, saveOverride, overlay, bare, restack, answerRows, pending: () => pend.length, saveCount: () => ovSaves, countSave: () => { ovSaves++; } };
}
