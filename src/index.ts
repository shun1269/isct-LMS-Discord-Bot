import { once } from "node:events";
import type { Client } from "discord.js";
import { loadConfig } from "./config.js";
import { Database } from "./database.js";
import { startGateway } from "./gateway.js";
import { createHttpServer } from "./http-server.js";

process.umask(0o077);
const config = loadConfig();
const database = new Database(config.DATABASE_PATH);
const env = { ...config, DB: database };
const server = createHttpServer(env);
let client: Client | undefined;
let closing = false;

async function shutdown(code = 0): Promise<void> {
  if (closing) return;
  closing = true;
  const forceExit = setTimeout(() => process.exit(1), 15_000);
  forceExit.unref();
  if (client) await client.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  database.close();
  clearTimeout(forceExit);
  process.exitCode = code;
}

process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });

try {
  server.listen(config.PORT, config.HOST);
  await once(server, "listening");
  console.log("LMS API listening", { host: config.HOST, port: config.PORT, discordMode: config.DISCORD_MODE });
  if (config.DISCORD_MODE === "gateway") client = await startGateway(env, () => { void shutdown(1); });
  server.on("error", () => { console.error("HTTP server error"); void shutdown(1); });
} catch (error) {
  const knownMessage = error instanceof Error && [
    "Discord application verification failed",
    "DISCORD_APPLICATION_ID does not match the bot token",
    "Clear the Interactions Endpoint URL in Discord Developer Portal before enabling Gateway mode",
  ].includes(error.message) ? error.message : undefined;
  if (knownMessage) console.error(knownMessage);
  console.error("Application startup failed; check configuration, network and Discord credentials");
  await shutdown(1);
}
