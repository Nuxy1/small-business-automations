// Lead follow-up: every website inquiry gets an instant reply and the owner an alert with everything they need to
// call back; if the customer hasn't replied or booked, two friendly follow-ups (after 1 day and 3 days), never in quiet
// hours, stopping the moment they do. The same person sending the form twice gets one conversation, not two.
// Messy input is cleaned (names, phones, emails); what can't be trusted is passed to the owner, never guessed.
import * as normalize from "../core/normalize.js";
import { HOUR, outsideQuiet } from "../core/time.js";

export const DEFAULTS = {
  timeZone: "America/Chicago",
  quiet: [20, 9], // (no messages 8 p.m. to 9 a.m.)
  followUps: [24, 72], // (hours after the inquiry)
  sameLeadHours: 24, // (the same email or phone again within this: one lead)
};

export function leadFollowUp({ store, mail, business, now = () => new Date(), ...options }) {
  const cfg = { ...DEFAULTS, ...options };
  const leads = (store.state.leads ??= []);
  const hello = (name) => `Hi ${name.split(" ")[0] || "there"},`;

  return {
    // A form submission (any shape a form tool sends: name/email/phone/message under common field names).
    async receive(form) {
      const raw = { name: form.name ?? form["full name"] ?? form.Name ?? "", email: form.email ?? form.Email ?? form["e-mail"] ?? "", phone: form.phone ?? form.Phone ?? form.tel ?? "", message: form.message ?? form.Message ?? form.details ?? "" };
      const name = normalize.name(raw.name).value;
      const email = normalize.email(raw.email);
      const phone = normalize.phone(raw.phone);
      const message = String(raw.message).trim().slice(0, 4000);
      const problems = [!email.ok && `email "${raw.email}" doesn't look right`, !phone.ok && `phone "${raw.phone}" doesn't look right`].filter(Boolean);
      const contact = { email: email.ok ? email.value : "", phone: phone.ok ? phone.value : "" };
      const time = now();
      const details = `Name: ${name || "(none given)"}\nEmail: ${contact.email || raw.email || "(none)"}\nPhone: ${contact.phone || raw.phone || "(none)"}\n\n${message || "(no message)"}${problems.length ? `\n\nCheck: ${problems.join("; ")}.` : ""}`;

      if (!contact.email && !contact.phone) {
        await mail.tell(`New inquiry with no way to reply automatically${name ? `: ${name}` : ""}`, `Nobody was emailed back: there's no usable email or phone.\n\n${details}`);
        return { status: "no-contact" };
      }
      const same = leads.find((l) => ((contact.email && l.email === contact.email) || (contact.phone && l.phone === contact.phone)) && time - Date.parse(l.at) < cfg.sameLeadHours * HOUR);
      if (same) {
        same.messages.push({ at: time.toISOString(), message });
        store.save();
        await mail.once(`lead:${same.id}:again:${same.messages.length}`, { to: business.owner, subject: `${name || "A customer"} wrote again`, text: `They already had the instant reply, so they weren't sent another.\n\n${details}` });
        return { status: "same-lead", id: same.id };
      }

      const lead = { id: `${time.getTime().toString(36)}-${leads.length + 1}`, name, ...contact, at: time.toISOString(), messages: [{ at: time.toISOString(), message }], stopped: "" };
      leads.push(lead);
      store.save();
      await mail.once(`lead:${lead.id}:owner`, { to: business.owner, subject: `New inquiry: ${name || contact.email || contact.phone}`, text: details });
      if (lead.email) {
        await mail.once(`lead:${lead.id}:reply`, {
          to: lead.email,
          subject: `Thanks for contacting ${business.name}`,
          text: `${hello(name)}\n\nThanks for reaching out! We got your message and we'll get back to you ${business.replyBy}. ${business.urgent}\n\n${business.signature}`,
        });
      }
      return { status: "new", id: lead.id };
    },

    // Due follow-ups go out (run it every few minutes; running it twice changes nothing).
    async tick() {
      const time = now();
      if (outsideQuiet(time, cfg.timeZone, cfg.quiet) > time) return; // (night: overdue ones wait for the morning too)
      for (const lead of leads) {
        if (lead.stopped || !lead.email) continue;
        for (const [i, hours] of cfg.followUps.entries()) {
          const due = outsideQuiet(new Date(Date.parse(lead.at) + hours * HOUR), cfg.timeZone, cfg.quiet);
          if (time < due) break;
          const text = i === 0
            ? `${hello(lead.name)}\n\nJust following up on your message to ${business.name}. If you'd still like help, reply to this email or ${business.book}, and we'll take it from there.\n\n${business.signature}`
            : `${hello(lead.name)}\n\nOne last note from ${business.name}: we'd be glad to help whenever you're ready. Reply any time or ${business.book}. We won't send more reminders.\n\n${business.signature}`;
          await mail.once(`lead:${lead.id}:follow-up:${i + 1}`, { to: lead.email, subject: i === 0 ? `Following up: ${business.name}` : `Still happy to help: ${business.name}`, text });
        }
      }
    },

    // The customer replied, booked or called: no more follow-ups for them.
    stop(emailOrPhone, reason = "replied") {
      const key = normalize.email(emailOrPhone).ok && emailOrPhone.includes("@") ? normalize.email(emailOrPhone).value : normalize.phone(emailOrPhone).value;
      let n = 0;
      for (const lead of leads) if (!lead.stopped && (lead.email === key || lead.phone === key)) (lead.stopped = reason), n++;
      store.save();
      return n;
    },
  };
}
