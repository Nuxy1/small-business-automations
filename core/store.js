// What each automation remembers between runs (who was emailed, which reminders went out), in one JSON file written
// atomically: a crash mid-write leaves the old file whole, never half a file. No path: kept in memory (tests).
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export function store(path, initial = {}) {
  let state;
  try {
    state = path && existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : structuredClone(initial);
  } catch (error) {
    // (never start empty instead: it would forget what went out and send everything again)
    throw new Error(`${path} is damaged (${error.message}), so nothing was sent. Restore it from a backup or fix it by hand.`);
  }
  return {
    state,
    save() {
      if (!path) return;
      writeFileSync(`${path}.tmp`, JSON.stringify(state, null, 2));
      renameSync(`${path}.tmp`, path);
    },
  };
}
