import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

// Import into a temporary database and publish with COPYFILE_EXCL: never overwrite a live DB.
export function importD1(input: string, output: string): Record<string, number> {
  process.umask(0o077);
  const destination = resolve(output);
  if (existsSync(destination)) throw new Error("Destination database already exists; choose a new path");
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${randomUUID()}.import`;
  const db = new DatabaseSync(temporary);
  let closed = false;
  try {
    db.exec(readFileSync(input, "utf8").replace(/^\uFEFF/, ""));
    const integrity = db.prepare("PRAGMA integrity_check").get();
    if (integrity?.integrity_check !== "ok") throw new Error("Imported database failed integrity_check");
    const counts: Record<string, number> = {};
    const requiredColumns = {
      assignments: ["source", "event_id", "course_module_id", "course_name", "course_name_ja", "title", "deadline_unix", "deadline_iso", "module", "url", "overdue", "first_seen_at", "last_seen_at", "is_active"],
      reminder_logs: ["source", "event_id", "deadline_unix", "reminder_type", "status", "claimed_at", "sent_at", "last_error"],
      sync_runs: ["id", "source", "synced_at", "received_count", "complete"],
    };
    for (const [table, columns] of Object.entries(requiredColumns)) {
      // Table and column identifiers are fixed above, never taken from the input.
      db.prepare(`SELECT ${columns.join(", ")} FROM ${table} LIMIT 0`).all();
      counts[table] = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count);
    }
    db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;");
    db.close();
    closed = true;
    copyFileSync(temporary, destination, constants.COPYFILE_EXCL);
    return counts;
  } finally {
    if (!closed) db.close();
    for (const suffix of ["", "-wal", "-shm", "-journal"]) rmSync(temporary + suffix, { force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.argv[2];
  const output = process.argv[3] ?? process.env.DATABASE_PATH ?? "data/lms.sqlite";
  if (!input) throw new Error("Usage: npm run db:import -- data/d1-export.sql [data/lms.sqlite]");
  console.log("D1 import completed", importD1(input, output));
}
