import type { Env } from "./env.js";
import { buildAssignmentListEmbed, buildReminderToggleComponents, formatSyncStatus, REMINDER_TOGGLE_PREFIX, type DiscordActionRow, type DiscordEmbed } from "./format.js";
import { countUpcomingAssignments, getLastSync, listOpenTodos, listUpcomingAssignments, setRemindersMuted } from "./repository.js";
import { buildTodoListEmbed } from "./todos.js";

export interface CommandReply { content?: string; embeds?: DiscordEmbed[]; components?: DiscordActionRow[] }

function validDays(requestedDays: unknown): number {
  return typeof requestedDays === "number" && Number.isInteger(requestedDays) && requestedDays >= 1 && requestedDays <= 365 ? requestedDays : 30;
}

async function assignmentListReply(env: Env, days: number): Promise<CommandReply> {
  const nowUnix = Math.floor(Date.now() / 1000);
  const [assignments, todos] = await Promise.all([listUpcomingAssignments(env.DB, nowUnix, nowUnix + days * 86_400, 50), listOpenTodos(env.DB)]);
  const todoEmbed = buildTodoListEmbed(todos);
  return { embeds: [buildAssignmentListEmbed(assignments, days, nowUnix), ...(todoEmbed ? [todoEmbed] : [])], components: buildReminderToggleComponents(assignments, days) };
}

export async function commandReply(env: Env, name: string, requestedDays?: unknown): Promise<CommandReply> {
  if (name === "assignments") return assignmentListReply(env, validDays(requestedDays));
  if (name === "sync-status") {
    const nowUnix = Math.floor(Date.now() / 1000);
    const [lastSync, counts] = await Promise.all([getLastSync(env.DB), countUpcomingAssignments(env.DB, nowUnix)]);
    return { content: formatSyncStatus(lastSync, counts, nowUnix * 1000) };
  }
  return { content: "未知のコマンドです。コマンドを再登録してください。" };
}

// Returns null for components this bot does not own. The refreshed list replaces the original message.
export async function componentReply(env: Env, customId: string, values: readonly string[]): Promise<CommandReply | null> {
  if (!customId.startsWith(REMINDER_TOGGLE_PREFIX)) return null;
  const days = validDays(Number(customId.slice(REMINDER_TOGGLE_PREFIX.length)));
  const match = /^(mute|unmute):(science-tokyo-lms-\d{4}):(\d+)$/.exec(values[0] ?? "");
  if (!match) return null;
  await setRemindersMuted(env.DB, match[2]!, Number(match[3]), match[1] === "mute");
  return assignmentListReply(env, days);
}
