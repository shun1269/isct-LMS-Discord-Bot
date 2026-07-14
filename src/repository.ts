import { db } from "./db.js";
import type {
  AssignmentInput,
  AssignmentRecord,
  ReminderType,
  SyncPayload,
} from "./types.js";

const deactivateSourceStatement = db.prepare(`
  UPDATE assignments
  SET is_active = 0
  WHERE source = ?
`);

const upsertAssignmentStatement = db.prepare(`
  INSERT INTO assignments (
    source,
    event_id,
    course_module_id,
    course_name,
    course_name_ja,
    title,
    deadline_unix,
    deadline_iso,
    module,
    url,
    overdue,
    first_seen_at,
    last_seen_at,
    is_active
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  ON CONFLICT(source, event_id) DO UPDATE SET
    course_module_id = excluded.course_module_id,
    course_name = excluded.course_name,
    course_name_ja = excluded.course_name_ja,
    title = excluded.title,
    deadline_unix = excluded.deadline_unix,
    deadline_iso = excluded.deadline_iso,
    module = excluded.module,
    url = excluded.url,
    overdue = excluded.overdue,
    last_seen_at = excluded.last_seen_at,
    is_active = 1
`);

const insertSyncRunStatement = db.prepare(`
  INSERT INTO sync_runs (source, synced_at, received_count, complete)
  VALUES (?, ?, ?, ?)
`);

function upsertAssignment(assignment: AssignmentInput, nowIso: string): void {
  upsertAssignmentStatement.run(
    assignment.source,
    assignment.eventId,
    assignment.courseModuleId,
    assignment.course,
    assignment.courseJa,
    assignment.title,
    assignment.deadlineUnix,
    assignment.deadlineIso,
    assignment.module,
    assignment.url,
    assignment.overdue ? 1 : 0,
    nowIso,
    nowIso,
  );
}

export function syncAssignments(payload: SyncPayload): {
  received: number;
  active: number;
} {
  const nowIso = new Date().toISOString();

  db.exec("BEGIN IMMEDIATE");
  try {
    if (payload.complete) {
      deactivateSourceStatement.run(payload.source);
    }

    for (const assignment of payload.assignments) {
      upsertAssignment(assignment, nowIso);
    }

    insertSyncRunStatement.run(
      payload.source,
      nowIso,
      payload.assignments.length,
      payload.complete ? 1 : 0,
    );

    const active = Number(
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM assignments
        WHERE source = ? AND is_active = 1
      `).get(payload.source)?.count ?? 0,
    );

    db.exec("COMMIT");
    return { received: payload.assignments.length, active };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function mapRow(row: Record<string, unknown>): AssignmentRecord {
  return {
    source: String(row.source),
    eventId: Number(row.event_id),
    courseModuleId:
      row.course_module_id === null ? null : Number(row.course_module_id),
    course: String(row.course_name),
    courseJa: String(row.course_name_ja),
    title: String(row.title),
    deadlineUnix: Number(row.deadline_unix),
    deadlineIso: String(row.deadline_iso),
    module: String(row.module),
    url: String(row.url),
    overdue: Boolean(row.overdue),
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    isActive: Boolean(row.is_active),
  };
}

export function listUpcomingAssignments(
  nowUnix: number,
  untilUnix: number,
  limit = 50,
): AssignmentRecord[] {
  const rows = db.prepare(`
    SELECT *
    FROM assignments
    WHERE is_active = 1
      AND deadline_unix >= ?
      AND deadline_unix <= ?
    ORDER BY deadline_unix ASC
    LIMIT ?
  `).all(nowUnix, untilUnix, limit) as Record<string, unknown>[];

  return rows.map(mapRow);
}

export function listReminderCandidates(
  nowUnix: number,
  untilUnix: number,
): AssignmentRecord[] {
  const rows = db.prepare(`
    SELECT *
    FROM assignments
    WHERE is_active = 1
      AND deadline_unix > ?
      AND deadline_unix <= ?
    ORDER BY deadline_unix ASC
  `).all(nowUnix, untilUnix) as Record<string, unknown>[];

  return rows.map(mapRow);
}

export function hasReminderBeenSent(
  assignment: AssignmentRecord,
  reminderType: ReminderType,
): boolean {
  const row = db.prepare(`
    SELECT 1 AS found
    FROM reminder_logs
    WHERE source = ?
      AND event_id = ?
      AND deadline_unix = ?
      AND reminder_type = ?
  `).get(
    assignment.source,
    assignment.eventId,
    assignment.deadlineUnix,
    reminderType,
  );

  return row !== undefined;
}

export function recordReminderSent(
  assignment: AssignmentRecord,
  reminderType: ReminderType,
): void {
  db.prepare(`
    INSERT OR IGNORE INTO reminder_logs (
      source,
      event_id,
      deadline_unix,
      reminder_type,
      sent_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    assignment.source,
    assignment.eventId,
    assignment.deadlineUnix,
    reminderType,
    new Date().toISOString(),
  );
}

export function getLastSync(): {
  source: string;
  syncedAt: string;
  receivedCount: number;
  complete: boolean;
} | null {
  const row = db.prepare(`
    SELECT source, synced_at, received_count, complete
    FROM sync_runs
    ORDER BY id DESC
    LIMIT 1
  `).get() as Record<string, unknown> | undefined;

  if (!row) return null;

  return {
    source: String(row.source),
    syncedAt: String(row.synced_at),
    receivedCount: Number(row.received_count),
    complete: Boolean(row.complete),
  };
}
