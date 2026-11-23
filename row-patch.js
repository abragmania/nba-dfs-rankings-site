// The Player list's rows redrawn by row (Adam 1:35 PM 11-20: an entry must show at once). Drawing all 212 rows took 200-300 ms of the browser's
// style and layout work on every click; now each redraw builds every row's markup as before (player-table.js rowHtml, the one copy) and puts on the
// page only the rows whose markup changed, moving the rest into the new order. A redraw that changes most rows draws the whole body, as before.
// What a row shows is decided only by rowHtml: a row is never left drawn from old markup. planRows is pure and tested in node; createRowPatch is the page part.

/** More changed or moved rows than this and the whole body is drawn at once (cheaper than many single changes). */
export const PATCH_MAX = 60;

/**
 * What a redraw changes. prev: [{ id, html }] as drawn (null when the body holds anything else: nothing drawn yet, or the "No players match" line);
 * next: [{ id, html }] to show. { full: true } or { full: false, changed: ids whose markup differs, added: ids new to the body, removed: ids leaving,
 * moves: how many rows change place }. Pure.
 */
export function planRows(prev, next, max = PATCH_MAX) {
  if (!prev || !next.length || new Set(next.map((r) => r.id)).size !== next.length) return { full: true };
  const was = new Map(prev.map((r) => [r.id, r.html]));
  const now = new Set(next.map((r) => r.id));
  const changed = next.filter((r) => was.has(r.id) && was.get(r.id) !== r.html).map((r) => r.id);
  const added = next.filter((r) => !was.has(r.id)).map((r) => r.id);
  const removed = prev.filter((r) => !now.has(r.id)).map((r) => r.id);
  // The rows that stay, in their old order, walked against the new order: each one out of step is one move (as the page part does it).
  const order = prev.filter((r) => now.has(r.id)).map((r) => r.id);
  let moves = 0, at = 0;
  for (const r of next) {
    if (!was.has(r.id)) continue;
    if (order[at] === r.id) { at++; continue; }
    const k = order.indexOf(r.id, at);
    order.splice(k, 1); order.splice(at, 0, r.id); at++; moves++;
  }
  if (changed.length + added.length + moves > max) return { full: true };
  return { full: false, changed, added, removed, moves };
}

/** The page part, bound to the table body. draw(rows: [{ id, html }], emptyHtml) shows them; forget(id) marks a row whose drawn element was changed by hand (it is drawn fresh next time); clear() draws the whole body next time. */
export function createRowPatch(body, max = PATCH_MAX) {
  let drawn = null; // Map id -> { html, el }, in the body's order; null when the body is not ours to patch
  function full(rows, emptyHtml) {
    body.innerHTML = rows.length ? rows.map((r) => r.html).join("") : emptyHtml;
    const els = body.children;
    drawn = rows.length && els.length === rows.length ? new Map(rows.map((r, i) => [r.id, { html: r.html, el: els[i] }])) : null;
  }
  function draw(rows, emptyHtml) {
    const prev = drawn && [...drawn].every(([, v]) => v.el.parentNode === body) ? [...drawn].map(([id, v]) => ({ id, html: v.html })) : null;
    const plan = planRows(prev, rows, max);
    if (plan.full) { full(rows, emptyHtml); return; }
    const fresh = [...plan.changed, ...plan.added];
    const made = new Map();
    if (fresh.length) {
      const html = new Map(rows.map((r) => [r.id, r.html]));
      const tpl = document.createElement("tbody");
      tpl.innerHTML = fresh.map((id) => html.get(id)).join("");
      fresh.forEach((id, i) => made.set(id, tpl.children[i]));
      if (made.size !== fresh.length || [...made.values()].some((el) => !el)) { full(rows, emptyHtml); return; } // markup that is not one row each: drawn whole, never half
    }
    for (const id of plan.removed) drawn.get(id).el.remove();
    for (const id of plan.changed) drawn.get(id).el.replaceWith(made.get(id));
    const next = new Map();
    let cur = body.firstElementChild;
    for (const r of rows) {
      const el = made.get(r.id) ?? drawn.get(r.id).el;
      if (el === cur) cur = cur.nextElementSibling; else body.insertBefore(el, cur);
      next.set(r.id, { html: r.html, el });
    }
    drawn = next;
  }
  return {
    draw,
    forget(id) { const d = drawn?.get(String(id)); if (d) d.html = null; },
    clear() { drawn = null; },
  };
}
