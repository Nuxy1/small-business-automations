// The demo week of each automation, as events in order: what arrived, every message sent (with its full text), and
// what was stopped or skipped. demo/run.js prints them; they can also be drawn (a video of the week).
//   play(scenario, emit, write?)  emit(event): { at, type: "form" | "email" | "note", ... }; write(message): also keep it
import { readFileSync } from "node:fs";
import { mailer } from "../core/mail.js";
import { store } from "../core/store.js";
import { local } from "../core/time.js";
import { bookingReminders } from "../booking-reminders/index.js";
import { business as groomer } from "../booking-reminders/business.js";
import { readInvoices, remind } from "../invoice-reminders/index.js";
import { business as cleaning, columns } from "../invoice-reminders/business.js";
import { leadFollowUp } from "../lead-follow-up/index.js";
import { business as plumber } from "../lead-follow-up/business.js";
import { reviewRequests } from "../review-requests/index.js";
import { business as salon } from "../review-requests/business.js";

const TZ = "America/Chicago";
export const stamp = (d) => { const l = local(d, TZ); return `${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][l.weekday - 1]} ${String(l.hour).padStart(2, "0")}:${String(l.minute).padStart(2, "0")}`; };
const file = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

export const scenarios = [
  {
    id: "booking-reminders", title: "Booking reminders", business: groomer,
    async run({ mail, s, sim, emit }) {
      const book = bookingReminders({ store: s, mail, business: groomer, now: () => sim.now });
      const arrive = async (iso, booking, tag = "booking") => { sim.now = new Date(iso); emit({ at: sim.now, type: "form", tag, label: tag === "booking" ? "Online booking, as the booking tool sent it" : "A booking moved online", form: booking }); await book.booked(booking); };
      const jordan = { id: "b1", name: "JORDAN PRICE", email: " Jordan@Example.com", phone: "507 555 0177", service: "Full groom", start: "2026-10-28T19:00:00Z" };
      await arrive("2026-10-26T15:12:00Z", jordan);
      await arrive("2026-10-27T02:40:00Z", { id: "b2", name: "ana lima", email: "Ana.Lima@Gmial.com", phone: "(507) 555-0122", service: "Nail trim", start: "2026-10-29T14:00:00Z" });
      // (every hour to Thursday evening; Jordan moves on Tuesday afternoon)
      for (let t = Date.parse("2026-10-26T16:00:00Z"); t <= Date.parse("2026-10-29T21:00:00Z"); t += 3_600_000) {
        sim.now = new Date(t);
        if (t === Date.parse("2026-10-27T22:00:00Z")) await arrive("2026-10-27T21:05:00Z", { ...jordan, start: "2026-10-29T16:00:00Z" }, "moved");
        sim.now = new Date(t);
        await book.tick();
        if (t === Date.parse("2026-10-29T12:00:00Z") && book.skippedSoon("b2")) emit({ at: sim.now, type: "note", note: "Ana's 2-hour reminder would land at 7 a.m.: skipped, she had yesterday's" });
      }
    },
  },
  {
    id: "lead-follow-up", title: "Lead follow-up", business: plumber,
    async run({ mail, s, sim, emit }) {
      const leads = leadFollowUp({ store: s, mail, business: plumber, now: () => sim.now });
      const arrive = async (iso, form) => { sim.now = new Date(iso); emit({ at: sim.now, type: "form", form }); await leads.receive(form); };
      await arrive("2026-10-26T14:10:00Z", { name: "MARIA GONZALEZ", email: "Maria.Gonzalez@Gmial.com", phone: "507.555.0110", message: "Kitchen sink drains slowly" });
      await arrive("2026-10-26T14:40:00Z", { name: "Maria", email: "maria.gonzalez@gmail.com", message: "Forgot to say: it's a double sink" });
      await arrive("2026-10-27T02:15:00Z", { name: "Wei Chen", email: "wei.chen@example.com", message: "Quote for a new water heater?" });
      await arrive("2026-10-27T15:00:00Z", { name: "Bob", email: "bob at home", phone: "12", message: "call me" });
      // (every hour for a week; Maria replies on Tuesday, so her second follow-up never goes)
      for (let t = Date.parse("2026-10-26T15:00:00Z"); t <= Date.parse("2026-11-02T15:00:00Z"); t += 3_600_000) {
        sim.now = new Date(t);
        if (t === Date.parse("2026-10-27T20:00:00Z")) { leads.stop("maria.gonzalez@gmail.com"); emit({ at: sim.now, type: "note", note: "Maria replied: her follow-ups stop" }); }
        await leads.tick();
      }
    },
  },
  {
    id: "invoice-reminders", title: "Invoice reminders", business: cleaning,
    async run({ mail, s, sim, emit }) {
      const { invoices, problems } = readInvoices(file("../invoice-reminders/sample-invoices.csv"), columns);
      emit({ at: new Date("2026-10-26T14:59:00Z"), type: "note", note: `Read the export: ${invoices.length} invoices, ${problems.length} rows that can't be trusted` });
      for (const day of ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-02"]) {
        sim.now = new Date(`${day}T15:00:00Z`);
        if (local(sim.now, TZ).weekday > 5) emit({ at: sim.now, type: "note", note: "Weekend: no customer emails" });
        await remind({ invoices, problems, store: s, mail, business: cleaning, now: sim.now });
      }
    },
  },
  {
    id: "review-requests", title: "Review requests", business: salon,
    async run({ mail, s, sim, emit }) {
      const reviews = reviewRequests({ store: s, mail, business: salon });
      const visits = JSON.parse(file("../review-requests/sample-visits.json"));
      const noted = new Set();
      for (let t = Date.parse("2026-10-26T15:00:00Z"); t <= Date.parse("2026-10-29T15:00:00Z"); t += 1_800_000) {
        sim.now = new Date(t);
        const out = await reviews.run(visits, sim.now);
        // (a skip is told once, when that visit has happened)
        for (const x of out.skipped) {
          const visit = visits.find((v) => v.id === x.id);
          if (noted.has(x.id) || Date.parse(visit.finished) > t) continue;
          noted.add(x.id);
          emit({ at: sim.now, type: "note", note: `Skipped ${visit.customer.split(" ")[0]}: ${x.why}` });
        }
      }
    },
  },
];

export async function play(scenario, emit, write) {
  const sim = { now: new Date() };
  const s = store(null);
  const transport = async (m) => {
    emit({ at: m.at, type: "email", to: m.to, subject: m.subject, text: m.text, owner: m.to === scenario.business.owner });
    if (write) await write(m);
  };
  const mail = mailer({ transport, store: s, owner: scenario.business.owner, now: () => sim.now, wait: async () => {} });
  await scenario.run({ mail, s, sim, emit });
}
