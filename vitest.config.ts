import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

process.env.WRANGLER_LOG_PATH = ".wrangler/logs/vitest.log";

export default defineConfig({
  plugins: [cloudflareTest({
    miniflare: {
      compatibilityDate: "2026-07-14",
      d1Databases: ["DB"],
      bindings: {
        SYNC_TOKEN: "test-sync-token",
        DISCORD_BOT_TOKEN: "test-bot-token",
        DISCORD_PUBLIC_KEY: "test-public-key",
        DISCORD_APPLICATION_ID: "1",
        DISCORD_GUILD_ID: "2",
        DISCORD_CHANNEL_ID: "3",
        DISCORD_MENTION: "",
      },
    },
  })],
});
