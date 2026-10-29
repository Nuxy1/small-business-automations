// How fast each automation gets through a big, messy batch (5,000 records each), with every message going to memory
// instead of a mail server: the numbers on the case-study pages.  npm run bench
import { mailer, memory } from "../core/mail.js";
import { store } from "../core/store.js";
import { readInvoices, remind } from "../invoice-reminders/index.js";
import { columns, business as cleaning } from "../invoice-reminders/business.js";
import { leadFollowUp } from "../lead-follow-up/index.js";
import { business as plumber } from "../lead-follow-up/business.js";
import { reviewRequests } from "../review-requests/index.js";
import { business as salon } from "../review-requests/business.js";

const N = 5000;
const names = ["MARIA GONZALEZ", "wei chen", "Sam Rivers Jr.", "o'brien family", "Chen, Wei", "ANA LIMA", "jordan price"];
const messy = (i) => [`User${i}@Gmial.com `, `user${i}@example.com`, `USER${i}@EXAMPLE.COM`, `user${i} at example`, ""][i % 5];
const kit = () => { const s = store(null); const t = memory(); return { s, t, mail: mailer({ transport: t, store: s, owner: "owner@x.example", wait: async () => {} }) }; };
const time = async (fn) => { const t = performance.now(); await fn(); return (performance.now() - t) / 1000; };

{
  const { s, t, mail } = kit();
  let clock = new Date("2026-10-26T15:00:00Z");
  const leads = leadFollowUp({ store: s, mail, business: plumber, now: () => clock });
  const secs = await time(async () => {
    for (let i = 0; i < N; i++) await leads.receive({ name: names[i % 7], email: messy(i % 1000), phone: i % 3 ? `(507) 555-${String(i % 10000).padStart(4, "0")}` : "12", message: "Leaking tap" });
    clock = new Date("2026-10-30T15:00:00Z");
    await leads.tick();
  });
  console.log(`Lead follow-up: ${N} form submissions (repeats, typos, bad emails) and the follow-ups in ${secs.toFixed(2)} s; ${t.sent.length} messages; customer emails sent twice: ${(() => { const c = t.sent.filter((m) => m.to !== plumber.owner && m.to !== "owner@x.example"); return c.length - new Set(c.map((m) => m.to + m.subject)).size; })()}`);
}
{
  const { s, t, mail } = kit();
  const rows = ["Invoice No.,Customer,Customer Email,Due Date,Total,Amount Paid,Payment Link"];
  for (let i = 0; i < N; i++) rows.push(`${10000 + i},${names[i % 7].replace(",", "")},${messy(i)},${["10/02/2026", "2026-10-20", "Oct 25 2026", "11/15/2026", "13/45/2026"][Math.floor(i / 5) % 5]},"$${(i % 900) + 50}.00",${i % 4 === 0 ? "$20.00" : ""},`);
  let read;
  const secs = await time(async () => {
    read = readInvoices(rows.join("\n"), columns);
    await remind({ ...read, store: s, mail, business: cleaning, now: new Date("2026-10-28T15:00:00Z") });
  });
  console.log(`Invoice reminders: a ${N}-row export read and checked in ${secs.toFixed(2)} s; ${read.invoices.length} usable, ${read.problems.length} rows passed to the owner, ${t.sent.filter((m) => m.to !== cleaning.owner).length} reminders`);
}
{
  const { s, t, mail } = kit();
  const reviews = reviewRequests({ store: s, mail, business: salon });
  const visits = Array.from({ length: N }, (_, i) => ({ id: `v${i}`, customer: names[i % 7], email: messy(i % 2000), finished: "2026-10-28T15:00:00Z", status: i % 9 === 0 ? "No-show" : "completed" }));
  let out;
  const secs = await time(async () => { out = await reviews.run(visits, new Date("2026-10-28T19:00:00Z")); });
  console.log(`Review requests: ${N} visits in ${secs.toFixed(2)} s; ${out.sent} thank-yous (one per person), ${out.skipped.length} skipped (no-shows, repeats, bad emails)`);
}
