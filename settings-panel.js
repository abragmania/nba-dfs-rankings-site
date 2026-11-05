// The optimizer panel's settings (panel.js draws them in its settings block): reading the typed settings into the
// optimizer's settings, the per-viewer storage of what was typed, the team overrides read from storage, and the
// low-owned rules (GPP only). Everything here is pure or touches browser storage only; the clicks live in panel.js.
import { esc } from "./board-util.js";
import { SLOTS, DEFAULT_COUNT } from "./slots.js";

const N = SLOTS.length;
const MAX_COUNT = 20; // the optimizer's own limit on lineups per build
// No min salary setting (Adam's ruling, 2026-10-29): an older stored minSalary is ignored because FIELDS leaves it out.
// Standard D9: 5 lineups, min unique 1, the per-team cap DraftKings' own rule (none short of the whole lineup), nothing on that blocks a build.
const DEFAULTS = { count: String(DEFAULT_COUNT), minUnique: "1", maxTotalOwn: "", teamMin: "0", teamMax: String(N), varOn: "", varPct: "10" };
const FIELDS = Object.keys(DEFAULTS);
// Low-owned rules (Adam, 2026-10-29: several rules working together, on one line of chips). Four chips plus "+ rule" fit
// the 640px panel on one line; a fifth would wrap, so the panel stops at four (the optimizer itself takes up to eight).
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
 * its message; a bad field is never sent. Commas are allowed in numbers ("48,000"). Max total own and Low-owned are GPP only;
 * the low-owned rules come as raw.lowRules, a list of {count, underPct} already checked when added or loaded.
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
    // The rules were checked when added or loaded (lowRuleOk); every one binds at once.
    const rules = Array.isArray(raw?.lowRules) ? raw.lowRules.filter(lowRuleOk) : [];
    if (rules.length) settings.lowOwned = rules.map((r) => ({ count: r.count, underPct: r.underPct }));
    // The variance switch (GPP only): on with 0 is the same as off, so nothing is sent.
    if (raw?.varOn === "1") {
      const pct = take("varPct", "Variance", 0, 100, { decimal: true });
      if (pct) settings.variancePct = pct;
    }
  }
  for (const k of Object.keys(settings)) if (settings[k] == null) delete settings[k];
  return { settings, bad };
}

/** Storage: settings per mode and slate (nbaboard.opt.<mode>.<slate>, standard A9), with the last ones used under
 *  nbaboard.opt.<mode> for a slate not yet touched; team overrides per slate (nbaboard.opt.teams.<slate>). These are per-viewer
 *  conveniences, the one thing browser storage may hold here: the viewer's own inputs, never a figure. A missing or unreadable
 *  entry falls back to the defaults (tryStore warns in the console when storage throws). */
export function loadRaw(tryStore, mode, slate = null) {
  const own = slate ? tryStore(() => JSON.parse(localStorage.getItem(`nbaboard.opt.${mode}.${slate}`) ?? "null")) : null;
  const saved = own ?? tryStore(() => JSON.parse(localStorage.getItem(`nbaboard.opt.${mode}`) ?? "null")) ?? {};
  const raw = Object.fromEntries(FIELDS.map((f) => [f, typeof saved[f] === "string" ? saved[f] : DEFAULTS[f]]));
  // Every save wrote every field, so an older stored 1 is the old default, not a choice: it takes D9's once (d9 marks a save
  // from here on, where a 1 was typed).
  if (saved.count === "1" && !saved.d9) raw.count = DEFAULTS.count;
  raw.d9 = true;
  if (mode === "GPP") raw.lowRules = readLowRules(saved);
  return raw;
}

/** Writes a mode's typed settings (and, in GPP, its low-owned rules) back to storage: a per-viewer convenience. */
export function saveRaw(tryStore, mode, raw, slate = null) {
  tryStore(() => localStorage.setItem(`nbaboard.opt.${mode}`, JSON.stringify(raw)));
  if (slate) tryStore(() => localStorage.setItem(`nbaboard.opt.${mode}.${slate}`, JSON.stringify(raw)));
}

/** A slate's settings as it opens. A slate with none of its own takes the last used and keeps them from now on, so a later
 *  change on another slate leaves this one as it was. */
export function pinRaw(tryStore, mode, slate) {
  const raw = loadRaw(tryStore, mode, slate);
  const key = `nbaboard.opt.${mode}.${slate}`;
  tryStore(() => { if (localStorage.getItem(key) == null) localStorage.setItem(key, JSON.stringify(raw)); });
  return raw;
}

/** A usable low-owned rule: at least `count` (1 to 8) men strictly under `underPct` (0 to 100) percent owned. */
export function lowRuleOk(r) {
  return r != null && typeof r === "object" && Number.isInteger(r.count) && r.count >= 1 && r.count <= N
    && typeof r.underPct === "number" && Number.isFinite(r.underPct) && r.underPct >= 0 && r.underPct <= 100;
}

/** The stored low-owned rules: the list, or an older single rule (lowCount and lowPct as typed) moved into one. A malformed
 *  rule is left out with a console warning; an older empty count or count of 0 meant no rule (no warning). */
function readLowRules(saved) {
  const warn = (what) => console.warn(`nbaboard.opt.GPP: ${what}; ignored`);
  if (saved.lowRules != null) {
    if (!Array.isArray(saved.lowRules)) { warn("lowRules is not a list"); return []; }
    const good = saved.lowRules.filter(lowRuleOk);
    if (good.length < saved.lowRules.length) warn(`${saved.lowRules.length - good.length} malformed low-owned rule(s)`);
    if (good.length > MAX_LOW_RULES) warn(`low-owned rules past the first ${MAX_LOW_RULES}`);
    return good.slice(0, MAX_LOW_RULES);
  }
  const text = (v) => (typeof v === "string" ? v.replace(/,/g, "").trim() : "");
  const c = text(saved.lowCount), u = text(saved.lowPct);
  if (c === "" || c === "0") return []; // no count (empty or 0) was no rule before, whatever the % field held
  const rule = { count: /^\d+$/.test(c) ? +c : NaN, underPct: /^\d+(\.\d+)?$/.test(u) ? +u : NaN };
  if (lowRuleOk(rule)) return [rule];
  warn(`the older low-owned rule (${c || "no count"} under ${u || "no %"}) is malformed`);
  return [];
}

/** Adds a rule typed in the form (count and under-% as text). { rules } with the rule added, or { msg } saying why not. */
export function addLowRule(rules, countText, pctText) {
  const c = String(countText ?? "").replace(/,/g, "").trim(), u = String(pctText ?? "").replace(/,/g, "").trim();
  const rule = { count: /^\d+$/.test(c) ? +c : NaN, underPct: /^\d+(\.\d+)?$/.test(u) ? +u : NaN };
  if (!Number.isInteger(rule.count) || rule.count < 1 || rule.count > N) return { msg: `The count is a whole number from 1 to ${N}.` };
  if (!lowRuleOk(rule)) return { msg: "The ownership line is a percentage from 0 to 100." };
  if (rules.some((r) => r.count === rule.count && r.underPct === rule.underPct)) return { msg: "That rule is already on." };
  if (rules.length >= MAX_LOW_RULES) return { msg: `At most ${MAX_LOW_RULES} low-owned rules.` };
  return { rules: [...rules, rule] };
}

/** The Low-owned line (GPP only): a chip per rule with × to remove, "+ rule", and the add form when open. */
export function lowOwnedHtml(rules, { open = false, msg = null, typed = {} } = {}) {
  const box = (k) => (typed[k] ? ` value="${esc(typed[k])}"` : ""); // what he has typed in the open form survives a redraw
  const pct = (v) => `${v}%`;
  // The rule counts a man strictly under the line, so the chip, its titles and the form all say "under" (<).
  const chips = rules.map((r, i) => `<span class="ovc" title="At least ${r.count} men under ${pct(r.underPct)} owned">≥${r.count} &lt;${pct(r.underPct)}<button data-op="lrdel" data-i="${i}" title="Remove at least ${r.count} under ${pct(r.underPct)}">×</button></span>`).join("");
  const form = open ? `<div class="ovf"><span>at least</span><input data-lr="count" inputmode="numeric" placeholder="—"${box("count")}><span>men under</span><input data-lr="pct" inputmode="decimal" placeholder="—"${box("pct")}><span>% owned</span><button class="ol sm" data-op="lradd">Add</button><button class="ol sm" data-op="ovcancel">Cancel</button><span class="ovmsg">${esc(msg ?? "")}</span></div>` : "";
  // At the limit "+ rule" is shown but disabled, with the limit as its title, rather than opening a form that cannot add.
  const full = rules.length >= MAX_LOW_RULES;
  const addBtn = `<button class="ov" data-op="lropen"${full ? ` disabled title="At most ${MAX_LOW_RULES} low-owned rules"` : ""}>+ rule</button>`;
  return `<div class="teams"><span class="tl">Low-owned:</span><span class="ovs">${chips || `<span>none</span>`}</span>${addBtn}</div>${form}`;
}
export function loadOverrides(tryStore, slate) {
  const saved = tryStore(() => JSON.parse(localStorage.getItem(`nbaboard.opt.teams.${slate}`) ?? "null"));
  if (saved == null) return {};
  if (typeof saved !== "object" || Array.isArray(saved)) { console.warn(`nbaboard.opt.teams.${slate} is not a team map; ignored`); return {}; }
  const ok =(v) => v == null || (Number.isInteger(v) && v >= 0 && v <= N);
  return Object.fromEntries(Object.entries(saved).filter(([, o]) => o && typeof o === "object" && ok(o.min) && ok(o.max)));
}

/** A suggested GPP variance range (± %) for a slate of this many games, or null when the count is 0 or unknown.
 *  The lead's starting estimate: bigger slates take more variance. Meant to be tuned; not from data. */
export function varianceGuide(gameCount) {
  const n = Number(gameCount);
  if (!Number.isFinite(n) || n < 1) return null;
  if (n <= 3) return { lo: 3, hi: 6 };
  if (n <= 6) return { lo: 6, hi: 10 };
  if (n <= 9) return { lo: 10, hi: 15 };
  return { lo: 15, hi: 20 };
}

/** The Lineups count box on its own (it sits beside Build on the player list; settingsHtml leaves it out there). */
export function countHtml(P, games = []) {
  const raw = P.raw[P.mode], { bad } = readSettings(raw, P.mode, liveOverrides(P.overrides, games));
  const msg = Object.values(bad)[0] ?? "";
  return `<div class="cntrow"><label>Lineups<input data-f="count" value="${esc(raw.count)}" inputmode="decimal" autocomplete="off"${bad.count ? ` class="bad" title="${esc(bad.count)}"` : ""}></label>`
    + `<div class="cntmsg"${msg && !P.setOpen ? "" : " hidden"} title="${esc(msg)}">${esc(msg)}</div></div>`;
}

/** The settings block: the typed fields, the Low-owned line in GPP, the team limits with their override chips and form (each game an option beside the teams).
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
  const varOn = raw.varOn === "1";
  const vg = varianceGuide(games?.length ?? 0), guide = vg ? `<span class="vguide" title="Suggested range for this ${games.length}-game slate; type any value">Guide ±${vg.lo}–${vg.hi}%</span>` : "";
  const variance = `<div class="teams"><span class="tl" title="Each lineup is searched on every player's projection varied at random; the numbers shown stay the real ones">Variance:</span><div class="seg">${[["", "Off"], ["1", "On"]].map(([v, w]) => `<button data-op="varsw" data-v="${v}" class="${(raw.varOn ?? "") === v ? "on" : ""}">${w}</button>`).join("")}</div><span class="tl">± <input data-f="varPct" value="${esc(raw.varPct ?? "")}" inputmode="decimal" autocomplete="off"${varOn ? "" : " disabled"}${varOn && bad.varPct ? ` class="bad" title="${esc(bad.varPct)}"` : ""}> % on all players</span>${guide}</div>`;
  return `<div class="sec sethd">Settings</div><div class="set${count ? "" : " two"}">${count ? `<label>Lineups${input("count")}</label>` : ""}<label>Min unique${input("minUnique")}</label>`
    + (gpp ? `<label>Max total own${input("maxTotalOwn", "none")}</label>` : `<label title="Ownership limits are GPP settings">Max total own<input disabled placeholder="GPP only"></label>`) + `</div>`
    + (gpp ? lowOwnedHtml(raw.lowRules ?? [], { open: P.lrOpen, msg: P.lrMsg, typed: P.lrForm ?? {} }) + variance : "")
    + `<div class="teams"><span class="tl">Teams: min ${input("teamMin")} · max ${input("teamMax")} per team</span><span class="ovs">${chips}</span><button class="ov" data-op="ovopen">+ override</button></div>${gone}${form}`
    + `<div class="setmsg"${msg ? "" : " hidden"} title="${esc(msg)}">${esc(msg)}</div>`;
}
