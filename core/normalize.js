// (from csv-contact-cleaner, github.com/Nuxy1/csv-contact-cleaner)
// Field normalisers. Each returns { value, ok, note }: `ok` false when the input can't be trusted (the row is then
// flagged, not silently changed), `note` saying what was done.

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const PARTICLES = new Set(["van", "von", "der", "den", "de", "del", "della", "da", "di", "la", "le", "bin", "al"]);
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

export function email(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { value: "", ok: true, note: "" };
  // (common typos of the big providers, fixed only when unambiguous)
  const value = text.toLowerCase().replace(/^mailto:/, "").replace(/@gmial\.com$|@gamil\.com$|@gmail\.co$/, "@gmail.com").replace(/@hotmial\.com$/, "@hotmail.com");
  if (!EMAIL.test(value)) return { value: text, ok: false, note: "invalid email" };
  return { value, ok: true, note: value === text ? "" : "email tidied" };
}

export function phone(raw, countryCode = "1") {
  const text = String(raw ?? "").trim();
  if (!text) return { value: "", ok: true, note: "" };
  const digits = text.replace(/\D/g, "");
  let value;
  if (text.startsWith("+")) value = `+${digits}`;
  else if (digits.startsWith("00")) value = `+${digits.slice(2)}`;
  else if (digits.startsWith("0")) value = `+${countryCode}${digits.slice(1)}`;
  else if (digits.length <= 10) value = `+${countryCode}${digits}`;
  else value = `+${digits}`;
  if (digits.length < 7 || value.length > 16) return { value: text, ok: false, note: "invalid phone" };
  return { value, ok: true, note: value === text ? "" : "phone to E.164" };
}

function properCase(word) {
  if (/^(ii|iii|iv)$/i.test(word)) return word.toUpperCase();
  return word.toLowerCase()
    .replace(/(^|[-'])(\p{L})/gu, (_, mark, letter) => mark + letter.toUpperCase())
    .replace(/^Mc(\p{L})/u, (_, letter) => `Mc${letter.toUpperCase()}`);
}

// A name re-cased only when typed all caps or all lower; first/last split with particles kept with the surname.
export function name(raw) {
  let text = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { value: "", first: "", last: "", ok: true, note: "" };
  let swapped = false;
  const parts = text.split(",").map((part) => part.trim());
  // ("Chen, Wei" typed last-name-first; not "Sam Rivers, Jr.")
  if (parts.length === 2 && parts[1] && !/^(jr|sr|ii|iii|iv|phd|md)\.?$/i.test(parts[1])) {
    text = `${parts[1]} ${parts[0]}`;
    swapped = true;
  }
  const recase = text === text.toUpperCase() || text === text.toLowerCase();
  const words = text.split(" ").map((word) => (PARTICLES.has(word.toLowerCase()) ? word.toLowerCase() : recase ? properCase(word) : word));
  let lastStart = words.length - 1;
  while (lastStart > 1 && PARTICLES.has(words[lastStart - 1].toLowerCase())) lastStart--;
  const value = words.join(" ");
  return {
    value,
    first: words.length > 1 ? words.slice(0, lastStart).join(" ") : value,
    last: words.length > 1 ? words.slice(lastStart).join(" ") : "",
    ok: true,
    note: swapped ? "name was last, first" : value === text ? "" : "name re-cased",
  };
}

// A calendar date to YYYY-MM-DD. `order` MDY or DMY decides 03/04; a day over 12 or dots (27.10.2026) decide alone.
export function date(raw, order = "MDY") {
  const text = String(raw ?? "").trim();
  if (!text) return { value: "", ok: true, note: "" };
  let y, m, d, match;
  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text))) [y, m, d] = match.slice(1).map(Number);
  else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(text))) {
    const [a, b, c] = match.slice(1).map(Number);
    const dayFirst = order === "DMY" || text.includes(".") || a > 12;
    [d, m] = dayFirst ? [a, b] : [b, a];
    y = c < 100 ? 2000 + c : c;
  } else {
    const words = text.toLowerCase().replace(/,/g, " ");
    const mon = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?/.exec(words);
    const year = /\b(\d{4})\b/.exec(words);
    const day = year && /\b(\d{1,2})(?:st|nd|rd|th)?\b/.exec(words.replace(year[0], " "));
    if (!mon || !year || !day) return { value: text, ok: false, note: "unreadable date" };
    [y, m, d] = [Number(year[1]), MONTHS[mon[1]], Number(day[1])];
  }
  const check = new Date(Date.UTC(y, m - 1, d));
  if (m < 1 || m > 12 || check.getUTCDate() !== d) return { value: text, ok: false, note: "impossible date" };
  const value = check.toISOString().slice(0, 10);
  return { value, ok: true, note: value === text ? "" : "date to ISO" };
}
