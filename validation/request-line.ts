import { z } from "zod";
import { isMonday, weekDates } from "../lib/week";

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

const dateString = z
  .string()
  .regex(DATE_SHAPE, "Date must be a valid YYYY-MM-DD");

export const mpRequestLineSchema = z.object({
  workAreaId: z.uuid(),
  shiftDefinitionId: z.uuid(),
  date: dateString,
  headcount: z.number().int().min(1).max(999),
});

// Controller ruling (pre-flight): siteLocationId stays optional at the
// schema level — an admin's is replaced with the pinned session value
// (effectiveSiteLocationId pattern) in the actions, a superadmin's passes
// through with a site weld check. siteId stays optional like every other
// create schema (derived server-side for ho/admin).
const mpRequestBaseSchema = z.object({
  siteId: z.uuid().optional(),
  siteLocationId: z.uuid().optional(),
  type: z.enum(["weekly", "daily"]),
  weekStart: dateString.optional(),
  requestDate: dateString.optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(mpRequestLineSchema).min(1),
});

// Issues are placed so fieldErrorsFrom lands them per-field: anchor-shape
// problems on the weekStart / requestDate path, line-date problems on the
// offending line (lines.<i>.date).
export const mpRequestCreateSchema = mpRequestBaseSchema.superRefine(
  (data, ctx) => {
    if (data.type === "weekly") {
      if (data.requestDate !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["requestDate"],
          message: "A weekly request must not carry a request date",
        });
      }
      if (data.weekStart === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["weekStart"],
          message: "Week start is required",
        });
        return;
      }
      if (!DATE_SHAPE.test(data.weekStart)) {
        // zod v4 runs this refine even when the base shape check failed,
        // handing it the raw input — the Monday/week math below needs a
        // parseable date, and the shape issue already landed on the field.
        return;
      }
      if (!isMonday(data.weekStart)) {
        ctx.addIssue({
          code: "custom",
          path: ["weekStart"],
          message: "Week start must be a Monday",
        });
      }
      const week = new Set(weekDates(data.weekStart));
      data.lines.forEach((line, index) => {
        if (!week.has(line.date)) {
          ctx.addIssue({
            code: "custom",
            path: ["lines", index, "date"],
            message: "Line date must fall within the request week",
          });
        }
      });
      return;
    }
    if (data.weekStart !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["weekStart"],
        message: "A daily request must not carry a week start",
      });
    }
    if (data.requestDate === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["requestDate"],
        message: "Request date is required",
      });
      return;
    }
    data.lines.forEach((line, index) => {
      if (line.date !== data.requestDate) {
        ctx.addIssue({
          code: "custom",
          path: ["lines", index, "date"],
          message: "Every line must share the request date",
        });
      }
    });
  },
);

// Anchor/type are immutable after creation: the update drops them here, so
// the actions validate line dates against the STORED anchor instead.
export const mpRequestUpdateSchema = mpRequestBaseSchema
  .omit({ type: true, weekStart: true, requestDate: true })
  .extend({ id: z.uuid() });

export const advanceStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(["received", "processing", "fulfilled", "rejected"]),
});

export type MpRequestLineInput = z.infer<typeof mpRequestLineSchema>;
export type MpRequestCreateInput = z.infer<typeof mpRequestCreateSchema>;
export type MpRequestUpdateInput = z.infer<typeof mpRequestUpdateSchema>;
