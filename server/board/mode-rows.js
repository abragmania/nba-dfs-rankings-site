// A board row's figures per mode (Adam 1:24 PM ET 11-20: thumbs and stars are kept per mode; server/slate/mode-marks.js). The server answers each
// row with its shared figures on top (GPP's thumbs and stars applied, the mode a reader that names none works on) and `modes`: for Cash and GPP the
// fields a thumb or a star moves, as that mode's merge gives them. The page shows a row in the mode on show (inMode); an Entries re-fill scores a
// spot in its own mode the same way. Pure, no imports: the page and the server load it.

export const ROW_MODES = Object.freeze(["Cash", "GPP"]);
/** The row fields a thumb or a star changes (server/slate/overrides.js mergeOverrides): what each mode's part holds. */
export const MODE_KEYS = Object.freeze(["projection", "value", "proj_own", "base", "ovr", "starred"]);
// base and ovr are on a row only when he has a number of his own: a part's null for them means "not on this row".
const ABSENT_WHEN_NULL = new Set(["base", "ovr"]);

/** One mode's part of a merged row: every MODE_KEYS field (null when the row lacks it); unknown: the mode's thumbs and stars could not be read. Pure. */
export function modePart(row, unknown = false) {
  const part = Object.fromEntries(MODE_KEYS.map((k) => [k, row && k in row ? row[k] : null]));
  return unknown ? { ...part, marks_unknown: true } : part;
}

/**
 * The rows on top with each mode's part attached: byMode { Cash, GPP }, each that mode's merged rows in the same order as `top` (the same players
 * merged), unknown { mode: true } for a mode whose rows are the shared figures only because its thumbs and stars could not be read. Pure.
 */
export function withModes(top, byMode, unknown = {}) {
  return top.map((p, i) => ({ ...p, modes: Object.fromEntries(ROW_MODES.map((m) => [m, modePart(byMode[m][i], unknown[m] === true)])) }));
}

/** The row as the mode on show has it: that mode's part over the shared row; a row with no parts (an older answer) as it is. A new object; pure. */
export function inMode(row, mode) {
  const part = row?.modes?.[mode];
  if (!part) return row;
  const next = { ...row };
  for (const k of MODE_KEYS) {
    if (part[k] == null && ABSENT_WHEN_NULL.has(k)) delete next[k];
    else next[k] = part[k];
  }
  if (part.marks_unknown) next.marks_unknown = true; else delete next.marks_unknown;
  return next;
}

/** The board's id -> row map with every row in `mode` (a card of the other mode is drawn and swapped on its own mode's figures). Pure: a new Map. */
export const byIdInMode = (byId, mode) => new Map([...byId].map(([id, p]) => [id, inMode(p, mode)]));

/** Whether a mode's thumbs and stars could not be read (its part is marked marks_unknown on the rows). Pure. */
export const marksUnknownIn = (rows, mode) => [...(rows ?? [])].some((p) => p?.modes?.[mode]?.marks_unknown === true);
