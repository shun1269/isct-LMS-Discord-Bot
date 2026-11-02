import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

process.umask(0o077);
const source = resolve(process.env.DATABASE_PATH ?? "data/lms.sqlite");
const output = resolve(process.argv[2] ?? `data/backups/lms-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`);
if (source === output) throw new Error("Backup destination must differ from source");
if (existsSync(output)) throw new Error("Backup destination already exists; choose a new path");
mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(source, { readOnly: true });
try { await backup(db, output); console.log("Database backup completed", { path: output }); }
finally { db.close(); }
