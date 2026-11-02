import { Client, Events, GatewayIntentBits, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { commandReply } from "./commands.js";
import type { Env } from "./env.js";
import { verifyDiscordApplication } from "./discord-application.js";

type CommandInteraction = Pick<ChatInputCommandInteraction, "guildId" | "commandName" | "options" | "deferReply" | "editReply" | "reply" | "deferred" | "replied">;

export async function handleGatewayCommand(interaction: CommandInteraction, env: Env): Promise<void> {
  if (interaction.guildId !== env.DISCORD_GUILD_ID) {
    await interaction.reply({ content: "このサーバーでは利用できません。", flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const days = interaction.commandName === "assignments" ? interaction.options.getInteger("days") : undefined;
    await interaction.editReply({ ...await commandReply(env, interaction.commandName, days), allowedMentions: { parse: [] } });
  } catch {
    console.error("Discord command failed", { command: interaction.commandName });
    const errorReply = { content: "処理に失敗しました。時間をおいて再試行してください。", allowedMentions: { parse: [] as never[] } };
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply(errorReply);
      else await interaction.reply({ ...errorReply, flags: MessageFlags.Ephemeral });
    } catch { console.error("Could not deliver command error response"); }
  }
}

export async function startGateway(env: Env, onInvalidated: () => void): Promise<Client> {
  await verifyDiscordApplication(env);
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.once(Events.ClientReady, () => console.log("Discord gateway ready"));
  client.on(Events.Error, () => console.error("Discord gateway error"));
  client.once(Events.Invalidated, onInvalidated);
  client.on(Events.InteractionCreate, (interaction) => {
    if (interaction.isChatInputCommand()) void handleGatewayCommand(interaction, env).catch(() => console.error("Discord command handler failed"));
  });
  try { await client.login(env.DISCORD_BOT_TOKEN); }
  catch (error) { await client.destroy(); throw error; }
  return client;
}
