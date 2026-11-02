import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";
import { loadConfig } from "../src/config.js";

// Read existing local Cloudflare secrets without printing them or replacing .env.
process.umask(0o077);
const output = resolve(process.argv[2] ?? "data/ubuntu.env");
const host = process.argv[3] ?? "127.0.0.1";
if (!/^[a-zA-Z0-9.:_-]+$/.test(host)) throw new Error("Invalid bind host");
const originalConfig = JSON.parse(readFileSync("wrangler.jsonc", "utf8")) as { vars?: Record<string, string> };
const previousSecrets = existsSync(".dev.vars") ? parseEnv(readFileSync(".dev.vars", "utf8")) : {};
const values = {
  ...parseEnv(readFileSync(".env.example", "utf8")), ...originalConfig.vars, ...previousSecrets,
  HOST: host, PORT: "3000", DATABASE_PATH: "/var/lib/lms-bot/lms.sqlite", DISCORD_MODE: "gateway",
};
loadConfig(values);
mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
writeFileSync(output, Object.entries(values).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join("\n") + "\n", { flag: "wx", mode: 0o600 });
console.log("Ubuntu environment file created; secret values were not printed", { path: output });
