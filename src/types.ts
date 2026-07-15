export interface AssignmentInput {
  source: string;
  eventId: number;
  courseModuleId: number | null;
  course: string;
  courseJa: string;
  title: string;
  deadlineUnix: number;
  deadlineIso: string;
  deadlineJst: string | null;
  module: string;
  url: string;
  overdue: boolean;
  syncedAt: string;
}

export interface SyncPayload {
  source: string;
  complete: boolean;
  assignments: AssignmentInput[];
}

export interface AssignmentRecord extends Omit<AssignmentInput, "deadlineJst" | "syncedAt"> {
  firstSeenAt: string;
  lastSeenAt: string;
  isActive: boolean;
}

export interface SyncRun {
  source: string;
  syncedAt: string;
  receivedCount: number;
  complete: boolean;
}

export type ReminderType = "7d" | "3d" | "2d" | `hourly-${number}`;

export type UrgencyLevel =
  | "overdue"
  | "critical"
  | "urgent"
  | "warning"
  | "near"
  | "normal"
  | "future";

export interface UrgencyStyle {
  level: UrgencyLevel;
  emoji: string;
  label: string;
  color: number;
  mentionRequired: boolean;
}

export interface UpcomingCounts {
  within24Hours: number;
  within3Days: number;
  within7Days: number;
}
