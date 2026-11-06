// The lineup bar (Adam, 11-06): above the player list, one row for each thing the Monster and RotoWire lineup pages say that the console does not
// yet show ("Monster + RotoWire: Jalen Johnson OUT (TwoGun still 32 min)  [Apply] [Dismiss]"), and one grey line whenever something was not read.
// Nothing is applied by itself: Apply runs the console's role move on the team's Tonight scenario and then the console's own Apply
// (console-card.js applyProposal), so minutes and projections reach the optimizer as a manual flip would. Dismiss is remembered in this browser
// per proposal until its sources change. Shows nothing at all when there is nothing to say and nothing missing. The same code runs on the public
// site, from the published lineups-latest.json. barHtml, statusLine and refusalText are DOM-free (tested in node); createLineupBar wires them. Look: lineup-bar.css.
import { esc } from "./board-util.js";
import { lastName } from "./console-model.js";
import { makeProposals, visible } from "./lineup-proposals.js";
import { sentText } from "./card-role.js";

const TIME_FMT = { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" };
const timeText = (iso) => {
  const ms = Date.parse(iso ?? "");
  return Number.isNaN(ms) ? "time unknown" : `${new Date(ms).toLocaleTimeString("en-US", TIME_FMT)} ET`;
};
const KIND = { out: "OUT", starter: "START", conflict: "CHECK", unmatched: "CHECK", unknown: "CHECK" };
const usable = (b) => b?.state === "ok" && Array.isArray(b.men);
const noUrl = (s) => String(s ?? "").replace(/\s*https?:\/\/\S+/g, "").trim();

/** The sources behind a proposal, for its hover and its time line: "Monster (projected) 3:05 PM ET; RotoWire (confirmed) 3:05 PM ET". */
export function sourcesText(sources) {
  return sources.map((s) => `${s.label}${s.lineup ? ` (${s.lineup === "confirmed" ? "confirmed" : "projected"})` : ""}${s.detail ? `, ${s.detail}` : ""} ${timeText(s.at)}`).join("; ");
}

/** The one-line status of the read, or "" when everything was read. `read` is the route's answer { state, latest?, why? }. */
export function statusLine(read) {
  if (read?.state === "missing") return "Lineups: no lineup read yet";
  if (read?.state !== "ok") return `Lineups: the read cannot be used (${noUrl(read?.why ?? "unknown")})`;
  const l = read.latest;
  if (l.status === "failed") return `Lineups: ${noUrl(l.note ?? "the read failed")}`;
  const parts = [];
  let bad = false;
  for (const [key, label] of [["monster", "Monster"], ["rotowire", "RotoWire"]]) {
    const s = l.sources?.[key];
    if (s?.status === "ok") parts.push(`${label} ok`);
    else { bad = true; parts.push(`${label} not read (${noUrl(s?.note ?? "no answer")})`); }
  }
  const n = l.monster_news;
  if (n?.status === "ok") parts.push(`Monster news ${timeText(n.fetched_at)}`);
  else { bad = true; parts.push(`Monster news missing (${noUrl(n?.note ?? "no answer")})`); }
  const short = Object.values(l.teams ?? {}).filter((t) => usable(t.monster) !== usable(t.rotowire)).length;
  if (short && !bad) { bad = true; parts.push(`${short} team${short === 1 ? "" : "s"} missing a source's five`); }
  return bad ? `Lineups ${timeText(l.generated_at)}: ${parts.join("; ")}` : "";
}

/**
 * The words for a refused Apply: the cause once, the men listed. "nothing sent, because on CHA: A has no projection here (why); B has ..." becomes
 * "Apply refused, nothing sent: no projection for A, B (why)". Anything else is said as it came, without the console's pointer sentence.
 */
export function refusalText(message) {
  const clean = String(message ?? "").replace(/\s*Open the console's Apply to see it all\.?\s*$/, "").replace(/\.$/, "");
  const m = /^nothing sent, because on \w+: (.*)$/.exec(clean);
  if (!m) return `Apply refused: ${clean}`;
  const segs = m[1].split("; ").map((s) => /^(.+?) has no projection here \((.*)\)$/.exec(s));
  if (segs.some((x) => !x)) return `Apply refused, nothing sent: ${m[1]}`;
  const groups = new Map();
  for (const [, who, why] of segs) {
    const reason = /^no (.+ season totals file) \(run node (\S+)\)$/.exec(why);
    const text = reason ? `${reason[1]} missing; run ${reason[2]}` : why;
    groups.set(text, [...(groups.get(text) ?? []), lastName(who)]);
  }
  return `Apply refused, nothing sent: ${[...groups].map(([why, who]) => `no projection for ${who.join(", ")} (${why})`).join("; ")}`;
}

/** The bar's inner HTML, or "" when there is nothing to show. state: { busy: id, errors: { id: text }, notes: [text] }. */
export function barHtml(result, state = {}) {
  const rows = [...result.proposals, ...result.conflicts], notes = state.notes ?? [];
  if (!rows.length && !notes.length) return "";
  const row = (r) => {
    const busy = state.busy === r.id, err = state.errors?.[r.id];
    if (r.kind === "conflict" || r.kind === "unmatched" || r.kind === "unknown") {
      return `<div class="lprow conflict" data-lp="${esc(r.id)}"><span class="lpkind">${KIND[r.kind]}</span><span class="lptext">${esc(r.text)}</span><span class="lpbtns"><button type="button" data-lp-dismiss="${esc(r.id)}">Dismiss</button></span>${r.sides.length ? `<div class="lpsides">${r.sides.map((s) => `<div>${esc(s)}</div>`).join("")}</div>` : ""}</div>`;
    }
    const where = sourcesText(r.sources), apply = r.noApply || r.nearApply ? "" : `<button type="button" class="lpapply" data-lp-apply="${esc(r.id)}"${state.busy ? " disabled" : ""}>${busy ? "Applying…" : "Apply"}</button>`;
    return `<div class="lprow ${r.kind}" data-lp="${esc(r.id)}"><span class="lpkind">${KIND[r.kind]}</span><span class="lptext" title="${esc(where)}">${esc(r.text)}</span><span class="lptime">${esc(where)}</span>`
      + `<span class="lpbtns">${apply}<button type="button" data-lp-dismiss="${esc(r.id)}"${busy ? " disabled" : ""}>Dismiss</button></span>${r.nearApply ? `<div class="lpwhy">${esc(r.nearApply)}</div>` : r.noApply && !result.stale ? `<div class="lpwhy">${esc(r.noApply)}</div>` : ""}${err ? `<div class="lperr">${esc(err)}</div>` : ""}</div>`;
  };
  return `${notes.map((n) => `<div class="lpnote">${esc(n)}</div>`).join("")}${rows.map(row).join("")}`;
}

/**
 * deps: { el, api(path), slate() -> the slate on show, players() -> its rows, console: { lineupView(slate), applyProposal(slate, proposal) },
 * toast(msg, kind), tryStore(fn), now() }. Returns { refresh() }: asks again for the lineup read and redraws; call it when the slate or its numbers change.
 */
export function createLineupBar({ el, api, slate, players, console: cons, toast, tryStore, now = Date.now }) {
  const key = () => `nbaboard.lineupdismiss.${slate()}`;
  const readDismissed = () => { try { return JSON.parse(tryStore(() => localStorage.getItem(key())) ?? "{}") ?? {}; } catch (e) { console.warn("Lineup dismissals unreadable:", e.message); return {}; } };
  const state = { busy: null, errors: {}, notes: [], slate: null, stuck: new Map() }; // stuck: a proposal whose Apply was refused stays on the bar with the reason, though the console now shows its move
  let gen = 0, shown = { proposals: [], conflicts: [], stale: null };

  function draw() {
    const held = [...state.stuck.values()].filter((p) => !shown.proposals.some((r) => r.id === p.id));
    const html = barHtml({ ...shown, proposals: [...held, ...shown.proposals] }, state);
    el.hidden = !html;
    el.innerHTML = html;
  }
  const settle = (notes, result = { proposals: [], conflicts: [], stale: null }) => { shown = result; state.notes = notes.filter(Boolean); draw(); };

  async function refresh() {
    const mine = ++gen, name = slate();
    if (!name) { el.hidden = true; return; }
    if (name !== state.slate) { state.slate = name; state.stuck.clear(); state.errors = {}; } // another slate: nothing refused before belongs on it
    let read;
    try { read = await api(`/api/slate/${encodeURIComponent(name)}/news-lineups`); } catch (e) {
      if (mine !== gen) return;
      console.warn("Lineup read unavailable:", e.message);
      return settle([`Lineups: the read could not be loaded (${noUrl(e.message)})`]);
    }
    if (mine !== gen) return;
    const line = statusLine(read);
    if (read.state !== "ok") return settle([line]);
    // The console's Tonight view is always loaded before anything is decided: who starts and who plays come only from it.
    let view;
    try { view = await cons.lineupView(name); } catch (e) {
      if (mine !== gen) return;
      return settle([line, `Lineup proposals wait: the console could not load (${e.message})`]);
    }
    if (mine !== gen) return;
    const result = makeProposals({ latest: read.latest, players: players(), view, nowMs: now() });
    const stale = result.stale ? `The lineup read is ${result.stale.ageMin == null ? "of unknown age" : `${result.stale.ageMin} minutes old`}; Apply is off until the next pull.` : "";
    settle([line, stale], visible(result, readDismissed()));
  }

  el.addEventListener("click", async (e) => {
    const dismiss = e.target.closest("[data-lp-dismiss]"), apply = e.target.closest("[data-lp-apply]");
    if (dismiss) {
      const id = dismiss.dataset.lpDismiss, row = [...state.stuck.values(), ...shown.proposals, ...shown.conflicts].find((r) => r.id === id);
      if (!row) return;
      tryStore(() => localStorage.setItem(key(), JSON.stringify({ ...readDismissed(), [id]: row.signature })));
      shown = visible(shown, { [id]: row.signature });
      state.stuck.delete(id); delete state.errors[id];
      return draw();
    }
    if (!apply || state.busy) return;
    const proposal = [...state.stuck.values(), ...shown.proposals].find((r) => r.id === apply.dataset.lpApply);
    if (!proposal || proposal.noApply || proposal.nearApply) return;
    state.busy = proposal.id; delete state.errors[proposal.id]; draw();
    try {
      const out = await cons.applyProposal(slate(), proposal);
      state.stuck.delete(proposal.id);
      toast(sentText(out), "ok");
    } catch (err) {
      const text = refusalText(err.message);
      state.errors[proposal.id] = text;
      state.stuck.set(proposal.id, proposal);
      toast(err.undo ? `${text}. Undo in the console, then Apply` : text, "err");
    }
    state.busy = null;
    await refresh();
  });
  return { refresh };
}
