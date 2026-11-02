import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Database } from "../src/database.js";
import { importD1 } from "../scripts/import-d1.js";
import { claimReminder, getLastSync, listUpcomingAssignments, syncAssignments } from "../src/repository.js";
import { assignment } from "./helpers.js";

const folders: string[] = [];
function temporaryFolder() { const folder = mkdtempSync(join(tmpdir(), "lms-bot-test-")); folders.push(folder); return folder; }
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

describe("SQLite storage and migration", () => {
  it("persists data across restart and applies each migration once", async () => {
    const path = join(temporaryFolder(), "db.sqlite");
    const first = new Database(path);
    const item = assignment();
    await syncAssignments(first, { source: item.source, complete: true, assignments: [item] });
    first.close();
    const second = new Database(path);
    try {
      expect((await listUpcomingAssignments(second, 0, item.deadlineUnix))[0]?.title).toBe(item.title);
      expect(await second.prepare("SELECT COUNT(*) AS count FROM app_migrations").first("count")).toBe(2);
    } finally { second.close(); }
  });

  it("rolls back the complete sync when an upsert fails", async () => {
    const db = new Database(":memory:");
    try {
      const item = assignment();
      await syncAssignments(db, { source: item.source, complete: true, assignments: [item] });
      db.connection.exec("CREATE TRIGGER reject_upsert BEFORE UPDATE OF title ON assignments BEGIN SELECT RAISE(ABORT, 'test failure'); END");
      await expect(syncAssignments(db, { source: item.source, complete: true, assignments: [{ ...item, title: "changed" }] })).rejects.toThrow();
      expect(await db.prepare("SELECT is_active FROM assignments").first("is_active")).toBe(1);
      expect(await db.prepare("SELECT title FROM assignments").first("title")).toBe(item.title);
      expect(await db.prepare("SELECT COUNT(*) AS count FROM sync_runs").first("count")).toBe(1);
    } finally { db.close(); }
  });

  it("imports D1 data including sent reminder history without overwriting a database", async () => {
    const folder = temporaryFolder();
    const input = join(folder, "export.sql");
    const output = join(folder, "db.sqlite");
    const now = new Date();
    const item = assignment(1, Math.floor(now.getTime() / 1000) + 1000);
    const schema = readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8");
    const dump = `${schema}\nINSERT INTO assignments VALUES ('${item.source}',1,101,'Course','Course','Title',${item.deadlineUnix},'${item.deadlineIso}','assign','${item.url}',0,'${now.toISOString()}','${now.toISOString()}',1);\nINSERT INTO sync_runs(source,synced_at,received_count,complete) VALUES ('${item.source}','${now.toISOString()}',1,1);\nINSERT INTO reminder_logs VALUES ('${item.source}',1,${item.deadlineUnix},'hourly-1','sent','${now.toISOString()}','${now.toISOString()}',NULL);`;
    writeFileSync(input, dump);
    expect(importD1(input, output)).toEqual({ assignments: 1, reminder_logs: 1, sync_runs: 1 });
    expect(() => importD1(input, output)).toThrow(/already exists/);
    const db = new Database(output);
    try {
      const [record] = await listUpcomingAssignments(db, 0, item.deadlineUnix);
      expect(record).toBeDefined();
      expect(await claimReminder(db, record!, "hourly-1", now)).toBe(false);
      expect((await getLastSync(db))?.receivedCount).toBe(1);
    } finally { db.close(); }
    writeFileSync(input, "CREATE TABLE wrong (id INTEGER);");
    const invalidOutput = join(folder, "invalid.sqlite");
    expect(() => importD1(input, invalidOutput)).toThrow();
    expect(existsSync(invalidOutput)).toBe(false);
  });
});
