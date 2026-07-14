import "dotenv/config";
import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  SYNC_TOKEN: z.string().min(32, "SYNC_TOKEN must be at least 32 characters"),
  DATABASE_PATH: z.string().default("./data/assignments.sqlite"),
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().regex(/^\d+$/),
  DISCORD_GUILD_ID: z.string().regex(/^\d+$/),
  DISCORD_CHANNEL_ID: z.string().regex(/^\d+$/),
  DISCORD_MENTION: z.string().default(""),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

const env = parsed.data;

export const config = {
  port: env.PORT,
  syncToken: env.SYNC_TOKEN,
  databasePath: path.resolve(env.DATABASE_PATH),
  discordBotToken: env.DISCORD_BOT_TOKEN,
  discordClientId: env.DISCORD_CLIENT_ID,
  discordGuildId: env.DISCORD_GUILD_ID,
  discordChannelId: env.DISCORD_CHANNEL_ID,
  discordMention: env.DISCORD_MENTION.trim(),
} as const;
