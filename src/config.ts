import { resolve } from "node:path";
import type { Env } from "./env.js";

export interface Config extends Omit<Env, "DB"> { HOST: string; PORT: number; DATABASE_PATH: string }

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Config {
  function required(name: string): string {
    const value = environment[name]?.trim();
    if (!value || /^(replace[-_]|REPLACE_)/i.test(value)) throw new Error(`${name} must be configured`);
    return value;
  }
  const mode = environment.DISCORD_MODE ?? "gateway";
  if (mode !== "gateway" && mode !== "http") throw new Error("DISCORD_MODE must be gateway or http");
  const syncToken = required("SYNC_TOKEN");
  if (syncToken.length < 32 || /\s/.test(syncToken)) throw new Error("SYNC_TOKEN must have at least 32 characters and no whitespace");
  const port = Number(environment.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535");
  const ids = ["DISCORD_APPLICATION_ID", "DISCORD_GUILD_ID", "DISCORD_CHANNEL_ID"] as const;
  const discordIds = Object.fromEntries(ids.map((name) => {
    const value = required(name);
    if (!/^\d+$/.test(value)) throw new Error(`${name} must be a Discord ID`);
    return [name, value];
  })) as Pick<Config, typeof ids[number]>;
  const ownerId = environment.DISCORD_OWNER_ID?.trim() ?? "";
  if (ownerId && !/^\d+$/.test(ownerId)) throw new Error("DISCORD_OWNER_ID must be a Discord ID");
  const publicKey = mode === "http" ? required("DISCORD_PUBLIC_KEY") : (environment.DISCORD_PUBLIC_KEY ?? "");
  if (mode === "http" && !/^[a-f0-9]{64}$/i.test(publicKey)) throw new Error("DISCORD_PUBLIC_KEY must be a 64-character hexadecimal key");
  return {
    ...discordIds, HOST: environment.HOST ?? "127.0.0.1", PORT: port,
    DATABASE_PATH: resolve(environment.DATABASE_PATH ?? "data/lms.sqlite"),
    DISCORD_MODE: mode, SYNC_TOKEN: syncToken,
    DISCORD_BOT_TOKEN: required("DISCORD_BOT_TOKEN"), DISCORD_PUBLIC_KEY: publicKey,
    DISCORD_MENTION: environment.DISCORD_MENTION ?? "", DISCORD_OWNER_ID: ownerId,
  };
}
