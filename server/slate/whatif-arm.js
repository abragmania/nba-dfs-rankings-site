// The what-if step (Adam 11-19 5:15 PM ET, "save and arm"; 1:37-1:38 PM 11-20). Inside every news pass (news-apply.js applyNews), after the news's own Outs and flips are on his page-less work and
// before the held teams are sent, and at once after each of his what-if writes (armAndSend, the money review's finding 3): each team's what-ifs are judged by the one rule
// (server/board/whatif-rule.js teamVerdicts). The one chosen puts its edits on the team's scenario as Console pins and the team's record keeps which (whatif_used); one no longer chosen takes
// its own pins off. The send that follows (resend.js sendHeld: planApply + writeApply, the Console's Apply path and record) writes the record and the numbers together, puts both back if it
// fails, and the two travel together in scenarios.json (finding 2). Each team is judged on a copy of its work, put back whole if its step throws (finding 8), so a what-if fault never stops
// the news's own Outs. The words go to whatif-status.json once the send is through, and the pass's note carries those that changed (G62). Nothing here awaits.
import { keyOf } from "../board/console-engine.js";
import { buildModel } from "../board/console-model.js";
import { teamVerdicts, feedOutsFor, fiveFor, teamTipped, putOnPins, takeOffPins, followPins } from "../board/whatif-rule.js";
import { readWhatifs, teamWhatifs, readStatus, writeStatus } from "./whatifs.js";
import { readSlate } from "./store.js";
import { buildInputs } from "../../site/shim/app-only.js";
import { readScenarios } from "./scenarios.js";
import { readOverrides } from "./overrides.js";
import { basePlayers } from "./base-players.js";
import { withOurProjection } from "../../site/shim/app-only.js";
import { sendHeld, mayResend, clockFrom, writeResend, writeNewsMarker, usageWhy, LOCKED_WHY } from "./resend.js";

const LOUD = new Set(["apply", "take_off", "partial", "his_work", "not_on_board", "built_without", "no_feeds", "gone", "tipped", "waiting_usage", "waiting_five", "five_differs", "tie", "outranked"]); // words the pass's note carries when they are new; "waiting", "used" and "off" stay on the tab

/** One team's what-ifs judged and, where one goes on or comes off, its work changed (model.ST[code]). Returns [{ id, state, text, moved }]. Throws only on a fault, which the caller contains. */
function judgeTeam(code, saved, { inputs, model, records, atIso, usageReady, judge }) {
  const T = model.TEAMS[code], S = model.ST[code];
  if (!T || !S) return saved.filter((w) => w.armed).map((w) => ({ id: w.id, state: "gone", text: `${w.name}: ${code} is not on this slate's console, so it is not used` }));
  const tipped = teamTipped(inputs, code);
  const followed = usageReady && !tipped ? followPins(S) : false; // round 2, finding 1: the record tracks every carry of its pins, so take-off finds them on the two scenarios it looks at; nothing moves while the usage table is not ready or after tip
  const verdicts = judge({ list: saved, T, S, feeds: feedOutsFor(inputs.teams[code], S), five: fiveFor(inputs.teams[code]), tipped, hisAt: records?.[code]?.his_at ?? null, usageReady });
  if (!usageReady || verdicts.every((v) => v.state === "tipped")) return verdicts; // finding 5: nothing moves, nothing is sent for it
  const byId = new Map(saved.map((w) => [w.id, w]));
  return verdicts.map((v) => {
    if (v.state === "take_off") { takeOffPins(S, byId.get(v.id) ?? null); return { ...v, moved: true }; }
    if (v.release) { S.whatif_used = null; return { ...v, moved: true }; } // his numbers now: the record goes, every pin stays
    if (v.state === "apply") { putOnPins(S, T, byId.get(v.id), atIso); return { ...v, moved: true }; }
    if (v.state === "used" && followed) return { ...v, moved: true };
    return v;
  });
}

/**
 * The step: { teams (whose work it changed: the caller sends them), notes (new words, "MEM: ..."), failed (why the what-ifs could not be read, else null), commit(sent) }. records: the scenarios
 * file's team records (their his_at); usageReady: the usage table is "ready" (else nothing moves, finding 5); judge: the rule (tests inject a failing one). commit(sent: Set of the teams the send
 * went through for) saves the words; a team not sent says so. An unreadable what-ifs file changes nothing and is said, never taken as empty.
 */
export function armWhatifs({ slate, inputs, model, records = {}, nowMs, usageReady = true, read = readWhatifs, judge = teamVerdicts }) {
  let doc;
  try { doc = read(slate); } catch (e) { return { teams: [], notes: [`what-ifs not checked: ${e.message}`], failed: e.message, commit: () => false }; }
  const atIso = new Date(nowMs).toISOString(), was = readStatus(slate), words = {}, teams = [], notes = [];
  const codes = [...new Set([...Object.keys(doc.teams), ...Object.entries(model.ST).filter(([, S]) => S.whatif_used).map(([c]) => c)])].sort();
  for (const code of codes) {
    const snap = model.ST[code] ? structuredClone(model.ST[code]) : null;
    try { words[code] = judgeTeam(code, teamWhatifs(doc, code), { inputs, model, records, atIso, usageReady, judge }); } catch (e) {
      if (snap) model.ST[code] = snap; // finding 8: the team as the news pass left it
      notes.push(`${code} what-ifs not checked: ${e.message}; the team was left as the news pass had it`);
      continue;
    }
    if (words[code].some((v) => v.moved)) teams.push(code);
    for (const v of words[code]) { const old = was.teams?.[code]?.[v.id]; if (LOUD.has(v.state) && (old?.state !== v.state || old?.text !== v.text)) notes.push(`${code} ${v.text}`); }
  }
  const commit = (sent) => {
    const next = { updated_at: atIso, teams: {} }; // updated_at: the time the sync's derived-file rule reads (pullnow/resolve.js derivedAt)
    for (const [code, vs] of Object.entries(words)) next.teams[code] = Object.fromEntries(vs.map((v) => {
      const unsent = v.moved && !sent.has(code), text = unsent ? `${v.text}; this did not reach the board, so the next pass tries again` : v.text, old = was.teams?.[code]?.[v.id];
      return [v.id, old?.state === v.state && old?.text === text ? old : { at: atIso, state: v.state, text: text.slice(0, 800) }];
    }));
    return JSON.stringify(next.teams) === JSON.stringify(was.teams ?? {}) ? false : writeStatus(slate, next);
  };
  return { teams, notes, failed: null, commit };
}

/** The what-ifs in use on the slate's teams, for a waiting note (round 2, finding 5): "; in use, its numbers stay on the board until the table loads: ORL If Wagner sits", or why they could not be read. */
function inUseWords(slate) {
  let teams;
  try { teams = readScenarios(slate).teams; } catch (e) { return `; the what-ifs in use could not be read (${e.message})`; }
  const on = Object.entries(teams).filter(([, rec]) => rec?.whatif_used).map(([t, rec]) => `${t} ${rec.whatif_used.name}`);
  return on.length ? `; in use, ${on.length === 1 ? "its numbers stay" : "their numbers stay"} on the board until the table loads: ${on.join(", ")}` : "";
}

/**
 * At once after his what-if write (finding 3): the step and the held teams' send on the newest slate, as a news pass makes them with no news of its own. SYNCHRONOUS from its read to its write (the
 * route awaits the usage table first). Returns { status: "ok" | "waiting" | "skipped" | "failed", note, notes, sent }. Usage not ready: nothing moves, said. Not the newest slate, or every game tipped:
 * nothing is sent by itself, said.
 */
export function armAndSend(slate, { usage, nowMs, ourPlayers = withOurProjection, writeSend }) {
  if (usage?.state !== "ready") return { status: "waiting", note: `waiting (${usageWhy(usage)}); nothing went on or came off the board${inUseWords(slate)}`, notes: [], sent: 0 };
  const slateData = readSlate(slate);
  if (!slateData) return { status: "skipped", note: `${slate} has no slate file`, notes: [], sent: 0 };
  const inputs = buildInputs(slate, slateData, { usage, nowMs });
  if (!mayResend(inputs)) return { status: "skipped", note: `${inputs.locked === true ? LOCKED_WHY : "this is not the newest slate"}, so nothing is sent by itself`, notes: [], sent: 0 };
  const file = readScenarios(slate), overrides = readOverrides(slate), { players, note: baseNote } = basePlayers(slate, slateData, nowMs, ourPlayers);
  const model = buildModel(inputs, file.teams, file.applied?.keys), atIso = new Date(nowMs).toISOString();
  const wi = armWhatifs({ slate, inputs, model, records: file.teams, nowMs, usageReady: true });
  if (!wi.teams.length) { wi.commit(new Set()); return { status: "ok", note: wi.notes.length ? wi.notes.join("; ") : "nothing went on or came off the board", notes: wi.notes, sent: 0 }; }
  const out = sendHeld({ slate, inputs, model, file, overrides, players, extra: wi.teams, usageReady: true, ...(writeSend ? { writeSend } : {}), atIso, clock: clockFrom(nowMs) });
  if (out.failed) return { status: "failed", note: `nothing was sent: ${out.failed}`, notes: wi.notes, sent: 0 };
  wi.commit(new Set(out.teams));
  if (out.teams.length) writeResend(slate, { at: atIso, pull: inputs.basis?.pull ?? null, status: "sent", why: null, teams: out.teams, tipped: out.tipped, sent: out.sent, usage_state: usage.state, usage_message: usage.message ?? null, missing: out.missing, stored: out.stored, base_note: baseNote });
  if (out.wrote) writeNewsMarker(slate, { at: atIso, applied: [], failed: [], sent: out.sent, whatifs: wi.teams });
  return { status: "ok", note: [...wi.notes, `${out.sent} number${out.sent === 1 ? "" : "s"} moved on the board`].join("; "), notes: wi.notes, sent: out.sent, keys: Object.fromEntries(wi.teams.map((t) => [t, keyOf(model.ST[t].outs)])) };
}
