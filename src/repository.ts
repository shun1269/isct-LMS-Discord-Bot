import type { AssignmentInput, AssignmentRecord, ReminderType, SyncPayload, SyncRun, UpcomingCounts } from "./types";

const UPSERT_SQL = `
  INSERT INTO assignments (
    source, event_id, course_module_id, course_name, course_name_ja, title,
    deadline_unix, deadline_iso, module, url, overdue,
    first_seen_at, last_seen_at, is_active
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
`;

function upsertStatement(db: D1Database, assignment: AssignmentInput, nowIso: string): D1PreparedStatement {
  return db.prepare(UPSERT_SQL).bind(
    assignment.source, assignment.eventId, assignment.courseModuleId,
    assignment.course, assignment.courseJa, assignment.title,
    assignment.deadlineUnix, assignment.deadlineIso, assignment.module,
    assignment.url, assignment.overdue ? 1 : 0, nowIso, nowIso,
  );
}

export async function syncAssignments(db: D1Database, payload: SyncPayload, now = new Date()): Promise<{ received: number; active: number }> {
  const nowIso = now.toISOString();
  const statements: D1PreparedStatement[] = [];

  if (payload.complete) {
    statements.push(db.prepare("UPDATE assignments SET is_active = 0 WHERE source = ?").bind(payload.source));
  }
  statements.push(...payload.assignments.map((assignment) => upsertStatement(db, assignment, nowIso)));
  statements.push(db.prepare(`
    INSERT INTO sync_runs (source, synced_at, received_count, complete)
    VALUES (?, ?, ?, ?)
  `).bind(payload.source, nowIso, payload.assignments.length, payload.complete ? 1 : 0));

  await db.batch(statements);
  const row = await db.prepare(`
    SELECT COUNT(*) AS count FROM assignments WHERE source = ? AND is_active = 1
  `).bind(payload.source).first<{ count: number }>();

  return { received: payload.assignments.length, active: Number(row?.count ?? 0) };
}

function mapAssignment(row: Record<string, unknown>): AssignmentRecord {
  return {
    source: String(row.source), eventId: Number(row.event_id),
    courseModuleId: row.course_module_id === null ? null : Number(row.course_module_id),
    course: String(row.course_name), courseJa: String(row.course_name_ja),
    title: String(row.title), deadlineUnix: Number(row.deadline_unix),
    deadlineIso: String(row.deadline_iso), module: String(row.module),
    url: String(row.url), overdue: Boolean(row.overdue),
    firstSeenAt: String(row.first_seen_at), lastSeenAt: String(row.last_seen_at),
    isActive: Boolean(row.is_active),
  };
}

export async function listUpcomingAssignments(db: D1Database, nowUnix: number, untilUnix: number, limit = 50): Promise<AssignmentRecord[]> {
  const { results } = await db.prepare(`
    SELECT * FROM assignments
    WHERE is_active = 1 AND deadline_unix >= ? AND deadline_unix <= ?
    ORDER BY deadline_unix ASC LIMIT ?
  `).bind(nowUnix, untilUnix, limit).all<Record<string, unknown>>();
  return results.map(mapAssignment);
}

export async function listReminderCandidates(db: D1Database, nowUnix: number, untilUnix: number): Promise<AssignmentRecord[]> {
  const { results } = await db.prepare(`
    SELECT * FROM assignments
    WHERE is_active = 1 AND deadline_unix > ? AND deadline_unix <= ?
    ORDER BY deadline_unix ASC
  `).bind(nowUnix, untilUnix).all<Record<string, unknown>>();
  return results.map(mapAssignment);
}

export async function getLastSync(db: D1Database): Promise<SyncRun | null> {
  const row = await db.prepare(`
    SELECT source, synced_at, received_count, complete
    FROM sync_runs ORDER BY id DESC LIMIT 1
  `).first<Record<string, unknown>>();
  if (!row) return null;
  return {
    source: String(row.source), syncedAt: String(row.synced_at),
    receivedCount: Number(row.received_count), complete: Boolean(row.complete),
  };
}

export async function countUpcomingAssignments(db: D1Database, nowUnix: number): Promise<UpcomingCounts> {
  const row = await db.prepare(`
    SELECT
      SUM(CASE WHEN deadline_unix <= ? THEN 1 ELSE 0 END) AS within_24_hours,
      SUM(CASE WHEN deadline_unix <= ? THEN 1 ELSE 0 END) AS within_3_days,
      COUNT(*) AS within_7_days
    FROM assignments
    WHERE is_active = 1 AND deadline_unix >= ? AND deadline_unix <= ?
  `).bind(nowUnix + 86_400, nowUnix + 3 * 86_400, nowUnix, nowUnix + 7 * 86_400).first<Record<string, unknown>>();
  return {
    within24Hours: Number(row?.within_24_hours ?? 0),
    within3Days: Number(row?.within_3_days ?? 0),
    within7Days: Number(row?.within_7_days ?? 0),
  };
}

export async function claimReminder(db: D1Database, assignment: AssignmentRecord, reminderType: ReminderType, now: Date): Promise<boolean> {
  const staleIso = new Date(now.getTime() - 15 * 60_000).toISOString();
  await db.prepare("DELETE FROM reminder_logs WHERE status = 'pending' AND claimed_at <= ?").bind(staleIso).run();
  const result = await db.prepare(`
    INSERT OR IGNORE INTO reminder_logs
      (source, event_id, deadline_unix, reminder_type, status, claimed_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).bind(assignment.source, assignment.eventId, assignment.deadlineUnix, reminderType, now.toISOString()).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function markReminderSent(db: D1Database, assignment: AssignmentRecord, reminderType: ReminderType, now: Date): Promise<void> {
  await db.prepare(`
    UPDATE reminder_logs SET status = 'sent', sent_at = ?, last_error = NULL
    WHERE source = ? AND event_id = ? AND deadline_unix = ? AND reminder_type = ? AND status = 'pending'
  `).bind(now.toISOString(), assignment.source, assignment.eventId, assignment.deadlineUnix, reminderType).run();
}

export async function releaseReminderClaim(db: D1Database, assignment: AssignmentRecord, reminderType: ReminderType): Promise<void> {
  await db.prepare(`
    DELETE FROM reminder_logs
    WHERE source = ? AND event_id = ? AND deadline_unix = ? AND reminder_type = ? AND status = 'pending'
  `).bind(assignment.source, assignment.eventId, assignment.deadlineUnix, reminderType).run();
}
