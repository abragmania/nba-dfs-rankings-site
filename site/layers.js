// A visitor's own overrides and console scenarios layered on Adam's published baseline, per man (overrides) and per team (scenarios). What the browser keeps is only the visitor's own differences
// from the baseline he saw when he saved, plus that baseline's version; what the app's code reads is the baseline's newest figures with his differences on top. So a man he never touched follows
// Adam's later numbers, a man he did touch keeps his, and the board foot says when the baseline moved after his last save. No imports, so the fs shim and the tests load it. Pure but for `baselines`.

const MARK = 1;
const SECTIONS = ["proj", "own", "bump", "min"];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** slate -> { overrides, scenarios, version }: the newest published baseline this page holds (static-api.js sets it from site.json). */
export const baselines = new Map();
export const setBaseline = (slate, b) => { if (b) baselines.set(slate, b); else baselines.delete(slate); };

const kindOf = (p) => /^\/data\/slates\/([^/]+)\/(overrides|scenarios)\.json$/.exec(p);
/** Whether a file path is one of the two layered files; { slate, kind } or null. */
export function layeredPath(p) { const m = kindOf(p); return m ? { slate: m[1], kind: m[2] } : null; }

// ---------- overrides: per man, in each of proj, own, bump, min and the star list ----------
export function splitOverrides(W, B, version) {
  const edits = {};
  for (const sec of SECTIONS) {
    const w = W[sec] ?? {}, b = B?.[sec] ?? {}, e = {};
    for (const id of new Set([...Object.keys(w), ...Object.keys(b)])) {
      if (!has(w, id)) e[id] = null; // he took the number away
      else if (!has(b, id) || !same(w[id], b[id])) e[id] = w[id];
    }
    if (Object.keys(e).length) edits[sec] = e;
  }
  const ws = new Set(W.stars ?? []), bs = new Set(B?.stars ?? []), st = {};
  for (const id of ws) if (!bs.has(id)) st[id] = true;
  for (const id of bs) if (!ws.has(id)) st[id] = false;
  if (Object.keys(st).length) edits.stars = st;
  return { site_layer: MARK, kind: "overrides", base_version: version ?? null, edits, ...(W.auto !== undefined ? { auto: W.auto } : {}), updated_at: W.updated_at ?? null };
}

export function mergeOverrides(B, layer) {
  const out = { proj: {}, own: {}, bump: {}, min: {}, stars: [] };
  for (const sec of SECTIONS) out[sec] = { ...(B?.[sec] ?? {}) };
  const edited = {};
  for (const sec of SECTIONS) for (const [id, v] of Object.entries(layer.edits?.[sec] ?? {})) { (edited[sec] ??= new Set()).add(id); if (v === null) delete out[sec][id]; else out[sec][id] = v; }
  const stars = new Set(B?.stars ?? []);
  for (const [id, on] of Object.entries(layer.edits?.stars ?? {})) { if (on) stars.add(id); else stars.delete(id); }
  out.stars = [...stars];
  if (B?.auto !== undefined || layer.auto !== undefined) {
    const lists = {};
    for (const list of ["proj", "min", "pin"]) {
      const sec = list === "pin" ? "proj" : list, mine = edited[sec] ?? new Set();
      lists[list] = [...new Set([...(B?.auto?.[list] ?? []).filter((id) => !mine.has(id)), ...(layer.auto?.[list] ?? []).filter((id) => mine.has(id))])].filter((id) => has(out[sec], id));
    }
    out.auto = lists;
  }
  out.updated_at = layer.updated_at ?? B?.updated_at ?? null;
  return out;
}

// ---------- scenarios: per team, and the Apply record per team (its keys by team; its set and base by the men of the teams) ----------
/** slate -> Map dk_id -> team: the slate's roster as this page holds it (static-api.js sets it), so an Apply record's men can be told by team. A man it does not know is in the team "?". */
export const rosters = new Map();
export const setRoster = (slate, players) => { rosters.set(slate, new Map((players ?? []).map((p) => [String(p.dk_id), p.team]))); };
const teamOfFor = (slate) => (id) => rosters.get(slate)?.get(String(id)) ?? "?";

/** An Apply record split by team: { TEAM: { key, set: {id: ...}, base: {id: ...} } }. Pure. */
export function appliedByTeam(a, teamOf) {
  const out = {};
  if (!a) return out;
  const at = (t) => (out[t] ??= { set: {}, base: {} });
  for (const [t, k] of Object.entries(a.keys ?? {})) at(t).key = k;
  for (const [id, e] of Object.entries(a.set ?? {})) at(teamOf(id)).set[id] = e;
  for (const [id, b] of Object.entries(a.base ?? {})) at(teamOf(id)).base[id] = b;
  return out;
}

/** The Apply record from its per-team parts, with the record-level fields `top` (at, pull); null when no team is left. Pure. */
function appliedFrom(parts, top) {
  const teams = Object.entries(parts);
  if (!teams.length) return null;
  const keys = {}, set = {}, base = {};
  for (const [t, p] of teams) { if (p.key !== undefined) keys[t] = p.key; Object.assign(set, p.set); Object.assign(base, p.base); }
  return { at: typeof top.at === "string" ? top.at : "", ...(typeof top.pull === "string" ? { pull: top.pull } : {}), set, ...(Object.keys(keys).length ? { keys } : {}), ...(Object.keys(base).length ? { base } : {}) };
}

export function splitScenarios(W, B, version, teamOf = () => "?") {
  const w = W.teams ?? {}, b = B?.teams ?? {}, teams = {};
  for (const t of new Set([...Object.keys(w), ...Object.keys(b)])) {
    if (!has(w, t)) teams[t] = null;
    else if (!has(b, t) || !same(w[t], b[t])) teams[t] = w[t];
  }
  const wa = appliedByTeam(W.applied, teamOf), ba = appliedByTeam(B?.applied, teamOf), edited = {};
  for (const t of new Set([...Object.keys(wa), ...Object.keys(ba)])) if (!same(wa[t] ?? null, ba[t] ?? null)) edited[t] = wa[t] ?? null;
  const applied = Object.keys(edited).length ? { teams: edited, at: W.applied?.at ?? null, pull: W.applied?.pull ?? null } : null;
  return { site_layer: MARK, kind: "scenarios", base_version: version ?? null, edits: { teams, ...(applied ? { applied } : {}) }, schema: W.schema, slate: W.slate, updated_at: W.updated_at ?? null };
}

export function mergeScenarios(B, layer, teamOf = () => "?") {
  const teams = { ...(B?.teams ?? {}) };
  for (const [t, rec] of Object.entries(layer.edits?.teams ?? {})) { if (rec === null) delete teams[t]; else teams[t] = rec; }
  let applied = B?.applied ?? null;
  const ap = layer.edits?.applied;
  if (ap) {
    const parts = appliedByTeam(B?.applied, teamOf);
    for (const [t, rec] of Object.entries(ap.teams ?? {})) { if (rec === null) delete parts[t]; else parts[t] = rec; }
    applied = appliedFrom(parts, { at: ap.at ?? B?.applied?.at, pull: ap.pull ?? B?.applied?.pull });
  }
  return { schema: layer.schema ?? B?.schema, ...(layer.slate ?? B?.slate ? { slate: layer.slate ?? B?.slate } : {}), teams, applied, updated_at: layer.updated_at ?? B?.updated_at ?? null };
}

// ---------- the fs shim's hook (shim/fs.js setLayer) ----------
/**
 * What the browser stores for a write of the full file `text` at path p: the visitor's differences from the baseline he is working on, always in layer form. With no baseline loaded the base is empty,
 * so what is stored is his differences from nothing (his whole file as his own), never a bare whole file; a baseline that loads later is then the base under them.
 */
export function encode(text, p) {
  const at = layeredPath(p);
  if (!at) return text;
  const b = baselines.get(at.slate);
  try {
    const W = JSON.parse(text);
    return JSON.stringify(at.kind === "overrides" ? splitOverrides(W, b?.overrides ?? null, b?.version) : splitScenarios(W, b?.scenarios ?? null, b?.version, teamOfFor(at.slate)));
  } catch (e) {
    console.warn("A change could not be layered on the published baseline and is kept whole:", e.message);
    return text;
  }
}

/** The full file the app's code reads for what the browser stored at p: the newest baseline with the stored differences on top. A whole file stored by an earlier version stands as it was (migrate converts it once a baseline is loaded). */
export function decode(stored, p) {
  const at = layeredPath(p);
  let layer;
  try { layer = JSON.parse(stored); } catch { return stored; }
  if (!at || layer?.site_layer !== MARK || layer.kind !== at.kind) return stored;
  const b = baselines.get(at.slate);
  return JSON.stringify(at.kind === "overrides" ? mergeOverrides(b?.overrides ?? null, layer) : mergeScenarios(b?.scenarios ?? null, layer, teamOfFor(at.slate)));
}

/**
 * An earlier version's whole-file copy at p, converted once into layer form against the baseline now loaded: the new stored text (marked converted, for the foot), or null when p holds a layer already,
 * is not a layered file, is not a readable whole file, or no baseline is loaded yet (the whole file then stands as his until one is). Pure but for `baselines`.
 */
export function migrate(stored, p) {
  const at = layeredPath(p);
  const b = at ? baselines.get(at.slate) : null;
  if (!at || !b) return null;
  let W;
  try { W = JSON.parse(stored); } catch { return null; }
  if (!W || typeof W !== "object" || W.site_layer === MARK) return null;
  const layer = at.kind === "overrides" ? splitOverrides(W, b.overrides, b.version) : splitScenarios(W, b.scenarios, b.version, teamOfFor(at.slate));
  return JSON.stringify({ ...layer, converted: true });
}

const part = (v, kind) => String(v ?? "|").split("|")[kind === "overrides" ? 0 : 1]; // the version is "<overrides updated_at>|<scenarios updated_at>"
/** The foot lines about a visitor's stored file: Adam's file moved after his last save; his earlier whole copy was converted. `rawStored`: the stored text at the path or null. */
export function layerLines(slate, kind, rawStored) {
  let layer;
  try { layer = rawStored ? JSON.parse(rawStored) : null; } catch { return []; }
  if (!layer || layer.site_layer !== MARK) return [];
  const out = [];
  if (layer.converted) out.push(`Public site: your earlier changes to the ${kind} in this browser were kept as your own on top of Adam's published ones (converted once); a man or team you changed keeps your numbers, every other follows his.`);
  const b = baselines.get(slate);
  if (b && part(layer.base_version, kind) !== part(b.version, kind)) out.push(`Public site: Adam's ${kind} changed after your last change in this browser; the ${kind === "overrides" ? "men" : "teams"} you changed keep your numbers and every other follows his newer ones.`);
  return out;
}
