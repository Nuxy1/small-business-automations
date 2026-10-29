// Invoice reminders: reads the open-invoices export (CSV from QuickBooks, Wave, Square or a spreadsheet), and sends a
// friendly reminder 3, 7 and 14 days after an invoice is due, never the same one twice, stopping once it's paid. At 30
// days late the owner is told to step in (a person, not a fourth email). Every Monday morning the owner gets the list.
// Rows that can't be trusted (no email, unreadable date or amount) are never guessed at: they go to the owner.
import { decode, key, parseCsv, toRecords } from "../core/csv.js";
import * as normalize from "../core/normalize.js";
import { daysBetween, local } from "../core/time.js";

export const DEFAULTS = { timeZone: "America/Chicago", stages: [3, 7, 14], ownerAfter: 30, sendFrom: 9, sendTo: 17 };

// Money to cents: "$1,234.50", "1234.5", "(50.00)" (negative), "USD 80". NaN when it isn't money.
export function cents(raw) {
  const text = String(raw ?? "").trim();
  const negative = /^\(.*\)$/.test(text) || text.startsWith("-");
  const number = text.replace(/[^0-9.]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(number)) return NaN;
  const value = Math.round(Number(number) * 100);
  return negative ? -value : value;
}
// "2026-10-20" as people write it: "October 20, 2026".
export const longDate = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
export const dollars =(c) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The export (its text, or the file's bytes), read with `columns` naming which column holds what. Returns { invoices,
// problems }. A file that can't be read at all (an unclosed quote, the wrong report) is one problem with file: true.
export function readInvoices(input, columns) {
  const found = [];
  const problems = [];
  let rows;
  try {
    rows = toRecords(parseCsv(typeof input === "string" ? input : decode(input)), [columns.number, columns.email, columns.due, columns.total]);
  } catch (error) {
    return { invoices: [], problems: [{ file: true, line: 0, number: "", why: [error.message] }] };
  }
  for (const row of rows) {
    if (Object.values(row).every((v) => typeof v !== "string" || !v)) continue;
    const get = (field) => row[key(columns[field])] ?? "";
    const number = get("number").trim();
    if (!number && Object.values(row).some((v) => typeof v === "string" && /^(sub|grand )?total\b/i.test(v))) continue; // (the export's total line)
    const email = normalize.email(get("email"));
    const due = normalize.date(get("due"));
    const total = cents(get("total"));
    const paid = get("paid") ? cents(get("paid")) : 0;
    const why = [
      !number && "no invoice number",
      !get("email").trim() ? "it has no email" : !email.ok && `email "${get("email")}" can't be used`,
      (!due.ok || !due.value) && `due date "${get("due")}" can't be read`,
      Number.isNaN(total) && `total "${get("total")}" isn't an amount`,
      Number.isNaN(paid) && `paid "${get("paid")}" isn't an amount`,
    ].filter(Boolean);
    if (why.length) problems.push({ line: row.__line, number, why });
    else found.push({ line: row.__line, invoice: { number, customer: normalize.name(get("customer")).value, email: email.value, due: due.value, total, paid, link: get("link").trim() } });
  }
  // (two rows with one invoice number would share its reminders: neither is guessed at, both go to the owner)
  const count = new Map();
  for (const { invoice } of found) count.set(invoice.number, (count.get(invoice.number) ?? 0) + 1);
  for (const { line, invoice } of found) if (count.get(invoice.number) > 1) problems.push({ line, number: invoice.number, why: [`invoice number ${invoice.number} is on ${count.get(invoice.number)} rows`] });
  return { invoices: found.filter(({ invoice }) => count.get(invoice.number) === 1).map(({ invoice }) => invoice), problems };
}

export async function remind({ invoices, problems = [], store, mail, business, now = new Date(), ...options }) {
  const cfg = { ...DEFAULTS, ...options };
  const today = local(now, cfg.timeZone);
  const done = { reminded: 0, owner: 0 };
  const open = invoices.filter((inv) => inv.total - inv.paid > 0);
  // (customers are emailed on weekdays in business hours; the owner's notes can go any time)
  const sendable = today.weekday <= 5 && today.hour >= cfg.sendFrom && today.hour < cfg.sendTo;

  for (const p of problems) {
    await mail.once(`invoice-problem:${p.file ? "file" : p.number || `line-${p.line}`}:${p.why.join("|")}`, p.file
      ? { to: business.owner, subject: "The invoice export couldn't be read", text: `No reminders went out, because ${p.why.join("; ")}.\nExport the open invoices again (or ask for the column names to be updated) and it will be picked up on the next run.` }
      : { to: business.owner, subject: `Invoice ${p.number || `on line ${p.line}`} needs a look`, text: `It wasn't reminded because: ${p.why.join("; ")}.\nFix it in your invoicing tool and it will be picked up on the next run.` });
  }
  for (const inv of open) {
    const late = daysBetween(inv.due, today.date);
    const balance = inv.total - inv.paid;
    const stage = cfg.stages.filter((d) => late >= d).at(-1);
    if (stage && sendable) {
      const partly = inv.paid > 0 ? ` (${dollars(inv.paid)} of ${dollars(inv.total)} already received, thank you)` : "";
      // (only an invoice that already had a reminder gets "Second reminder"; one first seen late starts friendly)
      const before = cfg.stages.some((d) => d < stage && store.state.sends?.[`invoice:${inv.number}:day-${d}`]?.status === "sent");
      const result = await mail.once(`invoice:${inv.number}:day-${stage}`, {
        to: inv.email,
        subject: `${before ? "Second reminder" : "Friendly reminder"}: invoice ${inv.number} from ${business.name}`,
        text: `Hi ${inv.customer.split(" ")[0] || "there"},\n\nA quick reminder that invoice ${inv.number} for ${dollars(balance)}${partly} was due on ${longDate(inv.due)}.${inv.link ? `\n\nYou can pay it here: ${inv.link}` : ""}\n\nIf you've already paid, thank you, and please ignore this. Questions? Just reply.\n\n${business.signature}`,
      });
      if (result === "sent") done.reminded++;
    }
    if (late >= cfg.ownerAfter) {
      const result = await mail.once(`invoice:${inv.number}:owner`, { to: business.owner, subject: `Invoice ${inv.number} is ${late} days late`, text: `${inv.customer || inv.email} owes ${dollars(balance)} (due ${longDate(inv.due)}). The automatic reminders are done; this one needs a personal call or a pause on work. No more automatic emails will be sent for it.` });
      if (result === "sent") done.owner++;
    }
  }
  // (the Monday list, once a week)
  if (today.weekday === 1 && today.hour >= 8) {
    const late = open.filter((inv) => daysBetween(inv.due, today.date) > 0).sort((a, b) => a.due.localeCompare(b.due));
    const owed = late.reduce((t, inv) => t + inv.total - inv.paid, 0);
    await mail.once(`invoice-week:${today.date}`, {
      to: business.owner,
      subject: `This week: ${late.length} late invoice${late.length === 1 ? "" : "s"}, ${dollars(owed)} owed`,
      text: late.length ? late.map((inv) => `${inv.number}  ${inv.customer || inv.email}  ${dollars(inv.total - inv.paid)}  due ${inv.due} (${daysBetween(inv.due, today.date)} days)`).join("\n") : "Nothing late. Nice week.",
    });
  }
  return done;
}
