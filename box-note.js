// The board's box score line and its place in the Data warnings count, from the slate route's box_freshness (server/boxes/freshness.js). Pure strings, tested in node; board.js
// draws them. With no box_freshness (the public site, which does not carry the boxes) nothing is said; ok with a clean night says nothing; stale, unknown or a bad
// overnight run is one line and one data warning.
import { warningText } from "./board-util.js";

const NAMED = 10; // teams named on the line; the rest are counted, all of them in the title
const md = (day) => String(day ?? "").slice(5); // "2026-11-09" -> "11-09"
const listed = (a, n) => `${a.slice(0, n).join(", ")}${a.length > n ? ` and ${a.length - n} more` : ""}`;

/** The one line, or "" when there is nothing to say: { text, title, counted }. The nightly job's bad or missing night (f.nightly, server/boxes/nightly.js) comes first,
 *  even when the boxes are fresh; a night the pull-time step has since made good (f.nightly_quiet, with fresh boxes) is shown but not counted as a data warning. */
export function boxNote(f) {
  if (!f || typeof f !== "object") return { text: "", title: "", counted: false };
  const nightly = typeof f.nightly === "string" && f.nightly ? [f.nightly.replace(/\.+$/, "")] : [];
  if (f.ok === true) return nightly.length ? { text: `${nightly[0]}.`, title: f.checked_at ? `Checked ${f.checked_at}` : "", counted: f.nightly_quiet !== true } : { text: "", title: "", counted: false };
  const stale = Array.isArray(f.stale) ? f.stale : [];
  const parts = [...nightly], titles = [];
  if (stale.length) {
    const teams = stale.map((s) => s.team);
    const dates = [...new Set(stale.flatMap((s) => (s.missing_games ?? []).map((g) => g.date)))].sort();
    const lastOnly = stale.every((s) => s.missing_games?.length === 1 && s.missing_games[0].date === s.last_played);
    const which = dates.length === 1 ? `${lastOnly ? "last game" : "game"} ${md(dates[0])}` : `games ${listed(dates.map(md), 4)}`;
    parts.push(`Box scores behind for ${listed(teams, NAMED)}: ${which} not on file — minutes use older games`);
    titles.push(...stale.map((s) => `${s.team}: missing ${(s.missing_games ?? []).map((g) => `${md(g.date)} ${g.away} at ${g.home}`).join(", ")}; newest box on file ${s.newest_box ? md(s.newest_box) : "none"}`));
  }
  if (f.state === "unknown" || !stale.length) parts.push(`Box score freshness unknown: ${String(f.why ?? "no reason given").replace(/\.+$/, "")} — minutes may use older games`);
  const text = `${parts.join(". ")}.`;
  return { text, title: [...titles, f.checked_at ? `Checked ${f.checked_at}` : ""].filter(Boolean).join("\n"), counted: true };
}

/** The header's Data warnings lists from the slate: conflicts, missing, and the box score line as one entry (unless it is a quiet one). The button's count is the three lengths added. */
export function noteLists(slate) {
  const box = boxNote(slate?.box_freshness);
  return {
    conflicts: (slate?.conflicts ?? []).map(warningText),
    missing: [...(slate?.missing ?? []).map(warningText), ...(slate?.min_ours_problem ? [slate.min_ours_problem] : []), ...(slate?.proj_problem ? [slate.proj_problem] : [])],
    boxes: box.text && box.counted ? [box.text] : [],
  };
}
export const warningCount = (n) => n.conflicts.length + n.missing.length + n.boxes.length;

const boxesKey = (f) => JSON.stringify([f?.state ?? null, f?.stale ?? [], f?.why ?? null, f?.nightly ?? null, f?.nightly_quiet === true]);
/**
 * The once-a-minute box check (slate-refresh.js onBoxes): the new answer when its state, stale list or reason differs from the one on show, else null. Nothing is asked, and
 * null comes back, when the slate on show has no box_freshness (the public site, or an app that does not check). fetchAnswer() is GET /api/boxes/freshness; a failed or
 * shapeless answer is "unknown" with the reason, never kept as ok. Never throws.
 */
export async function freshBoxes(slateData, fetchAnswer, nowMs = Date.now()) {
  if (!slateData || typeof slateData !== "object" || !Object.hasOwn(slateData, "box_freshness")) return null;
  let f;
  try {
    f = await fetchAnswer();
    if (!f || typeof f !== "object" || typeof f.state !== "string" || !Array.isArray(f.stale)) throw new Error("the answer has no state");
  } catch (e) {
    f = { checked_at: new Date(nowMs).toISOString(), state: "unknown", ok: false, stale: [], why: `the box score check could not be read (${e?.message ?? e})`, season: null };
  }
  return boxesKey(f) === boxesKey(slateData.box_freshness) ? null : f;
}
