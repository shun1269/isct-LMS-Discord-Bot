import { REST, Routes } from "discord.js";
import { commandDefinitions } from "./commands.js";
import { config } from "./config.js";

const rest = new REST({ version: "10" }).setToken(config.discordBotToken);

console.log("Registering guild commands...");

await rest.put(
  Routes.applicationGuildCommands(
    config.discordClientId,
    config.discordGuildId,
  ),
  { body: commandDefinitions.map((command) => command.toJSON()) },
);

console.log("Guild commands registered.");
