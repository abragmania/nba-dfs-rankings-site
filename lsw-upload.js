// Screen 1, Upload (entries late swap): drop or choose the DraftKings entries file, use the last upload, recent uploads. The file is kept on
// disk by the server, so the screen says so and does not claim it stays in the tab. The board-age warning stays.
import { esc } from "./lsw-common.js";
import { shortTime } from "./board-util.js";


const COLS = ["Entry ID", "Contest Name", "Contest ID", "Entry Fee", "PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"];
const STEPS = [
  ["Upload", "Drop the DraftKings entries file. Started men are locked at once."],
  ["Match", "Give each entry a spot (Cash, GPP #1, GPP #2), then give each spot one lineup. Set once, kept for next time."],
  ["Swap", "Remove a player from one spot or every spot holding him, or edit a single slot."],
  ["Export", "Changed entries only, one spot, or the whole file with just the changed ones edited."],
];

const when = (iso) => { const t = shortTime(iso, Date.now()); return t ?? iso; };
const stampET = (iso) => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? `${new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET` : "—";
};

/** boardAge: { minutes, stamp } or null when the board's time is not known. */
export function uploadHtml(L) {
  const ups = L.uploads ?? [];
  const last = ups[0];
  const age = L.boardAge;
  const old = age && age.minutes > 30;
  return `<div class="up-grid">
<section class="drop" id="lswDrop" tabindex="0">
<svg width="52" height="52" viewBox="0 0 52 52" fill="none" stroke="currentColor" stroke-width="3"><path d="M26 36V10M14 21l12-12 12 12M8 38v6h36v-6"/></svg>
<h2>Drop your DraftKings entries file here</h2>
<p>The CSV from DraftKings, Upload Lineups page. Every entry row is read, then matched to a spot, then each spot to a lineup.</p>
<div class="dbtn"><button class="go" data-lsw="chooseFile">Choose file</button>${last ? `<button class="go ol" data-lsw="useUpload" data-file="last">Use last upload: ${esc(stampET(last.at))}${last.entries != null ? `, ${last.entries} entries` : ""}</button>` : ""}</div>
<small>${esc(L.upName ?? "DKEntries.csv")} · the file is saved on this machine, so your spots and edits are still here after a reload</small>
${L.upMsg ? `<div class="msg err">${esc(L.upMsg)}</div>` : ""}
</section>
<aside class="how">
<h4>How late swap works</h4>
${STEPS.map((s, i) => `<div class="step"><b>${i + 1}</b><div><h3>${s[0]}</h3><p>${esc(s[1])}</p></div></div>`).join("")}
<div class="agebox ${old ? "old" : ""}"><span>Board</span><b>${age ? esc(age.label) : "—"}</b><span>${age ? `${age.minutes} min old` : "age unknown"}</span></div>
<div class="warn">If your board is more than 30 minutes old, pull it before you swap: late news will not be in these numbers.</div>
</aside>
<section class="cols"><h4>What the app looks for in the file</h4><div class="colgrid">${COLS.map((c) => `<span>${esc(c)}</span>`).join("")}</div></section>
<section class="recent"><h4>Recent uploads</h4>
${ups.length ? ups.map((u, i) => `<div class="ru"><b>${esc(stampET(u.at))}</b><span class="en">${u.entries ?? "—"} entries</span><span class="sp">${u.spots?.length ? `${u.spots.length} ${u.spots.length === 1 ? "spot" : "spots"}: ${esc(u.spots.join(", "))}` : "—"}</span><span class="nt${u.noteKind ? ` ${u.noteKind}` : ""}">${esc(u.note ?? "")}</span>${L.has && i > 0 ? '<span class="muted" title="An older file would put back what DraftKings held earlier">for looking</span>' : `<button class="ol" data-lsw="useUpload" data-file="${esc(u.file)}">Open</button>`}</div>`).join("") : '<div class="ru dim">No uploads yet for this slate.</div>'}
</section></div>`;
}

export { when };
