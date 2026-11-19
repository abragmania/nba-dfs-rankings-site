// The one copy of three small checks shared by the page and the server: overrides, the console's engine, inputs and storing. Pure.

/** A finite number. */
export const isNum = (v) => typeof v === "number" && Number.isFinite(v);
/** A plain object: not null, not a list. */
export const isPlain = (v) => v != null && typeof v === "object" && !Array.isArray(v);
/** The one test for a man Out (RULES R4): an injury status of OUT or O, any case, spaces ignored. Takes the status text, not the player. Doubtful is not Out. */
export const isOut = (status) => /^(out|o)$/i.test(String(status ?? "").trim());
/** Out or Doubtful (D, DOUBTFUL): the board's "sitting" statuses. Doubtful is a flag only; only isOut removes a man from a lineup. */
export const isSitting = (status) => isOut(status) || /^(d|doubtful)$/i.test(String(status ?? "").trim());
/**
 * Whether a man is Out for a lineup: his own call first (p.his, stamped by server/slate/out-pool.js from his console and Minutes-page marks: "in" beats every outside Out, "out" beats every outside In),
 * else, with `engine`, our minutes engine's playing === false (its Outs come from our own injury feeds only). TwoGun's injury status never counts (Adam 11-19, 3:18 PM ET: "DO NOT TRUST TWOGUN").
 * Pure. One copy for the optimizer, the lineup cards, late swap and the board.
 */
export const outFor = (p, { engine = false } = {}) => (p?.his === "in" ? false : p?.his === "out" ? true : engine && p?.ours?.playing === false);
/** A team's console work with nothing in it, as stored. */
export const EMPTY_RECORD = () => ({ saved: [], pins: {}, handouts: {}, combos: {} });
/** "a" or "an" before a team code, as it is said. */
export const aOrAn = (code) => (/^[AEIO]/.test(code) ? "an" : "a");
/** To hundredths, the slate's own precision. */
export const round2 = (v) => Math.round(v * 100) / 100;
/** Tonight's expected DK points per minute: projection over minutes. Null with either missing or on zero minutes, never zero. */
export const tonightRate = (projection, minutes) => (isNum(projection) && isNum(minutes) && minutes > 0 ? projection / minutes : null);
/** A man's value: projection per $1,000 of salary, unrounded; null with either missing or no salary above 0 (R1: never 0). The server's copy, slate/overrides.js valueFrom, is not loadable in the browser. */
export const valuePer1k = (projection, salary) => (isNum(projection) && Number.isInteger(salary) && salary > 0 ? (projection * 1000) / salary : null);
