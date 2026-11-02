import { MessageFlags } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commandReply, componentReply } from "../src/commands.js";
import { handleInteraction } from "../src/discord-interactions.js";
import { handleGatewaySelect } from "../src/gateway.js";
import { checkReminders } from "../src/reminders.js";
import { listReminderCandidates, listUpcomingAssignments, setRemindersMuted, syncAssignments } from "../src/repository.js";
import { assignment, env, resetDatabase } from "./helpers.js";

const nowUnix = () => Math.floor(Date.now() / 1000);
async function seed(...items: ReturnType<typeof assignment>[]) {
  await syncAssignments(env.DB, { source: items[0]!.source, complete: true, assignments: items });
}
beforeEach(resetDatabase);

describe("reminder muting", () => {
  it("excludes muted assignments from reminders but keeps them listed", async () => {
    const item = assignment(1, nowUnix() + 3600);
    await seed(item);
    expect(await setRemindersMuted(env.DB, item.source, item.eventId, true)).toBe(true);
    expect(await listReminderCandidates(env.DB, nowUnix(), nowUnix() + 7 * 86_400)).toHaveLength(0);
    const [listed] = await listUpcomingAssignments(env.DB, nowUnix(), nowUnix() + 86_400);
    expect(listed?.remindersMuted).toBe(true);
    const reply = await commandReply(env, "assignments", 30);
    expect(reply.embeds?.[0]?.description).toContain("🔕 リマインド停止中");
    expect(reply.components?.[0]?.components[0]?.options[0]).toMatchObject({ value: `unmute:${item.source}:1`, emoji: { name: "🔔" } });
  });

  it("keeps the mute across a complete sync and a deadline change", async () => {
    const item = assignment(1, nowUnix() + 3600);
    await seed(item);
    await setRemindersMuted(env.DB, item.source, item.eventId, true);
    await seed({ ...item, deadlineUnix: item.deadlineUnix + 60, deadlineIso: new Date((item.deadlineUnix + 60) * 1000).toISOString() });
    expect((await listUpcomingAssignments(env.DB, nowUnix(), nowUnix() + 86_400))[0]?.remindersMuted).toBe(true);
  });

  it("does not send reminders for muted assignments", async () => {
    const item = assignment(1, nowUnix() + 3600);
    await seed(item);
    await setRemindersMuted(env.DB, item.source, item.eventId, true);
    await checkReminders(env);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM reminder_logs").first("count")).toBe(0);
  });

  it("toggles via the select menu and rejects unknown values", async () => {
    const item = assignment(1, nowUnix() + 3600);
    await seed(item);
    const muted = await componentReply(env, "reminder-toggle:7", [`mute:${item.source}:1`]);
    expect(muted?.embeds?.[0]?.description).toContain("リマインド停止中");
    const unmuted = await componentReply(env, "reminder-toggle:7", [`unmute:${item.source}:1`]);
    expect(unmuted?.embeds?.[0]?.description).not.toContain("リマインド停止中");
    expect(await componentReply(env, "other", [`mute:${item.source}:1`])).toBeNull();
    expect(await componentReply(env, "reminder-toggle:7", ["mute:evil'; DROP TABLE assignments;--:1"])).toBeNull();
  });

  it("updates the message over the Gateway and HTTP interactions", async () => {
    const item = assignment(1, nowUnix() + 3600);
    await seed(item);
    const select = { guildId: env.DISCORD_GUILD_ID, customId: "reminder-toggle:30", values: [`mute:${item.source}:1`], update: vi.fn(), reply: vi.fn(), followUp: vi.fn(), deferred: false, replied: false };
    await handleGatewaySelect(select as unknown as Parameters<typeof handleGatewaySelect>[0], env);
    expect(select.update).toHaveBeenCalledWith(expect.objectContaining({ allowedMentions: { parse: [] } }));

    const foreign = { ...select, guildId: "other", update: vi.fn(), reply: vi.fn() };
    await handleGatewaySelect(foreign as unknown as Parameters<typeof handleGatewaySelect>[0], env);
    expect(foreign.update).not.toHaveBeenCalled();
    expect(foreign.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));

    const request = new Request("https://x/discord/interactions", { method: "POST", headers: { "x-signature-ed25519": "sig", "x-signature-timestamp": "time" }, body: JSON.stringify({ type: 3, guild_id: env.DISCORD_GUILD_ID, data: { custom_id: "reminder-toggle:30", values: [`unmute:${item.source}:1`] } }) });
    const body = await (await handleInteraction(request, env, async () => true)).json() as { type: number };
    expect(body.type).toBe(7);
    expect((await listReminderCandidates(env.DB, nowUnix(), nowUnix() + 86_400))).toHaveLength(1);
  });
});
