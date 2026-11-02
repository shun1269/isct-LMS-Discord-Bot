import type { Env } from "./env.js";
import { buildAssignmentListEmbed, formatSyncStatus, type DiscordEmbed } from "./format.js";
import { countUpcomingAssignments, getLastSync, listUpcomingAssignments } from "./repository.js";

export interface CommandReply { content?: string; embeds?: DiscordEmbed[] }

export async function commandReply(env: Env, name: string, requestedDays?: unknown): Promise<CommandReply> {
  const nowUnix = Math.floor(Date.now() / 1000);
  if (name === "assignments") {
    const days = typeof requestedDays === "number" && Number.isInteger(requestedDays) && requestedDays >= 1 && requestedDays <= 365 ? requestedDays : 30;
    const assignments = await listUpcomingAssignments(env.DB, nowUnix, nowUnix + days * 86_400, 50);
    return { embeds: [buildAssignmentListEmbed(assignments, days, nowUnix)] };
  }
  if (name === "sync-status") {
    const [lastSync, counts] = await Promise.all([getLastSync(env.DB), countUpcomingAssignments(env.DB, nowUnix)]);
    return { content: formatSyncStatus(lastSync, counts, nowUnix * 1000) };
  }
  return { content: "未知のコマンドです。コマンドを再登録してください。" };
}
