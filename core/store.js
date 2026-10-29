// What each automation remembers between runs (who was emailed, which reminders went out), in one JSON file written
// atomically: a crash mid-write leaves the old file whole, never half a file. No path: kept in memory (tests).
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export function store(path, initial = {}) {
  const state = path && existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : structuredClone(initial);
  return {
    state,
    save() {
      if (!path) return;
      writeFileSync(`${path}.tmp`, JSON.stringify(state, null, 2));
      renameSync(`${path}.tmp`, path);
    },
  };
}
