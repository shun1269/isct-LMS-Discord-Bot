const required = ["DISCORD_BOT_TOKEN", "DISCORD_APPLICATION_ID", "DISCORD_GUILD_ID"] as const;
for (const name of required) if (!process.env[name] || /^(replace[-_]|REPLACE_)/i.test(process.env[name]!)) throw new Error(`${name} is required in .env or the environment`);

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
  {
    name: "todo",
    description: "Add a task with a deadline", description_localizations: { ja: "期限付きのタスクを追加します" }, type: 1,
    options: [
      { type: 3, name: "name", name_localizations: { ja: "名前" }, description: "Task name", description_localizations: { ja: "タスク名" }, required: true, max_length: 100 },
      { type: 3, name: "deadline", name_localizations: { ja: "期限" }, description: "Deadline in JST (e.g. Fri, 11/10 18:00)", description_localizations: { ja: "期限（例：金、明日 18、3日後、11/10 12:00）" }, required: true, autocomplete: true, max_length: 100 },
    ],
  },
];

const response = await fetch(`https://discord.com/api/v10/applications/${process.env.DISCORD_APPLICATION_ID}/guilds/${process.env.DISCORD_GUILD_ID}/commands`, {
  method: "PUT", headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(commands), signal: AbortSignal.timeout(15_000),
});
if (!response.ok) throw new Error(`Discord command registration failed (${response.status})`);
console.log(`Registered ${commands.length} guild commands.`);
