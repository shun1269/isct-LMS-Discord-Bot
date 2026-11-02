-- Personal tasks added with "todo:" messages. The deadline is optional and set afterwards from a modal.
CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  deadline_unix INTEGER,
  source_message_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_todos_open
  ON todos (completed_at, deadline_unix);
