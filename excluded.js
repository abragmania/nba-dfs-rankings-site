// Nobody is left out of the player pool (Adam 11-19, 4:18 PM ET): "they just get excluded with a projection of 0, so they show up in the excluded section; that makes it so I can put them back
// in easily". A man our minutes engine has not playing (our own injury feeds, or his own Out: figures.js outFor) is EXCLUDED as a derived state: shown in the Player list's Excluded section in Cash and
// GPP alike, never written into his saved exclusions (cache/picks), so when a feed drops the Out he comes back by himself. His un-exclude of such a man is his In on the Minutes page (POST action "in"),
// which the engine and outFor already honour, so it sticks and wins until he undoes it. His own excludes are untouched. Pure; one copy for the board and the public site.
import { outFor } from "./figures.js";

/** The men excluded because they are not playing tonight (outFor with the engine; his In beats a feed's Out): their dk_ids. */
export const autoExcluded = (players) => (players ?? []).filter((p) => p?.dk_id != null && outFor(p, { engine: true })).map((p) => String(p.dk_id));

/** The picks the Player list shows: his saved locks and excludes, with the not-playing men added to the excluded (a man he locked stays locked). Pure. */
export function shownPicks(picks, players) {
  const saved = picks?.excluded ?? [], locked = new Set(picks?.locked ?? []);
  return { locked: picks?.locked ?? [], excluded: [...new Set([...saved, ...autoExcluded(players).filter((id) => !locked.has(id))])] };
}

/** Whether an exclude click on this man is an un-exclude of a derived Out: he is not playing and NOT locked (a locked man is shown locked, not
 *  excluded, so his click is the plain lock-to-exclude swap; review F2 11-19). The board then puts him In on the Minutes page; his own saved
 *  exclude, if he has one, is lifted in the same click (Adam 11-19). Pure. */
export const isAutoExcluded = (id, picks, players) => !(picks?.locked ?? []).includes(id) && autoExcluded(players).includes(String(id));

/** What an Exclude click does (board.js): { putIn, save } — putIn: send his In to the Minutes page; save: the picks to save, or null.
 *  A derived Out man not locked: his saved exclude (if any) is lifted and he is put In. Anyone else: the exclude toggles, and a newly
 *  excluded man leaves the locks. `picks` are the live picks (men on the slate). Pure. */
export function excludeClick(id, picks, players) {
  const locked = picks?.locked ?? [], excluded = picks?.excluded ?? [];
  if (isAutoExcluded(id, picks, players)) return { putIn: true, save: excluded.includes(id) ? { locked, excluded: excluded.filter((x) => x !== id) } : null };
  const has = excluded.includes(id);
  return { putIn: false, save: { excluded: has ? excluded.filter((x) => x !== id) : [...excluded, id], locked: has ? locked : locked.filter((x) => x !== id) } };
}
