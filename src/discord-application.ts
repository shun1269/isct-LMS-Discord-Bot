import type { Env } from "./env.js";

export async function verifyDiscordApplication(env: Env, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher("https://discord.com/api/v10/applications/@me", {
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Discord application verification failed");
  const application = await response.json() as { id?: string; interactions_endpoint_url?: string | null };
  if (application.id !== env.DISCORD_APPLICATION_ID) throw new Error("DISCORD_APPLICATION_ID does not match the bot token");
  if (env.DISCORD_MODE === "gateway" && application.interactions_endpoint_url) {
    throw new Error("Clear the Interactions Endpoint URL in Discord Developer Portal before enabling Gateway mode");
  }
}
