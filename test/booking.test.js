import assert from "node:assert/strict";
import { test } from "node:test";
import { bookingReminders } from "../booking-reminders/index.js";
import { business as groomer } from "../booking-reminders/business.js";
import { mailer, memory } from "../core/mail.js";
import { store } from "../core/store.js";

test("bookings: confirmed at once, reminded the day before and 2 hours before, moved and cancelled bookings handled, the owner's morning schedule", async () => {
  const transport = memory();
  const s = store(null);
  let clock = new Date("2026-10-26T15:12:00Z"); // (Mon 10:12 a.m. in Minnesota)
  const mail = mailer({ transport, store: s, owner: groomer.owner, now: () => clock, wait: async () => {} });
  const book = bookingReminders({ store: s, mail, business: groomer, now: () => clock });
  const to = (who, re) => transport.sent.filter((m) => m.to === who && (!re || re.test(m.subject)));

  assert.equal(await book.booked({ id: "b1", name: "JORDAN PRICE", email: " Jordan@Example.com", phone: "507 555 0177", service: "Full groom", start: "2026-10-28T19:00:00Z" }), "booked");
  assert.match(to("jordan@example.com")[0].subject, /^Booked: Full groom, Wednesday, October 28/);
  assert.match(to("jordan@example.com")[0].text, /^Hi Jordan,/);
  assert.equal(to(groomer.owner, /New booking: Jordan Price/).length, 1);
  assert.equal(await book.booked({ id: "b1", name: "JORDAN PRICE", email: "jordan@example.com", service: "Full groom", start: "2026-10-28T19:00:00Z" }), "booked"); // (the same webhook twice)
  assert.equal(to("jordan@example.com").length, 1);

  // (the day before at 2 p.m.: the reminder; moved that afternoon: a new confirmation, and the old 2-hour reminder never goes)
  clock = new Date("2026-10-27T19:00:00Z");
  await book.tick();
  assert.equal(to("jordan@example.com", /See you tomorrow/).length, 1);
  clock = new Date("2026-10-27T21:05:00Z");
  assert.equal(await book.booked({ id: "b1", name: "Jordan Price", email: "jordan@example.com", service: "Full groom", start: "2026-10-29T16:00:00Z" }), "moved");
  assert.match(to("jordan@example.com", /^Moved/)[0].text, /moved to Thursday, October 29/);
  clock = new Date("2026-10-28T17:00:00Z"); // (Wed noon: the old booking's 2-hour time)
  await book.tick();
  assert.equal(to("jordan@example.com", /In 2 hours/).length, 0);
  clock = new Date("2026-10-28T16:00:00Z");
  await book.tick();
  assert.equal(to("jordan@example.com", /See you tomorrow/).length, 2); // (a new day-before for the new time)

  // (a 9 a.m. booking: its 2-hour reminder would be 7 a.m., quiet hours, so skipped; a cancelled one gets nothing)
  await book.booked({ id: "b2", name: "ana lima", email: "ana@example.com", service: "Nail trim", start: "2026-10-29T14:00:00Z" });
  await book.booked({ id: "b3", name: "Riley", email: "riley@example.com", service: "Bath", start: "2026-10-29T20:00:00Z" });
  await book.booked({ id: "b3", name: "Riley", email: "riley@example.com", service: "Bath", start: "2026-10-29T20:00:00Z", status: "Cancelled" });
  assert.equal(book.skippedSoon("b2"), true);
  for (const iso of ["2026-10-29T12:00:00Z", "2026-10-29T13:30:00Z", "2026-10-29T14:30:00Z", "2026-10-29T18:00:00Z", "2026-10-29T19:30:00Z"]) { clock = new Date(iso); await book.tick(); }
  assert.equal(to("ana@example.com", /In 2 hours/).length, 0);
  assert.equal(to("jordan@example.com", /In 2 hours/).length, 1);
  assert.deepEqual(to("riley@example.com").map((m) => m.subject.split(":")[0]), ["Booked", "Cancelled"]);
  const schedule = to(groomer.owner, /^Today: 2 appointments/);
  assert.equal(schedule.length, 1); // (Thursday 7 a.m., once)
  assert.match(schedule[0].text, /9:00 AM  Ana Lima  Nail trim/);
});

test("bookings: no usable email or an unreadable time goes to the owner", async () => {
  const transport = memory();
  const s = store(null);
  const mail = mailer({ transport, store: s, owner: groomer.owner, wait: async () => {} });
  const book = bookingReminders({ store: s, mail, business: groomer, now: () => new Date("2026-10-26T15:00:00Z") });
  assert.equal(await book.booked({ id: "b9", name: "Pat", email: "pat at home", phone: "(507) 555-0101", service: "Bath", start: "2026-10-30T15:00:00Z" }), "no-email");
  assert.match(transport.sent[0].subject, /^Confirm by hand: Pat/);
  assert.equal(await book.booked({ id: "b10", name: "Lee", email: "lee@example.com", start: "next tuesday" }), "unreadable");
  assert.equal(transport.sent.length, 2);
});
