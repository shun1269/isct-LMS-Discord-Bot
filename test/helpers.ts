import { Database } from "../src/database.js";
import type { Env } from "../src/env.js";

export const env: Env = {
  DB: new Database(":memory:", new URL("../migrations/", import.meta.url)),
  SYNC_TOKEN: "test-sync-token", DISCORD_BOT_TOKEN: "test-bot-token", DISCORD_PUBLIC_KEY: "test-public-key",
  DISCORD_APPLICATION_ID: "1", DISCORD_GUILD_ID: "2", DISCORD_CHANNEL_ID: "3", DISCORD_MENTION: "", DISCORD_MODE: "http",
};

export async function resetDatabase(): Promise<void> {
  const statements = [
    "DELETE FROM reminder_logs",
    "DELETE FROM sync_runs",
    "DELETE FROM assignments",
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
