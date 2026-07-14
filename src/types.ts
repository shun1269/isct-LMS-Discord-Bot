import { z } from "zod";

export const assignmentSchema = z.object({
  source: z.string().min(1).max(100),
  eventId: z.number().int().nonnegative(),
  courseModuleId: z.number().int().nonnegative().nullable(),
  course: z.string().min(1).max(500),
  courseJa: z.string().min(1).max(300),
  title: z.string().min(1).max(500),
  deadlineUnix: z.number().int().positive(),
  deadlineIso: z.iso.datetime(),
  deadlineJst: z.string().max(100).nullable(),
  module: z.string().max(100),
  url: z.url(),
  overdue: z.boolean(),
  syncedAt: z.iso.datetime(),
});

export const syncPayloadSchema = z.object({
  source: z.string().min(1).max(100),
  complete: z.boolean().default(true),
  assignments: z.array(assignmentSchema).max(500),
}).superRefine((payload, ctx) => {
  for (const [index, assignment] of payload.assignments.entries()) {
    if (assignment.source !== payload.source) {
      ctx.addIssue({
        code: "custom",
        path: ["assignments", index, "source"],
        message: "assignment.source must match payload.source",
      });
    }
  }
});

export type AssignmentInput = z.infer<typeof assignmentSchema>;
export type SyncPayload = z.infer<typeof syncPayloadSchema>;

export interface AssignmentRecord {
  source: string;
  eventId: number;
  courseModuleId: number | null;
  course: string;
  courseJa: string;
  title: string;
  deadlineUnix: number;
  deadlineIso: string;
  module: string;
  url: string;
  overdue: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  isActive: boolean;
}

export type ReminderType =
  | "7d"
  | `hourly-${number}`;