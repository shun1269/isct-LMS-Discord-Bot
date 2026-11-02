-- Muting is keyed by (source, event_id) and is never touched by the sync UPSERT.
ALTER TABLE assignments
  ADD COLUMN reminders_muted INTEGER NOT NULL DEFAULT 0 CHECK (reminders_muted IN (0, 1));
