import {
  Client,
  Events,
  GatewayIntentBits,
} from "discord.js";
import { config } from "./config.js";
import { handleCommand } from "./commands.js";

export const discordClient = new Client({
  intents: [GatewayIntentBits.Guilds],
});

discordClient.once(Events.ClientReady, (client) => {
  console.log(`Discord bot logged in as ${client.user.tag}`);
});

discordClient.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    await handleCommand(interaction);
  } catch (error) {
    console.error("Command failed:", error);

    const message = "コマンドの処理中にエラーが発生しました。";
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: message, ephemeral: true });
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  }
});

export async function startDiscordBot(): Promise<void> {
  await discordClient.login(config.discordBotToken);
}
