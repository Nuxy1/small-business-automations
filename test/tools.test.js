import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cents, readInvoices, remind } from "../invoice-reminders/index.js";
import { business as cleaning, columns } from "../invoice-reminders/business.js";
import { leadFollowUp } from "../lead-follow-up/index.js";
import { business as plumber } from "../lead-follow-up/business.js";
import { reviewRequests } from "../review-requests/index.js";
import { business as salon } from "../review-requests/business.js";
import { mailer, memory } from "../core/mail.js";
import { store } from "../core/store.js";

const setup = (owner) => {
  const transport = memory();
  const s = store(null);
  return { transport, s, mail: mailer({ transport, store: s, owner, wait: async () => {} }) };
};

test("leads: instant reply and owner alert; messy fields cleaned; a repeat is one lead; follow-ups stop on reply", async () => {
  const { transport, s, mail } = setup(plumber.owner);
  let clock = new Date("2026-10-28T15:00:00Z"); // (10 a.m. in Minnesota)
  const leads = leadFollowUp({ store: s, mail, business: plumber, now: () => clock });
  assert.equal((await leads.receive({ name: "  JANE   O'CONNOR ", email: " Jane.OConnor@Gmial.com ", phone: "(507) 555-0199", message: "Water heater is leaking" })).status, "new");
  const [owner, reply] = transport.sent;
  assert.match(owner.subject, /New inquiry: Jane O'Connor/);
  assert.match(owner.text, /Phone: \+15075550199/);
  assert.equal(reply.to, "jane.oconnor@gmail.com"); // (the gmial typo fixed, everything lower case)
  assert.match(reply.text, /^Hi Jane,/);
  // (the same person again an hour later: the owner hears, she doesn't get a second reply)
  clock = new Date("2026-10-28T16:00:00Z");
  assert.equal((await leads.receive({ name: "Jane", email: "jane.oconnor@gmail.com", message: "Also the sink" })).status, "same-lead");
  assert.equal(transport.sent.filter((m) => m.to === "jane.oconnor@gmail.com").length, 1);
  // (a day later at 10 p.m. local: quiet hours, nothing; the next morning the first follow-up)
  clock = new Date("2026-10-30T03:00:00Z");
  await leads.tick();
  assert.equal(transport.sent.filter((m) => /Following up/.test(m.subject)).length, 0);
  clock = new Date("2026-10-30T14:30:00Z");
  await leads.tick();
  await leads.tick(); // (running twice changes nothing)
  assert.equal(transport.sent.filter((m) => /Following up/.test(m.subject)).length, 1);
  // (she replies: no second follow-up, ever)
  assert.equal(leads.stop("JANE.OCONNOR@gmail.com"), 1);
  clock = new Date("2026-11-05T15:00:00Z");
  await leads.tick();
  assert.equal(transport.sent.filter((m) => /Still happy to help/.test(m.subject)).length, 0);
});

test("leads, any form tool: other field names, first and last name apart, lists, nested values, an empty body; nothing the customer typed is lost", async () => {
  const { transport, s, mail } = setup(plumber.owner);
  const leads = leadFollowUp({ store: s, mail, business: plumber, now: () => new Date("2026-10-28T15:00:00Z") });
  assert.equal((await leads.receive({ "First Name": "Jordan", "Last Name": "Price", "Email Address": "Jordan Price <jordan@example.com>", "Phone Number": "(507) 555-0101", "Comments": "Leaky faucet", "Preferred day": "Friday" })).status, "new");
  const owner = transport.sent.find((m) => m.to === plumber.owner);
  assert.match(owner.text, /^Name: Jordan Price\nEmail: jordan@example\.com\nPhone: \+15075550101\n\nLeaky faucet\n\nPreferred day: Friday$/);
  assert.ok(transport.sent.some((m) => m.to === "jordan@example.com"));
  await leads.receive({ name: ["Sam", "Rivers"], email: ["sam@example.com"], details: { what: "water heater" } });
  assert.match(transport.sent.find((m) => /Sam Rivers/.test(m.subject)).text, /\{"what":"water heater"\}/);
  assert.equal((await leads.receive(null)).status, "no-contact");
});

test("reviews and the core: a missing or broken visit list, a finish time with no zone, a damaged state file", async () => {
  const { transport, s, mail } = setup(salon.owner);
  const reviews = reviewRequests({ store: s, mail, business: salon });
  assert.deepEqual(await reviews.run(null, new Date("2026-10-28T15:00:00Z")), { sent: 0, waiting: 0, skipped: [] });
  // (finished 9:30 a.m. in Minnesota, written without a zone: not before 11:30 there, whatever zone the server is in)
  const visit = [null, { id: "v1", customer: "Ana", email: "ana@example.com", finished: "2026-10-28T09:30:00" }];
  assert.equal((await reviews.run(visit, new Date("2026-10-28T16:00:00Z"))).waiting, 1); // (11:00 there)
  assert.equal((await reviews.run(visit, new Date("2026-10-28T16:31:00Z"))).sent, 1);
  assert.equal(transport.sent.length, 1);
  const dir = mkdtempSync(join(tmpdir(), "sba-"));
  writeFileSync(join(dir, "state.json"), '{"sends": {"k": {"status": "se');
  assert.throws(() => store(join(dir, "state.json")), /is damaged .* so nothing was sent/);
});

test("leads: no usable email or phone goes to the owner, not into a void", async () => {
  const { transport, s, mail } = setup(plumber.owner);
  const leads = leadFollowUp({ store: s, mail, business: plumber, now: () => new Date("2026-10-28T15:00:00Z") });
  assert.equal((await leads.receive({ name: "Bob", email: "bob at home", phone: "12", message: "call me" })).status, "no-contact");
  assert.equal(transport.sent.length, 1);
  assert.match(transport.sent[0].subject, /no way to reply automatically: Bob/);
  assert.match(transport.sent[0].text, /bob at home/);
});

test("invoices: messy export read, bad rows to the owner, reminders by days late, partial payments, never twice", async () => {
  assert.equal(cents("$1,240.00"), 124000);
  assert.equal(cents("(50.00)"), -5000);
  assert.ok(Number.isNaN(cents("ten dollars")));
  const { invoices, problems } = readInvoices(readFileSync(new URL("../invoice-reminders/sample-invoices.csv", import.meta.url), "utf8"), columns);
  assert.deepEqual(invoices.map((i) => i.number), ["1041", "1042", "1043", "1044", "1045", "1048"]);
  assert.deepEqual(problems.map((p) => p.number), ["1046", "1047"]);
  assert.equal(invoices[1].customer, "Wei Chen");
  assert.equal(invoices[2].email, "sam.rivers@example.com");
  const { transport, s, mail } = setup(cleaning.owner);
  const now = new Date("2026-10-28T15:00:00Z"); // (Wednesday 10 a.m.)
  await remind({ invoices, problems, store: s, mail, business: cleaning, now });
  const to = (who) => transport.sent.filter((m) => m.to === who);
  assert.match(to("maria.g@example.com")[0].subject, /^Friendly reminder: invoice 1041/); // (26 days late, first one)
  assert.match(to("wei.chen@example.com")[0].text, /\$100\.00 \(\$80\.00 of \$180\.00 already received/); // (8 days, partly paid)
  assert.equal(to("sam.rivers@example.com").length, 1); // (3 days late)
  assert.equal(to("obrien@example.com").length, 0); // (not due yet)
  assert.equal(to("billing@lakeside-dental.example").length, 0); // (paid)
  assert.ok(transport.sent.some((m) => m.to === cleaning.owner && /1048 is 38 days late/.test(m.subject)));
  assert.equal(transport.sent.filter((m) => /needs a look/.test(m.subject)).length, 2);
  const before = transport.sent.length;
  await remind({ invoices, problems, store: s, mail, business: cleaning, now });
  assert.equal(transport.sent.length, before); // (a second run the same day sends nothing new)
  // (Saturday: customers aren't emailed)
  const { transport: t2, s: s2, mail: m2 } = setup(cleaning.owner);
  await remind({ invoices, store: s2, mail: m2, business: cleaning, now: new Date("2026-10-31T15:00:00Z") });
  assert.ok(t2.sent.length > 0 && t2.sent.every((m) => m.to === cleaning.owner));
});

test("invoices: a report's title lines, a header in other capitals, the total line, a repeated number, an old Excel file, a broken file", async () => {
  const head = "Invoice No.,Customer,Customer Email,Due Date,Total,Amount Paid,Payment Link";
  const titled = readInvoices(`Cannon River Cleaning\nOpen Invoices\nAs of October 28, 2026\n\n${head}\n1001,Jordan Price,jordan@example.com,10/20/26,$120.00,,\n,TOTAL,,,$120.00,,\n`, columns);
  assert.deepEqual([titled.invoices.map((i) => i.number), titled.problems], [["1001"], []]);
  assert.equal(readInvoices(` invoice no. ,CUSTOMER,Customer  email,due date,TOTAL,Amount paid,Payment link\n1001,Jordan Price,jordan@example.com,10/20/26,$120.00,,\n`, columns).invoices.length, 1);
  const twice = readInvoices(`${head}\r\n1002,"Smith, John",a@example.com,10/20/26,50,,\r\n1003,Ana,b@example.com,10/20/26,50,,\r\n1002,Other,c@example.com,10/20/26,75,,\r\n`, columns);
  assert.deepEqual(twice.invoices.map((i) => i.number), ["1003"]);
  assert.deepEqual(twice.problems.map((p) => [p.line, p.number]), [[2, "1002"], [4, "1002"]]);
  assert.equal(readInvoices(Buffer.from(`${head}\n1012,Jos\xe9 Ruiz,jr@example.com,10/20/2026,50,,\n`, "latin1"), columns).invoices[0].customer, "José Ruiz");
  const broken = readInvoices(`${head}\n1011,"Never closed,nc@example.com,10/20/2026,50,,\n`, columns);
  const wrong = readInvoices("Name,Phone\nJordan,555\n", columns);
  assert.ok(broken.problems[0].file && /unclosed quote.*line 2/.test(broken.problems[0].why[0]));
  assert.ok(wrong.problems[0].file && /no header row/.test(wrong.problems[0].why[0]));
  const { transport, s, mail } = setup(cleaning.owner);
  await remind({ ...broken, store: s, mail, business: cleaning, now: new Date("2026-10-28T15:00:00Z") });
  assert.deepEqual(transport.sent.map((m) => [m.to, m.subject]), [[cleaning.owner, "The invoice export couldn't be read"]]);
});

test("reviews: after the visit, outside quiet hours, once per person in 180 days, never after cancel or opt-out, same link for all", async () => {
  const { transport, s, mail } = setup(salon.owner);
  const reviews = reviewRequests({ store: s, mail, business: salon });
  const visits = [
    { id: "v1", customer: "ANA LIMA", email: "ana@example.com", finished: "2026-10-28T16:00:00Z", status: "completed" },
    { id: "v2", customer: "Ana Lima", email: "ANA@example.com", finished: "2026-10-28T17:00:00Z", status: "completed" },
    { id: "v3", customer: "Tom", email: "tom@example.com", finished: "2026-10-28T16:00:00Z", status: "Cancelled" },
    { id: "v4", customer: "Lee", email: "not-an-email", finished: "2026-10-28T16:00:00Z", status: "completed" },
    { id: "v5", customer: "Kim", email: "kim@example.com", finished: "2026-10-29T00:30:00Z", status: "completed" },
  ];
  let out = await reviews.run(visits, new Date("2026-10-28T17:00:00Z")); // (1 hour after: too soon)
  assert.equal(out.sent, 0);
  out = await reviews.run(visits, new Date("2026-10-28T19:00:00Z"));
  assert.equal(out.sent, 1); // (Ana once, though she came twice)
  assert.deepEqual(out.skipped.map((x) => x.id).sort(), ["v2", "v3", "v4"]);
  assert.match(transport.sent[0].text, /https:\/\/g\.page\/r\/juniper-rose-example\/review/);
  // (Kim finished 7:30 p.m.: due 9:30 p.m., quiet hours, so 9 a.m. next day)
  out = await reviews.run(visits, new Date("2026-10-29T04:00:00Z"));
  assert.equal(out.sent, 0);
  out = await reviews.run(visits, new Date("2026-10-29T14:05:00Z"));
  assert.equal(out.sent, 1);
  reviews.optOut("ana@example.com");
  out = await reviews.run([{ id: "v9", customer: "Ana", email: "ana@example.com", finished: "2027-06-01T16:00:00Z", status: "completed" }], new Date("2027-06-01T20:00:00Z"));
  assert.equal(out.sent, 0);
  assert.equal(out.skipped[0].why, "opted out");
});
