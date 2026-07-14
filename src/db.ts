import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

export const db = new DatabaseSync(config.databasePath, {
  timeout: 5_000,
});

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS assignments (
    source            TEXT NOT NULL,
    event_id          INTEGER NOT NULL,
    course_module_id  INTEGER,
    course_name       TEXT NOT NULL,
    course_name_ja    TEXT NOT NULL,
    title             TEXT NOT NULL,
    deadline_unix     INTEGER NOT NULL,
    deadline_iso      TEXT NOT NULL,
    module            TEXT NOT NULL,
    url               TEXT NOT NULL,
    overdue           INTEGER NOT NULL DEFAULT 0 CHECK (overdue IN (0, 1)),
    first_seen_at     TEXT NOT NULL,
    last_seen_at      TEXT NOT NULL,
    is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    PRIMARY KEY (source, event_id)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_assignments_upcoming
    ON assignments (is_active, deadline_unix);

  CREATE TABLE IF NOT EXISTS reminder_logs (
    source          TEXT NOT NULL,
    event_id        INTEGER NOT NULL,
    deadline_unix   INTEGER NOT NULL,
    reminder_type   TEXT NOT NULL,
    sent_at         TEXT NOT NULL,
    PRIMARY KEY (source, event_id, deadline_unix, reminder_type)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS sync_runs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    source            TEXT NOT NULL,
    synced_at         TEXT NOT NULL,
    received_count    INTEGER NOT NULL,
    complete          INTEGER NOT NULL CHECK (complete IN (0, 1))
  ) STRICT;
`);
