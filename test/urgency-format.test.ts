import { describe, expect, it } from "vitest";
import {
  buildAssignmentListEmbed,
  buildReminderMessage,
  formatRemainingTime,
  getUrgencyLevel,
  getUrgencyStyle,
} from "../src/format";
import { assignment } from "./helpers";

const HOUR = 3_600;
const DAY = 24 * HOUR;
const NOW = 2_000_000_000;

function record(eventId: number, remainingSeconds: number) {
  const input = assignment(eventId, NOW + remainingSeconds);
  return { ...input, firstSeenAt: "x", lastSeenAt: "x", isActive: true };
}

describe("urgency formatting", () => {
  it.each([
    [0, "overdue"], [-1, "overdue"], [1, "critical"], [HOUR, "critical"],
    [HOUR + 1, "urgent"], [3 * HOUR, "urgent"], [3 * HOUR + 1, "warning"],
    [DAY, "warning"], [DAY + 1, "near"], [3 * DAY, "near"],
    [3 * DAY + 1, "normal"], [7 * DAY, "normal"], [7 * DAY + 1, "future"],
  ])("maps %i remaining seconds to %s", (remaining, expected) => {
    expect(getUrgencyLevel(remaining)).toBe(expected);
  });

  it.each([
    [1, "残り 1分"], [30 * 60, "残り 30分"], [HOUR, "残り 1時間"],
    [2 * HOUR + 15 * 60, "残り 2時間15分"], [DAY, "残り 1日"],
    [2 * DAY + 4 * HOUR, "残り 2日4時間"], [0, "提出期限を過ぎています"],
  ])("formats %i remaining seconds", (remaining, expected) => {
    expect(formatRemainingTime(remaining)).toBe(expected);
  });

  it("builds a sorted list using the most urgent title and color", () => {
    const embed = buildAssignmentListEmbed([
      record(3, 2 * DAY),
      record(1, 30 * 60),
      record(2, 2 * HOUR),
    ], 30, NOW);
    expect(embed.title).toBe("🚨 今すぐ対応すべき課題があります");
    expect(embed.color).toBe(getUrgencyStyle("critical").color);
    expect(embed.description).toContain("**🚨 残り 30分**");
    expect(embed.description?.indexOf("課題1")).toBeLessThan(embed.description?.indexOf("課題2") ?? 0);
    expect(embed.description?.indexOf("課題2")).toBeLessThan(embed.description?.indexOf("課題3") ?? 0);
  });

  it.each([
    [30 * 60, "critical", 0xFF2D2D],
    [2 * HOUR, "urgent", 0xFF4D4F],
    [12 * HOUR, "warning", 0xFF8C00],
  ] as const)("uses the %s urgency styling in reminders", (remaining, level, color) => {
    const message = buildReminderMessage(record(1, remaining), `hourly-${Math.ceil(remaining / HOUR)}`, "<@123>", NOW);
    expect(message.embeds[0]?.color).toBe(color);
    expect(message.embeds[0]?.description).toContain("**");
    expect(message.embeds[0]?.title).toContain(getUrgencyStyle(level).emoji);
    expect(message.content).toBe("<@123>");
    expect(message.allowed_mentions).toEqual({ parse: [], users: ["123"] });
  });

  it("does not mention for the seven-day reminder", () => {
    const message = buildReminderMessage(record(1, 6 * DAY), "7d", "<@123>", NOW);
    expect(message.content).toBeUndefined();
    expect(message.allowed_mentions).toEqual({ parse: [] });
  });
});
