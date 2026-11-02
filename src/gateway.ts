import { Client, Events, GatewayIntentBits, MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction, type Message, type ModalSubmitInteraction, type StringSelectMenuInteraction } from "discord.js";
import { commandReply, componentReply } from "./commands.js";
import type { Env } from "./env.js";
import { verifyDiscordApplication } from "./discord-application.js";
import { completeTodo, createTodo, getTodo, setTodoDeadline } from "./repository.js";
import { buildTodoDeadlineModal, buildTodoMessage, parseTodoDeadline, parseTodoId, parseTodoMessage, TODO_DEADLINE_INPUT, TODO_DEADLINE_PREFIX, TODO_DONE_PREFIX, TODO_MODAL_PREFIX, TODO_TITLE_MAX_LENGTH } from "./todos.js";

type CommandInteraction = Pick<ChatInputCommandInteraction, "guildId" | "commandName" | "options" | "deferReply" | "editReply" | "reply" | "deferred" | "replied">;
type SelectInteraction = Pick<StringSelectMenuInteraction, "guildId" | "customId" | "values" | "update" | "reply" | "followUp" | "deferred" | "replied">;
type TodoSourceMessage = Pick<Message, "id" | "guildId" | "author" | "content" | "reply">;
type TodoButtonInteraction = Pick<ButtonInteraction, "guildId" | "user" | "customId" | "showModal" | "update" | "reply" | "deferred" | "replied">;
type TodoModalInteraction = Pick<ModalSubmitInteraction, "guildId" | "user" | "customId" | "fields" | "reply" | "isFromMessage" | "deferred" | "replied">;

const noMentions = { parse: [] as never[] };
const isOwner = (env: Env, userId: string) => env.DISCORD_OWNER_ID !== "" && userId === env.DISCORD_OWNER_ID;

export async function handleGatewayCommand(interaction: CommandInteraction, env: Env): Promise<void> {
  if (interaction.guildId !== env.DISCORD_GUILD_ID) {
    await interaction.reply({ content: "このサーバーでは利用できません。", flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
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

// Only the configured owner can add tasks; other users' messages are ignored silently.
export async function handleGatewayMessage(message: TodoSourceMessage, env: Env): Promise<void> {
  if (message.guildId !== env.DISCORD_GUILD_ID || message.author.bot || !isOwner(env, message.author.id)) return;
  const title = parseTodoMessage(message.content);
  if (title === null) return;
  const reply = (content: string) => message.reply({ content, allowedMentions: { ...noMentions, repliedUser: false } });
  if (title === "") { await reply("タスク名を `todo:タスク名` の形式で送ってください。"); return; }
  if (title.length > TODO_TITLE_MAX_LENGTH) { await reply(`タスク名は${TODO_TITLE_MAX_LENGTH}文字以内にしてください。`); return; }
  try {
    const todo = await createTodo(env.DB, title, message.id);
    await message.reply({ ...buildTodoMessage(todo), allowedMentions: { ...noMentions, repliedUser: false } });
  } catch {
    console.error("Todo creation failed");
    try { await reply("タスクの追加に失敗しました。時間をおいて再試行してください。"); }
    catch { console.error("Could not deliver todo error response"); }
  }
}

async function rejectTodoInteraction(interaction: Pick<TodoButtonInteraction, "reply">, content: string): Promise<void> {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: noMentions });
}

export async function handleGatewayButton(interaction: TodoButtonInteraction, env: Env): Promise<void> {
  const deadlineId = parseTodoId(interaction.customId, TODO_DEADLINE_PREFIX);
  const doneId = parseTodoId(interaction.customId, TODO_DONE_PREFIX);
  const id = deadlineId ?? doneId;
  if (id === null) return;
  if (interaction.guildId !== env.DISCORD_GUILD_ID || !isOwner(env, interaction.user.id)) {
    await rejectTodoInteraction(interaction, "このタスクは操作できません。");
    return;
  }
  try {
    const todo = await getTodo(env.DB, id);
    if (!todo || todo.completedAt !== null) {
      await interaction.update({ ...(todo ? buildTodoMessage(todo) : { content: "このタスクは見つかりません。", components: [] }), allowedMentions: noMentions });
      return;
    }
    if (deadlineId !== null) { await interaction.showModal(buildTodoDeadlineModal(todo)); return; }
    await completeTodo(env.DB, todo.id);
    await interaction.update({ ...buildTodoMessage((await getTodo(env.DB, todo.id))!), allowedMentions: noMentions });
  } catch {
    console.error("Todo button failed", { customId: interaction.customId });
    try { if (!interaction.deferred && !interaction.replied) await rejectTodoInteraction(interaction, "処理に失敗しました。時間をおいて再試行してください。"); }
    catch { console.error("Could not deliver todo error response"); }
  }
}

export async function handleGatewayModal(interaction: TodoModalInteraction, env: Env): Promise<void> {
  const id = parseTodoId(interaction.customId, TODO_MODAL_PREFIX);
  if (id === null) return;
  if (interaction.guildId !== env.DISCORD_GUILD_ID || !isOwner(env, interaction.user.id)) {
    await rejectTodoInteraction(interaction, "このタスクは操作できません。");
    return;
  }
  try {
    const deadline = parseTodoDeadline(interaction.fields.getTextInputValue(TODO_DEADLINE_INPUT));
    if (deadline === null) {
      await rejectTodoInteraction(interaction, "期限を読み取れませんでした。`11/10 23:59` や `2026-11-10 18:00` のように、未来の日時を日本時間で入力してください。");
      return;
    }
    if (!(await setTodoDeadline(env.DB, id, deadline))) {
      await rejectTodoInteraction(interaction, "このタスクは完了済みか、見つかりません。");
      return;
    }
    const message = { ...buildTodoMessage((await getTodo(env.DB, id))!), allowedMentions: noMentions };
    if (interaction.isFromMessage()) await interaction.update(message);
    else await interaction.reply({ ...message, flags: MessageFlags.Ephemeral });
  } catch {
    console.error("Todo modal failed", { customId: interaction.customId });
    try { if (!interaction.deferred && !interaction.replied) await rejectTodoInteraction(interaction, "処理に失敗しました。時間をおいて再試行してください。"); }
    catch { console.error("Could not deliver todo error response"); }
  }
}

export async function startGateway(env: Env, onInvalidated: () => void): Promise<Client> {
  await verifyDiscordApplication(env);
  // Reading "todo:" messages needs the privileged Message Content intent, so it is requested only when an owner is configured.
  const intents = env.DISCORD_OWNER_ID ? [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] : [GatewayIntentBits.Guilds];
  const client = new Client({ intents });
  client.once(Events.ClientReady, () => console.log("Discord gateway ready"));
  client.on(Events.Error, () => console.error("Discord gateway error"));
  client.once(Events.Invalidated, onInvalidated);
  client.on(Events.InteractionCreate, (interaction) => {
    if (interaction.isChatInputCommand()) void handleGatewayCommand(interaction, env).catch(() => console.error("Discord command handler failed"));
    else if (interaction.isStringSelectMenu()) void handleGatewaySelect(interaction, env).catch(() => console.error("Discord component handler failed"));
    else if (interaction.isButton()) void handleGatewayButton(interaction, env).catch(() => console.error("Discord button handler failed"));
    else if (interaction.isModalSubmit()) void handleGatewayModal(interaction, env).catch(() => console.error("Discord modal handler failed"));
  });
  if (env.DISCORD_OWNER_ID) client.on(Events.MessageCreate, (message) => { void handleGatewayMessage(message, env).catch(() => console.error("Discord message handler failed")); });
  try { await client.login(env.DISCORD_BOT_TOKEN); }
  catch (error) { await client.destroy(); throw error; }
  return client;
}
