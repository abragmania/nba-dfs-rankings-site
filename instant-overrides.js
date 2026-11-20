// His typed Own, thumbs, star and row reset on the Player list show at once (Adam 1:35-1:36 PM 11-20: "when i enter stuff it should take instantly",
// "not just those buttons"). A click works out his change from the row as shown, puts the board's own reading of it on the row before any answer
// (guessRow, the server's formulas in server/slate/overrides.js mergeOverrides), and goes to the server in order (board-saves.js). The server's answer
// always wins: its rows replace the guess; a refused save puts back the last rows the server gave and says why. Nothing about what is saved changes.
// Pure; tested in node (tests/instant_overrides.test.mjs, which also holds guessProjection to the server's effectiveProjection).
import { isNum, round2, projAside } from "./figures.js";
import { BUMP_STEP_PCT } from "./override-limits.js";
import { hisProj, boardTyped } from "./board-util.js";
import { bumpStepsOf, nextBumpSteps } from "./bump-control.js";

/** The bumped projection as the server works it (overrides.js effectiveProjection: whole hundredths, a half rounding up); a missing figure stays missing. */
export function guessProjection(fig, steps) {
  if (!isNum(fig)) return fig ?? null;
  if (!steps) return fig;
  return Math.round((Math.round(fig * 100) * (100 + BUMP_STEP_PCT * steps)) / 100) / 100;
}
/** Value as the server works it (overrides.js valueFrom): points per $1,000 to hundredths; null when either is missing. */
const valueOf = (projection, salary) => (isNum(projection) && Number.isInteger(salary) && salary > 0 ? round2((projection * 1000) / salary) : null);

/**
 * One man's row with one change of his on it, as the server will answer: { kind: "own", v } (null removes), { kind: "proj", v }, { kind: "bump", steps },
 * { kind: "star", on } or { kind: "reset" } (his typed projection, ownership and bump off; a number the console or news wrote stays). A new object; the row is not touched. Pure.
 */
export function guessRow(p, change) {
  if (!p) return p;
  if (change.kind === "star") return { ...p, starred: Boolean(change.on) };
  const base = p.base ?? { projection: p.projection, value: p.value, proj_own: p.proj_own };
  const o = { steps: bumpStepsOf(p), projection: p.ovr?.projection ?? null, proj_own: p.ovr?.proj_own ?? null };
  let auto = p.auto;
  if (change.kind === "own") o.proj_own = isNum(change.v) ? round2(change.v) : null;
  else if (change.kind === "proj") {
    o.projection = isNum(change.v) ? round2(change.v) : null;
    if (o.projection == null && !isNum(base.projection)) o.steps = 0; // nothing left to scale: the server drops his bump too (overrides.js applyChanges)
    if (auto) auto = auto.min ? { ...auto, proj: false, pin: false } : undefined; // a number typed here is his: the send's marks on it go (and the row's auto with them when nothing else is marked)
  }
  else if (change.kind === "bump") o.steps = Number.isInteger(change.steps) ? change.steps : 0;
  else if (change.kind === "reset") { o.steps = 0; o.proj_own = null; if (hisProj(p) && !p.auto?.pin) o.projection = null; }
  else return p;
  const next = { ...p };
  if (auto === undefined) delete next.auto; else next.auto = auto;
  if (o.projection == null && o.proj_own == null && !o.steps) { // nothing of his left: the server answers the plain figures, with no base or ovr
    delete next.base; delete next.ovr;
    return { ...next, projection: base.projection, value: base.value, proj_own: base.proj_own };
  }
  const projection = guessProjection((projAside(p, o.projection) ? null : o.projection) ?? base.projection, o.steps); // a number typed on a man not playing is set aside, as the server's merge does (figures.js projAside)
  return { ...next, projection, value: projection !== base.projection ? valueOf(projection, p.salary) : base.value, proj_own: o.proj_own ?? base.proj_own, base, ovr: o };
}

/** The changes an overrides body makes, as [id, change] pairs in the order guessRow takes them; a resetAll body is every man with a board-typed number (rows: the rows shown). Pure. */
export function changesOf(body, rows = []) {
  if (!body || typeof body !== "object") return [];
  if (body.resetAll === true) return rows.filter((p) => boardTyped(p)).map((p) => [String(p.dk_id), { kind: "reset" }]);
  if (typeof body.reset === "string") return [[body.reset, { kind: "reset" }]];
  const out = [];
  for (const [id, v] of Object.entries(body.proj ?? {})) out.push([id, { kind: "proj", v }]);
  for (const [id, v] of Object.entries(body.own ?? {})) out.push([id, { kind: "own", v }]);
  for (const [id, v] of Object.entries(body.bump ?? {})) out.push([id, { kind: "bump", steps: v ?? 0 }]);
  for (const [id, v] of Object.entries(body.stars ?? {})) out.push([id, { kind: "star", on: v }]);
  return out;
}

/** True for a body of plain changes ({ proj, own, bump, stars }), which may go to the server together; a reset goes on its own (the route refuses it with anything else). Pure. */
export const isChanges = (body) => Boolean(body) && typeof body === "object" && !("reset" in body) && !("resetAll" in body);

/** Change bodies in click order as one: each section's ids merged, a later value for a man winning. Pure. */
export function mergeBodies(bodies) {
  const out = {};
  for (const b of bodies) for (const [sec, ids] of Object.entries(b)) out[sec] = { ...(out[sec] ?? {}), ...ids };
  return out;
}

/**
 * The rows with the changes still on their way put on them: rows are the server's; bodies the pending saves for the slate on show, in click order.
 * { rows (the same objects for a man with nothing pending), server: Map id -> his server row, for each man shown with a guess }. Pure.
 */
export function overlayRows(rows, bodies) {
  const server = new Map();
  if (!bodies.length) return { rows, server };
  const now = new Map(rows.map((p) => [String(p.dk_id), p])), orig = new Map(now);
  // In click order, each body read against the rows as the bodies before it left them: a Reset all names the men his earlier pending changes typed on too (review 11-20).
  for (const b of bodies) {
    for (const [id, ch] of changesOf(b, isChanges(b) ? [] : [...now.values()])) {
      const p = now.get(id);
      if (!p) continue;
      if (!server.has(id)) server.set(id, orig.get(id));
      now.set(id, guessRow(p, ch));
    }
  }
  return { rows: rows.map((p) => now.get(String(p.dk_id)) ?? p), server };
}

/** A thumbs press: { id, steps } from the row as shown (one more step that way, the opposite thumb clearing to 0), or null when it leaves nothing to do (at the limit, no row). Pure. */
export function bumpOf(action, row) {
  if (!row) return null;
  const now = bumpStepsOf(row), next = nextBumpSteps(now, action === "bump-up" ? 1 : -1);
  return next === now ? null : { id: String(row.dk_id), steps: next };
}
