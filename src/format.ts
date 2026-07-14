import {
  EmbedBuilder,
  type MessageCreateOptions,
} from "discord.js";
import { config } from "./config.js";
import type { AssignmentRecord, ReminderType } from "./types.js";

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function assignmentLine(assignment: AssignmentRecord): string {
  const unix = assignment.deadlineUnix;
  return [
    `**${truncate(assignment.courseJa, 80)} — ${truncate(assignment.title, 120)}**`,
    `<t:${unix}:F>（<t:${unix}:R>） · [課題を開く](${assignment.url})`,
  ].join("\n");
}

export function buildAssignmentListEmbed(
  assignments: AssignmentRecord[],
  days: number,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`未期限課題（今後${days}日）`)
    .setTimestamp();

  if (assignments.length === 0) {
    return embed.setDescription("該当する課題はありません。");
  }

  const lines: string[] = [];
  let length = 0;

  for (const assignment of assignments) {
    const line = assignmentLine(assignment);
    if (length + line.length + 2 > 3_800) {
      lines.push("…表示上限のため、以降は省略しました。");
      break;
    }
    lines.push(line);
    length += line.length + 2;
  }

  return embed.setDescription(lines.join("\n\n"));
}

function getReminderTitle(
  reminderType: ReminderType,
): string {
  if (reminderType === "7d") {
    return "締切まで7日以内です";
  }

  const match =
    /^hourly-(\d+)$/.exec(reminderType);

  if (!match?.[1]) {
    return "課題の締切が近づいています";
  }

  const hours = Number(match[1]);

  if (hours === 24) {
    return "締切まで24時間を切りました";
  }

  if (hours === 1) {
    return "締切まで1時間を切りました";
  }

  return `締切まで${hours}時間を切りました`;
}

function allowedMentionsFromConfig(): NonNullable<MessageCreateOptions["allowedMentions"]> {
  const userMatch = config.discordMention.match(/^<@(\d+)>$/);
  if (userMatch?.[1]) {
    return { parse: [], users: [userMatch[1]] };
  }

  const roleMatch = config.discordMention.match(/^<@&(\d+)>$/);
  if (roleMatch?.[1]) {
    return { parse: [], roles: [roleMatch[1]] };
  }

  return { parse: [] };
}

export function buildReminderMessage(
  assignment: AssignmentRecord,
  reminderType: ReminderType,
): MessageCreateOptions {
  const mention = config.discordMention
    ? `${config.discordMention}\n`
    : "";

  const embed = new EmbedBuilder()
  .setTitle(
    getReminderTitle(reminderType)
  )    
  .setDescription(
      [
        `**${assignment.courseJa}**`,
        assignment.title,
        "",
        `期限：<t:${assignment.deadlineUnix}:F>（<t:${assignment.deadlineUnix}:R>）`,
        `[課題を開く](${assignment.url})`,
      ].join("\n"),
    )
    .setTimestamp();

  const message: MessageCreateOptions = {
    embeds: [embed],
    allowedMentions: allowedMentionsFromConfig(),
  };

  if (mention) {
    message.content = mention;
  }

  return message;
}
