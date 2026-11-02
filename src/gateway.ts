import { Client, Events, GatewayIntentBits, MessageFlags, type AutocompleteInteraction, type ButtonInteraction, type ChatInputCommandInteraction, type Message, type StringSelectMenuInteraction } from "discord.js";
import { commandReply, componentReply } from "./commands.js";
import type { Env } from "./env.js";
import { verifyDiscordApplication } from "./discord-application.js";
import { completeTodo, createTodo, getTodo, getTodoByBotMessage, setTodoBotMessage, setTodoDeadline } from "./repository.js";
import { buildDeadlineChoices, buildTodoMessage, isTodoCompletionReply, LEGACY_TODO_DEADLINE_PREFIX, normalizeTodoTitle, parseTodoDeadline, parseTodoId, TODO_DONE_PREFIX, TODO_TITLE_MAX_LENGTH } from "./todos.js";

type CommandInteraction = Pick<ChatInputCommandInteraction, "id" | "guildId" | "user" | "commandName" | "options" | "deferReply" | "editReply" | "reply" | "deferred" | "replied">;
type SelectInteraction = Pick<StringSelectMenuInteraction, "guildId" | "customId" | "values" | "update" | "reply" | "followUp" | "deferred" | "replied">;
type TodoReplyMessage = Pick<Message, "guildId" | "author" | "content" | "reference" | "fetchReference" | "reply" | "react">;
type TodoButtonInteraction = Pick<ButtonInteraction, "guildId" | "user" | "customId" | "update" | "reply" | "deferred" | "replied">;
type TodoAutocompleteInteraction = Pick<AutocompleteInteraction, "guildId" | "user" | "commandName" | "options" | "respond">;

const noMentions = { parse: [] as never[] };
const isOwner = (env: Env, userId: string) => env.DISCORD_OWNER_ID !== "" && userId === env.DISCORD_OWNER_ID;
const DEADLINE_HELP = "`金`、`明日 18`、`3日後`、`11/10 12:00` のように、未来の日時を日本時間で入力してください。";

export async function handleGatewayCommand(interaction: CommandInteraction, env: Env): Promise<void> {
  if (interaction.guildId !== env.DISCORD_GUILD_ID) {
    await interaction.reply({ content: "このサーバーでは利用できません。", flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  if (interaction.commandName === "todo") { await handleTodoCommand(interaction, env); return; }
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const days = interaction.commandName === "assignments" ? interaction.options.getInteger("days") : undefined;
    await interaction.editReply({ ...await commandReply(env, interaction.commandName, days), allowedMentions: { parse: [] } });
  } catch {
    console.error("Discord command failed", { command: interaction.commandName });
    const errorReply = { content: "処理に失敗しました。時間をおいて再試行してください。", allowedMentions: { parse: [] as never[] } };
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply(errorReply);
      else await interaction.reply({ ...errorReply, flags: MessageFlags.Ephemeral });
    } catch { console.error("Could not deliver command error response"); }
  }
}

export async function handleGatewaySelect(interaction: SelectInteraction, env: Env): Promise<void> {
  if (interaction.guildId !== env.DISCORD_GUILD_ID) {
    await interaction.reply({ content: "このサーバーでは利用できません。", flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  try {
    const reply = await componentReply(env, interaction.customId, interaction.values);
    if (!reply) {
      await interaction.reply({ content: "この操作は利用できません。`/課題` を再実行してください。", flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return;
    }
    await interaction.update({ ...reply, allowedMentions: { parse: [] } });
  } catch {
    console.error("Discord component failed", { customId: interaction.customId });
    const errorReply = { content: "処理に失敗しました。時間をおいて再試行してください。", flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] as never[] } } as const;
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(errorReply);
      else await interaction.reply(errorReply);
    } catch { console.error("Could not deliver component error response"); }
  }
}

async function replyPrivately(interaction: Pick<CommandInteraction, "reply">, content: string): Promise<void> {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: noMentions });
}

// The task reply is public so the owner can reply to it to change the deadline or complete the task.
async function handleTodoCommand(interaction: CommandInteraction, env: Env): Promise<void> {
  if (!isOwner(env, interaction.user.id)) { await replyPrivately(interaction, "このコマンドは利用できません。"); return; }
  try {
    const title = normalizeTodoTitle(interaction.options.getString("name", true));
    const deadlineInput = interaction.options.getString("deadline", true);
    if (title === "" || title.length > TODO_TITLE_MAX_LENGTH) { await replyPrivately(interaction, `タスク名は1〜${TODO_TITLE_MAX_LENGTH}文字で入力してください。`); return; }
    const deadline = parseTodoDeadline(deadlineInput);
    if (deadline === null) { await replyPrivately(interaction, `「${title}」の期限「${deadlineInput}」を読み取れませんでした。${DEADLINE_HELP}`); return; }
    const todo = await createTodo(env.DB, title, deadline, interaction.id);
    const response = await interaction.reply({ ...buildTodoMessage(todo), allowedMentions: noMentions, withResponse: true });
    const messageId = response.resource?.message?.id;
    if (messageId) await setTodoBotMessage(env.DB, todo.id, messageId);
    else console.error("Todo reply message ID was not returned", { todoId: todo.id });
  } catch {
    console.error("Todo command failed");
    try { if (!interaction.deferred && !interaction.replied) await replyPrivately(interaction, "タスクの追加に失敗しました。時間をおいて再試行してください。"); }
    catch { console.error("Could not deliver todo error response"); }
  }
}

export async function handleGatewayAutocomplete(interaction: TodoAutocompleteInteraction, env: Env): Promise<void> {
  if (interaction.commandName !== "todo") return;
  const focused = interaction.options.getFocused(true);
  const allowed = interaction.guildId === env.DISCORD_GUILD_ID && isOwner(env, interaction.user.id);
  await interaction.respond(allowed && focused.name === "deadline" ? buildDeadlineChoices(String(focused.value)) : []);
}

// Replies from the owner to a /todo message change its deadline ("木 18") or complete it ("完了").
export async function handleGatewayMessage(message: TodoReplyMessage, env: Env): Promise<void> {
  const referenceId = message.reference?.messageId;
  if (!referenceId || message.guildId !== env.DISCORD_GUILD_ID || message.author.bot || !isOwner(env, message.author.id)) return;
  const todo = await getTodoByBotMessage(env.DB, referenceId);
  if (!todo) return;
  const answer = (content: string) => message.reply({ content, allowedMentions: { ...noMentions, repliedUser: false } });
  try {
    if (todo.completedAt !== null) { await answer("このタスクは完了済みです。"); return; }
    if (isTodoCompletionReply(message.content)) await completeTodo(env.DB, todo.id);
    else {
      const deadline = parseTodoDeadline(message.content);
      if (deadline === null) { await answer(`期限を読み取れませんでした。${DEADLINE_HELP}終わった場合は「完了」とリプライしてください。`); return; }
      await setTodoDeadline(env.DB, todo.id, deadline);
    }
    const original = await message.fetchReference();
    await original.edit({ ...buildTodoMessage((await getTodo(env.DB, todo.id))!), allowedMentions: noMentions });
    try { await message.react("✅"); }
    catch { console.error("Could not react to todo reply"); }
  } catch {
    console.error("Todo reply failed", { todoId: todo.id });
    try { await answer("処理に失敗しました。時間をおいて再試行してください。"); }
    catch { console.error("Could not deliver todo error response"); }
  }
}

export async function handleGatewayButton(interaction: TodoButtonInteraction, env: Env): Promise<void> {
  const reject = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: noMentions });
  if (interaction.customId.startsWith(LEGACY_TODO_DEADLINE_PREFIX)) {
    await reject("期限設定ボタンは廃止しました。`/todo` で期限付きで登録し直し、このタスクは「✅ 完了」で片付けてください。");
    return;
  }
  const id = parseTodoId(interaction.customId, TODO_DONE_PREFIX);
  if (id === null) return;
  if (interaction.guildId !== env.DISCORD_GUILD_ID || !isOwner(env, interaction.user.id)) { await reject("このタスクは操作できません。"); return; }
  try {
    await completeTodo(env.DB, id);
    const todo = await getTodo(env.DB, id);
    await interaction.update({ ...(todo ? buildTodoMessage(todo) : { content: "このタスクは見つかりません。", components: [] }), allowedMentions: noMentions });
  } catch {
    console.error("Todo button failed", { customId: interaction.customId });
    try { if (!interaction.deferred && !interaction.replied) await reject("処理に失敗しました。時間をおいて再試行してください。"); }
    catch { console.error("Could not deliver todo error response"); }
  }
}

export async function startGateway(env: Env, onInvalidated: () => void): Promise<Client> {
  await verifyDiscordApplication(env);
  // Reading replies to /todo messages needs the privileged Message Content intent, so it is requested only when an owner is configured.
  const intents = env.DISCORD_OWNER_ID ? [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] : [GatewayIntentBits.Guilds];
  const client = new Client({ intents });
  client.once(Events.ClientReady, () => console.log("Discord gateway ready"));
  client.on(Events.Error, () => console.error("Discord gateway error"));
  client.once(Events.Invalidated, onInvalidated);
  client.on(Events.InteractionCreate, (interaction) => {
    if (interaction.isChatInputCommand()) void handleGatewayCommand(interaction, env).catch(() => console.error("Discord command handler failed"));
    else if (interaction.isAutocomplete()) void handleGatewayAutocomplete(interaction, env).catch(() => console.error("Discord autocomplete handler failed"));
    else if (interaction.isStringSelectMenu()) void handleGatewaySelect(interaction, env).catch(() => console.error("Discord component handler failed"));
    else if (interaction.isButton()) void handleGatewayButton(interaction, env).catch(() => console.error("Discord button handler failed"));
  });
  if (env.DISCORD_OWNER_ID) client.on(Events.MessageCreate, (message) => { void handleGatewayMessage(message, env).catch(() => console.error("Discord message handler failed")); });
  try { await client.login(env.DISCORD_BOT_TOKEN); }
  catch (error) { await client.destroy(); throw error; }
  return client;
}
