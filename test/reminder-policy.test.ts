import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { allowedMentions, reminderTitle } from "../src/format";
import { claimReminder, syncAssignments } from "../src/repository";
import { processReminderCandidate, selectReminderType } from "../src/reminders";
import { assignment, resetDatabase } from "./helpers";

describe("reminder policy", () => {
  const now = 2_000_000_000;
  it.each([
    [7 * 86400 + 1, null], [7 * 86400, "7d"],
    [3 * 86400, "7d"], [3 * 86400 - 1, "3d"],
    [2 * 86400, "3d"], [2 * 86400 - 1, "2d"],
    [24 * 3600, "2d"], [24 * 3600 - 1, "hourly-24"], [23 * 3600, "hourly-23"],
    [3600, "hourly-1"], [3599, "hourly-1"], [0, null], [-1, null],
  ])("remaining %i seconds -> %s", (remaining, expected) => {
    expect(selectReminderType(now + remaining, now)).toBe(expected);
  });

  beforeEach(resetDatabase);
  it("claims a deadline bucket once and permits a changed deadline", async () => {
    const input = assignment(1, now + 1000);
    await syncAssignments(env.DB, { source: input.source, complete: true, assignments: [input] });
    const record = { ...input, firstSeenAt: "x", lastSeenAt: "x", isActive: true };
    const date = new Date(now * 1000);
    expect(await claimReminder(env.DB, record, "hourly-1", date)).toBe(true);
    expect(await claimReminder(env.DB, record, "hourly-1", date)).toBe(false);
    expect(await claimReminder(env.DB, { ...record, deadlineUnix: record.deadlineUnix + 60 }, "hourly-1", date)).toBe(true);
  });

  it("releases a failed delivery claim for the next cron", async () => {
    const input = assignment(1, now + 1000);
    await syncAssignments(env.DB, { source: input.source, complete: true, assignments: [input] });
    const record = { ...input, firstSeenAt: "x", lastSeenAt: "x", isActive: true };
    const workerEnv = {
      ...env, SYNC_TOKEN: "x", DISCORD_BOT_TOKEN: "x", DISCORD_PUBLIC_KEY: "x",
      DISCORD_APPLICATION_ID: "1", DISCORD_GUILD_ID: "2", DISCORD_CHANNEL_ID: "3", DISCORD_MENTION: "",
    };
    const failingSender = async () => { throw new Error("expected failure"); };
    expect(await processReminderCandidate(workerEnv, record, new Date(now * 1000), failingSender)).toBe(false);
    expect(await processReminderCandidate(workerEnv, record, new Date(now * 1000), async () => undefined)).toBe(true);
  });

  it("only selects the current bucket after a long pause", () => {
    expect(selectReminderType(now + 4 * 3600 + 40 * 60, now)).toBe("hourly-5");
  });

  it("uses the two-day reminder instead of the seven-day reminder inside two days", () => {
    const type = selectReminderType(now + 36 * 3600, now);
    expect(type).toBe("2d");
    expect(type).not.toBe("7d");
    expect(reminderTitle(type!)).toBe("締切まで2日を切りました");
  });

  it("restricts allowed mentions", () => {
    expect(allowedMentions("<@123>")).toEqual({ parse: [], users: ["123"] });
    expect(allowedMentions("<@&456>")).toEqual({ parse: [], roles: ["456"] });
    expect(allowedMentions("@everyone")).toEqual({ parse: [] });
  });
});
