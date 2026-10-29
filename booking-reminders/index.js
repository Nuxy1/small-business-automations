// Booking reminders: a booking made online (the booking tool's webhook) gets a confirmation at once with a link to
// move or cancel it; a reminder the day before and another 2 hours before, never in quiet hours (a 2-hour reminder that
// would land at night is skipped: the day-before one already went). A moved booking gets its reminders moved, a
// cancelled one gets none, and every morning the owner gets the day's schedule. Messy names, emails and phones are
// cleaned; a booking with no usable email goes to the owner to confirm by hand.
import * as normalize from "../core/normalize.js";
import { HOUR, local, outsideQuiet } from "../core/time.js";

export const DEFAULTS = { timeZone: "America/Chicago", quiet: [20, 9], dayBefore: 24, hoursBefore: 2, scheduleAt: 7 };

export function bookingReminders({ store, mail, business, now = () => new Date(), ...options }) {
  const cfg = { ...DEFAULTS, ...options };
  const bookings = (store.state.bookings ??= {});
  const when = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: cfg.timeZone, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  const hi = (b) => `Hi ${b.name.split(" ")[0] || "there"},`;

  return {
    // A booking made, moved or cancelled: { id, name, email, phone, service, start (ISO), status }.
    async booked(raw) {
      const email = normalize.email(raw.email);
      const name = normalize.name(raw.name).value;
      const start = new Date(raw.start);
      if (!raw.id || Number.isNaN(start.getTime())) {
        await mail.tell(`A booking couldn't be read`, `It had no id or an unreadable time, so nothing was sent:\n${JSON.stringify(raw)}`);
        return "unreadable";
      }
      const before = bookings[raw.id];
      const b = { id: raw.id, name, email: email.ok ? email.value : "", phone: normalize.phone(raw.phone).value, service: String(raw.service ?? "").trim(), start: start.toISOString(), status: /cancel/i.test(raw.status ?? "") ? "cancelled" : "booked" };
      bookings[raw.id] = b;
      store.save();
      if (b.status === "cancelled") {
        if (b.email) await mail.once(`booking:${b.id}:cancelled`, { to: b.email, subject: `Cancelled: ${b.service} at ${business.name}`, text: `${hi(b)}\n\nYour ${b.service} on ${when(b.start)} is cancelled, and you won't get any reminders for it. Whenever you'd like a new time: ${business.book}\n\n${business.signature}` });
        await mail.once(`booking:${b.id}:owner-cancelled`, { to: business.owner, subject: `Cancelled: ${b.name}, ${when(b.start)}`, text: `${b.name} cancelled ${b.service} on ${when(b.start)}. The time is free again.` });
        return "cancelled";
      }
      if (!b.email) {
        await mail.once(`booking:${b.id}:no-email:${b.start}`, { to: business.owner, subject: `Confirm by hand: ${b.name || "a booking"}, ${when(b.start)}`, text: `The booking has no usable email ("${raw.email ?? ""}"), so no confirmation or reminders can go out. Phone: ${b.phone || "(none)"}` });
        return "no-email";
      }
      const moved = before && before.start !== b.start && before.status !== "cancelled";
      // (keys carry the start time: a moved booking gets a new confirmation and new reminders; the old ones never go)
      await mail.once(`booking:${b.id}:confirm:${b.start}`, {
        to: b.email,
        subject: `${moved ? "Moved" : "Booked"}: ${b.service}, ${when(b.start)}`,
        text: `${hi(b)}\n\n${moved ? `Your ${b.service} is moved to` : `You're booked for ${b.service} on`} ${when(b.start)} at ${business.name}, ${business.address}.\n\nNeed to change it? ${business.book}\n\n${business.signature}`,
      });
      if (!before || moved) await mail.once(`booking:${b.id}:owner:${b.start}`, { to: business.owner, subject: `${moved ? "Moved" : "New booking"}: ${b.name}, ${when(b.start)}`, text: `${b.service} for ${b.name} (${b.email}${b.phone ? `, ${b.phone}` : ""}).${moved ? ` It was ${when(before.start)}.` : ""}` });
      return moved ? "moved" : "booked";
    },

    // Run it every few minutes: due reminders go out, and the owner's schedule each morning.
    async tick() {
      const time = now();
      const today = local(time, cfg.timeZone);
      const quietNow = outsideQuiet(time, cfg.timeZone, cfg.quiet) > time;
      for (const b of Object.values(bookings)) {
        if (b.status !== "booked" || !b.email || time >= new Date(b.start)) continue;
        const start = new Date(b.start);
        const dayBefore = outsideQuiet(new Date(start - cfg.dayBefore * HOUR), cfg.timeZone, cfg.quiet);
        const soon = new Date(start - cfg.hoursBefore * HOUR);
        const soonQuiet = outsideQuiet(soon, cfg.timeZone, cfg.quiet) > soon;
        if (!quietNow && time >= dayBefore && dayBefore < soon) {
          await mail.once(`booking:${b.id}:day-before:${b.start}`, { to: b.email, subject: `See you tomorrow: ${b.service}`, text: `${hi(b)}\n\nA reminder that you're booked for ${b.service} ${when(b.start)} at ${business.name}.\n\nCan't make it? Move or cancel here so someone else can have the time: ${business.book}\n\n${business.signature}` });
        }
        if (!quietNow && !soonQuiet && time >= soon) {
          await mail.once(`booking:${b.id}:soon:${b.start}`, { to: b.email, subject: `In 2 hours: ${b.service}`, text: `${hi(b)}\n\nSee you at ${new Date(b.start).toLocaleTimeString("en-US", { timeZone: cfg.timeZone, hour: "numeric", minute: "2-digit" })} at ${business.name}, ${business.address}.\n\n${business.signature}` });
        }
      }
      if (today.hour >= cfg.scheduleAt) {
        const list = Object.values(bookings).filter((b) => b.status === "booked" && local(new Date(b.start), cfg.timeZone).date === today.date).sort((a, c) => a.start.localeCompare(c.start));
        if (list.length) {
          await mail.once(`schedule:${today.date}`, {
            to: business.owner,
            subject: `Today: ${list.length} appointment${list.length === 1 ? "" : "s"}`,
            text: list.map((b) => `${new Date(b.start).toLocaleTimeString("en-US", { timeZone: cfg.timeZone, hour: "numeric", minute: "2-digit" }).padStart(8)}  ${b.name}  ${b.service}${b.phone ? `  ${b.phone}` : ""}`).join("\n"),
          });
        }
      }
    },

    // For the timeline: whether a 2-hour reminder was skipped for landing in quiet hours.
    skippedSoon(id) {
      const b = bookings[id];
      const soon = new Date(new Date(b.start) - cfg.hoursBefore * HOUR);
      return outsideQuiet(soon, cfg.timeZone, cfg.quiet) > soon;
    },
  };
}
