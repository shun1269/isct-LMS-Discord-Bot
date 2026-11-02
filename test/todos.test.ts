import { MessageFlags } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commandReply } from "../src/commands.js";
import { handleGatewayButton, handleGatewayMessage, handleGatewayModal } from "../src/gateway.js";
import { listOpenTodos } from "../src/repository.js";
import { parseTodoDeadline, parseTodoMessage } from "../src/todos.js";
import { env as baseEnv, resetDatabase } from "./helpers.js";

const env = { ...baseEnv, DISCORD_OWNER_ID: "99" };
type MessageArg = Parameters<typeof handleGatewayMessage>[0];
type ButtonArg = Parameters<typeof handleGatewayButton>[0];
type ModalArg = Parameters<typeof handleGatewayModal>[0];

function message(content: string, authorId = "99", id = "500") {
  return { id, guildId: env.DISCORD_GUILD_ID, author: { id: authorId, bot: false }, content, reply: vi.fn() };
}
function button(customId: string, userId = "99") {
  return { guildId: env.DISCORD_GUILD_ID, user: { id: userId }, customId, showModal: vi.fn(), update: vi.fn(), reply: vi.fn(), deferred: false, replied: false };
}
function modal(customId: string, value: string) {
  const update = vi.fn();
  return { guildId: env.DISCORD_GUILD_ID, user: { id: "99" }, customId, fields: { getTextInputValue: vi.fn(() => value) }, reply: vi.fn(), update, isFromMessage: () => true, deferred: false, replied: false };
}
async function addTodo(content = "todo:レポート") {
  const request = message(content);
  await handleGatewayMessage(request as unknown as MessageArg, env);
  return request;
}
beforeEach(resetDatabase);

describe("todo message parsing", () => {
  it("accepts half- and full-width colons and ignores other messages", () => {
    expect(parseTodoMessage("todo:レポート提出")).toBe("レポート提出");
    expect(parseTodoMessage("TODO： 買い物  リスト ")).toBe("買い物 リスト");
    expect(parseTodoMessage("todo:")).toBe("");
    expect(parseTodoMessage("今日のtodo:なし")).toBeNull();
  });

  it("reads deadlines as JST and rejects invalid or past dates", () => {
    const now = new Date("2026-11-02T03:00:00Z"); // 12:00 JST
    expect(parseTodoDeadline("2026-11-10 18:00", now)).toBe(Date.parse("2026-11-10T09:00:00Z") / 1000);
    expect(parseTodoDeadline("１１/１０", now)).toBe(Date.parse("2026-11-10T14:59:00Z") / 1000);
    expect(parseTodoDeadline("1/5 9:30", now)).toBe(Date.parse("2027-01-05T00:30:00Z") / 1000);
    expect(parseTodoDeadline("11/2 13:00", now)).toBe(Date.parse("2026-11-02T04:00:00Z") / 1000);
    expect(parseTodoDeadline("2026-11-01", now)).toBeNull();
    expect(parseTodoDeadline("2/30", now)).toBeNull();
    expect(parseTodoDeadline("11/10 24:00", now)).toBeNull();
    expect(parseTodoDeadline("来週", now)).toBeNull();
  });
});

describe("todo over the Gateway", () => {
  it("adds a task from the owner's message and offers the deadline button", async () => {
    const request = await addTodo();
    expect(request.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining("タスク「レポート」を追加しました"),
      allowedMentions: { parse: [], repliedUser: false },
      components: [expect.objectContaining({ components: expect.arrayContaining([expect.objectContaining({ custom_id: expect.stringMatching(/^todo-deadline:\d+$/), label: "期限を設定" })]) })],
    }));
    expect(await listOpenTodos(env.DB)).toMatchObject([{ title: "レポート", deadlineUnix: null }]);
  });

  it("ignores other users, bots, other guilds, and duplicate deliveries", async () => {
    const other = message("todo:x", "100");
    await handleGatewayMessage(other as unknown as MessageArg, env);
    const bot = { ...message("todo:x"), author: { id: "99", bot: true } };
    await handleGatewayMessage(bot as unknown as MessageArg, env);
    const foreign = { ...message("todo:x"), guildId: "other" };
    await handleGatewayMessage(foreign as unknown as MessageArg, env);
    const disabled = message("todo:x");
    await handleGatewayMessage(disabled as unknown as MessageArg, baseEnv);
    expect([other, bot, foreign, disabled].every((item) => item.reply.mock.calls.length === 0)).toBe(true);
    await addTodo();
    await addTodo();
    expect(await listOpenTodos(env.DB)).toHaveLength(1);
  });

  it("sets the deadline from the modal and shows it in /課題", async () => {
    await addTodo();
    const [todo] = await listOpenTodos(env.DB);
    const click = button(`todo-deadline:${todo!.id}`);
    await handleGatewayButton(click as unknown as ButtonArg, env);
    expect(click.showModal).toHaveBeenCalledWith(expect.objectContaining({ custom_id: `todo-deadline-modal:${todo!.id}` }));

    const submit = modal(`todo-deadline-modal:${todo!.id}`, "2099-01-01 09:00");
    await handleGatewayModal(submit as unknown as ModalArg, env);
    const deadline = Date.parse("2099-01-01T00:00:00Z") / 1000;
    expect(submit.update).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining(`<t:${deadline}:F>`) }));
    expect((await listOpenTodos(env.DB))[0]?.deadlineUnix).toBe(deadline);

    const reply = await commandReply(env, "assignments", 30);
    expect(reply.embeds?.[1]).toMatchObject({ title: "📝 タスク", description: expect.stringContaining("レポート") });
  });

  it("rejects an unreadable deadline privately", async () => {
    await addTodo();
    const [todo] = await listOpenTodos(env.DB);
    const submit = modal(`todo-deadline-modal:${todo!.id}`, "あした");
    await handleGatewayModal(submit as unknown as ModalArg, env);
    expect(submit.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
    expect((await listOpenTodos(env.DB))[0]?.deadlineUnix).toBeNull();
  });

  it("completes a task and blocks other users", async () => {
    await addTodo();
    const [todo] = await listOpenTodos(env.DB);
    const intruder = button(`todo-done:${todo!.id}`, "100");
    await handleGatewayButton(intruder as unknown as ButtonArg, env);
    expect(intruder.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
    expect(await listOpenTodos(env.DB)).toHaveLength(1);

    const done = button(`todo-done:${todo!.id}`);
    await handleGatewayButton(done as unknown as ButtonArg, env);
    expect(done.update).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("完了にしました"), components: [] }));
    expect(await listOpenTodos(env.DB)).toHaveLength(0);
  });
});
