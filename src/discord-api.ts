import type { Env } from "./env";
import { buildReminderMessage } from "./format";
import type { AssignmentRecord, ReminderType } from "./types";

export async function sendReminder(env: Env, assignment: AssignmentRecord, type: ReminderType, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(`https://discord.com/api/v10/channels/${encodeURIComponent(env.DISCORD_CHANNEL_ID)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildReminderMessage(assignment, type, env.DISCORD_MENTION ?? "")),
  });
  if (!response.ok) {
    const safeBody = (await response.text()).slice(0, 1_000);
    console.error("Discord API request failed", { status: response.status, body: safeBody });
    throw new Error(`Discord API returned ${response.status}`);
  }
}
