import type { Env } from "./env";
import { sendReminder } from "./discord-api";
import { claimReminder, listReminderCandidates, markReminderSent, releaseReminderClaim } from "./repository";
import type { AssignmentRecord, ReminderType } from "./types";

const HOUR = 3_600;
const DAY = 24 * HOUR;

export function selectReminderType(deadlineUnix: number, nowUnix: number): ReminderType | null {
  const remainingSeconds = deadlineUnix - nowUnix;
  if (remainingSeconds <= 0) return null;
  if (remainingSeconds < DAY) {
    const hours = Math.min(24, Math.max(1, Math.ceil(remainingSeconds / HOUR)));
    return `hourly-${hours}`;
  }
  if (remainingSeconds < 2 * DAY) return "2d";
  if (remainingSeconds < 3 * DAY) return "3d";
  return remainingSeconds <= 7 * DAY ? "7d" : null;
}

export async function processReminderCandidate(
  env: Env,
  assignment: AssignmentRecord,
  now: Date,
  sender: typeof sendReminder = sendReminder,
): Promise<boolean> {
  const type = selectReminderType(assignment.deadlineUnix, Math.floor(now.getTime() / 1000));
  if (!type || !(await claimReminder(env.DB, assignment, type, now))) return false;
  try {
    await sender(env, assignment, type);
    await markReminderSent(env.DB, assignment, type, now);
    console.log("Reminder sent", { eventId: assignment.eventId, reminderType: type });
    return true;
  } catch (error) {
    await releaseReminderClaim(env.DB, assignment, type);
    console.error("Reminder delivery failed", { eventId: assignment.eventId, reminderType: type, error: error instanceof Error ? error.message : "unknown error" });
    return false;
  }
}

export async function checkReminders(env: Env, now = new Date()): Promise<void> {
  const nowUnix = Math.floor(now.getTime() / 1000);
  console.log("Reminder cron started", { now: now.toISOString() });
  const candidates = await listReminderCandidates(env.DB, nowUnix, nowUnix + 7 * DAY);
  let sent = 0;
  for (const assignment of candidates) {
    if (await processReminderCandidate(env, assignment, now)) sent += 1;
  }
  console.log("Reminder cron finished", { candidates: candidates.length, sent });
}
