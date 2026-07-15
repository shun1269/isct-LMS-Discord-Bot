import type {
  AssignmentRecord,
  ReminderType,
  SyncRun,
  UpcomingCounts,
  UrgencyLevel,
  UrgencyStyle,
} from "./types";

export interface DiscordEmbed { title?: string; description?: string; color?: number; timestamp?: string }
export interface AllowedMentions { parse: string[]; users?: string[]; roles?: string[] }

const HOUR = 3_600;
const DAY = 24 * HOUR;

const URGENCY_STYLES: Record<UrgencyLevel, UrgencyStyle> = {
  overdue: { level: "overdue", emoji: "⛔", label: "期限超過", color: 0x4B4B4B, mentionRequired: true },
  critical: { level: "critical", emoji: "🚨", label: "超緊急", color: 0xFF2D2D, mentionRequired: true },
  urgent: { level: "urgent", emoji: "🔴", label: "緊急", color: 0xFF4D4F, mentionRequired: true },
  warning: { level: "warning", emoji: "🟠", label: "注意", color: 0xFF8C00, mentionRequired: true },
  near: { level: "near", emoji: "🟡", label: "近い", color: 0xFFD60A, mentionRequired: false },
  normal: { level: "normal", emoji: "🟢", label: "通常", color: 0x34C759, mentionRequired: false },
  future: { level: "future", emoji: "🔵", label: "先の予定", color: 0x3B82F6, mentionRequired: false },
};

export function getUrgencyLevel(remainingSeconds: number): UrgencyLevel {
  if (remainingSeconds <= 0) return "overdue";
  if (remainingSeconds <= HOUR) return "critical";
  if (remainingSeconds <= 3 * HOUR) return "urgent";
  if (remainingSeconds <= DAY) return "warning";
  if (remainingSeconds <= 3 * DAY) return "near";
  if (remainingSeconds <= 7 * DAY) return "normal";
  return "future";
}

export function getUrgencyStyle(level: UrgencyLevel): UrgencyStyle {
  return URGENCY_STYLES[level];
}

export function formatRemainingTime(remainingSeconds: number): string {
  if (remainingSeconds <= 0) return "提出期限を過ぎています";
  const totalMinutes = Math.max(1, Math.ceil(remainingSeconds / 60));
  if (totalMinutes < 60) return `残り ${totalMinutes}分`;
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (remainingSeconds < DAY) return `残り ${totalHours}時間${minutes > 0 ? `${minutes}分` : ""}`;
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `残り ${days}日${hours > 0 ? `${hours}時間` : ""}`;
}

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

function assignmentListTitle(level: UrgencyLevel): string {
  if (level === "overdue") return "⛔ 締切超過の課題があります";
  if (level === "critical") return "🚨 今すぐ対応すべき課題があります";
  if (level === "urgent") return "🔴 緊急の課題があります";
  if (level === "warning") return "🟠 緊急の課題があります";
  if (level === "near") return "🟡 締切の近い課題があります";
  return "📚 課題一覧";
}

export function buildAssignmentListEmbed(
  assignments: AssignmentRecord[],
  days: number,
  nowUnix = Math.floor(Date.now() / 1000),
): DiscordEmbed {
  if (assignments.length === 0) {
    return {
      title: "✅ 対象期間内の課題はありません",
      description: `今後${days}日以内に期限を迎える課題はありません。`,
      color: 0x34C759,
    };
  }

  const sorted = [...assignments].sort((a, b) => a.deadlineUnix - b.deadlineUnix);
  const levels = sorted.map((item) => getUrgencyLevel(item.deadlineUnix - nowUnix));
  const mostUrgent = levels[0] ?? "future";
  const counts = new Map<UrgencyLevel, number>();
  for (const level of levels) counts.set(level, (counts.get(level) ?? 0) + 1);
  const summaryLabels: Array<[UrgencyLevel, string]> = [
    ["overdue", "期限超過"], ["critical", "1時間以内"], ["urgent", "3時間以内"],
    ["warning", "24時間以内"], ["near", "3日以内"], ["normal", "7日以内"], ["future", "7日より先"],
  ];
  const lines = summaryLabels
    .filter(([level]) => (counts.get(level) ?? 0) > 0)
    .map(([level, label]) => `${getUrgencyStyle(level).emoji} ${label} ${counts.get(level)}件`);
  lines.push("", "締切の近い順に表示しています。");

  for (const assignment of sorted) {
    const remaining = assignment.deadlineUnix - nowUnix;
    const style = getUrgencyStyle(getUrgencyLevel(remaining));
    const timeEmoji = style.level === "critical" ? "🚨" : style.level === "overdue" ? "⛔" : "⏳";
    const block = [
      "",
      `### ${style.emoji} ${truncate(assignment.title, 120)}`,
      `**${truncate(assignment.courseJa, 80)}**`,
      `**${timeEmoji} ${formatRemainingTime(remaining)}**`,
      `📅 締切：<t:${assignment.deadlineUnix}:F>`,
      `🔗 [課題を開く](${assignment.url})`,
    ];
    if (lines.join("\n").length + block.join("\n").length > 3_800) {
      lines.push("", "…表示上限のため、以降は省略しました。");
      break;
    }
    lines.push(...block);
  }

  return {
    title: assignmentListTitle(mostUrgent),
    description: lines.join("\n"),
    color: getUrgencyStyle(mostUrgent).color,
  };
}

export function formatSyncStatus(
  lastSync: SyncRun | null,
  counts?: UpcomingCounts,
  nowMs = Date.now(),
): string {
  if (!lastSync) return "まだLMSから同期されていません。";
  const unix = Math.floor(Date.parse(lastSync.syncedAt) / 1000);
  const lines = [
    `最終同期：<t:${unix}:F>（<t:${unix}:R>）`,
    `受信件数：${lastSync.receivedCount}件`,
    `完全同期：${lastSync.complete ? "はい" : "いいえ（50件上限など）"}`,
    `source：${lastSync.source}`,
  ];
  if (counts) {
    lines.push("", `24時間以内：${counts.within24Hours}件`, `3日以内：${counts.within3Days}件`, `7日以内：${counts.within7Days}件`);
  }
  if (nowMs - Date.parse(lastSync.syncedAt) >= DAY * 1000) {
    lines.push("", "⚠️ **LMSとの最終同期から24時間以上経過しています。**");
  }
  return lines.join("\n");
}

export function reminderTitle(type: ReminderType, style?: UrgencyStyle): string {
  const emoji = style?.emoji ?? "⏰";
  if (type === "7d") return `${emoji} 締切まで7日以内です`;
  if (type === "3d") return `${emoji} 締切まで3日を切りました`;
  if (type === "2d") return `${emoji} 締切まで2日を切りました`;
  const hours = Number(/^hourly-(\d+)$/.exec(type)?.[1]);
  if (!Number.isInteger(hours) || hours < 1 || hours > 24) return `${emoji} 課題の締切が近づいています`;
  if (hours === 1) return `${emoji} 締切まで1時間を切りました`;
  if (hours === 24) return `${emoji} 締切まで24時間を切りました`;
  return `${emoji} 締切まで${hours}時間です`;
}

export function allowedMentions(mention: string): AllowedMentions {
  const user = /^<@(\d+)>$/.exec(mention.trim())?.[1];
  if (user) return { parse: [], users: [user] };
  const role = /^<@&(\d+)>$/.exec(mention.trim())?.[1];
  if (role) return { parse: [], roles: [role] };
  return { parse: [] };
}

export function buildReminderMessage(
  assignment: AssignmentRecord,
  type: ReminderType,
  mention: string,
  nowUnix = Math.floor(Date.now() / 1000),
): { content?: string; embeds: DiscordEmbed[]; allowed_mentions: AllowedMentions } {
  const remaining = assignment.deadlineUnix - nowUnix;
  const style = getUrgencyStyle(getUrgencyLevel(remaining));
  const timeEmoji = style.level === "critical" ? "🚨" : style.level === "overdue" ? "⛔" : "⏳";
  const validMention = style.mentionRequired && /^(?:<@\d+>|<@&\d+>)$/.test(mention.trim()) ? mention.trim() : "";
  const message: { content?: string; embeds: DiscordEmbed[]; allowed_mentions: AllowedMentions } = {
    embeds: [{
      title: reminderTitle(type, style),
      description: [
        `**${truncate(assignment.courseJa, 256)}**`, truncate(assignment.title, 512), "",
        `**${timeEmoji} ${formatRemainingTime(remaining)}**`,
        `📅 締切：<t:${assignment.deadlineUnix}:F>`,
        `🔗 [課題を開く](${assignment.url})`,
      ].join("\n"),
      color: style.color,
      timestamp: new Date().toISOString(),
    }],
    allowed_mentions: validMention ? allowedMentions(validMention) : { parse: [] },
  };
  if (validMention) message.content = validMention;
  return message;
}
