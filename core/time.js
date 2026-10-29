// Business time: local dates and hours in the business's time zone (daylight saving included), so a reminder isn't a
// day early for a shop in Minnesota and nobody gets a text at 3 a.m. No libraries: Intl does the zone math.
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

// The local clock in `timeZone`: { y, m, d, hour, minute, weekday (1 Mon .. 7 Sun), date: "YYYY-MM-DD" }.
export function local(at, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(at).map((p) => [p.type, p.value]));
  const [y, m, d] = [Number(parts.year), Number(parts.month), Number(parts.day)];
  return { y, m, d, hour: Number(parts.hour), minute: Number(parts.minute), weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday) + 1, date: `${parts.year}-${parts.month}-${parts.day}` };
}

// The instant it is `hour`:`minute` on local date "YYYY-MM-DD" in `timeZone`.
export function at(date, timeZone, hour = 0, minute = 0) {
  const [y, m, d] = date.split("-").map(Number);
  let guess = Date.UTC(y, m - 1, d, hour, minute);
  for (let i = 0; i < 2; i++) {
    const seen = local(new Date(guess), timeZone);
    guess += Date.UTC(y, m - 1, d, hour, minute) - Date.UTC(seen.y, seen.m - 1, seen.d, seen.hour, seen.minute);
  }
  return new Date(guess);
}

// Whole local days from date a to date b ("YYYY-MM-DD"), whatever the clocks did in between.
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

// Quiet hours: [from, to) local hours nobody is messaged in (e.g. [20, 9]: 8 p.m. to 9 a.m.). When `time` falls in
// them, the first allowed moment after it; otherwise `time` itself.
export function outsideQuiet(time, timeZone, [from, to]) {
  const { hour, date } = local(time, timeZone);
  const quiet = from > to ? hour >= from || hour < to : hour >= from && hour < to;
  if (!quiet) return time;
  const next = hour >= to && from > to ? at(addDays(date, 1), timeZone, to) : at(date, timeZone, to);
  return next > time ? next : at(addDays(date, 1), timeZone, to);
}

export const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
