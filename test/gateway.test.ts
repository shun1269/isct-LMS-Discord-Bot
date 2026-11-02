import { MessageFlags } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleGatewayCommand } from "../src/gateway.js";
import { syncAssignments } from "../src/repository.js";
import { assignment, env, resetDatabase } from "./helpers.js";

function interaction(guildId = env.DISCORD_GUILD_ID, name = "assignments") {
  return { guildId, commandName: name, options: { getInteger: vi.fn(() => 30) }, deferReply: vi.fn(), editReply: vi.fn(), reply: vi.fn(), deferred: false, replied: false };
}
const handle = (value: ReturnType<typeof interaction>) => handleGatewayCommand(value as unknown as Parameters<typeof handleGatewayCommand>[0], env);
beforeEach(resetDatabase);

describe("Gateway slash commands", () => {
  it("defers privately and uses the existing assignment display", async () => {
    const item = assignment();
    await syncAssignments(env.DB, { source: item.source, complete: true, assignments: [item] });
    const request = interaction();
    await handle(request);
    expect(request.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(request.editReply).toHaveBeenCalledWith(expect.objectContaining({ embeds: [expect.objectContaining({ description: expect.stringContaining(item.title) })], allowedMentions: { parse: [] } }));
  });

  it("does not disclose assignments in another guild", async () => {
    const request = interaction("other-guild");
    await handle(request);
    expect(request.deferReply).not.toHaveBeenCalled();
    expect(request.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
  });

  it("serves sync status over the Gateway", async () => {
    const request = interaction(env.DISCORD_GUILD_ID, "sync-status");
    await handle(request);
    expect(request.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: "まだLMSから同期されていません。" }));
  });
});
