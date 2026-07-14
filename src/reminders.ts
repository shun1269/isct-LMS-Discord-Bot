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

/**
 * 残り24時間未満の場合、その時点の通知区分を返す。
 *
 * 例：
 * 残り23時間50分 → hourly-24
 * 残り22時間59分 → hourly-23
 * 残り30分       → hourly-1
 */
function getHourlyReminderType(
  remainingSeconds: number,
): ReminderType | null {
  if (remainingSeconds <= 0 || remainingSeconds >= DAY) {
    return null;
  }

  const remainingHours = Math.ceil(
    remainingSeconds / HOUR,
  );

  return `hourly-${remainingHours}`;
}

function selectReminder(
  assignment: AssignmentRecord,
  nowUnix: number,
): ReminderType | null {
  const remainingSeconds =
    assignment.deadlineUnix - nowUnix;

  if (remainingSeconds <= 0) {
    return null;
  }

  /*
   * 締切24時間前以降は、残り時間の区分ごとに通知する。
   *
   * reminderTypeが
   * hourly-24, hourly-23, ..., hourly-1
   * と変化するため、それぞれ1回だけ通知される。
   */
  if (remainingSeconds < DAY) {
    const reminderType =
      getHourlyReminderType(remainingSeconds);

    if (
      reminderType &&
      !hasReminderBeenSent(
        assignment,
        reminderType,
      )
    ) {
      return reminderType;
    }

    return null;
  }

  /*
   * 24時間より前については、7日以内に入った時点で
   * 1回だけ通知する。
   */
  if (
    remainingSeconds <= 7 * DAY &&
    !hasReminderBeenSent(assignment, "7d")
  ) {
    return "7d";
  }

  return null;
}

async function getNotificationChannel(): Promise<SendableChannels> {
  const channel =
    await discordClient.channels.fetch(
      config.discordChannelId,
    );

  if (!channel?.isSendable()) {
    throw new Error(
      `DISCORD_CHANNEL_ID does not refer to a sendable channel: ${config.discordChannelId}`,
    );
  }

  return channel;
}

let checking = false;

export async function checkReminders(): Promise<void> {
  if (checking || !discordClient.isReady()) {
    return;
  }

  checking = true;

  try {
    const nowUnix = Math.floor(
      Date.now() / 1000,
    );

    /*
     * 7日以内に期限を迎える課題を取得する。
     */
    const candidates = listReminderCandidates(
      nowUnix,
      nowUnix + 7 * DAY,
    );

    const channel =
      await getNotificationChannel();

    for (const assignment of candidates) {
      const reminderType = selectReminder(
        assignment,
        nowUnix,
      );

      if (!reminderType) {
        continue;
      }

      await channel.send(
        buildReminderMessage(
          assignment,
          reminderType,
        ),
      );

      recordReminderSent(
        assignment,
        reminderType,
      );

      console.log(
        `Sent ${reminderType} reminder: ${assignment.courseJa} / ${assignment.title}`,
      );
    }
  } catch (error) {
    console.error(
      "Reminder check failed:",
      error,
    );
  } finally {
    checking = false;
  }
}

export function startReminderLoop(): NodeJS.Timeout {
  /*
   * 起動直後にも1回確認する。
   */
  void checkReminders();

  /*
   * 1分ごとに確認するため、実際の通知時刻には
   * 最大で約1分のずれが生じる。
   */
  return setInterval(
    () => void checkReminders(),
    60_000,
  );
}