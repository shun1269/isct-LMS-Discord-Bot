import type { Env } from "./env.js";
import { buildReminderMessage } from "./format.js";
import type { AssignmentRecord, ReminderType } from "./types.js";

export async function sendReminder(env: Env, assignment: AssignmentRecord, type: ReminderType, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(`https://discord.com/api/v10/channels/${encodeURIComponent(env.DISCORD_CHANNEL_ID)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildReminderMessage(assignment, type, env.DISCORD_MENTION ?? "")),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    console.error("Discord API request failed", { status: response.status });
    throw new Error(`Discord API returned ${response.status}`);
  }
}
