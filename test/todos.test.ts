import { MessageFlags } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commandReply } from "../src/commands.js";
import { handleGatewayAutocomplete, handleGatewayButton, handleGatewayCommand, handleGatewayMessage } from "../src/gateway.js";
import { checkReminders, processTodoReminderCandidate } from "../src/reminders.js";
import { completeTodo, createTodo, getTodoByBotMessage, listOpenTodos, listTodoReminderCandidates, setTodoDeadline, syncAssignments } from "../src/repository.js";
import { buildDeadlineChoices, buildTodoReminderMessage, parseTodoDeadline, resolveTodoDeadlines } from "../src/todos.js";
import { assignment } from "./helpers.js";
import { env as baseEnv, resetDatabase } from "./helpers.js";

const env = { ...baseEnv, DISCORD_OWNER_ID: "99" };
type CommandArg = Parameters<typeof handleGatewayCommand>[0];
type MessageArg = Parameters<typeof handleGatewayMessage>[0];
type ButtonArg = Parameters<typeof handleGatewayButton>[0];
type AutocompleteArg = Parameters<typeof handleGatewayAutocomplete>[0];

// Monday 2026-11-02 12:00 JST.
const now = new Date("2026-11-02T03:00:00Z");
const jst = (iso: string) => Date.parse(`${iso}+09:00`) / 1000;

function todoCommand(name: string, deadline: string, userId = "99", id = "1000") {
  const strings: Record<string, string> = { name, deadline };
  return {
    id, guildId: env.DISCORD_GUILD_ID, user: { id: userId }, commandName: "todo",
    options: { getString: vi.fn((key: string) => strings[key]) },
    reply: vi.fn(async () => ({ resource: { message: { id: "777" } } })),
    deferReply: vi.fn(), editReply: vi.fn(), deferred: false, replied: false,
  };
}
function replyMessage(content: string, authorId = "99", referenceId = "777") {
  const original = { edit: vi.fn() };
  return {
    guildId: env.DISCORD_GUILD_ID, author: { id: authorId, bot: false }, content, reference: { messageId: referenceId },
    fetchReference: vi.fn(async () => original), reply: vi.fn(), react: vi.fn(), original,
  };
}
async function addTodo(name = "レポート", deadline = "2099-01-01 09:00") {
  const command = todoCommand(name, deadline);
  await handleGatewayCommand(command as unknown as CommandArg, env);
  return command;
}
beforeEach(resetDatabase);

describe("todo deadline shorthand", () => {
  it.each([
    ["金", "2026-11-06T23:59"],
    ["金曜 18", "2026-11-06T18:00"],
    ["月", "2026-11-02T23:59"],
    ["今週日", "2026-11-08T23:59"],
    ["来週の月曜日", "2026-11-09T23:59"],
    ["明日", "2026-11-03T23:59"],
    ["明後日 9:30", "2026-11-04T09:30"],
    ["3日後", "2026-11-05T23:59"],
    ["2週間後", "2026-11-16T23:59"],
    ["11/10 18", "2026-11-10T18:00"],
    ["11月10日18時半", "2026-11-10T18:30"],
    ["１１/１０　１８:００", "2026-11-10T18:00"],
    ["1/5", "2027-01-05T23:59"],
    ["2026-11-10 12:00", "2026-11-10T12:00"],
    ["18時", "2026-11-02T18:00"],
    ["9:00", "2026-11-03T09:00"],
  ])("reads %s", (input, expected) => {
    expect(parseTodoDeadline(input, now)).toBe(jst(expected));
  });

  it.each(["", "今日 9:00", "2026-11-01", "2/30", "11/10 24:00", "来週", "あ", "明日18"])("rejects %s", (input) => {
    expect(parseTodoDeadline(input, now)).toBeNull();
  });

  it("skips a weekday whose time has passed today and offers the next week too", () => {
    expect(resolveTodoDeadlines("月 9:00", now)).toEqual([jst("2026-11-09T09:00")]);
    expect(resolveTodoDeadlines("金", now)).toEqual([jst("2026-11-06T23:59"), jst("2026-11-13T23:59")]);
  });

  it("builds autocomplete choices whose values parse back to the shown deadline", () => {
    const choices = buildDeadlineChoices("金", now);
    expect(choices.map((choice) => choice.name)).toEqual(["11/6(金) 23:59（残り 4日11時間）", "11/13(金) 23:59（残り 11日11時間）"]);
    expect(choices.map((choice) => parseTodoDeadline(choice.value, now))).toEqual([jst("2026-11-06T23:59"), jst("2026-11-13T23:59")]);

    const quick = buildDeadlineChoices("", now);
    expect(quick).toHaveLength(8);
    expect(quick[0]?.name).toMatch(/^今日 11\/2\(月\) 23:59/);
    expect(quick[1]?.name).toMatch(/^明日 11\/3\(火\)/);
    expect(buildDeadlineChoices("あ", now)[0]?.name).toContain("読み取れません");
  });
});

describe("/todo over the Gateway", () => {
  it("adds a task publicly and remembers the reply message", async () => {
    const command = await addTodo();
    expect(command.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("📝 **レポート**"), withResponse: true, allowedMentions: { parse: [] } }));
    expect(command.reply.mock.calls[0]).not.toEqual([expect.objectContaining({ flags: MessageFlags.Ephemeral })]);
    expect(await getTodoByBotMessage(env.DB, "777")).toMatchObject({ title: "レポート", deadlineUnix: jst("2099-01-01T09:00") });

    const reply = await commandReply(env, "assignments", 30);
    expect(reply.embeds?.[1]).toMatchObject({ title: "📝 タスク", description: expect.stringContaining("レポート") });
  });

  it("refuses other users and unreadable deadlines privately", async () => {
    const intruder = todoCommand("x", "金", "100");
    await handleGatewayCommand(intruder as unknown as CommandArg, env);
    expect(intruder.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));

    const unreadable = todoCommand("レポート", "そのうち");
    await handleGatewayCommand(unreadable as unknown as CommandArg, env);
    expect(unreadable.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral, content: expect.stringContaining("読み取れませんでした") }));
    expect(await listOpenTodos(env.DB)).toHaveLength(0);
  });

  it("does not duplicate a redelivered command", async () => {
    await addTodo();
    await addTodo();
    expect(await listOpenTodos(env.DB)).toHaveLength(1);
  });

  it("offers deadline choices only to the owner", async () => {
    const autocomplete = (userId: string) => ({ guildId: env.DISCORD_GUILD_ID, user: { id: userId }, commandName: "todo", options: { getFocused: () => ({ name: "deadline", value: "金" }) }, respond: vi.fn() });
    const owner = autocomplete("99");
    await handleGatewayAutocomplete(owner as unknown as AutocompleteArg, env);
    expect(owner.respond).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ name: expect.stringContaining("(金) 23:59") })]));
    const other = autocomplete("100");
    await handleGatewayAutocomplete(other as unknown as AutocompleteArg, env);
    expect(other.respond).toHaveBeenCalledWith([]);
  });
});

describe("replies to a /todo message", () => {
  it("changes the deadline and edits the original message", async () => {
    await addTodo();
    const message = replyMessage("2099-02-01 18");
    await handleGatewayMessage(message as unknown as MessageArg, env);
    expect((await getTodoByBotMessage(env.DB, "777"))?.deadlineUnix).toBe(jst("2099-02-01T18:00"));
    expect(message.original.edit).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining(`<t:${jst("2099-02-01T18:00")}:F>`) }));
    expect(message.react).toHaveBeenCalledWith("✅");
  });

  it("completes the task with 完了", async () => {
    await addTodo();
    const message = replyMessage("完了");
    await handleGatewayMessage(message as unknown as MessageArg, env);
    expect(await listOpenTodos(env.DB)).toHaveLength(0);
    expect(message.original.edit).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("完了"), components: [] }));
  });

  it("explains unreadable replies and ignores other users and unrelated messages", async () => {
    await addTodo();
    const unreadable = replyMessage("そのうち");
    await handleGatewayMessage(unreadable as unknown as MessageArg, env);
    expect(unreadable.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("読み取れませんでした") }));

    const other = replyMessage("完了", "100");
    await handleGatewayMessage(other as unknown as MessageArg, env);
    const unrelated = replyMessage("完了", "99", "888");
    await handleGatewayMessage(unrelated as unknown as MessageArg, env);
    expect([other, unrelated].every((item) => item.reply.mock.calls.length === 0 && item.fetchReference.mock.calls.length === 0)).toBe(true);
    expect(await listOpenTodos(env.DB)).toHaveLength(1);
  });
});

describe("todo buttons", () => {
  it("completes via the button and blocks other users", async () => {
    await addTodo();
    const [todo] = await listOpenTodos(env.DB);
    const button = (userId: string) => ({ guildId: env.DISCORD_GUILD_ID, user: { id: userId }, customId: `todo-done:${todo!.id}`, update: vi.fn(), reply: vi.fn(), deferred: false, replied: false });
    const intruder = button("100");
    await handleGatewayButton(intruder as unknown as ButtonArg, env);
    expect(intruder.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
    expect(await listOpenTodos(env.DB)).toHaveLength(1);

    const owner = button("99");
    await handleGatewayButton(owner as unknown as ButtonArg, env);
    expect(owner.update).toHaveBeenCalledWith(expect.objectContaining({ components: [] }));
    expect(await listOpenTodos(env.DB)).toHaveLength(0);
  });

  it("answers the retired deadline button instead of failing", async () => {
    const legacy = { guildId: env.DISCORD_GUILD_ID, user: { id: "99" }, customId: "todo-deadline:1", update: vi.fn(), reply: vi.fn(), deferred: false, replied: false };
    await handleGatewayButton(legacy as unknown as ButtonArg, env);
    expect(legacy.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral, content: expect.stringContaining("/todo") }));
  });
});

describe("todo reminders", () => {
  const nowUnix = () => Math.floor(Date.now() / 1000);
  afterEach(() => { vi.unstubAllGlobals(); });

  it("uses the assignment urgency style and mention rule with a completion button", () => {
    const todo = { id: 5, title: "レポート", deadlineUnix: 2_000_003_000, createdAt: "x", completedAt: null, botMessageId: null };
    const urgent = buildTodoReminderMessage(todo, "hourly-1", "<@123>", 2_000_000_000);
    expect(urgent).toMatchObject({
      content: "<@123>", allowed_mentions: { parse: [], users: ["123"] },
      embeds: [{ title: "🚨 締切まで1時間を切りました", description: expect.stringContaining("📝 レポート") }],
      components: [{ type: 1, components: [{ type: 2, custom_id: "todo-done:5", label: "完了" }] }],
    });
    const later = buildTodoReminderMessage({ ...todo, deadlineUnix: 2_000_000_000 + 5 * 86_400 }, "7d", "<@123>", 2_000_000_000);
    expect(later.content).toBeUndefined();
    expect(later.allowed_mentions).toEqual({ parse: [] });
  });

  it("lists only open tasks with a deadline inside the window", async () => {
    const soon = await createTodo(env.DB, "soon", nowUnix() + 3600, "a");
    await createTodo(env.DB, "far", nowUnix() + 8 * 86_400, "b");
    const done = await createTodo(env.DB, "done", nowUnix() + 3600, "c");
    await completeTodo(env.DB, done.id);
    expect((await listTodoReminderCandidates(env.DB, nowUnix(), nowUnix() + 7 * 86_400)).map((todo) => todo.id)).toEqual([soon.id]);
  });

  it("sends each bucket once, again after a deadline change, and separately from assignments", async () => {
    const todo = await createTodo(env.DB, "レポート", nowUnix() + 3600, "a");
    const sender = vi.fn(async () => undefined);
    const candidate = { ...todo, deadlineUnix: todo.deadlineUnix! };
    expect(await processTodoReminderCandidate(env, candidate, new Date(), sender)).toBe(true);
    expect(await processTodoReminderCandidate(env, candidate, new Date(), sender)).toBe(false);
    expect(await processTodoReminderCandidate(env, { ...candidate, deadlineUnix: candidate.deadlineUnix + 60 }, new Date(), sender)).toBe(true);
    expect(sender).toHaveBeenCalledTimes(2);

    // An assignment whose event_id equals the task ID still gets its own reminder.
    const item = assignment(todo.id, candidate.deadlineUnix);
    await syncAssignments(env.DB, { source: item.source, complete: true, assignments: [item] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    await checkReminders(env);
    expect(await env.DB.prepare("SELECT source, event_id FROM reminder_logs WHERE deadline_unix = ? ORDER BY source").bind(candidate.deadlineUnix).all()).toEqual({
      results: [{ source: "discord-todo", event_id: todo.id }, { source: item.source, event_id: todo.id }],
    });
  });

  it("posts task reminders with the button from the reminder job", async () => {
    const todo = await createTodo(env.DB, "レポート", nowUnix() + 3600, "a");
    await setTodoDeadline(env.DB, todo.id, nowUnix() + 2 * 3600);
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    await checkReminders(env);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as { components: unknown };
    expect(body.components).toEqual([expect.objectContaining({ components: [expect.objectContaining({ custom_id: `todo-done:${todo.id}` })] })]);
  });
});
