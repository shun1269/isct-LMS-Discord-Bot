import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";

Object.assign(process.env, parse(readFileSync(resolve(".dev.vars"), "utf8")));
const required = ["DISCORD_BOT_TOKEN", "DISCORD_APPLICATION_ID", "DISCORD_GUILD_ID"] as const;
for (const name of required) if (!process.env[name] || process.env[name]?.startsWith("replace-")) throw new Error(`${name} is required in .dev.vars`);

const commands = [
  {
    name: "assignments", name_localizations: { ja: "課題" },
    description: "Show upcoming LMS assignments", description_localizations: { ja: "LMSの未期限課題を表示します" }, type: 1,
    options: [{ type: 4, name: "days", name_localizations: { ja: "日数" }, description: "Number of days to show", description_localizations: { ja: "何日先まで表示するか" }, min_value: 1, max_value: 365, required: false }],
  },
  {
    name: "sync-status", name_localizations: { ja: "同期状態" },
    description: "Show the latest LMS sync status", description_localizations: { ja: "LMSとの最終同期状態を表示します" }, type: 1,
  },
];

const response = await fetch(`https://discord.com/api/v10/applications/${process.env.DISCORD_APPLICATION_ID}/guilds/${process.env.DISCORD_GUILD_ID}/commands`, {
  method: "PUT", headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(commands),
});
if (!response.ok) throw new Error(`Discord command registration failed (${response.status}): ${(await response.text()).slice(0, 1000)}`);
console.log(`Registered ${commands.length} guild commands.`);
