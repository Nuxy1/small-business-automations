import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { mailer, memory } from "../core/mail.js";
import { retry } from "../core/retry.js";
import { store } from "../core/store.js";
import { at, daysBetween, local, outsideQuiet } from "../core/time.js";

const noWait = async () => {};

test("never twice: a key that went out is skipped, whatever re-runs", async () => {
  const transport = memory();
  const s = store(null);
  const mail = mailer({ transport, store: s, owner: "owner@x.example", wait: noWait });
  assert.equal(await mail.once("k", { to: "a@x.example", subject: "Hi", text: "1" }), "sent");
  assert.equal(await mail.once("k", { to: "a@x.example", subject: "Hi", text: "1" }), "skipped");
  assert.equal(transport.sent.length, 1);
});

test("never silently: a failing send is retried, then the owner is told, and it's tried again next run", async () => {
  let fail = 3;
  const sent = [];
  const transport = async (m) => { if (m.to !== "owner@x.example" && fail-- > 0) throw new Error("mail server down"); sent.push(m); };
  const s = store(null);
  const mail = mailer({ transport, store: s, owner: "owner@x.example", wait: noWait });
  assert.equal(await mail.once("k", { to: "a@x.example", subject: "Reminder", text: "1" }), "failed");
  assert.match(sent[0].subject, /^Not sent: "Reminder" to a@x\.example/);
  assert.equal(await mail.once("k", { to: "a@x.example", subject: "Reminder", text: "1" }), "sent"); // (next run)
});

test("a send cut off halfway is flagged for a person, not repeated", async () => {
  const transport = memory();
  const s = store(null, { sends: { k: { status: "sending", at: "2026-10-28T10:00:00Z" } } });
  const mail = mailer({ transport, store: s, owner: "owner@x.example", wait: noWait });
  assert.equal(await mail.once("k", { to: "a@x.example", subject: "Reminder", text: "1" }), "unsure");
  assert.deepEqual(transport.sent.map((m) => m.to), ["owner@x.example"]);
  assert.match(transport.sent[0].text, /NOT sent again/);
});

test("the state file is written whole and read back", () => {
  const path = join(mkdtempSync(join(tmpdir(), "sba-")), "state.json");
  const s = store(path);
  s.state.leads = [{ id: 1 }];
  s.save();
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { leads: [{ id: 1 }] });
  assert.deepEqual(store(path).state.leads, [{ id: 1 }]);
});

test("retry: waits longer each time and gives up with the last error", async () => {
  const waits = [];
  let n = 0;
  await assert.rejects(retry(async () => { n++; throw new Error(`no ${n}`); }, { tries: 3, base: 100, wait: async (ms) => waits.push(ms) }), /no 3/);
  assert.deepEqual(waits, [100, 200]);
  assert.equal(await retry(async () => "ok", { wait: noWait }), "ok");
});

test("business time: Minnesota dates and hours through daylight saving; quiet hours", () => {
  const tz = "America/Chicago";
  assert.equal(at("2026-07-01", tz, 9).toISOString(), "2026-07-01T14:00:00.000Z"); // (CDT, -5)
  assert.equal(at("2026-12-01", tz, 9).toISOString(), "2026-12-01T15:00:00.000Z"); // (CST, -6)
  assert.equal(local(new Date("2026-11-02T03:30:00Z"), tz).date, "2026-11-01"); // (still Sunday night there)
  assert.equal(daysBetween("2026-10-30", "2026-11-03"), 4); // (across the clock change)
  const late = new Date("2026-10-28T03:00:00Z"); // (10 p.m. local)
  assert.equal(outsideQuiet(late, tz, [20, 9]).toISOString(), "2026-10-28T14:00:00.000Z"); // (next 9 a.m.)
  const early = new Date("2026-10-28T11:00:00Z"); // (6 a.m. local)
  assert.equal(outsideQuiet(early, tz, [20, 9]).toISOString(), "2026-10-28T14:00:00.000Z"); // (same day 9 a.m.)
  const noon = new Date("2026-10-28T17:00:00Z");
  assert.equal(outsideQuiet(noon, tz, [20, 9]), noon);
});
