import { Client, Events, GatewayIntentBits, MessageFlags, type ChatInputCommandInteraction, type StringSelectMenuInteraction } from "discord.js";
import { commandReply, componentReply } from "./commands.js";
import type { Env } from "./env.js";
import { verifyDiscordApplication } from "./discord-application.js";

type CommandInteraction = Pick<ChatInputCommandInteraction, "guildId" | "commandName" | "options" | "deferReply" | "editReply" | "reply" | "deferred" | "replied">;
type SelectInteraction = Pick<StringSelectMenuInteraction, "guildId" | "customId" | "values" | "update" | "reply" | "followUp" | "deferred" | "replied">;

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

export async function handleGatewaySelect(interaction: SelectInteraction, env: Env): Promise<void> {
  if (interaction.guildId !== env.DISCORD_GUILD_ID) {
    await interaction.reply({ content: "このサーバーでは利用できません。", flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  try {
    const reply = await componentReply(env, interaction.customId, interaction.values);
    if (!reply) {
      await interaction.reply({ content: "この操作は利用できません。`/課題` を再実行してください。", flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return;
    }
    await interaction.update({ ...reply, allowedMentions: { parse: [] } });
  } catch {
    console.error("Discord component failed", { customId: interaction.customId });
    const errorReply = { content: "処理に失敗しました。時間をおいて再試行してください。", flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] as never[] } } as const;
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(errorReply);
      else await interaction.reply(errorReply);
    } catch { console.error("Could not deliver component error response"); }
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
    else if (interaction.isStringSelectMenu()) void handleGatewaySelect(interaction, env).catch(() => console.error("Discord component handler failed"));
  });
  try { await client.login(env.DISCORD_BOT_TOKEN); }
  catch (error) { await client.destroy(); throw error; }
  return client;
}
