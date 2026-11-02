import type { Env } from "./env.js";
import { sendReminder, sendTodoReminder } from "./discord-api.js";
import { claimReminder, listReminderCandidates, listTodoReminderCandidates, markReminderSent, releaseReminderClaim } from "./repository.js";
import { todoReminderTarget } from "./todos.js";
import type { AssignmentRecord, ReminderTarget, ReminderType, TodoRecord } from "./types.js";

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

// Claims the current bucket, sends, and records it; a failed send releases the claim for the next run.
async function deliverReminder(
  env: Env,
  target: ReminderTarget,
  now: Date,
  send: (type: ReminderType) => Promise<void>,
  logFields: Record<string, unknown>,
): Promise<boolean> {
  const type = selectReminderType(target.deadlineUnix, Math.floor(now.getTime() / 1000));
  if (!type || !(await claimReminder(env.DB, target, type, now))) return false;
  let delivered = false;
  try {
    await send(type);
    delivered = true;
    await markReminderSent(env.DB, target, type, now);
    console.log("Reminder sent", { ...logFields, reminderType: type });
    return true;
  } catch (error) {
    // If Discord accepted the message, retain the claim until expiry even if saving the receipt failed.
    if (!delivered) await releaseReminderClaim(env.DB, target, type);
    console.error("Reminder delivery failed", { ...logFields, reminderType: type, delivered });
    return false;
  }
}

export async function processReminderCandidate(
  env: Env,
  assignment: AssignmentRecord,
  now: Date,
  sender: typeof sendReminder = sendReminder,
): Promise<boolean> {
  return deliverReminder(env, assignment, now, (type) => sender(env, assignment, type), { eventId: assignment.eventId });
}

export async function processTodoReminderCandidate(
  env: Env,
  todo: TodoRecord & { deadlineUnix: number },
  now: Date,
  sender: typeof sendTodoReminder = sendTodoReminder,
): Promise<boolean> {
  return deliverReminder(env, todoReminderTarget(todo), now, (type) => sender(env, todo, type), { todoId: todo.id });
}

export async function checkReminders(env: Env, now = new Date()): Promise<void> {
  const nowUnix = Math.floor(now.getTime() / 1000);
  console.log("Reminder cron started", { now: now.toISOString() });
  const candidates = await listReminderCandidates(env.DB, nowUnix, nowUnix + 7 * DAY);
  const todos = await listTodoReminderCandidates(env.DB, nowUnix, nowUnix + 7 * DAY);
  let sent = 0;
  let failed = 0;
  for (const assignment of candidates) {
    try { if (await processReminderCandidate(env, assignment, now)) sent += 1; }
    catch { failed += 1; console.error("Reminder processing failed", { eventId: assignment.eventId }); }
  }
  for (const todo of todos) {
    try { if (await processTodoReminderCandidate(env, { ...todo, deadlineUnix: todo.deadlineUnix! }, now)) sent += 1; }
    catch { failed += 1; console.error("Reminder processing failed", { todoId: todo.id }); }
  }
  console.log("Reminder check finished", { candidates: candidates.length, todoCandidates: todos.length, sent, failed });
  if (failed > 0) throw new Error("Some reminder candidates could not be processed");
}
