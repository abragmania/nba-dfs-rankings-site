// Screen 4, Export (entries late swap): Export changed, Export all (only the changed ones edited), Export this spot, and several spots at
// once. An entry that differs from its spot is simply corrected and shown as changed. A row that fails a real check (a started man, legality,
// an unknown man) stays out of the file with its reason shown. Entries with no lineup are named: they are in no file.
import { esc, money, f1, signed, spotColour, feeText, outFlag, isOutMan, outChip } from "./lsw-common.js";
import { logo } from "./board-util.js";

const delta = (moves) => (moves.every((m) => Number.isFinite(m.in?.proj) && Number.isFinite(m.out?.proj)) ? moves.reduce((t, m) => t + m.in.proj - m.out.proj, 0) : null);

/** Repeats, before any download, every spot that holds a man who is Out or off the board. */
const outBanner = (M) => {
  const bad = M.spots.filter((s) => s.alert);
  return bad.length ? `<div class="outban"><b>Before you download:</b> ${bad.length === 1 ? "this spot holds" : "these spots hold"} a man who is Out or off the board.${bad.map((s) => `<div><span class="sc plain" style="--sc:${spotColour(s.name, M.spots)}">${esc(s.name)}</span> ${s.alert.men.map((m) => `<b>${esc(m.name)}</b> (${esc(m.why)})`).join(", ")}, ${s.nEntries} ${s.nEntries === 1 ? "entry" : "entries"}</div>`).join("")}</div>` : "";
};

export function exportHtml(M, L) {
  const E = M.exports, chg = E.changed.written, held = E.changed.heldBack, left = E.changed.leftOut;
  const allN = E.all.written;
  const picked = [...L.exportPick].filter((n) => M.spots.some((s) => s.name === n));
  const order = new Map(M.spots.map((s, i) => [s.name, i]));
  const rows = M.entries.filter((e) => e.changed || e.held).sort((a, b) => (order.get(a.spot) ?? 99) - (order.get(b.spot) ?? 99));
  const putsOut = (e) => e.moves.some((m) => isOutMan(m.in)); // a changed row that writes a man who is Out: never "passed", always flagged
  const passes = rows.filter((e) => !e.held && !putsOut(e)).length;
  const outRows = rows.filter((e) => !e.held && putsOut(e));
  const spotChanged = (n) => M.entries.filter((e) => e.spot === n && e.changed && !e.held).length;
  const one = picked.length === 1 ? picked[0] : null;
  const nPicked = picked.reduce((t, n) => t + spotChanged(n), 0);
  return `<div class="tiles">
<button class="tile am" data-lsw="exportChanged"${chg ? "" : " disabled"}><h2>Export changed (${chg})</h2><p>${chg ? `Only the ${chg} edited ${chg === 1 ? "entry" : "entries"} across ${new Set(M.entries.filter((e) => e.changed && !e.held).map((e) => e.spot)).size} spots, ready for DraftKings.` : "Nothing is changed from the upload yet."}</p></button>
<button class="tile am2" data-lsw="exportAll"${allN ? "" : " disabled"}><h2>Export all (${allN})</h2><p>Whole entries file, only changed edited: ${E.all.unchanged.length} ${E.all.unchanged.length === 1 ? "entry" : "entries"} byte for byte as uploaded, ${chg} edited.</p></button>
<div class="tile gr"><h2>Export this spot</h2><div class="spp">${M.spots.map((s) => `<button class="fc${L.exportPick.has(s.name) ? " on" : ""}" style="--sc:${spotColour(s.name, M.spots)}" data-lsw="pickSpot" data-spot="${esc(s.name)}">${esc(s.name)} <b>${s.nEntries}</b></button>`).join("")}</div>
<button class="go" data-lsw="exportSpots"${nPicked ? "" : " disabled"}>${picked.length ? `Export ${picked.join(" + ")}${nPicked ? ` (${nPicked})` : ""}` : "Pick one or more spots"}</button><small class="muted">${picked.length > 1 ? "Several spots in one file." : "Changed entries of just that spot."}</small></div>
<div class="checks"><div class="ck ${held.length ? "" : "ok"}">${held.length ? "✗" : "✓"} ${passes} changed ${passes === 1 ? "entry passes" : "entries pass"} every check (legal, under the $50,000 cap, no started man moved)</div>
${outRows.length ? `<div class="ck amb">⚠ ${outRows.length} changed ${outRows.length === 1 ? "entry writes" : "entries write"} a man who is Out: ${[...new Set(outRows.flatMap((e) => e.moves.filter((m) => isOutMan(m.in)).map((m) => m.in.name)))].map(esc).join(", ")}</div>` : ""}
${held.length ? `<div class="ck bad">✗ ${held.length} ${held.length === 1 ? "entry" : "entries"} left out of the file for failing a check; reasons below</div>` : ""}
<div class="ck ${left.length ? "bad" : "ok"}">${left.length ? "✗" : "✓"} ${left.length} ${left.length === 1 ? "entry" : "entries"} left out for having no lineup assigned</div></div></div>
${outBanner(M)}${M.exports.changed.error ? `<div class="msg err">${esc(M.exports.changed.error)}</div>` : ""}
<div class="mapcol xt"><div class="et hd"><span>Spot</span><span>Entry</span><span>Entry ID</span><span>Slot</span><span>Out</span><span></span><span>In</span><span class="r">Proj</span><span class="r">Check</span></div>
${rows.length ? rows.map((e, i) => {
    const first = i === 0 || rows[i - 1].spot !== e.spot, c = spotColour(e.spot, M.spots);
    const d = delta(e.moves);
    return (e.moves.length ? e.moves : [{ slot: "—", out: null, in: null }]).map((m, k) => `<div class="et${e.held ? " held" : ""}" style="--sc:${c}"><span>${k === 0 && first ? `<i class="sc plain" style="--sc:${c}">${esc(e.spot)}</i>` : ""}</span><span class="cn">${k === 0 ? esc(e.contestName) : ""}</span><span class="id">${k === 0 ? esc(e.entryId) : ""}</span><span class="slt">${esc(m.slot)}</span>
<span class="out">${m.out ? logo(m.out.team ?? "", "xs") : ""}<s>${esc(m.out?.name ?? "—")}</s></span><span>→</span><span class="in">${m.in?.team ? `<i class="lgc">${logo(m.in.team, "xs")}</i>` : ""}${esc(m.in?.name ?? "—")}${outChip(m.in)}</span><span class="r ${d != null && d < 0 ? "dn" : "up"}">${k === 0 ? signed(d, f1) : ""}</span><span class="r ${e.held ? "bad" : putsOut(e) ? "amb" : "ok"}">${k === 0 ? (e.held ? "✗ left out" : putsOut(e) ? "⚠ Out man" : "✓ passed") : ""}</span></div>${k === 0 && e.held ? `<div class="rs et-r">${e.held.map(esc).join(" ")}</div>` : ""}`).join("");
  }).join("") : '<div class="rs dim">No entry differs from the upload.</div>'}</div>
<div class="mapcol leftout"><div class="mh"><span class="t ${left.length ? "red" : ""}">Left out: no lineup assigned</span><span class="muted">${left.length} ${left.length === 1 ? "entry" : "entries"}, never edited or exported</span></div>
${left.length ? `<div class="lo">${left.map((e) => `<span class="lc"><span>${esc(e.contestName)}</span> <b>${esc(e.entryId)}</b>${e.reservation ? ' <i class="muted">open reservation</i>' : ""}</span>`).join("")}</div>` : '<div class="rs dim">Every entry has a spot.</div>'}
<div class="fileline">File: ${esc(L.lastFile ?? "DKEntries_late_swap.csv")}, header Entry ID through UTIL · exported ${M.file.exportedAt ? esc(new Date(M.file.exportedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })) + " ET" : "not yet"}</div></div>`;
}
export { money, feeText };
