// The board's reading of the console (Adam, 11-07): who starts tonight (the S chip by each starter's name: green when a lineup source has
// confirmed him or he is Adam's own pick, orange when only expected), and Adam's typed minutes and DK/min, which the board's Min and DK/m TON
// cells show with an undo chip. Every write goes through the console (console-card.js), so the console stays the one place they are kept.
// The pure parts are tested in node; createBoardMarks wires them to the page.
import { esc, isoToEastern } from "./board-util.js";
import { liveText } from "./console-marks.js";
import { syncWords } from "./console-auto.js";
import { staleOf, withFreshness, blockFresh, LINEUP_KEYS, LINEUP_LABEL, BACKS_ONLY } from "./lineup-proposals.js";
import { newsRuling, newestStatusCards } from "./news-status.js";

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

/** An undo chip on a Min (m) or DK/m TON (d) cell: one click drops his typed number. */
export const undoChipHtml = (id, kind, mark) => (mark ? `<button class="cundo" type="button" data-unmark="${kind}" data-id="${esc(id)}" title="${esc(`Your typed ${kind === "m" ? "minutes" : "DK/min"}. ${liveText(kind, mark)}. Click to drop it`)}">&#8634;</button>` : "");

/**
 * deps: { api, slate() -> the slate on show, console (boardView, setMark, dropMark, syncState), toast, pullAt() -> the pull's time text, onChange() (redraw rows),
 * noteEl (the line above the list where the send's state shows) }.
 * Returns { refresh({ news }), of(id) -> { chip, m, d } or null, setPin(id, kind, v), drop(id, kind) }.
 */
export function createBoardMarks({ api, slate, console: cons, toast, pullAt, onChange, noteEl = null, players = () => [] }) {
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
    return np;
  }
  /** The news ruling for a man's injury badge (news-status.js), or null to keep TwoGun's word. */
  const ruling = (id) => {
    const card = statusCards.get(String(id));
    if (!card) return null;
    const list = players();
    if (byFor !== list) { byFor = list; byId = new Map(list.map((p) => [String(p.dk_id), p])); } // rebuilt when the page swaps in a new player list
    const p = byId.get(String(id));
    return p ? newsRuling({ card, tgStatus: p.injury_status, tgSince: p.status_since ?? null, viewOut: Boolean(view?.[String(id)]?.out) }) : null;
  };
  const teamOf = (id) => view?.[String(id)]?.team ?? null;
  const api2 = {
    refresh,
    /** How the lineup/news read stands: null (not read yet), { ok }, { stale, ageMin } or { failed, why }; the player panel says so instead of "no news". */
    newsState: () => newsState,
    of(id) {
      const v = view?.[String(id)], inj = ruling(id), nc = statusCards.get(String(id));
      if (!v && !inj && !nc) return null;
      // news: his newest status card whole (label, body, at), for the player panel's News box, shown in full.
      return { chip: v ? starterChip(v, latest, id, pullAt()) : null, m: v?.marks?.m ?? null, d: v?.marks?.d ?? null, inj, news: nc ? { label: nc.label ?? null, body: nc.body ?? null, at: nc.at ?? null } : null };
    },
    /** Every refusal is said (Adam, 11-07): not on the console, Out there, or the console could not load. Never rejects. */
    async setPin(id, kind, value) {
      try {
        view = await cons.boardView(slate()); // the console's work for this slate, read fresh
        const team = teamOf(id);
        if (!team) { toast("He is not on the console for this slate, so his number cannot be kept.", "err"); return false; }
        if (cons.setMark(team, String(id), kind, value) === false) { toast("He is Out in the console, so a typed number is not used. Bring him back in there first.", "err"); return false; }
        return true;
      } catch (e) {
        toast(`Your number was not kept: ${e.message}`, "err");
        return false;
      }
    },
    drop(id, kind) {
      const team = teamOf(id);
      if (!team) { toast("He is not on the console for this slate.", "err"); return; }
      try {
        if (cons.dropMark(team, String(id), kind) === false) toast("Nothing to drop: that number is no longer his on the console.", "err");
      } catch (e) { toast(`Your number was not dropped: ${e.message}`, "err"); }
    },
    /** The send's state as the board shows it (console-auto.js syncWords): a line above the rows unless the board and optimizer are up to date. */
    syncHtml() {
      const w = syncWords(cons.syncState?.());
      if (w.cls === "ok" || (w.cls === "busy" && !w.lines.length)) return ""; // a send under way is not drawn: the list would jump on every change
      return `<div class="syncnote ${w.cls}"><b>${esc(w.text)}</b>${w.lines.map((l) => `<span>${esc(l)}</span>`).join("")}</div>`;
    },
  };
  return api2;
}
