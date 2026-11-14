// The console's command box: text to { msg, run }. `run` is null when the text cannot be carried out, and msg says why. It reads the
// model through `c` and acts only through the actions on `c`, so the page wires it up once and the tests can drive it.
import { keyOf } from "./console-engine.js";
import { label, lastName, plain, savedFor } from "./console-model.js";
import { aOrAn } from "./figures.js";

export const FN = { m: "min", u: "usg", d: "dk/min", p: "proj" };
const FMAP = { m: "m", min: "m", minutes: "m", u: "u", usg: "u", usage: "u", d: "d", dk: "d", rate: "d", p: "p", proj: "p", projection: "p" };
export const fmtv = (k, v) => (k === "d" ? v.toFixed(2) : (Math.round(v * 10) / 10).toFixed(1));
const isNumber = (s) => /^\d+(\.\d+)?$/.test(s ?? "");

/** A man by the start of his last name (an exact last name first), then the start of any part of his name; the current team first. */
export function findPlayer(c, tok) {
  const order = [c.G.cur, ...Object.keys(c.model.TEAMS).filter((t) => t !== c.G.cur)];
  const score = (p) => {
    const last = plain(lastName(p.name));
    if (last === tok) return 0;
    if (last.startsWith(tok)) return 1;
    return plain(p.name).split(/[\s-]+/).some((w) => w.startsWith(tok)) ? 2 : 3;
  };
  for (const rank of [0, 1, 2]) {
    for (const t of order) {
      const hit = c.model.TEAMS[t].pl.find((p) => score(p) === rank);
      if (hit) return { t, p: hit };
    }
  }
  return null;
}

/** A man by the start of his first and last names, "jaylin williams", for two men sharing a last name; null when no one matches. */
function findByFullName(c, first, last) {
  for (const t of [c.G.cur, ...Object.keys(c.model.TEAMS).filter((x) => x !== c.G.cur)]) {
    const hit = c.model.TEAMS[t].pl.find((p) => plain(p.name).startsWith(first) && plain(lastName(p.name)).startsWith(last));
    if (hit) return { t, p: hit };
  }
  return null;
}

function parseShare(c, w) {
  const sitter = findPlayer(c, w[1] ?? "");
  if (!sitter) return { msg: `share: no player matches "${w[1] ?? ""}"`, run: null };
  const { t, p } = sitter;
  if (w[2] === "clear") return { msg: `clear ${p.name}'s hand-out edits`, run: () => c.clearShare(t, p.id) };
  const to = c.model.TEAMS[t].pl.find((x) => x.id !== p.id && plain(lastName(x.name)).startsWith(w[2] ?? "\0"));
  if (!to) return { msg: `share: name ${aOrAn(t)} ${t} teammate after ${lastName(p.name)}, then a percent`, run: null };
  const kind = w[3] === "u" || w[3] === "usg" || w[3] === "usage" ? "u" : "m";
  const num = kind === "u" ? w[4] : w[3];
  if (!isNumber(num) || +num > 100) return { msg: "share: need a percent from 0 to 100", run: null };
  const already = c.model.TEAMS[t].tonight.includes(p.id) ? `${lastName(p.name)} is out Tonight, so his hand-out is already in the board's minutes and this edit changes nothing: ` : "";
  return { msg: `${already}${t} ${lastName(p.name)} hands ${num}% of his ${FN[kind]} to ${lastName(to.name)}`, run: () => c.setShare(t, p.id, kind, to.id, +num) };
}

function parseCombo(c, w) {
  const key = keyOf(c.model.ST[c.G.cur].outs);
  if (key.split("+").length < 2) return { msg: "combo: put two or more men out first", run: null };
  if (w[1] === "save") return { msg: `save ${c.G.cur} ${label(c.model.TEAMS[c.G.cur], key)} as its combination table`, run: () => c.saveCombo(c.G.cur, key) };
  if (w[1] === "clear") return { msg: `clear ${c.G.cur} ${label(c.model.TEAMS[c.G.cur], key)} combination table`, run: () => c.clearCombo(c.G.cur, key) };
  return { msg: "combo save, or combo clear", run: null };
}

function parseWord(c, word) {
  const code = word.toUpperCase();
  if (c.model.TEAMS[code]) return { msg: `go to ${code}`, run: () => c.jumpTeam(code) };
  if (word === "slate" || word === "team") return { msg: `${word} view`, run: () => c.setView(word) };
  if (word === "undo") return { msg: "undo", run: c.undo };
  if (word === "redo") return { msg: "redo", run: c.redo };
  if (word === "reset") return { msg: "reset scenario pins", run: c.resetScenario };
  if (word === "apply") return { msg: "preview sending Tonight to the board", run: c.openApply };
  if (word === "reverse" || word === "unapply") return { msg: "take back what Apply set", run: c.reverse };
  return null;
}

/** Text -> { msg, run }, or null for empty text. */
export function parseCmd(c, text) {
  const s = plain(text).trim();
  if (!s) return null;
  const w = s.split(/\s+/);
  if (w.length === 1) {
    const hit = parseWord(c, w[0]);
    if (hit) return hit;
  }
  if (w[0] === "share") return parseShare(c, w);
  if (w[0] === "combo") return parseCombo(c, w);
  const T = c.model.TEAMS[c.G.cur], S = c.model.ST[c.G.cur];
  if (T) {
    const sk = savedFor(T, S).find((k) => plain(label(T, k)) === s || plain(label(T, k)).replace(/ out$/, "") === s);
    if (sk !== undefined) return { msg: `${c.G.cur} scenario ${label(T, sk)}`, run: () => { c.G.view = "team"; c.setScenario(c.G.cur, sk); } };
  }
  const full = w.length > 1 ? findByFullName(c, w[0], w[1]) : null;
  const f = full ?? findPlayer(c, w[0]);
  if (!f) return { msg: `no player or command matches "${w[0]}"`, run: null };
  const { t, p } = f, id = p.id, rest = w.slice(full ? 2 : 1), nm = `${t} ${p.name}`;
  const go = (fn) => () => { c.G.cur = t; c.G.view = "team"; c.G.focus = { team: t, id, k: c.G.focus.k }; fn(); };
  if (!rest.length) return { msg: `focus ${nm}`, run: go(() => c.render()) };
  if (rest[0] === "out" || rest[0] === "in") {
    const want = rest[0] === "out", has = c.model.ST[t].outs.includes(id);
    return { msg: `${nm}${want ? " out" : " back in"}${want === has ? " (already)" : ""}`, run: want === has ? null : go(() => c.toggleOut(t, id)) };
  }
  if (rest[0] === "clear" || rest[0] === "x") {
    const fk = FMAP[rest[1]];
    return { msg: `clear ${nm} pin ${fk ? FN[fk] : "(all)"}`, run: go(() => c.clearPin(t, id, fk ?? null)) };
  }
  let fk = "m", num = rest[0];
  if (FMAP[rest[0]]) { fk = FMAP[rest[0]]; num = rest[1]; }
  if (!isNumber(num)) return { msg: `need a number after "${rest.join(" ")}"`, run: null };
  const v = parseFloat(num);
  if (c.model.ST[t].outs.includes(id)) return { msg: `${nm} is out in this scenario; bring him in first`, run: null };
  return { msg: `pin ${nm} ${FN[fk]} = ${fmtv(fk, v)}`, run: go(() => { c.G.focus.k = fk; c.setPin(t, id, fk, v); }) };
}
