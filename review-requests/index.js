// Review requests: after each finished visit (from the booking or point-of-sale tool's export or webhook), the customer
// gets a short thank-you with the business's Google review link, a couple of hours later and never in quiet hours.
// The same person is asked at most once in 180 days, cancelled and no-show visits are skipped, and anyone who opted
// out is never asked again. Every customer gets the same public link: asking only the happy ones ("review gating")
// is against Google's rules, so it isn't done.
import * as normalize from "../core/normalize.js";
import { DAY, HOUR, outsideQuiet, parseTime } from "../core/time.js";

export const DEFAULTS = { timeZone: "America/Chicago", delayHours: 2, quiet: [20, 9], askEveryDays: 180, skip: /cancel|no.?show|refund/i };

export function reviewRequests({ store, mail, business, ...options }) {
  const cfg = { ...DEFAULTS, ...options };
  const asked = (store.state.asked ??= {}); // email -> when last asked
  const optedOut = (store.state.optedOut ??= []);

  return {
    // visits: [{ id, customer, email, finished, status }]; returns what happened to each, for the run's log.
    async run(visits, now = new Date()) {
      const out = { sent: 0, waiting: 0, skipped: [] };
      const night = outsideQuiet(now, cfg.timeZone, cfg.quiet) > now; // (overdue ones wait for the morning too)
      for (const v of Array.isArray(visits) ? visits : []) {
        const visit = v && typeof v === "object" ? v : {};
        const email = normalize.email(visit.email);
        const finished = parseTime(visit.finished, cfg.timeZone);
        const why = !visit.id ? "no visit id"
          : !email.ok || !email.value ? "no usable email"
          : Number.isNaN(finished.getTime()) ? "unreadable finish time"
          : cfg.skip.test(visit.status ?? "") ? `visit was ${visit.status}`
          : optedOut.includes(email.value) ? "opted out"
          : "";
        if (why) {
          out.skipped.push({ id: visit.id, why });
          continue;
        }
        const last = asked[email.value];
        const key = `review:${visit.id}`;
        if (store.state.sends?.[key]?.status === "sent") continue; // (done; a failed one is tried again)
        if (last && Date.parse(last) > now - cfg.askEveryDays * DAY) {
          out.skipped.push({ id: visit.id, why: `asked on ${last.slice(0, 10)}` });
          continue;
        }
        if (night || now < outsideQuiet(new Date(finished.getTime() + cfg.delayHours * HOUR), cfg.timeZone, cfg.quiet)) {
          out.waiting++;
          continue;
        }
        const first = normalize.name(visit.customer).first;
        const result = await mail.once(key, {
          to: email.value,
          subject: `Thanks for visiting ${business.name}`,
          text: `Hi ${first || "there"},\n\nThank you for coming in today. If you have a minute, a Google review helps other people find us:\n${business.reviewLink}\n\nAnd if anything wasn't right, just reply to this email and it comes straight to me.\n\n${business.signature}\n\n(Don't want these? Reply "stop" and you won't get another.)`,
        });
        if (result === "sent") {
          asked[email.value] = now.toISOString();
          out.sent++;
        }
      }
      store.save();
      return out;
    },

    // "stop" replies: never asked again.
    optOut(rawEmail) {
      const email = normalize.email(rawEmail).value;
      if (email && !optedOut.includes(email)) optedOut.push(email);
      store.save();
    },
  };
}
