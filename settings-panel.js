// The optimizer panel's settings (panel.js draws them in its settings block): reading the typed settings into the
// optimizer's settings, the per-viewer storage of what was typed, the team overrides read from storage, and the
// ownership rules (GPP only; own-rules.js). Everything here is pure or touches browser storage only; the clicks live in panel.js.
import { esc } from "./board-util.js";
import { SLOTS, DEFAULT_COUNT, MAX_COUNT } from "./slots.js";
import { readLimits, sentLimits, probeJson, ABSENT } from "./row-limits.js";
import { toRule, ruleWords, ruleChip, ownConflict, sameRule } from "./own-rules.js";

const N = SLOTS.length;
// No min salary setting (Adam's ruling, 2026-10-29): an older stored minSalary is ignored because FIELDS leaves it out.
// Standard D9: 5 lineups, min unique 1, the per-team cap DraftKings' own rule (none short of the whole lineup), nothing on that blocks a build.
const DEFAULTS = { count: String(DEFAULT_COUNT), minUnique: "1", maxTotalOwn: "", teamMin: "0", teamMax: String(N), varOn: "", varPct: "10" };
const FIELDS = Object.keys(DEFAULTS);
// Ownership rules (Adam, 2026-10-29: several rules working together, on one line of chips; 11-16: at least or at most, under or over).
// Four chips plus "+ rule" fit the 640px panel on one line; a fifth would wrap, so the panel stops at four (the optimizer takes eight).
export const MAX_LOW_RULES = 4;
/** The team overrides' stored map also holds the game limits, keyed by game ("ATL@WAS"); a team code has no @. */
const isGameKey = (k) => k.includes("@");
const warnedGames = new Set(); // the panel redraws often: a stale stored game is warned about once

/** The slate's games, sorted, from its players. */
export function slateGames(players) {
  return [...new Set((players ?? []).map((p) => p.game).filter(Boolean))].sort();
}

/** The stored games not on this slate; with no games known yet, none. */
const staleGames = (overrides, games) => (games?.length ? Object.keys(overrides).filter((k) => isGameKey(k) && !games.includes(k)) : []);

/** The stored overrides without a game that is not on this slate, with a console warning; settingsHtml shows each one dropped. */
export function liveOverrides(overrides, games) {
  const stale = staleGames(overrides, games);
  if (!stale.length) return overrides;
  for (const g of stale) {
    if (!warnedGames.has(g)) console.warn(`Stored game limit ${g} is not on this slate; ignored`);
    warnedGames.add(g);
  }
  return Object.fromEntries(Object.entries(overrides).filter(([k]) => !stale.includes(k)));
}

/**
 * Reads the settings as typed (strings) into the optimizer's settings. Returns { settings, bad } where bad maps a field to
 * its message; a bad field is never sent. Commas are allowed in numbers ("48,000"). Max total own and Ownership are GPP only;
 * the ownership rules come as raw.lowRules, a list of own-rules.js rules already checked when added or loaded, sent as lowOwned.
 */
export function readSettings(raw, mode, overrides = {}) {
  const bad = {};
  const take = (f, label, lo, hi, { optional = false, decimal = false } = {}) => {
    const t = String(raw?.[f] ?? "").replace(/,/g, "").trim();
    if (t === "") {
      if (!optional) bad[f] = `${label} is needed.`;
      return null;
    }
    const v = (decimal ? /^\d+(\.\d+)?$/ : /^\d+$/).test(t) ? Number(t) : NaN;
    if (Number.isNaN(v) || v < lo || v > hi) {
      bad[f] = `${label} must be ${decimal ? "a number" : "a whole number"} from ${lo} to ${hi.toLocaleString("en-US")}.`;
      return null;
    }
    return v;
  };
  const settings = {
    count: take("count", "Lineups", 1, MAX_COUNT),
    minUnique: take("minUnique", "Min unique", 1, N),
    teamMin: take("teamMin", "Min per team", 0, N),
    teamMax: take("teamMax", "Max per team", 0, N),
  };
  if (settings.teamMin != null && settings.teamMax != null && settings.teamMin > settings.teamMax) bad.teamMin = "Min per team is more than max per team.";
  const ov = {}, gameOv = {};
  for (const [t, o] of Object.entries(overrides ?? {})) {
    const e = {};
    if (o?.min != null) e.min = o.min;
    if (o?.max != null) e.max = o.max;
    if (e.min == null && e.max == null) continue;
    const game = isGameKey(t); // the per-team fields bind a team, not a game
    if (e.min != null && e.min > (e.max ?? (game ? N : settings.teamMax ?? N))) bad.teams = `The ${t} minimum is more than its maximum.`;
    (game ? gameOv : ov)[t] = e;
  }
  if (Object.keys(ov).length) settings.teamOverrides = ov;
  if (Object.keys(gameOv).length) settings.gameOverrides = gameOv;
  if (mode === "GPP") {
    const own = take("maxTotalOwn", "Max total own", 0, N * 100, { optional: true, decimal: true });
    if (own != null) settings.maxTotalOwn = own;
    // The rules were checked when added or loaded (panelRule); every one binds at once.
    const rules = Array.isArray(raw?.lowRules) ? raw.lowRules.map(panelRule).filter(Boolean) : [];
    if (rules.length) settings.lowOwned = rules;
    // The variance switch (GPP only): on with 0 is the same as off, so nothing is sent.
    if (raw?.varOn === "1") {
      const pct = take("varPct", "Variance", 0, 100, { decimal: true });
      if (pct) settings.variancePct = pct;
    }
  }
  for (const k of Object.keys(settings)) if (settings[k] == null) delete settings[k];
  return { settings, bad };
}

/** Storage: settings per mode and slate (nbaboard.opt.<mode>.<slate>, standard A9); a slate with none of its own starts from the
 *  defaults, never another slate's (Adam, 11-13); team overrides per mode and slate (nbaboard.opt.teams.<mode>.<slate>). These are per-viewer
 *  conveniences, the one thing browser storage may hold here: the viewer's own inputs, never a figure. A missing or unreadable
 *  entry falls back to the defaults (tryStore warns in the console when storage throws). */
export const loadRaw = (tryStore, mode, slate = null) => readRaw(tryStore, mode, slate).raw;

/**
 * { raw, unreadable, rulesDropped }. Absent (getItem null) gives the defaults. An entry that cannot
 * be read gives the defaults and unreadable true, never another slate's settings in its place; the panel says so.
 * rulesDropped: how many stored ownership rules (GPP) could not be used and are not applied.
 */
export function readRaw(tryStore, mode, slate = null) {
  let unreadable = false, saved = null;
  const got = slate ? probeJson(tryStore, `nbaboard.opt.${mode}.${slate}`) : ABSENT;
  if (got === null) unreadable = true;
  else if (got !== ABSENT && got.value != null) {
    if (typeof got.value !== "object" || Array.isArray(got.value)) unreadable = true;
    else saved = got.value;
  }
  if (unreadable) console.warn(`nbaboard.opt.${mode}${slate ? `.${slate}` : ""} cannot be read; the defaults are used`);
  saved ??= {};
  const raw =Object.fromEntries(FIELDS.map((f) => [f, typeof saved[f] === "string" ? saved[f] : DEFAULTS[f]]));
  // Every save wrote every field, so an older stored 1 is the old default, not a choice: it takes D9's once (d9 marks a save
  // from here on, where a 1 was typed).
  if (saved.count === "1" && !saved.d9) raw.count = DEFAULTS.count;
  raw.d9 = true;
  let rulesDropped = 0;
  if (mode === "GPP") ({ rules: raw.lowRules, dropped: rulesDropped } = readLowRules(saved));
  return { raw, unreadable, rulesDropped };
}

/** Writes a mode's typed settings (and, in GPP, its ownership rules) back to storage: a per-viewer convenience. */
export function saveRaw(tryStore, mode, raw, slate = null) {
  if (!slate) { console.warn(`${mode} settings not saved: no slate given`); return; }
  tryStore(() => localStorage.setItem(`nbaboard.opt.${mode}.${slate}`, JSON.stringify(raw)));
}

/** A slate's settings as it opens. A slate with none of its own opens at the defaults and keeps them from now on. */
export function pinRaw(tryStore, mode, slate) {
  const { raw, unreadable } = readRaw(tryStore, mode, slate);
  const key = `nbaboard.opt.${mode}.${slate}`;
  if (!unreadable) tryStore(() => { if (localStorage.getItem(key) == null) localStorage.setItem(key, JSON.stringify(raw)); }); // defaults stood in for an unreadable entry are not kept as if they were Adam's
  return raw;
}

/** A rule the panel can hold, in its one shape (own-rules.js; the older { count, underPct } reads as at least, under), or null:
 *  an at least of 1 to 8 men or an at most of 0 to 8, on a line from 0 to 100 percent. */
function panelRule(r) {
  const rule = toRule(r);
  if (!rule || rule.count > N || (rule.dir === "min" && rule.count < 1) || rule.pct > 100) return null;
  return rule;
}

/** The stored ownership rules: { rules, dropped }. The list, or an older single rule (lowCount and lowPct as typed) moved into one. A
 *  malformed rule, or one past the panel's four, is left out and counted in dropped (global G62: settingsHtml and refillState say so),
 *  with a console warning; a stored value that is not a list counts as one. An older empty count or count of 0 meant no rule. */
function readLowRules(saved) {
  const warn = (what) => console.warn(`nbaboard.opt.GPP: ${what}; ignored`);
  if (saved.lowRules != null) {
    if (!Array.isArray(saved.lowRules)) { warn("lowRules is not a list"); return { rules: [], dropped: 1 }; }
    const good = saved.lowRules.map(panelRule).filter(Boolean);
    if (good.length < saved.lowRules.length) warn(`${saved.lowRules.length - good.length} malformed ownership rule(s)`);
    if (good.length > MAX_LOW_RULES) warn(`ownership rules past the first ${MAX_LOW_RULES}`);
    const rules = good.slice(0, MAX_LOW_RULES);
    return { rules, dropped: saved.lowRules.length - rules.length };
  }
  const text = (v) => (typeof v === "string" ? v.replace(/,/g, "").trim() : "");
  const c = text(saved.lowCount), u = text(saved.lowPct);
  if (c === "" || c === "0") return { rules: [], dropped: 0 }; // no count (empty or 0) was no rule before, whatever the % field held
  const rule = panelRule({ count: /^\d+$/.test(c) ? +c : NaN, underPct: /^\d+(\.\d+)?$/.test(u) ? +u : NaN });
  if (rule) return { rules: [rule], dropped: 0 };
  warn(`the older low-owned rule (${c || "no count"} under ${u || "no %"}) is malformed`);
  return { rules: [], dropped: 1 };
}

/**
 * Adds a rule typed in the form: dir "min" (at least) or "max" (at most), side "under" or "over", count and % as text. { rules } with
 * the rule added, or { msg } saying why not; a rule that plainly contradicts one already on is refused naming both (own-rules.js).
 */
export function addLowRule(rules, countText, pctText, dir = "min", side = "under") {
  const c = String(countText ?? "").replace(/,/g, "").trim(), u = String(pctText ?? "").replace(/,/g, "").trim();
  const count = /^\d+$/.test(c) ? +c : NaN, pct = /^\d+(\.\d+)?$/.test(u) ? +u : NaN;
  if (dir === "min" && !(count >= 1)) return { msg: `The count is a whole number from 1 to ${N}.` };
  if (dir === "max" && !(count >= 0 && count <= N)) return { msg: `The count is a whole number from 0 to ${N}.` };
  if (!(pct >= 0 && pct <= 100)) return { msg: "The ownership line is a percentage from 0 to 100." };
  const rule = toRule({ dir, side, count, pct });
  if (!rule) return { msg: "Choose at least or at most, and under or over." };
  if (rules.some((r) => sameRule(r, rule))) return { msg: "That rule is already on." };
  if (rules.length >= MAX_LOW_RULES) return { msg: `At most ${MAX_LOW_RULES} ownership rules.` };
  const clash = ownConflict([...rules, rule]);
  return clash ? { msg: clash } : { rules: [...rules, rule] };
}

/** The Ownership line (GPP only): a chip per rule with × to remove, "+ rule", and the add form when open, with its two toggles. */
export function lowOwnedHtml(rules, { open = false, msg = null, typed = {} } = {}) {
  const box = (k) => (typed[k] ? ` value="${esc(typed[k])}"` : ""); // what he has typed in the open form survives a redraw
  const words = (r) => ruleWords(r).replace(/^./, (ch) => ch.toUpperCase());
  const chips = rules.map((r, i) => `<span class="ovc" title="${esc(words(r))}">${esc(ruleChip(r))}<button data-op="lrdel" data-i="${i}" title="Remove ${esc(ruleWords(r))}">×</button></span>`).join("");
  const dir = typed.dir === "max" ? "max" : "min", side = typed.side === "over" ? "over" : "under";
  const seg = (op, now, pairs) => `<div class="seg">${pairs.map(([v, w]) => `<button data-op="${op}" data-v="${v}"${v === now ? ' class="on"' : ""}>${w}</button>`).join("")}</div>`;
  const form = open ? `<div class="ovf">${seg("lrdir", dir, [["min", "at least"], ["max", "at most"]])}<input data-lr="count" inputmode="numeric" placeholder="—"${box("count")}><span>men</span>${seg("lrside", side, [["under", "under"], ["over", "over"]])}<input data-lr="pct" inputmode="decimal" placeholder="—"${box("pct")}><span>% owned</span><button class="ol sm" data-op="lradd">Add</button><button class="ol sm" data-op="ovcancel">Cancel</button><span class="ovmsg">${esc(msg ?? "")}</span></div>` : "";
  // At the limit "+ rule" is shown but disabled, with the limit as its title, rather than opening a form that cannot add.
  const full = rules.length >= MAX_LOW_RULES;
  const addBtn = `<button class="ov" data-op="lropen"${full ? ` disabled title="At most ${MAX_LOW_RULES} ownership rules"` : ""}>+ rule</button>`;
  return `<div class="teams"><span class="tl">Ownership:</span><span class="ovs">${chips || `<span>none</span>`}</span>${addBtn}</div>${form}`;
}
/** Storage key of a mode's team and game limits for a slate (Adam, 11-13: Cash and GPP each keep their own). */
export const overridesKey = (slate, mode) => `nbaboard.opt.teams.${mode}.${slate}`;
const LEGACY_OV_MODES = ["Cash", "GPP"];

/** A mode's stored limits; a mode with none of its own takes the one set older versions saved for both (nbaboard.opt.teams.<slate>). */
export const loadOverrides = (tryStore, slate, mode = null) => readOverrides(tryStore, slate, mode).overrides;

/**
 * { overrides, unreadable }. A key that is absent (getItem null) differs from one that cannot be read (storage throws, bad JSON, not a team map):
 * absent falls back to the old shared set; unreadable applies none ({}) and says so (unreadable true), never a stale set in its place.
 */
export function readOverrides(tryStore, slate, mode = null) {
  const ABSENT = { absent: true };
  const read = (key) => tryStore(() => { const t = localStorage.getItem(key); return t == null ? ABSENT : { value: JSON.parse(t) }; }); // tryStore gives null when this throws
  const bad = (key, why) => { console.warn(`${key} ${why}; none of its limits are applied`); return { overrides: {}, unreadable: true }; };
  let key = mode ? overridesKey(slate, mode) : `nbaboard.opt.teams.${slate}`;
  let got = read(key);
  if (got === ABSENT && mode) { key = `nbaboard.opt.teams.${slate}`; got = read(key); }
  if (got === null) return bad(key, "cannot be read");
  if (got === ABSENT) return { overrides: {}, unreadable: false };
  const saved = got.value;
  if (saved == null) return { overrides: {}, unreadable: false };
  if (typeof saved !== "object" || Array.isArray(saved)) return bad(key, "is not a team map");
  const ok = (v) => v == null || (Number.isInteger(v) && v >= 0 && v <= N);
  return { overrides: Object.fromEntries(Object.entries(saved).filter(([, o]) => o && typeof o === "object" && ok(o.min) && ok(o.max))), unreadable: false };
}

/** Both modes' limits for a slate: { byMode: { Cash, GPP }, bad: [modes whose stored limits could not be read] }. */
export function readOverridesByMode(tryStore, slate) {
  const byMode = {}, bad = [];
  for (const m of LEGACY_OV_MODES) { const r = readOverrides(tryStore, slate, m); byMode[m] = r.overrides; if (r.unreadable) bad.push(m); }
  return { byMode, bad };
}

/** Both modes' limits for a slate: { Cash, GPP }. */
export const loadOverridesByMode = (tryStore, slate) => readOverridesByMode(tryStore, slate).byMode;

/** Gives the panel state P its limits per mode: P.ovByMode holds both sets, and P.overrides reads and writes the set of the mode in force (P.mode). */
export function perModeOverrides(P, byMode = { Cash: {}, GPP: {} }, bad = []) {
  P.ovBad = [...bad]; // the modes whose stored limits could not be read (settingsHtml says so)
  Object.defineProperty(P, "ovByMode", { value: { ...byMode }, writable: true, enumerable: false, configurable: true });
  Object.defineProperty(P, "overrides", { get() { return this.ovByMode[this.mode] ?? {}; }, set(v) { this.ovByMode[this.mode] = v; }, enumerable: true, configurable: true });
  return P;
}

/** The Lineups count box on its own (it sits beside Build on the player list; settingsHtml leaves it out there). */
export function countHtml(P, games = []) {
  const raw = P.raw[P.mode], { bad } = readSettings(raw, P.mode, liveOverrides(P.overrides, games));
  const msg = Object.values(bad)[0] ?? "";
  return `<div class="cntrow"><label>Lineups<input data-f="count" value="${esc(raw.count)}" inputmode="decimal" autocomplete="off"${bad.count ? ` class="bad" title="${esc(bad.count)}"` : ""}></label>`
    + `<div class="cntmsg"${msg && !P.setOpen ? "" : " hidden"} title="${esc(msg)}">${esc(msg)}</div></div>`;
}

/** Under the Ownership line: how many saved rules could not be read (readRaw's rulesDropped), in the unreadable-settings style; "" with none. */
const droppedRulesHtml = (n, line) => (n > 0 ? line(`${n} saved ownership rule${n === 1 ? " could not be read and is" : "s could not be read and are"} not applied.`) : "");

/** The settings block: the typed fields, the Ownership line in GPP, the team limits with their override chips and form (each game an option beside the teams).
 *  `count: false` leaves the Lineups box out (countHtml draws it elsewhere). */
export function settingsHtml(P, teams, games = [], { count = true } = {}) {
  const raw = P.raw[P.mode], overrides = liveOverrides(P.overrides, games);
  const { bad } = readSettings(raw, P.mode, overrides);
  const input = (f, ph = "") => `<input data-f="${f}" value="${esc(raw[f])}" inputmode="decimal" autocomplete="off"${ph ? ` placeholder="${ph}"` : ""}${bad[f] ? ` class="bad" title="${esc(bad[f])}"` : ""}>`;
  const gpp = P.mode === "GPP";
  const chips = Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b)).flatMap(([t, o]) => [
    o.max != null ? `<span class="ovc">${esc(t)} ≤ ${o.max}<button data-op="ovdel" data-team="${esc(t)}" data-b="max" title="Remove ${esc(t)} at most ${o.max}">×</button></span>` : "",
    o.min != null ? `<span class="ovc">${esc(t)} ≥ ${o.min}<button data-op="ovdel" data-team="${esc(t)}" data-b="min" title="Remove ${esc(t)} at least ${o.min}">×</button></span>` : "",
  ]).join("");
  const ov = P.ovForm ?? {}, ovBox = (k) => (ov[k] ? ` value="${esc(ov[k])}"` : ""); // the open form's choices survive a redraw, so Add never lands on another team
  const form = P.ovOpen ? `<div class="ovf"><select data-ov="team">${teams.map((t) => `<option${t === ov.team ? " selected" : ""}>${esc(t)}</option>`).join("")}${games.map((g) => `<option value="${esc(g)}"${g === ov.team ? " selected" : ""}>${esc(g)} (either team)</option>`).join("")}</select><span>min</span><input data-ov="min" inputmode="numeric" placeholder="—"${ovBox("min")}><span>max</span><input data-ov="max" inputmode="numeric" placeholder="—"${ovBox("max")}><button class="ol sm" data-op="ovadd">Add</button><button class="ol sm" data-op="ovcancel">Cancel</button><span class="ovmsg">${esc(P.ovMsg ?? "")}</span></div>` : "";
  const msg = Object.values(bad)[0] ?? "";
  // A stored game limit the slate has lost: said in the block, one line per bound, each with × to remove it.
  const gone = staleGames(P.overrides, games).sort().flatMap((g) => ["min", "max"].filter((b) => P.overrides[g][b] != null).map((b) => `<div class="teams"><span class="ovs"><span class="ovc">${esc(g)} ${b} ${P.overrides[g][b]} ignored: that game is no longer on this slate<button data-op="ovdel" data-team="${esc(g)}" data-b="${b}" title="Remove ${esc(g)} ${b} ${P.overrides[g][b]}">×</button></span></span></div>`)).join("");
  const unreadable = (P.ovBad ?? []).includes(P.mode) ? `<div class="teams"><span class="ovc" title="The saved limits could not be read from this browser, so none are applied">Your saved ${esc(P.mode)} team and game limits could not be read; none are applied.</span></div>` : "";
  const line = (text) => `<div class="teams"><span class="ovc" title="The saved entry could not be read from this browser">${esc(text)}</span></div>`;
  const unreadableAll = unreadable + ((P.rawBad ?? []).includes(P.mode) ? line(`Your typed ${P.mode} settings could not be read; the defaults are shown.`) : "") + (P.limBad && gpp ? line("Your saved Min % and Max % could not be read; none are applied.") : "");
  const varOn = raw.varOn === "1";
  const variance = `<div class="teams"><span class="tl" title="Each lineup is searched on every player's projection varied at random; the numbers shown stay the real ones">Variance:</span><div class="seg">${[["", "Off"], ["1", "On"]].map(([v, w]) => `<button data-op="varsw" data-v="${v}" class="${(raw.varOn ?? "") === v ? "on" : ""}">${w}</button>`).join("")}</div><span class="tl">± <input data-f="varPct" value="${esc(raw.varPct ?? "")}" inputmode="decimal" autocomplete="off"${varOn ? "" : " disabled"}${varOn && bad.varPct ? ` class="bad" title="${esc(bad.varPct)}"` : ""}> % on all players</span></div>`;
  return `<div class="sec sethd">Settings</div><div class="set${count ? "" : " two"}">${count ? `<label>Lineups${input("count")}</label>` : ""}<label>Min unique${input("minUnique")}</label>`
    + (gpp ? `<label>Max total own${input("maxTotalOwn", "none")}</label>` : `<label title="Ownership limits are GPP settings">Max total own<input disabled placeholder="GPP only"></label>`) + `</div>`
    + (gpp ? lowOwnedHtml(raw.lowRules ?? [], { open: P.lrOpen, msg: P.lrMsg, typed: P.lrForm ?? {} }) + droppedRulesHtml(P.rulesDropped, line) + variance : "")
    + `<div class="teams"><span class="tl">Teams: min ${input("teamMin")} · max ${input("teamMax")} per team</span><span class="ovs">${chips}</span><button class="ov" data-op="ovopen">+ override</button></div>${unreadableAll}${gone}${form}`
    + `<div class="setmsg"${msg ? "" : " hidden"} title="${esc(msg)}">${esc(msg)}</div>`;
}

/**
 * What a Late swap screen re-optimize sends of the board's own state, read from the same browser storage the optimizer panel uses: each mode's
 * typed settings with its own team and game limits ({ Cash, GPP }), and the men's Min % and Max % (applied server-side to GPP spots only).
 * A field that cannot be read is left out and named in settingsBad ({ Cash: [names], GPP: [names] }) so the server can say so. { settings, settingsBad, exposure } (exposure null with none).
 */
export function refillState(tryStore, slate) {
  const settings = {}, settingsBad = {};
  for (const mode of LEGACY_OV_MODES) {
    const ov = readOverrides(tryStore, slate, mode), typed = readRaw(tryStore, mode, slate);
    const { settings: s, bad } = readSettings(typed.raw, mode, ov.overrides);
    settingsBad[mode] = [...Object.keys(bad).filter((f) => !["count", "minUnique", "varPct"].includes(f)), // a re-fill builds one lineup, so these three are never used
      ...(typed.unreadable ? ["typed settings"] : []), ...(ov.unreadable ? ["team and game limits"] : []), ...(typed.rulesDropped > 0 ? ["ownership rules"] : [])];
    settings[mode] = s;
  }
  const lim = readLimits(tryStore, slate);
  if (lim.unreadable) settingsBad.GPP.push("Max %"); // a Max % binds GPP spots only
  return { settings, settingsBad, exposure: sentLimits(lim.limits, { has: () => true }) };
}
