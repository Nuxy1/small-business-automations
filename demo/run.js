// The three automations on a simulated week (no server, no real email): every message lands in demo/outbox/<tool>/
// as a text file, and the timeline prints here.  npm run demo
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { outbox } from "../core/mail.js";
import { play, scenarios, stamp } from "./scenarios.js";

const dir = fileURLToPath(new URL("./outbox/", import.meta.url));
rmSync(dir, { recursive: true, force: true });

for (const scenario of scenarios) {
  console.log(`\n${scenario.title}: ${scenario.business.name} (made up)`);
  await play(scenario, (e) => {
    const what = e.type === "form" ? `form: ${JSON.stringify(e.form)}` : e.type === "email" ? `-> ${e.to.padEnd(36)} ${e.subject}` : e.note;
    console.log(`  ${stamp(e.at)}  ${what}`);
  }, outbox(`${dir}${scenario.id}`));
}
console.log(`\nEvery message is in ${dir}\n`);
