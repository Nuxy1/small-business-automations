// The webhook a website form posts to (directly, or through Zapier, Make or the form tool's own webhook setting):
//   POST /lead  (JSON or form-encoded) with the header x-secret: <SECRET>   ->  202
//   GET  /health                                                             ->  ok
// Follow-ups are checked every 5 minutes. A sketch of the deployment shape: the demo (npm run demo) runs the same
// logic on a simulated clock without a server.
//   SECRET=... OWNER=you@example.com node lead-follow-up/server.js
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { mailer, outbox } from "../core/mail.js";
import { store } from "../core/store.js";
import { leadFollowUp } from "./index.js";

const SECRET = process.env.SECRET ?? "";
if (SECRET.length < 16) throw new Error("set SECRET to a long random string: the form tool sends it with every lead");
const state = store("lead-follow-up.json");
const mail = mailer({ transport: outbox("outbox"), store: state, owner: process.env.OWNER ?? "owner@northfield-plumbing.example" });
const leads = leadFollowUp({ store: state, mail, business: (await import("./business.js")).business });

createServer(async (req, res) => {
  const reply = (status, text) => res.writeHead(status, { "content-type": "text/plain" }).end(text);
  try {
    if (req.method === "GET" && req.url === "/health") return reply(200, "ok");
    if (req.method !== "POST" || req.url !== "/lead") return reply(404, "not found");
    const given = Buffer.from(String(req.headers["x-secret"] ?? ""));
    const want = Buffer.from(SECRET); // (bytes, not characters: timingSafeEqual throws on a length mismatch)
    if (given.length !== want.length || !timingSafeEqual(given, want)) return reply(401, "wrong secret");
    let body = "";
    for await (const chunk of req) if ((body += chunk).length > 100_000) return reply(413, "too large");
    const form = /json/.test(req.headers["content-type"] ?? "") ? JSON.parse(body) : Object.fromEntries(new URLSearchParams(body));
    const result = await leads.receive(form);
    reply(202, result.status);
  } catch (error) {
    console.error(error);
    reply(500, "error"); // (the form tool retries; nothing is half-recorded: the state file is written whole)
  }
}).listen(process.env.PORT ?? 8787, () => console.log("listening for leads"));
setInterval(() => leads.tick().catch((e) => console.error(e)), 5 * 60_000);
