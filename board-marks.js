// The board's reading of the console (Adam, 11-07): who starts tonight (the S chip by each starter's name: green when a lineup source has
// confirmed him or he is Adam's own pick, orange when only expected), and Adam's typed minutes and DK/min, which the board's Min and DK/m TON
// cells show with an undo chip. Every write goes through the console (console-card.js), so the console stays the one place they are kept.
// The pure parts are tested in node; createBoardMarks wires them to the page.
import { esc, isoToEastern } from "./board-util.js";
import { liveText } from "./console-marks.js";
import { syncWords } from "./console-auto.js";
import { staleOf, withFreshness, blockFresh, LINEUP_KEYS, LINEUP_LABEL, BACKS_ONLY } from "./lineup-proposals.js";
import { newsRuling, newestStatusCards } from "./news-status.js";
import { createInstantPins } from "./instant-pins.js";

const okBlock = (b) => b?.state === "ok" && Array.isArray(b.men);
const at = (iso) => (iso ? isoToEastern(iso) ?? iso : "time unknown");

/** The lineup sources naming a man in their five: [{ key, label, confirmed, at }]. latest: news/lineups/latest.json, or null. */
export function lineupClaims(latest, team, id) {
  const block = latest?.teams?.[team] ?? {};
  return LINEUP_KEYS.filter((k) => okBlock(block[k]) && blockFresh(latest, k, block[k]) && block[k].men.some((m) => m.id != null && String(m.id) === String(id) && m.status !== "Out"))
    .map((k) => ({ key: k, label: LINEUP_LABEL[k], confirmed: block[k].confirmed === true, at: latest.sources?.[k]?.fetched_at ?? null }));
}

/**
 * The S chip for one man, or null when the console does not start him. v: the console's boardView entry for him; latest: the lineup read;
 * pullAt: the TwoGun pull's time text. { state: "confirmed" | "expected", title }. His own S mark counts as his pick: confirmed, "yours".
 */
export function starterChip(v, latest, id, pullAt) {
  if (!v || v.role !== "starter") return null;
  const claims = lineupClaims(latest, v.team, id), conf = claims.filter((c) => c.confirmed);
  const mon = latest?.teams?.[v.team]?.monster, monAgainst = okBlock(mon) && blockFresh(latest, "monster", mon) && mon.confirmed === true && !claims.some((c) => c.key === "monster"); // a confirmed Monster five that leaves him out
  const solid = monAgainst ? conf.filter((c) => !BACKS_ONLY.includes(c.key)).length >= 2 : conf.some((c) => !BACKS_ONLY.includes(c.key)) || conf.length >= 2; // a back-only page's confirmed mark never stands alone
  if (v.starterBy === "yours") return { state: "confirmed", title: "Starting: yours (you marked him S in the console)" };
  if (solid) return { state: "confirmed", title: `Confirmed starter: ${conf.map((c) => `${c.label} confirmed lineup, ${at(c.at)}`).join("; ")}` };
  const why = [
    v.starterBy === "chart" ? "the depth chart's five" : null,
    v.tgStarter ? `TwoGun starter${pullAt ? `, ${pullAt}` : ""}` : null,
    ...claims.map((c) => `${c.label} projected lineup, ${at(c.at)}`),
  ].filter(Boolean);
  return { state: "expected", title: `Expected starter, not confirmed: ${why.join("; ") || "the console's five"}` };
}

/** The chip's markup. */
export const starterChipHtml = (chip) => (chip ? `<span class="schip ${chip.state}" title="${esc(chip.title)}">S</span>` : "");

/** His typed minutes a later role change set aside (typed-aside.js): a small restore button in the undo chip's place; its hover says what happened. Nothing when none is set aside. */
export const asideChipHtml = (id, mark) => (mark?.aside ? `<button class="cundo" type="button" data-mrestore="${esc(id)}" title="${esc(`${mark.aside.words.charAt(0).toUpperCase()}${mark.aside.words.slice(1)}. Click to use it again`)}">&#8617;</button>` : "");
/** An undo chip on a Min (m) or DK/m TON (d) cell: one click drops his typed number. */
export const undoChipHtml = (id, kind, mark) => (mark ? `<button class="cundo" type="button" data-unmark="${kind}" data-id="${esc(id)}" title="${esc(`Your typed ${kind === "m" ? "minutes" : "DK/min"}. ${liveText(kind, mark)}. Click to drop it`)}">&#8634;</button>` : "");

/**
 * deps: { api, slate() -> the slate on show, console (boardView, setMark, dropMark, syncState), toast, pullAt() -> the pull's time text, onChange() (redraw rows),
 * noteEl (the line above the list where the send's state shows) }.
 * Returns { refresh({ news }), of(id) -> { chip, m, d } or null, setPin(id, kind, v), drop(id, kind), reset() }. A typed number shows on his row at once (instant-pins.js).
 */
export function createBoardMarks({ api, slate, console: cons, toast, pullAt, onChange, noteEl = null, players = () => [], reload = async () => {}, timers = globalThis }) {
  let view = null, latest = null, newsState = null, newsGen = 0, gen = 0, statusCards = new Map(), byId = new Map(), byFor = null;
  /** The problem with the lineup/news read, in words, or "" (shown with the send state above the list, so it is not only in the console log). */
  const newsProblem = () => (newsState?.failed ? `Lineup news could not be read: ${newsState.why}` : newsState?.stale ? `Lineup news is ${newsState.ageMin ?? "an unknown number of"} min old, so it is not used` : "");
  const note = () => { if (noteEl) { const bad = newsProblem(), html = api2.syncHtml() + (bad ? `<div class="syncnote err"><b>${esc(bad)}</b></div>` : ""); noteEl.innerHTML = html; noteEl.hidden = !html; } };
  /** The lineup/news read, on its own: when it settles and is still the newest one for the slate on show it sets latest, the status cards and the news state, and redraws.
   *  Never touches `view`. A throw anywhere in the chain comes back as a failed read with its reason, never as the console's fault. */
  function readNews(name) {
    const ng = ++newsGen;
    return api(`/api/slate/${encodeURIComponent(name)}/news-lineups`).then((r) => {
      const now = Number.isFinite(r?.now_ms) ? r.now_ms : Date.now();
      if (r?.state !== "ok") return { st: { failed: true, why: `the server answered "${r?.state ?? "nothing"}"` }, l: null };
      const stale = staleOf(r.latest, now);
      return stale ? { st: { stale: true, ageMin: stale.ageMin }, l: null } : { st: { ok: true }, l: withFreshness(r.latest, now) };
    }).catch((e) => { console.warn("lineup read for the S chips:", e.message); return { st: { failed: true, why: e.message }, l: null }; }).then((out) => {
      if (ng !== newsGen || name !== slate()) return;
      latest = out.l; newsState = out.st;
      statusCards = newestStatusCards(latest?.monster_news?.cards); // a stale or failed read is null here, so it gives no ruling
      note();
      onChange();
    });
  }
  /** news: read the lineup page again too (a new slate or pull); without it only the console's work is read again (after each change there). The two reads are independent:
   *  the console read only ever writes `view`, the lineup read only `latest`, so neither waits for or overwrites the other. */
  async function refresh({ news = true } = {}) {
    const name = slate(), g = ++gen;
    if (!name) return;
    const np = news ? readNews(name) : null;
    try {
      const v = await cons.boardView(name);
      if (g !== gen || name !== slate()) return np;
      view = v;
    } catch (e) {
      if (g !== gen) return np;
      view = null;
      toast(`The board could not read the console (starters and your typed numbers): ${e.message}`, "err");
    }
    note();
    onChange();
    instant.check(); // the console's send state moved (its redraw calls this): a typed number whose send has settled shows the server's figures
    return np;
  }
  /** The news ruling for a man's injury badge (news-status.js), or null to keep TwoGun's word. */
  const ruling = (id) => {
    const card = statusCards.get(String(id));
    if (!card) return null;
    const list = players();
    if (byFor !== list) { byFor = list; byId = new Map(list.map((p) => [String(p.dk_id), p])); } // rebuilt when the page swaps in a new player list
    const p = byId.get(String(id));
    return p ? newsRuling({ card, tgStatus: null, tgSince: null, viewOut: Boolean(view?.[String(id)]?.out) }) : null;
  };
  const teamOf = (id) => view?.[String(id)]?.team ?? null;
  /** The console write behind a typed number: every refusal is said (Adam, 11-07): not on the console, Out there, or the console could not load. Never rejects.
   *  onSlate: the slate the number was made on; "skipped" (counted and said by instant-pins.js) when another slate is on show by the time it is written. */
  async function handPin(id, kind, value, onSlate = slate()) {
    if (onSlate !== slate()) return "skipped";
    try {
      const v = await cons.boardView(onSlate); // the console's work for this slate, read fresh
      if (onSlate !== slate()) return "skipped"; // the slate changed while it was read: never written to the new one
      view = v;
      const team = teamOf(id);
      if (!team) { toast("He is not on the console for this slate, so his number cannot be kept.", "err"); return false; }
      if (cons.setMark(team, String(id), kind, value) === false) { toast("He is Out in the console, so a typed number is not used. Bring him back in there first.", "err"); return false; }
      return true;
    } catch (e) {
      toast(`Your number was not kept: ${e.message}`, "err");
      return false;
    }
  }
  function dropNow(id, kind) {
    const team = teamOf(id);
    if (!team) { toast("He is not on the console for this slate.", "err"); return; }
    try {
      if (cons.dropMark(team, String(id), kind) === false) toast("Nothing to drop: that number is no longer his on the console.", "err");
    } catch (e) { toast(`Your number was not dropped: ${e.message}`, "err"); }
  }
  const instant = createInstantPins({ players, slate, hand: handPin, syncState: () => cons.syncState?.() ?? null, teamOf, onChange, toast, timers });
  const api2 = {
    refresh,
    /** How the lineup/news read stands: null (not read yet), { ok }, { stale, ageMin } or { failed, why }; the player panel says so instead of "no news". */
    newsState: () => newsState,
    of(id) {
      instant.keep(players()); // a new list from the server: his numbers still on their way are shown over it (the rows ask this before drawing a cell)
      const v = view?.[String(id)], inj = ruling(id), nc = statusCards.get(String(id));
      if (!v && !inj && !nc) return null;
      // news: his newest status card whole (label, body, at), for the player panel's News box, shown in full.
      return { chip: v ? starterChip(v, latest, id, pullAt()) : null, m: v?.marks?.m ?? null, d: v?.marks?.d ?? null, inj, news: nc ? { label: nc.label ?? null, body: nc.body ?? null, at: nc.at ?? null } : null };
    },
    /** His typed minutes (m) or DK/min (d), from the Min cell's - and +, its box or the DK/m TON box: on his row at once, to the console after the quiet time (instant-pins.js). Resolves true when kept; never rejects. */
    setPin: (id, kind, value) => instant.press(id, kind, value),
    /** His set-aside typed minutes back in use: a Console number re-stamped (console restoreTyped, sent at once); a Minutes-page number typed again as it was on the Minutes route, then the slate read again. Never rejects. */
    async restore(id) {
      const p = players().find((x) => String(x.dk_id) === String(id)), team = teamOf(id) ?? p?.team ?? null;
      try {
        if (teamOf(id) && cons.restoreTyped(team, String(id)) !== false) return;
        const a = p?.ours?.min_aside;
        if (!a || !team) { toast("Nothing to bring back: he has no typed minutes set aside now.", "err"); return; }
        await api(`/api/minutes/${encodeURIComponent(slate())}/team/${encodeURIComponent(team)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "minutes", id: String(id), value: a.value }) });
        await reload();
      } catch (e) { toast(`Your number was not brought back: ${e.message}`, "err"); }
    },
    /** His undo chip. A number of his not yet sent goes with it; one being written now lands first, so the undo is the last word (a promise then). */
    drop(id, kind) {
      instant.cancel(id, kind);
      const going = instant.inFlight(id, kind);
      if (going) return going.then(() => dropNow(id, kind));
      dropNow(id, kind);
    },
    /** A new slate on show (board.js loadSlate): his numbers still on their way belong to the slate he left (instant-pins.js reset). */
    reset: () => instant.reset(),
    /** The send's state as the board shows it (console-auto.js syncWords): a line above the rows unless the board and optimizer are up to date. */
    syncHtml() {
      const w = syncWords(cons.syncState?.());
      if (w.cls === "ok" || (w.cls === "busy" && !w.lines.length)) return ""; // a send under way is not drawn: the list would jump on every change
      return `<div class="syncnote ${w.cls}"><b>${esc(w.text)}</b>${w.lines.map((l) => `<span>${esc(l)}</span>`).join("")}</div>`;
    },
  };
  return api2;
}
