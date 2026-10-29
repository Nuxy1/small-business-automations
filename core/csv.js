// (from csv-contact-cleaner, github.com/Nuxy1/csv-contact-cleaner)
// RFC 4180 CSV: quoted fields, "" inside quotes, commas and newlines inside quotes, CRLF or LF, a UTF-8 BOM.

// Bytes from a file as text: UTF-8, or Windows-1252 when they aren't valid UTF-8 (older Excel saves that way, and
// "José" would otherwise reach a customer as "Jos�").
export function decode(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

// Each row keeps the line it starts on in the file (row.line), so a problem can point at the right spreadsheet row.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        if (ch === "\n" || (ch === "\r" && text[i + 1] !== "\n")) line++;
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      row.line = start;
      rows.push(row);
      row = [];
      field = "";
      start = ++line;
    } else {
      field += ch;
    }
  }
  if (quoted) throw new Error(`there's an unclosed quote in the row starting on line ${start}`);
  if (field !== "" || row.length) {
    row.push(field);
    row.line = start;
    rows.push(row);
  }
  return rows.filter((r) => r.some((value) => value.trim() !== ""));
}

// A column name as compared: no case, no extra spaces ("Customer  email " is "customer email").
export const key = (name) => String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");

// Rows as objects keyed by the header row's names (as key() writes them). need: names the header must have; lines
// above it (a report's title and date) are skipped, and with no such row it throws. A short row is padded, an
// over-long one is reported; __line is its line in the file.
export function toRecords(rows, need = []) {
  if (!rows.length) return [];
  const want = need.map(key);
  const at = rows.findIndex((r) => want.every((w) => r.some((name) => key(name) === w)));
  if (at < 0) throw new Error(`it has no header row with the columns ${need.map((n) => `"${n}"`).join(", ")} (its first row is: ${rows[0].join(", ").slice(0, 120)})`);
  const names = rows[at].map(key);
  return rows.slice(at + 1).map((values, index) => {
    const record = {};
    names.forEach((name, column) => (record[name] = (values[column] ?? "").trim()));
    if (values.length > names.length) record.__extra = values.slice(names.length);
    record.__line = values.line ?? at + index + 2;
    return record;
  });
}
