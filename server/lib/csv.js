// Copied once from NFLDFSRankings server/lib/csv.js at ea6cb52 (2026-10-29); this project's own copy from here on.
// Minimal CSV parser: strips a UTF-8 BOM, handles quoted fields (commas, doubled "" inside quotes, and
// newlines embedded inside a quoted field), CRLF and LF line endings, and skips blank lines. Scans the
// whole text rather than splitting on newlines first, since a quoted field can legitimately contain one.
// Returns {headers, rows, warnings}; warns (rather than throwing) on an unterminated quoted field so a
// truncated or corrupt upload is reported, not silently misparsed. No external dependencies.
// Optional `columns` (array or Set of header names): only those columns become keys of each row object, which keeps
// a wide file (nflverse play-by-play has about 370 columns) small in memory. `headers` is always the full header row.

export function parseCsv(text, { columns } = {}) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const warnings = [];
  const rows = [];
  let headers = [];
  let started = false;
  const wanted = columns ? new Set(columns) : null;
  let keep = null; // header indices to keep when `columns` is given

  let field = "";
  let row = [];
  let inQuotes = false;

  function endField() {
    row.push(field);
    field = "";
  }

  function endRow() {
    endField();
    const isBlank = row.length === 1 && row[0].trim() === "";
    if (!isBlank) {
      if (!started) {
        headers = row;
        started = true;
        if (wanted) keep = headers.map((h, i) => (wanted.has(h) ? i : -1)).filter((i) => i >= 0);
      } else {
        const obj = {};
        if (keep) for (const i of keep) obj[headers[i]] = row[i] ?? "";
        else for (let i = 0; i < headers.length; i++) obj[headers[i]] = row[i] ?? "";
        rows.push(obj);
      }
    }
    row = [];
  }

  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { endField(); i++; continue; }
    if (ch === "\r") { i++; continue; } // bare CR: swallowed, \n (if any) ends the row
    if (ch === "\n") { endRow(); i++; continue; }
    field += ch;
    i++;
  }
  if (field !== "" || row.length > 0) endRow();

  if (inQuotes) {
    warnings.push({ code: "UNTERMINATED_QUOTE", message: "The CSV had an unterminated quoted field; the file may be truncated or corrupt." });
  }

  return { headers, rows, warnings };
}
