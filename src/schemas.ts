import { z } from "zod";

const sourceSchema = z.string().min(1).max(100).regex(/^science-tokyo-lms-\d{4}$/);

export const assignmentSchema = z.object({
  source: sourceSchema,
  eventId: z.number().int().nonnegative(),
  courseModuleId: z.number().int().nonnegative().nullable(),
  course: z.string().trim().min(1).max(500),
  courseJa: z.string().trim().min(1).max(300),
  title: z.string().trim().min(1).max(500),
  deadlineUnix: z.number().int().positive(),
  deadlineIso: z.iso.datetime(),
  deadlineJst: z.string().max(100).nullable(),
  module: z.string().max(100),
  url: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "lms.s.isct.ac.jp";
  }, "url must be an HTTPS Science Tokyo LMS URL"),
  overdue: z.boolean(),
  syncedAt: z.iso.datetime(),
}).superRefine((assignment, ctx) => {
  const isoUnix = Date.parse(assignment.deadlineIso) / 1000;
  if (!Number.isFinite(isoUnix) || Math.abs(isoUnix - assignment.deadlineUnix) > 1) {
    ctx.addIssue({ code: "custom", path: ["deadlineIso"], message: "deadlineIso must match deadlineUnix" });
  }
});

export const syncPayloadSchema = z.object({
  source: sourceSchema,
  complete: z.boolean(),
  assignments: z.array(assignmentSchema).max(500),
}).superRefine((payload, ctx) => {
  payload.assignments.forEach((assignment, index) => {
    if (assignment.source !== payload.source) {
      ctx.addIssue({ code: "custom", path: ["assignments", index, "source"], message: "assignment.source must match payload.source" });
    }
  });
});
