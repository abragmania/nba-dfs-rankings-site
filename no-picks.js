// The NO list on the Player list (Adam 4:34-4:52 PM ET 11-19): a NO button in each row's controls, a loud red chip beside the Min gap
// alert naming the open mode's NO men (each with its own ✕, and clear all), and the row kept in view with a pink tint and a NO tag.
// NO is "build without him" for the open mode only; it never touches his exclude, projection or exposures. Late swap mode has its
// OWN list, "Late" (Adam 5:28 PM 11-19: "I want the no OPTION in those scenarios, don't just carry a player 'no' over"): in late swap
// the button, tint and chip ("NO · late swap") work on it, and the build lists stay apart. The lists are the server's (lineup/no-list.js,
// beside his picks); saves go one at a time, in order, as the picks do. The markup helpers are pure and tested in node; createNoPicks wires the saves.
import { esc } from "./board-util.js";

export const NO_MODES = Object.freeze(["Cash", "GPP"]);
export const LATE = "Late";
const modeOk = (m) => (NO_MODES.includes(m) || m === LATE ? m : "GPP");
const kindOf = (m) => (m === LATE ? "late" : "build");
/** The chip's name for a list: "GPP", "Cash", "late swap". */
const listWord = (m) => (m === LATE ? "late swap" : m);

/** The list with `id` added, or taken out when it is on it. A new array. */
export const toggleNo = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

/** The row's NO button (between the lock and the exclude). In late swap it works on the late swap list; a started man's is off. */
export function noCellHtml(p, on, lateSwap = false, started = false) {
  const id = esc(p.dk_id);
  if (started) return `<td class="ctl"><button class="nob${on ? " on" : ""}" disabled title="Game started">NO</button></td>`;
  const what = lateSwap ? `late swap fills without ${esc(p.name)} (a man whose game has started, or kept here, stays)` : `build lineups without ${esc(p.name)} (his exclude, projection and exposures stay as they are)`;
  return `<td class="ctl"><button class="nob${on ? " on" : ""}" data-no="${id}" aria-pressed="${on}" title="${on ? `Clear NO: ${lateSwap ? "late swap" : "builds"} may use ${esc(p.name)} again` : `NO: ${what}`}">NO</button></td>`;
}

/** The small tag by a NO man's name. */
export const noTagHtml = (on, lateSwap = false) => (on ? `<span class="notag" title="${lateSwap ? "On the late swap NO list: late swap fills leave him out" : "On the NO list: builds in this mode leave him out"}">NO</span>` : "");

/**
 * The red chip beside the Min gap alert: "🚫 NO · GPP" (or "· late swap"), each NO man with his own ✕, and clear all. "" with nobody on NO.
 * `error` (the list could not be read) shows instead, so an unknown list never reads as an empty one; "reset it" replaces the file.
 */
export function noChipHtml({ mode, ids, nameOf, error = null, lsw = false }) {
  // The Player list's buttons are read by board.js (data-nox, data-noclear, data-noretry); the Entries screen's by lsw-lineups.js (data-lsw).
  const at = lsw ? { x: (id) => `data-lsw="lbNoX" data-id="${esc(id)}"`, clear: 'data-lsw="lbNoClear"', retry: 'data-lsw="lbNoRetry"' } : { x: (id) => `data-nox="${esc(id)}"`, clear: "data-noclear", retry: "data-noretry" };
  if (error) return `<span class="nochip noerr" title="${esc(error)}"><span class="nolbl">🚫 ${mode === LATE ? "Late swap NO" : "NO"} list could not be read</span><button class="noclr" ${at.retry}>try again</button><button class="noclr" ${at.clear} title="Start the ${esc(listWord(mode))} NO list empty; the unreadable file is replaced${mode === LATE ? "" : " and the other mode's list is empty too"}">reset it</button></span>`;
  if (!ids.length) return "";
  const men = ids.map((id) => `<span class="nonm">${esc(nameOf(id))}<button class="nox" ${at.x(id)} title="Clear NO on ${esc(nameOf(id))}" aria-label="Clear NO on ${esc(nameOf(id))}">✕</button></span>`).join("");
  const title = mode === LATE ? "Late swap fills leave these men out of the open slots; a man whose game has started, or kept here, stays. The build NO lists are apart." : `Builds in ${mode} leave these men out. Their excludes, projections and exposures are untouched.`;
  return `<span class="nochip" role="group" aria-label="NO list, ${esc(listWord(mode))}" title="${esc(title)}"><span class="nolbl">🚫 NO · ${esc(listWord(mode))}</span>${men}<button class="noclr" ${at.clear}>clear all</button></span>`;
}

/** One promise for "both queues now settled", the same object until either queue gains a link, so a until-unchanged wait
 *  (panel.js picksSettled) ends. `a` and `b` return their queue's current promise. */
export function combineSettled(a, b) {
  let of = [], p = Promise.resolve();
  return () => {
    const x = a(), y = b();
    if (of[0] !== x || of[1] !== y) { of = [x, y]; p = Promise.all(of); }
    return p;
  };
}

/**
 * The page's NO lists. deps: api, toast, slate() (the slate on show), mode() (the optimizer's mode), onChange() (redraw rows
 * and chip), nameOf(id) (a man's name for messages). The lists are what the server answered; a click shows at once and is sent in order;
 * a failed save reads them again.
 */
export function createNoPicks({ api, toast, slate, mode, onChange, nameOf = (id) => `DraftKings id ${id}` }) {
  const none = () => ({ Cash: [], GPP: [], [LATE]: [] });
  let lists = none(), errors = {}, queue = Promise.resolve(); // errors: kind ("build" | "late") -> why its list could not be read
  const url = (name) => `/api/slate/${encodeURIComponent(name)}/no`;
  const take = (out) => {
    lists = Object.fromEntries(Object.keys(none()).map((m) => [m, Array.isArray(out?.[m]) ? out[m] : []]));
    errors = out?.unreadable && typeof out.unreadable === "object" ? { ...out.unreadable } : {};
  };
  async function load(name = slate()) {
    try {
      const out = await api(url(name));
      if (name !== slate()) return;
      take(out);
      if (out.dropped?.length) toast(`${out.dropped.length} NO ${out.dropped.length === 1 ? "man is" : "men are"} no longer on this slate and ignored: ${out.dropped.map((d) => `${d.name ?? `DraftKings id ${d.id}`} (${listWord(d.mode)})`).join(", ")}. The saved list keeps ${out.dropped.length === 1 ? "him" : "them"} until your next NO change.`);
    } catch (e) {
      if (name !== slate()) return;
      lists = none();
      const why = `The NO list could not be read: ${e.message}. Builds and late swap still read the saved lists on the server.`;
      errors = { build: why, late: why };
    }
    onChange();
  }
  const error = (m = mode()) => errors[kindOf(modeOk(m))] ?? null;
  let pending = 0; // saves not yet answered: only the last one's answer is drawn, so a quick second click never flickers back
  function set(m, ids) {
    const name = slate(), md = modeOk(m);
    lists = { ...lists, [md]: ids };
    onChange();
    const body = JSON.stringify({ mode: md, ids });
    pending++;
    queue = queue.then(async () => {
      try {
        const out = await api(url(name), { method: "POST", headers: { "content-type": "application/json" }, body });
        if (out.replaced_unreadable) toast(out.replaced_unreadable, "err");
        if (out.ignored?.length) toast(`${out.ignored.map(nameOf).join(", ")} ${out.ignored.length === 1 ? "is" : "are"} no longer on this slate, so not kept on the NO list; the others are saved.`, "err");
        if (--pending === 0 && name === slate()) { take(out); onChange(); }
      } catch (e) {
        pending--;
        toast(`Could not save the NO list: ${e.message}`, "err");
        if (name === slate()) await load(name); // the saved file is the truth
      }
    });
  }
  const ids = (m = mode()) => lists[modeOk(m)] ?? [];
  // While the list cannot be read, the page's lists are unknown (shown empty): a click must not write them over the saved file (review F8b).
  // Only "reset it" (clear) may write, which replaces the unreadable file on purpose (lineup/no-list.js saveNo).
  const known = (m) => { const e = error(m); if (e) toast("The NO list could not be read, so this click was not saved. Try again, or reset it from the red chip.", "err"); return !e; };
  // The same lists by name, for a screen that is always on one list (the Entries screen works on the late swap list, lsw-lineups.js).
  const toggleIn = (m, id) => { if (known(m)) set(m, toggleNo(ids(m), id)); };
  const dropIn = (m, id) => { if (known(m)) set(m, ids(m).filter((x) => x !== id)); };
  return {
    load, ids, error,
    has: (id, m) => ids(m).includes(id),
    toggle: (id) => toggleIn(mode(), id),
    drop: (id) => dropIn(mode(), id),
    clear: () => set(mode(), []),
    toggleIn, dropIn, clearIn: (m) => set(m, []),
    settled: () => queue,
  };
}
