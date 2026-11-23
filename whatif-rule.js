// The arm rule of saved what-ifs (Adam 11-19 5:15 PM ET "save and arm"; 1:37-1:38 PM 11-20: a what-if may name men who start, several may be armed, "it should be able to figure that out
// automatically based on the lineup and use the right one by default"). Pure, run by the server (server/slate/whatif-arm.js: every news pass, and at once after each of his what-if writes)
// and by the Scenario tab for its own estimate. Nothing touches the board until a what-if is armed AND its conditions hold:
//   - every man he picked to sit ruled Out by our own feeds and Out on the board; only some: "partial", none yet: "waiting";
//   - every man Out on the board when he built it still Out (a man back since: "built_without", its numbers were made without him);
//   - when it names men who start: the confirmed five the board uses (FIVE_KINDS) has them starting; no five posted yet: "waiting_five", another five: "five_differs";
//   - of the team's armed what-ifs whose conditions hold, the one with the most conditions (sitters plus starters) is used; a tie is not applied and is named ("tie"), the others are "outranked";
//   - his own Console work held on the team wins: the what-if is skipped and named ("his_work", fail-safe);
//   - the usage table not ready: nothing moves ("waiting_usage"); the team has tipped: never used ("tipped"); not armed: never used ("off").
// The one used puts its edits on as Console pins and the team's record keeps which (S.whatif_used, scenarios.js, written with the pins). A what-if in use that no longer wins comes off: its
// pins are taken off wherever they still stand exactly as written (its recorded scenario, and any scenario holding all of them). Once he has saved work on the team after it went on (the
// record's his_at later than its time), its numbers are his: nothing of it is taken off and it is released. Our feeds' Outs: the console inputs' feed_outs (console-inputs.js feedOutsOf) plus
// a man a news entry put Out who is still Out (newsOwned). TwoGun's Out list is never read (Adam 11-19).
import { keyOf } from "./console-engine.js";
import { pinsOf } from "./console-model.js";
import { newsOwned } from "./console-marks.js";
import { EDIT_KINDS } from "./whatif-model.js";

/**
 * The lineup reads' fives a starting condition is judged on: the one the board uses (personal-view.js confirmedFive), a confirmed one when posted, else the pages agreeing (Adam 2:27 PM 11-20:
 * "expected and agreed BUT it has to have the flexibility to (a) pivot if the agreed upon starting 5 changes between sites and ESPECIALLY if/when (b) the confirmed lineup comes out"). Every pass
 * judges again on the five then in use, so a what-if whose starters left it comes off and the one that matches goes on in the same send, the switch named.
 */
export const FIVE_KINDS = ["confirmed", "agreed"];
export const ARM_STATES = ["off", "tipped", "waiting_usage", "no_feeds", "gone", "waiting", "partial", "not_on_board", "built_without", "waiting_five", "five_differs", "tie", "outranked", "his_work", "apply", "used", "take_off"];
const PIN_WORD = { m: "minutes", u: "usage", d: "DK/min", p: "projection" };
const list = (names) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
const ET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const etTime = (iso) => { const ms = Date.parse(iso ?? ""); return Number.isFinite(ms) ? ET.format(ms).replace(/[  ]/g, " ") : "an unknown time"; };

/** Whether the team's game has tipped by the inputs (inputs.locked and inputs.open, slate-times.js openTeams): before the lock no team has. Pure. */
export const teamTipped = (inputs, code) => inputs?.locked === true && !(Array.isArray(inputs?.open) && inputs.open.includes(code));

/** The men our feeds rule Out on the team: { ok (the inputs carry a read of our feeds), ids: Set, why }. A news entry's Out still standing counts even with no read (it is our feeds' own call). Pure. */
export function feedOutsFor(input, S) {
  const ok = Array.isArray(input?.feed_outs), ids = new Set([...(ok ? input.feed_outs.map(String) : []), ...newsOwned(S).out]);
  return { ok, ids, why: ok ? null : input?.tier?.missing ?? "the console inputs carry no read of our feeds for this team" };
}

/** The five the board uses (the inputs' tier.confirmed, of a kind in FIVE_KINDS): { ok (posted), ids: Set, kind ("confirmed" | "agreed") }. Pure. */
export function fiveFor(input) {
  const c = input?.tier?.confirmed, kind = c?.kind ?? "agreed";
  return Array.isArray(c?.ids) && c.ids.length && FIVE_KINDS.includes(kind) ? { ok: true, ids: new Set(c.ids.map(String)), kind } : { ok: false, ids: new Set(), kind: null };
}

/** The apply words: plain, or, when another what-if was in use, the switch named with the five behind it ("Post starts per the confirmed lineup: switched from ..."). Pure. */
function applyWords(w, T, used, five) {
  if (!used || used.id === w.id) return `${w.name}: used; its conditions hold tonight, so its numbers went on the board as your Console work`;
  const st = (w.starts ?? []).map((id) => T.byId[id]?.name ?? id), per = st.length && five.ok ? `${list(st)} start${st.length === 1 ? "s" : ""} per the ${five.kind} lineup: ` : "";
  return `${w.name}: ${per}switched from "${used.name}"; its numbers went on the board as your Console work and the old one's came off`;
}

/** How many conditions a what-if has: the men he picked to sit plus the men it has starting. The team's pick goes to the most. Pure. */
export const conditionsOf = (w) => w.outs.length + (w.starts?.length ?? 0);

/** The edits that would go on now: those on men on the team and playing in the scenario on show (a man Out takes no number, console-engine.js pinsOnPlaying). Pure. */
export function effectiveEdits(T, S, w) {
  const out = { m: {}, u: {}, d: {} };
  for (const k of EDIT_KINDS) for (const [id, v] of Object.entries(w?.edits?.[k] ?? {})) if (T.byId[id] && !S.outs.includes(id)) out[k][id] = v;
  return out;
}
const sameEdits = (a, b) => EDIT_KINDS.every((k) => JSON.stringify(Object.entries(a?.[k] ?? {}).sort()) === JSON.stringify(Object.entries(b?.[k] ?? {}).sort()));
/** Whether he has saved work on the team since the what-if in use went on (the record's his_at, which only his clicks move, scenarios.js): then its numbers are his (finding 7). Pure. */
export const hisSince = (hisAt, used) => Boolean(used) && Number.isFinite(Date.parse(hisAt ?? "")) && Date.parse(hisAt) > Date.parse(used.at);

/**
 * His own Console work held on the team, on the scenario the board is on: [words]. A pin the what-if in use wrote (used.pins, value for value, unless he has worked on the team since) is not his,
 * but one of them he changed or cleared is; a news Out or news flip is not his; his Out on one of w's own men is not in the way. Pure.
 */
export function hisWork(T, S, w, used = null, released = false) {
  const key = keyOf(S.outs), pins = S.pins?.[key] ?? {}, own = newsOwned(S), up = released ? {} : used?.pins ?? {}, outs = new Set(S.outs), mine = S.mine ?? { out: [], in: [] };
  const name = (id) => T.byId[id]?.name ?? id, playing = (id) => Boolean(T.byId[id]) && !outs.has(id), out = [];
  for (const k of ["m", "u", "d", "p"]) for (const [id, v] of Object.entries(pins[k] ?? {})) if (playing(id) && up[k]?.[id] !== v) out.push(`your typed ${PIN_WORD[k]} on ${name(id)}`);
  for (const k of EDIT_KINDS) for (const id of Object.keys(up[k] ?? {})) if (playing(id) && !Object.hasOwn(pins[k] ?? {}, id)) out.push(`you cleared its ${PIN_WORD[k]} on ${name(id)}`); // his clearing is his work: never put back
  for (const id of Object.keys(pins.r ?? {})) if (playing(id) && !own.r.has(id)) out.push(`your role flip on ${name(id)}`);
  for (const id of mine.out ?? []) if (T.byId[id] && !own.out.has(id) && !(w?.outs ?? []).includes(id)) out.push(`your Out on ${name(id)}`);
  for (const id of mine.in ?? []) if (T.byId[id]) out.push(`your back-in on ${name(id)}`);
  for (const id of S.outs) if (EDIT_KINDS.some((k) => Object.keys(S.handouts?.[id]?.[k] ?? {}).length)) out.push(`your hand-outs for ${name(id)}`);
  if (S.outs.length >= 2 && Object.keys(S.combos?.[key] ?? {}).length) out.push("your combined hand-outs");
  return [...new Set(out)];
}

const usedEntries = (used) => EDIT_KINDS.flatMap((k) => Object.entries(used?.pins?.[k] ?? {}).map(([id, v]) => [k, id, v]));
/** Whether a scenario holds every pin the what-if in use wrote, as written; one that wrote none is held wherever it stands (round 2, finding 4: never put on again every pass). Pure. */
export const holdsAll = (S, key, used) => usedEntries(used).every(([k, id, v]) => S.pins?.[key]?.[k]?.[id] === v);
/** Whether the scenario on show holds every pin the what-if in use wrote, as written. Pure. */
export const usedStillOn = (S, used) => holdsAll(S, keyOf(S.outs), used);

/** One armed what-if against tonight's facts: { state: "match" } when every condition holds, else its verdict { state, text }. A what-if in use is not asked the feeds again while its men stay Out on the board. Pure. */
export function matchOf(w, { T, S, feeds, five, used }) {
  const name = (id) => T.byId[id]?.name ?? id, outs = new Set(S.outs), starts = w.starts ?? [], say = (state, text) => ({ state, text: `${w.name}: ${text}` });
  const gone = [...w.outs, ...starts].filter((id) => !T.byId[id]);
  if (gone.length) return say("gone", `${gone.length === 1 ? "a man of it is" : `${gone.length} men of it are`} no longer on the team, so it is not used`);
  const allOn = w.outs.every((id) => outs.has(id));
  if (!(used && allOn)) {
    const ruled = w.outs.filter((id) => feeds.ids.has(id)), not = w.outs.filter((id) => !feeds.ids.has(id));
    if (not.length && !feeds.ok) return say("no_feeds", `not used, because our feeds could not be read for the team (${feeds.why})`);
    if (!ruled.length) return say("waiting", `armed, waiting; our feeds do not have ${list(w.outs.map(name))} Out`);
    if (not.length) return say("partial", `not used, because only ${list(ruled.map(name))} of its ${w.outs.length} men ${ruled.length === 1 ? "is" : "are"} ruled Out by our feeds (${list(not.map(name))} not)`);
    if (!allOn) return say("not_on_board", `not used, because our feeds rule ${list(w.outs.map(name))} Out but the board still has ${list(w.outs.filter((id) => !outs.has(id)).map(name))} playing (your back-in, or the news not yet applied)`);
  }
  const back = (w.base?.outs ?? []).filter((id) => T.byId[id] && !outs.has(id));
  if (back.length) return say("built_without", `not used, because ${list(back.map(name))} ${back.length === 1 ? "was" : "were"} Out when you built it and ${back.length === 1 ? "plays" : "play"} tonight, so its numbers were made without ${back.length === 1 ? "him" : "them"}`);
  if (starts.length && !five.ok && !used) return say("waiting_five", `armed, waiting for the starting five (${list(starts.map(name))} must start)`);
  const off = starts.filter((id) => five.ok && !five.ids.has(id));
  if (off.length) return say("five_differs", `not used, because the ${five.kind} five does not have ${list(off.map(name))} starting`);
  return { state: "match", text: null };
}

/** Why the what-if in use comes off, in words. */
function offWhy(w, T, S, m, winner, tied) {
  const outs = new Set(S.outs), name = (id) => T.byId[id]?.name ?? id;
  if (w.orphan) return "it is no longer saved";
  if (!w.armed) return "it is no longer armed";
  if (!w.outs.every((id) => outs.has(id))) return `${list(w.outs.filter((id) => !outs.has(id)).map(name))} ${w.outs.filter((id) => !outs.has(id)).length === 1 ? "is" : "are"} playing again`;
  if (m && m.state !== "match") return m.text.slice(w.name.length + 2);
  if (tied) return "another what-if fits tonight equally, so neither is used";
  return winner ? `${winner.name} fits tonight with more conditions` : "it no longer fits tonight";
}

/**
 * The verdicts on a team's what-ifs: [{ id, state (ARM_STATES), text (his words, naming the men), his: [words], release? }], one for each, plus one for a what-if in use that is no longer saved; the ones
 * coming off first. list: the team's saved what-ifs { id, name, outs, starts, edits, armed, base }; T, S: the team as the board holds it now (after the news pass's own moves), S.whatif_used the one in
 * use; feeds: feedOutsFor; five: fiveFor; tipped: teamTipped; hisAt: the team record's his_at; usageReady: the usage table's state is "ready". Pure: the risky decision, tested directly (tests/whatif_arm.test.mjs).
 */
export function teamVerdicts({ list: saved, T, S, feeds, five, tipped, hisAt = null, usageReady = true }) {
  const used = S.whatif_used ?? null, orphan = used && !saved.some((w) => w.id === used.id) ? [{ id: used.id, name: used.name, outs: [], starts: [], edits: {}, armed: false, orphan: true }] : [];
  const all = [...saved, ...orphan], usedOf = (w) => (used && used.id === w.id ? used : null);
  if (!usageReady) return all.map((w) => ({ id: w.id, state: "waiting_usage", text: `${w.name}: waiting (usage table not ready); nothing moves until it loads${usedOf(w) ? "; the numbers it put on stay on the board until the table loads" : ""}`, his: [] }));
  if (tipped) return all.map((w) => ({ id: w.id, state: "tipped", text: `${w.name}: the team has tipped, so it is never used${usedOf(w) ? "; the numbers it put on stand as they were at the tip" : ""}`, his: [] }));
  if (used && hisSince(hisAt, used)) { // finding 7: he saved work on the team after it went on; its numbers are his now and nothing of it is taken off
    const rest = teamVerdicts({ list: saved, T, S: { ...S, whatif_used: null }, feeds, five, tipped, hisAt, usageReady }).filter((v) => v.id !== used.id);
    return [{ id: used.id, state: "his_work", release: true, text: `${used.name}: you saved work on the team in the Console after it went on at ${etTime(used.at)}, so its numbers are yours now and nothing of it is taken off`, his: [] }, ...rest];
  }
  const ctx = { T, S, feeds, five }, m = new Map(all.filter((w) => w.armed).map((w) => [w.id, matchOf(w, { ...ctx, used: usedOf(w) })]));
  const fits = all.filter((w) => m.get(w.id)?.state === "match"), top = Math.max(0, ...fits.map(conditionsOf)), best = fits.filter((w) => conditionsOf(w) === top);
  const winner = best.length === 1 ? best[0] : null, tied = best.length > 1 ? new Set(best.map((w) => w.id)) : new Set();
  const out = all.map((w) => {
    const say = (state, text, his = []) => ({ id: w.id, state, text, his });
    if (winner && w.id === winner.id) {
      const his = hisWork(T, S, w, used);
      if (his.length) return say("his_work", `${w.name}: skipped, because your own Console work holds the team (${his.join("; ")}); your work wins${usedOf(w) ? ", and its numbers you did not change stay" : ""}`, his);
      if (usedOf(w) && usedStillOn(S, used) && sameEdits(used.pins, effectiveEdits(T, S, w))) return say("used", `${w.name}: in use`);
      return say("apply", applyWords(w, T, used, five));
    }
    if (usedOf(w)) return say("take_off", `${w.name}: ${offWhy(w, T, S, m.get(w.id), winner, tied.has(w.id))}, so the numbers it put on come off (any you changed since stay)`);
    if (!w.armed) return say("off", `${w.name}: not armed, so it is never used`);
    if (tied.has(w.id)) return say("tie", `${w.name}: not used, because ${list(best.filter((x) => x.id !== w.id).map((x) => x.name))} fit${best.length === 2 ? "s" : ""} tonight equally (${top} conditions each); load one in the Console to choose`);
    if (fits.includes(w)) return say("outranked", `${w.name}: fits, but ${winner.name} fits with more conditions, so that one is used`);
    return { id: w.id, ...m.get(w.id), his: [] };
  });
  return out.sort((a, b) => Number(b.state === "take_off") - Number(a.state === "take_off"));
}

/**
 * The what-if in use comes off (round 2, finding 1): on its recorded scenario (which follows every carry, followPins), and on the one on show when the whole set was carried there, each pin still as
 * written is taken off with its stamp (a number he changed stays). On any other
 * scenario only a minutes pin still carrying the what-if's own stamp (w.stamps.m[id].at, as putOnPins wrote it) is taken off: an unstamped or otherwise stamped equal number there is his and stays.
 * w: the saved what-if (null when it is no longer saved: then only the two scenarios). S.whatif_used is cleared. Mutates S. Returns how many came off.
 */
export function takeOffPins(S, w = null) {
  const used = S.whatif_used;
  if (!used) return 0;
  let n = 0;
  const drop = (key, k, id) => { delete S.pins[key][k][id]; if (k === "m" && S.stamps?.m?.[key]) delete S.stamps.m[key][id]; n++; };
  const here = keyOf(S.outs), main = new Set([used.key, ...(here !== used.key && holdsAll(S, here, used) ? [here] : [])]); // the scenario on show by value only when the whole set was carried there; else his equal number there stays
  for (const key of main) for (const [k, id, v] of usedEntries(used)) if (S.pins?.[key]?.[k]?.[id] === v) drop(key, k, id);
  for (const key of Object.keys(S.pins ?? {})) {
    if (main.has(key)) continue;
    for (const [id, v] of Object.entries(used.pins?.m ?? {})) {
      const own = w?.stamps?.m?.[id]?.at;
      if (own && S.pins[key]?.m?.[id] === v && S.stamps?.m?.[key]?.[id]?.at === own) drop(key, "m", id);
    }
  }
  S.whatif_used = null;
  return n;
}

/**
 * The what-if's edits onto the scenario on show as Console pins, with his minutes stamps (typed-aside.js), as if he had typed them in the Console: the one in use before comes off first. Its starters are
 * not written: it is used only when the confirmed five already has them. Mutates S and records S.whatif_used { id, name, at, key, pins }. Returns the pins written.
 */
export function putOnPins(S, T, w, atIso) {
  takeOffPins(S);
  const key = keyOf(S.outs), pins = pinsOf(S, key), wrote = effectiveEdits(T, S, w);
  for (const k of EDIT_KINDS) for (const [id, v] of Object.entries(wrote[k])) {
    pins[k][id] = v;
    const st = w.stamps?.m?.[id];
    if (k === "m" && st) ((S.stamps ??= {}).m ??= {})[key] = { ...(S.stamps.m[key] ?? {}), [id]: st };
  }
  S.whatif_used = { id: w.id, name: w.name, at: atIso, key, pins: wrote };
  return wrote;
}

/** A what-if in use whose pins were carried to the scenario now on show (a pull or the news moved the team): its record follows them (finding 1). Mutates S. True when it moved. */
export function followPins(S) {
  const used = S.whatif_used, here = keyOf(S.outs);
  if (!used || used.key === here || !usedStillOn(S, used)) return false;
  S.whatif_used = { ...used, key: here };
  return true;
}
