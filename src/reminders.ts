import { type SendableChannels } from "discord.js";
import { config } from "./config.js";
import { discordClient } from "./discord.js";
import { buildReminderMessage } from "./format.js";
import {
  hasReminderBeenSent,
  listReminderCandidates,
  recordReminderSent,
} from "./repository.js";
import type { AssignmentRecord, ReminderType } from "./types.js";

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

const thresholds: Array<{
  type: ReminderType;
  seconds: number;
}> = [
  { type: "3h", seconds: 3 * HOUR },
  { type: "24h", seconds: DAY },
  { type: "7d", seconds: 7 * DAY },
];

function selectReminder(
  assignment: AssignmentRecord,
  nowUnix: number,
): ReminderType | null {
  const remaining = assignment.deadlineUnix - nowUnix;
  if (remaining <= 0) return null;

  for (const threshold of thresholds) {
    if (
      remaining <= threshold.seconds &&
      !hasReminderBeenSent(assignment, threshold.type)
    ) {
      return threshold.type;
    }
  }

  return null;
}

async function getNotificationChannel(): Promise<SendableChannels> {
  const channel = await discordClient.channels.fetch(config.discordChannelId);

  if (!channel?.isSendable()) {
    throw new Error(
      `DISCORD_CHANNEL_ID does not refer to a sendable channel: ${config.discordChannelId}`,
    );
  }

  return channel;
}

let checking = false;

export async function checkReminders(): Promise<void> {
  if (checking || !discordClient.isReady()) return;
  checking = true;

  try {
    const nowUnix = Math.floor(Date.now() / 1000);
    const candidates = listReminderCandidates(nowUnix, nowUnix + 7 * DAY);
    const channel = await getNotificationChannel();

    for (const assignment of candidates) {
      const reminderType = selectReminder(assignment, nowUnix);
      if (!reminderType) continue;

      await channel.send(buildReminderMessage(assignment, reminderType));
      recordReminderSent(assignment, reminderType);
      console.log(
        `Sent ${reminderType} reminder: ${assignment.courseJa} / ${assignment.title}`,
      );
    }
  } catch (error) {
    console.error("Reminder check failed:", error);
  } finally {
    checking = false;
  }
}

export function startReminderLoop(): NodeJS.Timeout {
  void checkReminders();
  return setInterval(() => void checkReminders(), 60_000);
}
