// The public site's per-slate data file (slates/<slate>/site.json), shared by the publish-time bake (Node) and the browser (the stand-in and the shims). No imports, so both load it.
//   ours      our minutes engine's figures for every man, as the app's withOurProjection (server/minutes/board.js) gives them, baked from the desktop's live engine read
//             { as_of, pull (the board's pull the read was made on), base: { dk_id: [status, TwoGun minutes] } at that pull, proj_source, proj_problem?, men: { dk_id: fields }, carried: null | { reason, from } }
//             or null with `ours_gap` saying why
//   baseline  Adam's overrides, scenarios and saved work, a read-only starting point under a visitor's own browser edits
//             { as_of, version, overrides, scenarios, saved: { picks, working, lineups, builds, spots } (parsed files or null), saved_meta: { kind: { as_of, carried: null | { reason, from } } } }
//   box_freshness  the app's box score freshness answer as of the publish
//   notes     the lines the board's foot shows (G62, G64): what was carried, what could not be baked, and why
// Pure.

export const SITE_FORMAT = "nba-site-bake/2";
/** The fields our engine puts on a man (server/minutes/board.js applyOurs): what is baked, and what the browser lays back on the slate's own row. */
export const OURS_KEYS = Object.freeze(["ours", "role_tonight", "role_usual", "role_change", "role_reason", "proj_source", "projection", "minutes", "value", "tg_projection", "tg_minutes", "tg_value", "proj_note"]);
/** The saved-work files the site starts from, by kind (the app keeps them at data/cache/<kind>/<slate>.json). */
export const SAVED_KINDS = Object.freeze(["picks", "working", "lineups", "builds", "spots"]);

/** One man's baked fields from the engine's answer for him. */
export const pickOurs = (p) => Object.fromEntries(OURS_KEYS.filter((k) => k in p).map((k) => [k, p[k]]));

/** The pull a slate row was built from (the last part of its built_from), or null. */
export const pullOf = (data) => String(data?.built_from ?? "").split(/[\\/]/).at(-1) || null;
/** What decides whether a carried figure still stands for a man: his status and TwoGun's minutes on the board row. */
export const baseOf = (players) => Object.fromEntries((players ?? []).map((p) => [String(p.dk_id), [p.injury_status ?? null, p.minutes ?? null]]));

const ROLE_BLANK = { role_tonight: null, role_usual: null, role_change: null, role_reason: null };

/** A man the baked read has no row for: applyOurs's own answer for a man with no row, with `why` as the reason. */
export function missingMan(p, source, why) {
  const out = { ...p, ours: { minutes: null, rate: null, projection: null, value: null, missing: why }, ...ROLE_BLANK };
  if (source !== "ours") return { ...out, proj_source: "twogun" };
  return { ...out, proj_source: "ours", projection: null, minutes: null, value: null, tg_projection: p.projection ?? null, tg_minutes: p.minutes ?? null, tg_value: p.value ?? null, proj_note: `Our projection is missing: ${why}` };
}

/** A man shown with TwoGun's current numbers, said on his row (his `ours` block carries the reason, his source is TwoGun). */
export const twogunMan = (p, why) => ({ ...p, ours: { minutes: null, rate: null, projection: null, value: null, missing: why }, ...ROLE_BLANK, proj_source: "twogun", ours_changed: true }); // ours_changed: overrides.js staleSendOf sets a send's numbers for him aside

/**
 * The slate's players with our figures laid on, and the men shown with TwoGun's numbers instead. Every TwoGun field comes from the slate row in hand. When the slate is not the pull the read
 * was made on, a man's figures stand only if his status and TwoGun minutes are unchanged since that pull; a man who changed, or who was not on that board, shows TwoGun's current numbers, marked.
 * The pull counts as the same only when both sides name one. Returns { players, twogun: [{ id, why, kind: "changed" | "new" }] }. Pure.
 */
export function layOurs(slateData, ours) {
  const pull = pullOf(slateData), samePull = pull !== null && (ours.pull ?? null) === pull, twogun = [];
  const gone = `he is not in the desktop read of our figures${ours.as_of ? ` made ${ours.as_of}` : ""}`;
  const players = (slateData.players ?? []).map((p) => {
    const id = String(p.dk_id), m = ours.men?.[id];
    if (!m) {
      if (samePull) return missingMan(p, ours.proj_source, gone);
      const why = `he was not on the board at the ${ours.pull ?? "unnamed"} pull our figures were made on, so TwoGun's current numbers are shown`;
      twogun.push({ id, why, kind: "new" });
      return twogunMan(p, why);
    }
    if (!samePull) {
      const b = ours.base?.[id];
      if (!b || b[0] !== (p.injury_status ?? null) || b[1] !== (p.minutes ?? null)) {
        const why = `his status or TwoGun's minutes changed since the ${ours.pull ?? "unnamed"} pull our figures were made on, so TwoGun's current numbers are shown`;
        twogun.push({ id, why, kind: "changed" });
        return twogunMan(p, why);
      }
    }
    if (m.proj_source !== "ours") return { ...p, ours: m.ours, role_tonight: m.role_tonight ?? null, role_usual: m.role_usual ?? null, role_change: m.role_change ?? null, role_reason: m.role_reason ?? null, proj_source: m.proj_source ?? "twogun" };
    return { ...p, ...m, tg_projection: p.projection ?? null, tg_minutes: p.minutes ?? null, tg_value: p.value ?? null };
  });
  return { players, twogun };
}

/**
 * The slate with our figures on every man, as the app's withOurs does (server/server.js). `site` is the parsed site.json or null. With no baked figures the
 * board shows TwoGun's numbers, said on every man and in the slate's proj_problem (never silently). Pure.
 */
export function applyOursDoc(slateData, site) {
  const ours = site?.ours ?? null;
  if (!ours) {
    const why = site ? (site.ours_gap ?? "our figures were not published with this slate") : "this slate was published without the site's data file";
    const problem = `Our projections are not on the public site for this slate (${why}); TwoGun's numbers are shown.`;
    return { ...slateData, proj_source: "twogun", proj_problem: problem, players: (slateData.players ?? []).map((p) => missingMan(p, "twogun", why)) };
  }
  return { ...slateData, proj_source: ours.proj_source, ...(ours.proj_problem ? { proj_problem: ours.proj_problem } : {}), players: layOurs(slateData, ours).players };
}

/** The files a visitor's browser starts from, as [{ file, text }] under the app's data folder (dataDir "/data"): Adam's overrides and scenarios, then his saved work. */
export function baselineFiles(site, slate) {
  const b = site?.baseline;
  if (!b) return [];
  const out = [];
  if (b.overrides) out.push({ file: `/data/slates/${slate}/overrides.json`, text: JSON.stringify(b.overrides) });
  if (b.scenarios) out.push({ file: `/data/slates/${slate}/scenarios.json`, text: JSON.stringify(b.scenarios) });
  for (const kind of SAVED_KINDS) if (b.saved?.[kind]) out.push({ file: `/data/cache/${kind}/${slate}.json`, text: JSON.stringify(b.saved[kind]) });
  return out;
}

/** The board foot lines for a slate: the baked notes, or the one line saying there is no data file. */
export const footLines = (site) => (site ? (site.notes ?? []) : ["Public site: this slate was published without its data file, so our figures, Adam's overrides and the box score line are not shown."]);
