import { createApi } from "./api.js";
import { config } from "./config.js";
import { startDiscordBot } from "./discord.js";
import { startReminderLoop } from "./reminders.js";

const app = createApi();

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`Sync API listening on http://127.0.0.1:${config.port}`);
});

await startDiscordBot();
const reminderTimer = startReminderLoop();

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}; shutting down...`);
  clearInterval(reminderTimer);

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
