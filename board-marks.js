// The board's reading of the console (Adam, 11-07): who starts tonight (the S chip by each starter's name: green when a lineup source has
// confirmed him or he is Adam's own pick, orange when only expected), and Adam's typed minutes and DK/min, which the board's Min and DK/m TON
// cells show with an undo chip. Every write goes through the console (console-card.js), so the console stays the one place they are kept.
// The pure parts are tested in node; createBoardMarks wires them to the page.
import { esc, isoToEastern } from "./board-util.js";
import { liveText } from "./console-marks.js";
import { syncWords } from "./console-auto.js";
import { staleOf, LINEUP_KEYS, LINEUP_LABEL, BACKS_ONLY } from "./lineup-proposals.js";
import { newsRuling, newestStatusCards } from "./news-status.js";

const okBlock = (b) => b?.state === "ok" && Array.isArray(b.men);
const at = (iso) => (iso ? isoToEastern(iso) ?? iso : "time unknown");

/** The lineup sources naming a man in their five: [{ key, label, confirmed, at }]. latest: news/lineups/latest.json, or null. */
export function lineupClaims(latest, team, id) {
  const block = latest?.teams?.[team] ?? {};
  return LINEUP_KEYS.filter((k) => okBlock(block[k]) && block[k].men.some((m) => m.id != null && String(m.id) === String(id) && m.status !== "Out"))
    .map((k) => ({ key: k, label: LINEUP_LABEL[k], confirmed: block[k].confirmed === true, at: latest.sources?.[k]?.fetched_at ?? null }));
}

/**
 * The S chip for one man, or null when the console does not start him. v: the console's boardView entry for him; latest: the lineup read;
 * pullAt: the TwoGun pull's time text. { state: "confirmed" | "expected", title }. His own S mark counts as his pick: confirmed, "yours".
 */
export function starterChip(v, latest, id, pullAt) {
  if (!v || v.role !== "starter") return null;
  const claims = lineupClaims(latest, v.team, id), conf = claims.filter((c) => c.confirmed);
  const mon = latest?.teams?.[v.team]?.monster, monAgainst = okBlock(mon) && mon.confirmed === true && !claims.some((c) => c.key === "monster"); // a confirmed Monster five that leaves him out
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
  let view = null, latest = null, gen = 0, statusCards = new Map(), byId = new Map(), byFor = null;
  const note = () => { if (noteEl) { const html = api2.syncHtml(); noteEl.innerHTML = html; noteEl.hidden = !html; } };
  /** news: read the lineup page again too (a new slate or pull); without it only the console's work is read again (after each change there). */
  async function refresh({ news = true } = {}) {
    const name = slate(), g = ++gen;
    if (!name) return;
    const read = !news ? Promise.resolve(latest) : api(`/api/slate/${encodeURIComponent(name)}/news-lineups`).then((r) => (r?.state === "ok" && !staleOf(r.latest, Number.isFinite(r.now_ms) ? r.now_ms : Date.now()) ? r.latest : null), (e) => { console.warn("lineup read for the S chips:", e.message); return null; });
    try {
      const [v, l] = await Promise.all([cons.boardView(name), read]);
      if (g !== gen || name !== slate()) return;
      view = v; latest = l;
    } catch (e) {
      if (g !== gen) return;
      view = null;
      toast(`The board could not read the console (starters and your typed numbers): ${e.message}`, "err");
    }
    statusCards = newestStatusCards(latest?.monster_news?.cards); // a stale read is null here, so it gives no ruling
    note();
    onChange();
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
    of(id) {
      const v = view?.[String(id)], inj = ruling(id);
      if (!v && !inj) return null;
      return { chip: v ? starterChip(v, latest, id, pullAt()) : null, m: v?.marks?.m ?? null, d: v?.marks?.d ?? null, inj };
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
