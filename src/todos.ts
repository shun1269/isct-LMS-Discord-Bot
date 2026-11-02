import type { DiscordEmbed } from "./format.js";
import type { TodoRecord } from "./types.js";

export const TODO_DEADLINE_PREFIX = "todo-deadline:";
export const TODO_DONE_PREFIX = "todo-done:";
export const TODO_MODAL_PREFIX = "todo-deadline-modal:";
export const TODO_DEADLINE_INPUT = "deadline";
export const TODO_TITLE_MAX_LENGTH = 100;

const JST_OFFSET_SECONDS = 9 * 3_600;

interface DiscordButton { type: 2; style: 1 | 2 | 3; custom_id: string; label: string; emoji?: { name: string } }
interface DiscordTextInput { type: 4; custom_id: string; label: string; style: 1; placeholder?: string; required?: boolean; min_length?: number; max_length?: number }
export interface TodoButtonRow { type: 1; components: DiscordButton[] }
export interface TodoMessage { content: string; components: TodoButtonRow[] }
export interface TodoModal { custom_id: string; title: string; components: Array<{ type: 1; components: DiscordTextInput[] }> }

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

// Accepts "todo:" with a half- or full-width colon; returns null for other messages.
export function parseTodoMessage(content: string): string | null {
  const match = /^todo[:：]([\s\S]*)$/i.exec(content.trim());
  if (!match) return null;
  return match[1]!.replace(/\s+/g, " ").trim();
}

// Interprets the input as JST. Supports "2026-11-10 23:59", "2026/11/10", "11/10 9:00" and "11/10" (23:59).
// Without a year, the next occurrence from now is used. Returns null for malformed or past dates.
export function parseTodoDeadline(input: string, now = new Date()): number | null {
  const normalized = input.normalize("NFKC").trim();
  const match = /^(?:(\d{4})[-/.])?(\d{1,2})[-/.](\d{1,2})(?:[\sT]+(\d{1,2}):(\d{2}))?$/.exec(normalized);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = hourText === undefined ? 23 : Number(hourText);
  const minute = minuteText === undefined ? 59 : Number(minuteText);
  if (hour > 23 || minute > 59) return null;
  const nowUnix = Math.floor(now.getTime() / 1000);
  const toUnix = (year: number): number | null => {
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date.getTime() / 1000 - JST_OFFSET_SECONDS;
  };
  let deadline: number | null;
  if (yearText !== undefined) deadline = toUnix(Number(yearText));
  else {
    const currentYear = new Date((nowUnix + JST_OFFSET_SECONDS) * 1000).getUTCFullYear();
    deadline = toUnix(currentYear);
    if (deadline !== null && deadline <= nowUnix) deadline = toUnix(currentYear + 1);
  }
  return deadline !== null && deadline > nowUnix ? deadline : null;
}

function deadlineLine(todo: TodoRecord): string {
  return todo.deadlineUnix === null ? "📅 期限：未設定" : `📅 期限：<t:${todo.deadlineUnix}:F>（<t:${todo.deadlineUnix}:R>）`;
}

export function buildTodoMessage(todo: TodoRecord): TodoMessage {
  if (todo.completedAt !== null) return { content: `✅ タスク「${todo.title}」を完了にしました。`, components: [] };
  return {
    content: [`📝 タスク「${todo.title}」を追加しました。`, deadlineLine(todo)].join("\n"),
    components: [{
      type: 1,
      components: [
        { type: 2, style: 1, custom_id: `${TODO_DEADLINE_PREFIX}${todo.id}`, label: todo.deadlineUnix === null ? "期限を設定" : "期限を変更", emoji: { name: "📅" } },
        { type: 2, style: 3, custom_id: `${TODO_DONE_PREFIX}${todo.id}`, label: "完了", emoji: { name: "✅" } },
      ],
    }],
  };
}

export function buildTodoDeadlineModal(todo: TodoRecord): TodoModal {
  return {
    custom_id: `${TODO_MODAL_PREFIX}${todo.id}`,
    title: truncate(`期限を設定：${todo.title}`, 45),
    components: [{
      type: 1,
      components: [{
        type: 4, custom_id: TODO_DEADLINE_INPUT, label: "期限（日本時間）", style: 1,
        placeholder: "例：11/10 23:59、2026-11-10 18:00、11/10", required: true, min_length: 3, max_length: 20,
      }],
    }],
  };
}

export function buildTodoListEmbed(todos: TodoRecord[]): DiscordEmbed | null {
  if (todos.length === 0) return null;
  const lines: string[] = [];
  for (const todo of todos) {
    const due = todo.deadlineUnix === null ? "期限なし" : `<t:${todo.deadlineUnix}:F>（<t:${todo.deadlineUnix}:R>）`;
    const line = `- **${truncate(todo.title, TODO_TITLE_MAX_LENGTH)}** — ${due}`;
    if (lines.join("\n").length + line.length > 3_800) {
      lines.push("…表示上限のため、以降は省略しました。");
      break;
    }
    lines.push(line);
  }
  return { title: "📝 タスク", description: lines.join("\n"), color: 0x8B5CF6 };
}

export function parseTodoId(customId: string, prefix: string): number | null {
  if (!customId.startsWith(prefix)) return null;
  const id = customId.slice(prefix.length);
  return /^\d{1,15}$/.test(id) ? Number(id) : null;
}
