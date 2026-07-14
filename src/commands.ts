import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { buildAssignmentListEmbed } from "./format.js";
import { getLastSync, listUpcomingAssignments } from "./repository.js";

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("assignments")
    .setNameLocalization("ja", "課題")
    .setDescription("Show upcoming LMS assignments")
    .setDescriptionLocalization("ja", "LMSの未期限課題を表示します")
    .addIntegerOption((option) =>
      option
        .setName("days")
        .setNameLocalization("ja", "日数")
        .setDescription("Number of days to show")
        .setDescriptionLocalization("ja", "何日先まで表示するか")
        .setMinValue(1)
        .setMaxValue(365),
    ),
  new SlashCommandBuilder()
    .setName("sync-status")
    .setNameLocalization("ja", "同期状態")
    .setDescription("Show the latest LMS sync status")
    .setDescriptionLocalization("ja", "LMSとの最終同期状態を表示します"),
];

export async function handleCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (interaction.commandName === "assignments") {
    const days = interaction.options.getInteger("days") ?? 30;
    const nowUnix = Math.floor(Date.now() / 1000);
    const untilUnix = nowUnix + days * 24 * 60 * 60;
    const assignments = listUpcomingAssignments(nowUnix, untilUnix, 50);

    await interaction.reply({
      embeds: [buildAssignmentListEmbed(assignments, days)],
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "sync-status") {
    const lastSync = getLastSync();

    if (!lastSync) {
      await interaction.reply({
        content: "まだLMSから同期されていません。",
        ephemeral: true,
      });
      return;
    }

    const syncUnix = Math.floor(new Date(lastSync.syncedAt).getTime() / 1000);
    await interaction.reply({
      content: [
        `最終同期：<t:${syncUnix}:F>（<t:${syncUnix}:R>）`,
        `受信件数：${lastSync.receivedCount}件`,
        `完全同期：${lastSync.complete ? "はい" : "いいえ（50件上限など）"}`,
      ].join("\n"),
      ephemeral: true,
    });
  }
}
