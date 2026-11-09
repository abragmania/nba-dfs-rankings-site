// The console's screen (Adam, 11-07: plain and readable, light, the team always obvious): a header with the team's logo, name, opponent and
// tip; a team switcher with logos; then the Starters (the men starting, a position on every row), the Bench in rotation order and the men
// Out, each row with his minutes, DK/min, projection, where his minutes come from, an S toggle and an Out toggle, and an undo chip on every
// mark he made. A side column holds the team total, the notes and which minutes feed the optimizer. Pure strings, tested in node.
import { esc, logo } from "./board-util.js";
import { calc } from "./console-model.js";
import { keyOf, outsOf } from "./console-engine.js";
import { marksOf, liveText } from "./console-marks.js";
import { MINUTE_SOURCES, SOURCE_LABEL } from "./depth-chart.js";
import { syncWords } from "./console-auto.js";

export const TEAM_NAMES = {
  ATL: "Atlanta Hawks", BKN: "Brooklyn Nets", BOS: "Boston Celtics", CHA: "Charlotte Hornets", CHI: "Chicago Bulls", CLE: "Cleveland Cavaliers",
  DAL: "Dallas Mavericks", DEN: "Denver Nuggets", DET: "Detroit Pistons", GSW: "Golden State Warriors", HOU: "Houston Rockets", IND: "Indiana Pacers",
  LAC: "LA Clippers", LAL: "Los Angeles Lakers", MEM: "Memphis Grizzlies", MIA: "Miami Heat", MIL: "Milwaukee Bucks", MIN: "Minnesota Timberwolves",
  NOP: "New Orleans Pelicans", NYK: "New York Knicks", OKC: "Oklahoma City Thunder", ORL: "Orlando Magic", PHI: "Philadelphia 76ers", PHX: "Phoenix Suns",
  POR: "Portland Trail Blazers", SAC: "Sacramento Kings", SAS: "San Antonio Spurs", TOR: "Toronto Raptors", UTA: "Utah Jazz", WAS: "Washington Wizards",
};
const POS_ORDER = ["PG", "SG", "SF", "PF", "C", "G", "F"];
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const f1 = (x) => (isNum(x) ? (Math.round(x * 10) / 10).toFixed(1) : null);
const f2 = (x) => (isNum(x) ? x.toFixed(2) : null);
const miss = (why) => `<span class="cmiss" title="${esc(why)}">—</span>`;
const pos0 = (p) => (typeof p.pos === "string" ? p.pos.split("/")[0] : "");
const posRank = (p) => { const i = POS_ORDER.indexOf(pos0(p)); return i < 0 ? 99 : i; };

/** An undo chip: drops one mark; its text is the live figure, its hover says so. */
const chip = (team, id, kind, mark, text) => `<button class="rv" type="button" data-undo="${kind}" data-id="${esc(id)}" data-team="${esc(team)}" title="${esc(`${mark.news ? `From the lineup news (${mark.news}). ` : ""}${liveText(kind, mark)}. Click to drop ${mark.news ? "it" : "your mark"}`)}">&#8634; ${esc(text)}</button>`;

/** Where his minutes come from, as a source tag and words. */
function basisOf(r, T, S) {
  const p = r.p;
  if (r.pinned.m) return { tag: "you", word: "Yours", text: "minutes typed by you" };
  if (r.min_from_ours || ((S.source ?? "twogun") !== "twogun" && r.min_basis)) return { tag: "ch", word: "Chart", text: r.min_basis ?? "depth chart" };
  if (r.min_basis) return { tag: "tg", word: "Role", text: r.min_basis };
  if (isNum(r.min) && isNum(p.min) && Math.abs(r.min - p.min) < 0.05) return { tag: "tg", word: "TwoGun", text: p.starter ? "TwoGun starter" : "TwoGun projection" };
  if (isNum(r.min) && isNum(p.min)) {
    const d = r.min - p.min, why = outsOf(keyOf(S.outs)).filter((id) => !T.tonight.includes(id)).map((id) => T.byId[id]?.name).filter(Boolean);
    return { tag: "tg", word: "TwoGun", text: `TwoGun ${f1(p.min)}, ${d > 0 ? "+" : ""}${f1(d)} ${why.length ? `with ${why.join(", ")} out` : "with the men out shared"}` };
  }
  return { tag: "tg", word: "TwoGun", text: p.missing?.min ?? "no minutes" };
}

/** A typed number box (minutes or DK/min) with its undo chip slot. */
function numBox(team, r, k, mark) {
  const v = k === "m" ? r.min : r.rate, shown = k === "m" ? f1(v) : f2(v);
  const label = k === "m" ? "minutes" : "DK points per minute";
  const box = `<input class="fin${mark ? " pin" : ""}" data-k="${k}" data-id="${esc(r.id)}" data-team="${esc(team)}" value="${shown ?? ""}" inputmode="decimal" autocomplete="off" spellcheck="false" aria-label="${esc(r.p.name)} ${label}" title="${mark ? "Your number. " : ""}Type his ${label}; Enter keeps it. Projection = minutes x DK/min"${shown === null ? ` placeholder="—"` : ""}>`;
  return `<span class="nb">${box}<span class="cs">${mark ? chip(team, r.id, k, mark, k === "m" ? f1(mark.live) ?? "—" : f2(mark.live) ?? "—") : ""}</span></span>`;
}

const STATUS = (s) => String(s ?? "").trim();
const statusChip = (s) => {
  const t = STATUS(s), low = t.toLowerCase();
  if (!t || low === "available" || low === "active") return "";
  const cls = low.startsWith("out") ? "out" : low.startsWith("doubt") ? "d" : low.startsWith("quest") || low === "gtd" ? "q" : "o";
  return `<span class="stc ${cls}" title="Injury report: ${esc(t)}">${esc(t[0].toUpperCase() + t.slice(1).toLowerCase())}</span>`;
};

/** One man in the Starters or the Bench. */
function manRow(team, r, T, S, mk, rank) {
  const p = r.p, b = basisOf(r, T, S), starter = r.role === "starter";
  const rmark = mk?.r ? chip(team, r.id, "r", mk.r, mk.r.live === "starter" ? "S" : mk.r.live === "oor" ? "DNP" : "bench") : "";
  const omark = mk?.out ? chip(team, r.id, "out", mk.out, "out") : "";
  const proj = isNum(r.proj) ? `<b class="pj${r.pinned.m || r.pinned.d ? " pin" : ""}">${f1(r.proj)}</b>` : miss(r.missing.join(", ") || "no projection");
  return `<div class="row${mk ? " marked" : ""}" data-row="${esc(r.id)}">
<span class="ps">${esc(starter ? pos0(p) || "—" : rank)}</span>
<span class="who"><span class="nm">${esc(p.name)}</span><span class="pp">${esc(p.pos ?? "")}</span>${statusChip(p.status)}</span>
${numBox(team, r, "m", mk?.m)}${numBox(team, r, "d", mk?.d)}
<span class="r">${proj}</span>
<span class="why"><span class="stag k-${b.tag}">${b.word}</span>${esc(b.text)}</span>
<span class="tgl"><button class="tg s${starter ? " on" : ""}" type="button" data-s="${esc(r.id)}" data-team="${esc(team)}" title="${starter ? "Starting. Click to send him to the bench" : "Click to mark him a starter (S)"}">S</button><span class="cs">${rmark}</span></span>
<span class="tgl"><button class="tg o" type="button" data-out="${esc(r.id)}" data-team="${esc(team)}" title="Click to mark him Out">Out</button><span class="cs">${omark}</span></span>
</div>`;
}

/** One man in the Out list: his status and where it comes from; the Out toggle brings him back. */
function outRow(team, r, T, mk) {
  const p = r.p, theirs = T.tonight.includes(r.id), st = STATUS(p.status);
  const src = theirs ? `<span class="stag k-tg">TwoGun</span>${esc(st ? `${st.toLowerCase()} on TwoGun's board` : "out on TwoGun's board")}` : mk?.out?.news ? `<span class="stag k-ch">News</span>${esc(mk.out.news)}` : `<span class="stag k-you">Yours</span>you marked him Out`; // an Out the lineup news made is the news's, not his
  const omark = mk?.out ? chip(team, r.id, "out", mk.out, "in") : "";
  return `<div class="oline" data-row="${esc(r.id)}"><span class="ps">${esc(pos0(p) || "—")}</span><span class="onm">${esc(p.name)}</span>
<span class="tgl"><button class="tg o on" type="button" data-out="${esc(r.id)}" data-team="${esc(team)}" title="Out. Click to bring him back in">Out</button><span class="cs">${omark}</span></span>
<div class="why">${src}${isNum(p.healthy) && p.healthy > 0 ? ` &middot; usual ${f1(p.healthy)} min` : ""}</div></div>`;
}

const HEAD = (first) => `<div class="hd"><span>${first}</span><span>Player</span><span>Min</span><span>DK/min</span><span class="r">Proj</span><span>Where his minutes come from</span><span class="c">S</span><span class="c">Out</span></div>`;
const sumMin = (rows) => rows.reduce((s, r) => s + (isNum(r.min) ? r.min : 0), 0);

/** A roles note in the side column's width: the no-chart sentence says the same in fewer words, so it holds one line. */
const shortNote = (n) => (/^Starters by TwoGun's flag and Tonight's minutes: no depth chart for (?:[A-Z]{2,4}|this team)\.$/.test(n) ? "No depth chart: starters by TwoGun's flag and minutes." : n);

/** The team's sections and side column. */
function teamBody(model, code) {
  const T = model.TEAMS[code], S = model.ST[code], res = calc(T, S, S.outs), marks = marksOf(T, S);
  const rows = res.rows, playing = rows.filter((r) => !r.out);
  const starters = playing.filter((r) => r.role === "starter").sort((a, b) => posRank(a.p) - posRank(b.p) || (b.min ?? 0) - (a.min ?? 0));
  const rest = playing.filter((r) => r.role !== "starter");
  const inRot = rest.filter((r) => isNum(r.min) && r.min > 0).sort((a, b) => (b.min ?? 0) - (a.min ?? 0) || (a.p.order ?? 0) - (b.p.order ?? 0));
  const notRot = rest.filter((r) => !inRot.includes(r)).sort((a, b) => (b.p.healthy ?? 0) - (a.p.healthy ?? 0));
  const outs = rows.filter((r) => r.out).sort((a, b) => (b.p.healthy ?? 0) - (a.p.healthy ?? 0));
  const notes = [];
  if (starters.length > 5) notes.push(`${starters.length} starters marked: unmark one.`);
  else if (starters.length < 5) notes.push(`Only ${starters.length} starters: mark a man S.`);
  for (const n of String(res.roles_note ?? "").split(/(?<=\.)\s+/).filter(Boolean).map(shortNote)) if (!notes.some((x) => x.slice(0, 12) === n.slice(0, 12)) && !/starters marked|Only \d starters/.test(n)) notes.push(n);
  const auto = calc(T, { ...S, pins: {} }, T.tonight).totals;
  const typedAdd = (res.totals.min ?? 0) - (auto.min ?? 0);
  const main = `<section class="box"><h2>Starters <small>${starters.length} &middot; ${f1(sumMin(starters))} min</small></h2>${HEAD("Pos")}${starters.map((r) => manRow(code, r, T, S, marks[r.id], "")).join("") || `<div class="none">Nobody is starting. Mark five men S.</div>`}</section>
<section class="box"><h2>Bench <small>rotation order &middot; ${f1(sumMin(inRot))} min</small></h2>${HEAD("#")}${inRot.map((r, i) => manRow(code, r, T, S, marks[r.id], String(6 + i))).join("") || `<div class="none">Nobody on the bench has minutes.</div>`}${notRot.length ? `<div class="sub">Not in the rotation</div>${notRot.map((r) => manRow(code, r, T, S, marks[r.id], "")).join("")}` : ""}</section>`;
  const src = S.source ?? "twogun";
  const srcBox = T.depth ? `<section class="box"><h2>Minutes for the optimizer</h2><div class="srcs">${MINUTE_SOURCES.map((k) => `<button class="sv${k === src ? " on" : ""}" type="button" data-source="${k}" data-team="${esc(code)}">${SOURCE_LABEL[k]}</button>`).join("")}<button class="sv all" type="button" data-source-all="${src}" data-team="${esc(code)}" title="Use ${esc(SOURCE_LABEL[src])} on every team with a depth chart">All teams</button></div></section>` : "";
  const side = `<section class="box"><h2>Team total</h2><div class="tot">
<div class="big"><span>Minutes tonight</span><b class="${Math.abs(typedAdd) >= 0.05 ? "warn" : ""}">${f1(res.totals.min) ?? "—"} min</b></div>
<div><span>Without your marks</span><b>${f1(auto.min) ?? "—"} min</b></div>
${Math.abs(typedAdd) >= 0.05 ? `<div class="warn"><span>Your marks add</span><b>${typedAdd > 0 ? "+" : ""}${f1(typedAdd)}</b></div>` : ""}
<div><span>Team projection</span><b>${f1(res.totals.proj) ?? "—"} pts</b></div></div>
${notes.length ? `<ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}</section>
<section class="box"><h2>Out / injured <small>${outs.length} ${outs.length === 1 ? "man" : "men"}</small></h2>${outs.map((r) => outRow(code, r, T, marks[r.id])).join("") || `<div class="none">Nobody is out.</div>`}</section>${srcBox}`;
  return { main, side, marks: Object.keys(marks).length };
}

/** The team switcher: each game's two teams together, the team on show filled in its colour, a dot on a team that holds his marks. */
function switcherHtml(model, cur, games, colourOf) {
  const btn = (t) => {
    const n = model.TEAMS[t] ? Object.keys(marksOf(model.TEAMS[t], model.ST[t])).length : 0;
    return `<button class="tm${t === cur ? " on" : ""}" type="button" data-team-go="${esc(t)}" style="--tc:${colourOf(t)}" title="${esc(TEAM_NAMES[t] ?? t)}${n ? `: ${n} of your marks` : ""}">${logo(t, "sw")}<b>${esc(t)}</b>${n ? `<i class="dot"></i>` : ""}</button>`;
  };
  return `<nav class="teams" aria-label="Teams">${games.filter((g) => model.TEAMS[g.away] || model.TEAMS[g.home]).map((g) => `<span class="gm">${btn(g.away)}<span class="at">@</span>${btn(g.home)}</span>`).join("")}</nav>`;
}

/**
 * The whole screen for team `code`. opts: { games (the inputs' games, in tip order), colourOf(team), when(tip) -> "7:30 PM ET", slate, sync (console-auto.js
 * c.sync), canUndo, canRedo, saveErr }.
 */
export function depthHtml(model, code, opts) {
  const T = model.TEAMS[code], g = opts.games.find((x) => x.away === code || x.home === code), opp = T.opp;
  const { main, side } = teamBody(model, code);
  const words = syncWords(opts.sync), syncText = `<span class="sync ${words.cls}" title="${esc([words.text, ...words.lines].join(" · "))}"><i></i>${esc(words.text)}</span>`;
  const held = words.lines.length ? `<ul class="heldline">${words.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : "";
  const head = `<header class="thead" style="--tc:${opts.colourOf(code)}">${logo(code, "xl")}<div class="tn"><h1>${esc(TEAM_NAMES[code] ?? code)}</h1><div class="vs">${T.home ? "vs" : "@"} ${logo(opp, "xs")}<b>${esc(TEAM_NAMES[opp] ?? opp)}</b>${g?.tip ? ` &middot; ${esc(opts.when(g.tip) ?? g.tip)}` : ""}</div></div>
<div class="grow"></div><div class="acts">${syncText}<button class="ub" type="button" data-hist="-1"${opts.canUndo ? "" : " disabled"} title="Undo (Ctrl+Z)">&#8630; Undo</button><button class="ub" type="button" data-hist="1"${opts.canRedo ? "" : " disabled"} title="Redo (Ctrl+Y)">Redo &#8631;</button></div></header>`;
  const err = opts.saveErr ? `<div class="errline">${esc(opts.saveErr)}</div>` : "";
  return `${switcherHtml(model, code, opts.games, opts.colourOf)}${head}${held}${err}<p class="note">Every change goes to the board and the optimizer at once. Type a man's minutes or DK/min and his projection follows (minutes &times; DK/min). The &#8634; chip on a number you set drops it, and he goes back to the live figure.</p><div class="wrap"><div class="mainc">${main}</div><aside>${side}</aside></div>`;
}
