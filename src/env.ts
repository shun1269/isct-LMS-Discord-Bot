import type { Database } from "./database.js";

export interface Env {
  DB: Database;
  SYNC_TOKEN: string;
  DISCORD_BOT_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
  DISCORD_GUILD_ID: string;
  DISCORD_CHANNEL_ID: string;
  DISCORD_MENTION: string;
  DISCORD_MODE: "gateway" | "http";
}
