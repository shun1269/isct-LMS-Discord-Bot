import { env } from "cloudflare:test";

export async function resetDatabase(): Promise<void> {
  const statements = [
    "DROP TABLE IF EXISTS reminder_logs",
    "DROP TABLE IF EXISTS sync_runs",
    "DROP TABLE IF EXISTS assignments",
    `CREATE TABLE assignments (
      source TEXT NOT NULL, event_id INTEGER NOT NULL, course_module_id INTEGER,
      course_name TEXT NOT NULL, course_name_ja TEXT NOT NULL, title TEXT NOT NULL,
      deadline_unix INTEGER NOT NULL, deadline_iso TEXT NOT NULL, module TEXT NOT NULL,
      url TEXT NOT NULL, overdue INTEGER NOT NULL DEFAULT 0,
      first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (source, event_id)
    )`,
    `CREATE TABLE reminder_logs (
      source TEXT NOT NULL, event_id INTEGER NOT NULL, deadline_unix INTEGER NOT NULL,
      reminder_type TEXT NOT NULL, status TEXT NOT NULL, claimed_at TEXT NOT NULL,
      sent_at TEXT, last_error TEXT,
      PRIMARY KEY (source, event_id, deadline_unix, reminder_type)
    )`,
    `CREATE TABLE sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, synced_at TEXT NOT NULL,
      received_count INTEGER NOT NULL, complete INTEGER NOT NULL
    )`,
  ];
  await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
}

export function assignment(eventId = 1, deadlineUnix = Math.floor(Date.now() / 1000) + 86_400) {
  return {
    source: "science-tokyo-lms-2026", eventId, courseModuleId: 100 + eventId,
    course: "科目 / Course", courseJa: "科目", title: `課題${eventId}`,
    deadlineUnix, deadlineIso: new Date(deadlineUnix * 1000).toISOString(), deadlineJst: null,
    module: "assign", url: `https://lms.s.isct.ac.jp/2026/mod/assign/view.php?id=${100 + eventId}`,
    overdue: false, syncedAt: new Date().toISOString(),
  };
}
