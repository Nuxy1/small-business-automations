// The three automations on a simulated week (no server, no real email): every message lands in demo/outbox/<tool>/
// as a text file, and the timeline prints here.  npm run demo
import { readFileSync, rmSync } from "node:fs";
import { mailer, outbox } from "../core/mail.js";
import { store } from "../core/store.js";
import { local } from "../core/time.js";
import { readInvoices, remind } from "../invoice-reminders/index.js";
import { business as cleaning, columns } from "../invoice-reminders/business.js";
import { leadFollowUp } from "../lead-follow-up/index.js";
import { business as plumber } from "../lead-follow-up/business.js";
import { reviewRequests } from "../review-requests/index.js";
import { business as salon } from "../review-requests/business.js";

const dir = new URL("./outbox/", import.meta.url);
rmSync(dir, { recursive: true, force: true });
const tz = "America/Chicago";
const sim = { now: new Date() }; // (the simulated clock every message is stamped with)
const stamp = (d) => { const l = local(d, tz); return `${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][l.weekday - 1]} ${String(l.hour).padStart(2, "0")}:${String(l.minute).padStart(2, "0")}`; };
const watch = (folder, owner) => {
  const write = outbox(new URL(folder, dir).pathname.replace(/^\/([A-Z]:)/, "$1"));
  const transport = async (m) => { console.log(`  ${stamp(m.at)}  -> ${m.to.padEnd(36)} ${m.subject}`); await write(m); };
  const s = store(null);
  return { s, mail: mailer({ transport, store: s, owner, now: () => sim.now, wait: async () => {} }) };
};

console.log("\nLead follow-up: Northfield Plumbing Co. (made up)");
{
  const { s, mail } = watch("lead-follow-up/", plumber.owner);
  const leads = leadFollowUp({ store: s, mail, business: plumber, now: () => sim.now });
  const arrive = async (iso, form) => { sim.now = new Date(iso); console.log(`  ${stamp(sim.now)}  form: ${JSON.stringify(form)}`); await leads.receive(form); };
  await arrive("2026-10-26T14:10:00Z", { name: "MARIA GONZALEZ", email: "Maria.Gonzalez@Gmial.com", phone: "507.555.0110", message: "Kitchen sink drains slowly" });
  await arrive("2026-10-26T14:40:00Z", { name: "Maria", email: "maria.gonzalez@gmail.com", message: "Forgot to say: it's a double sink" });
  await arrive("2026-10-27T02:15:00Z", { name: "Wei Chen", email: "wei.chen@example.com", message: "Quote for a new water heater?" });
  await arrive("2026-10-27T15:00:00Z", { name: "Bob", email: "bob at home", phone: "12", message: "call me" });
  // (every hour for a week; Maria replies on Tuesday, so her second follow-up never goes)
  for (let t = Date.parse("2026-10-26T15:00:00Z"); t <= Date.parse("2026-11-02T15:00:00Z"); t += 3_600_000) {
    sim.now = new Date(t);
    if (t === Date.parse("2026-10-27T20:00:00Z")) { leads.stop("maria.gonzalez@gmail.com"); console.log(`  ${stamp(sim.now)}  Maria replied: her follow-ups stop`); }
    await leads.tick();
  }
}

console.log("\nInvoice reminders: Cannon River Cleaning (made up)");
{
  const { s, mail } = watch("invoice-reminders/", cleaning.owner);
  const { invoices, problems } = readInvoices(readFileSync(new URL("../invoice-reminders/sample-invoices.csv", import.meta.url), "utf8"), columns);
  console.log(`  read ${invoices.length} invoices, ${problems.length} rows that can't be trusted (sent to the owner, not guessed at)`);
  for (const day of ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-02"]) {
    sim.now = new Date(`${day}T15:00:00Z`);
    await remind({ invoices, problems, store: s, mail, business: cleaning, now: sim.now });
  }
}

console.log("\nReview requests: Juniper & Rose Salon (made up)");
{
  const { s, mail } = watch("review-requests/", salon.owner);
  const reviews = reviewRequests({ store: s, mail, business: salon });
  const visits = JSON.parse(readFileSync(new URL("../review-requests/sample-visits.json", import.meta.url), "utf8"));
  for (let t = Date.parse("2026-10-26T15:00:00Z"); t <= Date.parse("2026-10-29T15:00:00Z"); t += 1_800_000) { sim.now = new Date(t); await reviews.run(visits, sim.now); }
  const last = await reviews.run(visits, new Date("2026-10-29T15:00:00Z"));
  for (const x of last.skipped) console.log(`  skipped ${x.id}: ${x.why}`);
}
console.log(`\nEvery message is in ${dir.pathname.replace(/^\/([A-Z]:)/, "$1")}\n`);
