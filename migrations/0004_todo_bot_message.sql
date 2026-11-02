-- The bot's /todo reply. Replies to it change the deadline or complete the task.
ALTER TABLE todos ADD COLUMN bot_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_todos_bot_message
  ON todos (bot_message_id);
