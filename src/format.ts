import type { AssignmentRecord, ReminderType, SyncRun } from "./types";

export interface DiscordEmbed { title?: string; description?: string; timestamp?: string }
export interface AllowedMentions { parse: string[]; users?: string[]; roles?: string[] }

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

export function formatAssignmentList(assignments: AssignmentRecord[], days: number): string {
  if (assignments.length === 0) return `未期限課題（今後${days}日）\n該当する課題はありません。`;
  const lines = [`**未期限課題（今後${days}日）**`];
  let length = lines[0]?.length ?? 0;
  for (const assignment of assignments) {
    const line = [
      `**${truncate(assignment.courseJa, 80)} — ${truncate(assignment.title, 120)}**`,
      `<t:${assignment.deadlineUnix}:F>（<t:${assignment.deadlineUnix}:R>） · [課題を開く](${assignment.url})`,
    ].join("\n");
    if (length + line.length + 2 > 3_800) {
      lines.push("…表示上限のため、以降は省略しました。");
      break;
    }
    lines.push(line);
    length += line.length + 2;
  }
  return lines.join("\n\n");
}

export function formatSyncStatus(lastSync: SyncRun | null): string {
  if (!lastSync) return "まだLMSから同期されていません。";
  const unix = Math.floor(Date.parse(lastSync.syncedAt) / 1000);
  return [
    `最終同期：<t:${unix}:F>（<t:${unix}:R>）`,
    `受信件数：${lastSync.receivedCount}件`,
    `完全同期：${lastSync.complete ? "はい" : "いいえ（50件上限など）"}`,
    `source：${lastSync.source}`,
  ].join("\n");
}

export function reminderTitle(type: ReminderType): string {
  if (type === "7d") return "締切まで7日以内です";
  const hours = Number(/^hourly-(\d+)$/.exec(type)?.[1]);
  return Number.isInteger(hours) && hours >= 1 && hours <= 24
    ? `締切まで${hours}時間を切りました`
    : "課題の締切が近づいています";
}

export function allowedMentions(mention: string): AllowedMentions {
  const user = /^<@(\d+)>$/.exec(mention.trim())?.[1];
  if (user) return { parse: [], users: [user] };
  const role = /^<@&(\d+)>$/.exec(mention.trim())?.[1];
  if (role) return { parse: [], roles: [role] };
  return { parse: [] };
}

export function buildReminderMessage(assignment: AssignmentRecord, type: ReminderType, mention: string): { content?: string; embeds: DiscordEmbed[]; allowed_mentions: AllowedMentions } {
  const validMention = /^(?:<@\d+>|<@&\d+>)$/.test(mention.trim()) ? mention.trim() : "";
  const message: { content?: string; embeds: DiscordEmbed[]; allowed_mentions: AllowedMentions } = {
    embeds: [{
      title: reminderTitle(type),
      description: [
        `**${truncate(assignment.courseJa, 256)}**`, truncate(assignment.title, 512), "",
        `期限：<t:${assignment.deadlineUnix}:F>（<t:${assignment.deadlineUnix}:R>）`,
        `[課題を開く](${assignment.url})`,
      ].join("\n"),
      timestamp: new Date().toISOString(),
    }],
    allowed_mentions: allowedMentions(mention),
  };
  if (validMention) message.content = validMention;
  return message;
}
