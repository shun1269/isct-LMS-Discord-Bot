import { formatRemainingTime, type DiscordEmbed } from "./format.js";
import type { TodoRecord } from "./types.js";

export const TODO_DONE_PREFIX = "todo-done:";
// Buttons from the earlier modal-based version may still exist on old messages.
export const LEGACY_TODO_DEADLINE_PREFIX = "todo-deadline:";
export const TODO_TITLE_MAX_LENGTH = 100;

const JST_OFFSET_SECONDS = 9 * 3_600;
const DAY_MS = 86_400_000;
const WEEKDAYS = "日月火水木金土";
const MAX_CHOICES = 25;

interface DiscordButton { type: 2; style: 1 | 2 | 3; custom_id: string; label: string; emoji?: { name: string } }
export interface TodoButtonRow { type: 1; components: DiscordButton[] }
export interface TodoMessage { content: string; components: TodoButtonRow[] }
export interface DeadlineChoice { name: string; value: string }
interface TimeOfDay { hour: number; minute: number }

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

// Calendar days are represented as UTC-midnight Dates holding the JST date.
function jstToday(now: Date): Date {
  const shifted = new Date(now.getTime() + JST_OFFSET_SECONDS * 1000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

function addDays(day: Date, days: number): Date {
  return new Date(day.getTime() + days * DAY_MS);
}

function calendarDay(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

function toUnix(day: Date, time: TimeOfDay): number {
  return day.getTime() / 1000 + time.hour * 3_600 + time.minute * 60 - JST_OFFSET_SECONDS;
}

function parseTime(text: string, allowBareHour: boolean): TimeOfDay | null {
  const half = /^(\d{1,2})時半$/.exec(text);
  const match = /^(\d{1,2}):(\d{2})$/.exec(text) ?? /^(\d{1,2})時(?:(\d{1,2})分)?$/.exec(text) ?? (allowBareHour ? /^(\d{1,2})$/.exec(text) : null);
  const hour = Number((half ?? match)?.[1]);
  const minute = half ? 30 : Number(match?.[2] ?? 0);
  if (!(half ?? match) || hour > 23 || minute > 59) return null;
  return { hour, minute };
}

// Returns candidate days in preference order; an unknown expression yields none.
function dateCandidates(text: string, today: Date): Date[] {
  if (text === "") return [today, addDays(today, 1)];
  if (/^(今日|きょう)$/.test(text)) return [today];
  if (/^(明日|あした|あす)$/.test(text)) return [addDays(today, 1)];
  if (/^(明後日|あさって)$/.test(text)) return [addDays(today, 2)];

  const relative = /^(\d{1,3})(日|週間|週)後$/.exec(text);
  if (relative) {
    const days = Number(relative[1]) * (relative[2] === "日" ? 1 : 7);
    return days <= 366 ? [addDays(today, days)] : [];
  }

  const weekday = /^(今週|来週)?の?([日月火水木金土])(?:曜日?)?$/.exec(text);
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[2]!);
    const current = today.getUTCDay();
    if (!weekday[1]) {
      const ahead = (target - current + 7) % 7;
      return [addDays(today, ahead), addDays(today, ahead + 7)];
    }
    // Weeks start on Monday.
    const monday = addDays(today, -((current + 6) % 7));
    return [addDays(monday, (target + 6) % 7 + (weekday[1] === "来週" ? 7 : 0))];
  }

  const date = /^(?:(\d{4})[-/.年])?(\d{1,2})[-/.月](\d{1,2})日?$/.exec(text);
  if (date) {
    const [, yearText, month, day] = date;
    const years = yearText ? [Number(yearText)] : [today.getUTCFullYear(), today.getUTCFullYear() + 1];
    return years.map((year) => calendarDay(year, Number(month), Number(day))).filter((value): value is Date => value !== null);
  }
  return [];
}

// Splits a trailing time ("18:00", "18時", "18時半", or a bare "18" after a date) from the date expression.
function splitTime(text: string, today: Date): { dateText: string; time: TimeOfDay | null } {
  const timed = /^(.*?)\s*(\d{1,2}:\d{2}|\d{1,2}時(?:\d{1,2}分|半)?)$/.exec(text);
  if (timed) return { dateText: timed[1]!.trim(), time: parseTime(timed[2]!, false) };
  const bare = /^(.+?)\s+(\d{1,2})$/.exec(text);
  if (bare && dateCandidates(bare[1]!, today).length > 0) return { dateText: bare[1]!, time: parseTime(bare[2]!, true) };
  return { dateText: text, time: { hour: 23, minute: 59 } };
}

// Interprets the input in JST and returns future deadlines, most likely first. A missing time means 23:59.
export function resolveTodoDeadlines(input: string, now = new Date()): number[] {
  const text = input.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (text === "") return [];
  const today = jstToday(now);
  const { dateText, time } = splitTime(text, today);
  if (!time) return [];
  const nowUnix = Math.floor(now.getTime() / 1000);
  const deadlines = dateCandidates(dateText, today).map((day) => toUnix(day, time)).filter((unix) => unix > nowUnix);
  return [...new Set(deadlines)];
}

export function parseTodoDeadline(input: string, now = new Date()): number | null {
  return resolveTodoDeadlines(input, now)[0] ?? null;
}

function formatJst(unix: number): { date: string; time: string; canonical: string } {
  const shifted = new Date((unix + JST_OFFSET_SECONDS) * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  const [year, month, day] = [shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate()];
  const time = `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
  return { date: `${month}/${day}(${WEEKDAYS[shifted.getUTCDay()]})`, time, canonical: `${year}-${pad(month)}-${pad(day)} ${time}` };
}

function deadlineChoice(unix: number, nowUnix: number, prefix = ""): DeadlineChoice {
  const { date, time, canonical } = formatJst(unix);
  return { name: `${prefix}${date} ${time}（${formatRemainingTime(unix - nowUnix)}）`, value: canonical };
}

// Autocomplete choices for the deadline option. Values are canonical so a picked choice parses to the shown time.
export function buildDeadlineChoices(input: string, now = new Date()): DeadlineChoice[] {
  const nowUnix = Math.floor(now.getTime() / 1000);
  const text = input.trim();
  if (text === "") {
    const today = jstToday(now);
    const labels = ["今日 ", "明日 ", "明後日 "];
    return Array.from({ length: 8 }, (_, offset) => ({ offset, unix: toUnix(addDays(today, offset), { hour: 23, minute: 59 }) }))
      .filter(({ unix }) => unix > nowUnix)
      .map(({ offset, unix }) => deadlineChoice(unix, nowUnix, labels[offset] ?? ""));
  }
  const deadlines = resolveTodoDeadlines(text, now);
  if (deadlines.length === 0) {
    return [{ name: truncate(`「${text}」は読み取れません（例：金、明日 18、11/10 12:00）`, 100), value: truncate(text, 100) }];
  }
  return deadlines.slice(0, MAX_CHOICES).map((unix) => deadlineChoice(unix, nowUnix));
}

export function normalizeTodoTitle(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function isTodoCompletionReply(content: string): boolean {
  return /^(完了|done)$/i.test(content.normalize("NFKC").trim());
}

export function buildTodoMessage(todo: TodoRecord): TodoMessage {
  if (todo.completedAt !== null) return { content: `✅ ~~${todo.title}~~ 完了`, components: [] };
  const deadline = todo.deadlineUnix === null ? "📅 期限なし" : `📅 <t:${todo.deadlineUnix}:F>（<t:${todo.deadlineUnix}:R>）`;
  return {
    content: [`📝 **${todo.title}**`, deadline, "-# 期限を変えるときは「木 18」、終わったら「完了」とこのメッセージにリプライ"].join("\n"),
    components: [{ type: 1, components: [{ type: 2, style: 3, custom_id: `${TODO_DONE_PREFIX}${todo.id}`, label: "完了", emoji: { name: "✅" } }] }],
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
