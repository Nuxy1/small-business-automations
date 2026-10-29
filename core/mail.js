// Sending, with the two promises every automation here keeps:
//   never twice:      each message has a key; a key that went out is never sent again, whatever re-runs or retries.
//   never silently:   a send that fails is retried, then reported to the owner; a send cut off halfway (the power
//                     went out) is reported for a person to check, not repeated blindly.
// The transport is swappable: outbox() writes each email to a folder to read (the demos), memory() keeps them (tests).
// In a client's setup it is their own email account or the tool they already use.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { retry } from "./retry.js";

export function outbox(dir) {
  mkdirSync(dir, { recursive: true });
  let n = 0;
  return async ({ to, subject, text, at }) => {
    const file = join(dir, `${String(++n).padStart(3, "0")}-${to.replace(/[^a-z0-9@.]+/gi, "_")}.txt`);
    writeFileSync(file, `Date: ${at.toISOString()}\nTo: ${to}\nSubject: ${subject}\n\n${text}\n`);
  };
}

export function memory() {
  const sent = [];
  const transport = async (message) => void sent.push(message);
  transport.sent = sent;
  return transport;
}

// once(key, message): sends it unless that key already went out. Returns "sent", "skipped" (sent before), "failed"
// (retries used up: the owner is told) or "unsure" (a send started earlier never finished: the owner is told).
export function mailer({ transport, store, owner, now = () => new Date(), wait }) {
  const log = (store.state.sends ??= {});
  const tell = async (subject, text) => {
    const key = `alert:${subject}`;
    if (log[key]?.status === "sent") return;
    try {
      await retry(() => transport({ to: owner, subject, text, at: now() }), { wait });
      log[key] = { status: "sent", at: now().toISOString() };
    } catch (error) {
      // (the alert channel itself is down: kept in the state file and printed, so it is still not silent)
      log[key] = { status: "failed", at: now().toISOString(), error: error.message };
      console.error(`ALERT NOT DELIVERED: ${subject}: ${text}`);
    }
    store.save();
  };
  const once = async (key, message) => {
    const entry = log[key];
    if (entry?.status === "sent") return "skipped";
    if (entry?.status === "sending") {
      await tell(`Check by hand: "${message.subject}" to ${message.to}`, `A send started at ${entry.at} and never finished (a crash or a lost connection). It may or may not have arrived, so it was NOT sent again. Check with the customer, then mark it done.\n\nKey: ${key}`);
      return "unsure";
    }
    log[key] = { status: "sending", at: now().toISOString() };
    store.save();
    try {
      await retry(() => transport({ ...message, at: now() }), { wait });
      log[key] = { status: "sent", at: now().toISOString() };
      store.save();
      return "sent";
    } catch (error) {
      log[key] = { status: "failed", at: now().toISOString(), error: error.message };
      store.save();
      await tell(`Not sent: "${message.subject}" to ${message.to}`, `It failed after 3 tries: ${error.message}\nIt will be tried again on the next run.\n\nKey: ${key}`);
      return "failed";
    }
  };
  return { once, tell };
}
