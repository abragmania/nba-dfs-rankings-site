// The one copy of three small checks shared by the page and the server: overrides, the console's engine, inputs and storing. Pure.

/** A finite number. */
export const isNum = (v) => typeof v === "number" && Number.isFinite(v);
/** A plain object: not null, not a list. */
export const isPlain = (v) => v != null && typeof v === "object" && !Array.isArray(v);
/** The one test for a man Out (RULES R4): an injury status of OUT or O, any case, spaces ignored. Takes the status text, not the player. Doubtful is not Out. */
export const isOut = (status) => /^(out|o)$/i.test(String(status ?? "").trim());
/** Out or Doubtful (D, DOUBTFUL): the board's "sitting" statuses. Doubtful is a flag only; only isOut removes a man from a lineup. */
export const isSitting = (status) => isOut(status) || /^(d|doubtful)$/i.test(String(status ?? "").trim());
/** A team's console work with nothing in it, as stored. */
export const EMPTY_RECORD = () => ({ saved: [], pins: {}, handouts: {}, combos: {} });
/** "a" or "an" before a team code, as it is said. */
export const aOrAn = (code) => (/^[AEIO]/.test(code) ? "an" : "a");
/** To hundredths, the slate's own precision. */
export const round2 = (v) => Math.round(v * 100) / 100;
/** Tonight's expected DK points per minute: projection over minutes. Null with either missing or on zero minutes, never zero. */
export const tonightRate = (projection, minutes) => (isNum(projection) && isNum(minutes) && minutes > 0 ? projection / minutes : null);
