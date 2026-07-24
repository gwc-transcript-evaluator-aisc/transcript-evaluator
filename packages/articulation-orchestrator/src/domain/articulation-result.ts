import { z } from 'zod';
import { RequiredCourseResultSchema } from './course-result.js';
import { NormalizedStudentSchema, TakenCourseSchema } from './transcript.js';

export const ExcludedTakenCourseSchema = z.object({
  takenCourse: TakenCourseSchema,
  reasonCode: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(500),
}).strict();
export type ExcludedTakenCourse = z.infer<typeof ExcludedTakenCourseSchema>;

export const ArticulationResultSchema = z.object({
  resultId: z.string().uuid(),
  runId: z.string().uuid(),
  transcriptId: z.number().int().positive(),
  student: NormalizedStudentSchema,
  degreeProgramId: z.string().trim().min(1).max(200),
  createdAt: z.string().datetime(),
  excludedTakenCourses: z.array(ExcludedTakenCourseSchema),
  requiredCourseResults: z.array(RequiredCourseResultSchema),
}).strict().superRefine((result, context) => {
  if (result.resultId !== result.runId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['resultId'], message: 'resultId must equal runId' });
  }
  const requiredCourseIds = new Set<string>();
  result.requiredCourseResults.forEach((courseResult, index) => {
    if (requiredCourseIds.has(courseResult.requiredCourseId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['requiredCourseResults', index, 'requiredCourseId'], message: 'Required course results must be unique' });
    }
    requiredCourseIds.add(courseResult.requiredCourseId);
  });
});
export type ArticulationResult = z.infer<typeof ArticulationResultSchema>;

export const StudentDirectorySummarySchema = z.object({
  studentKey: z.string().min(1),
  displayName: z.string().min(1),
  externalStudentId: z.string().min(1).optional(),
  latestResultAt: z.string().datetime(),
  latestResultId: z.string().uuid(),
  resultCount: z.number().int().nonnegative(),
}).strict();
export type StudentDirectorySummary = z.infer<typeof StudentDirectorySummarySchema>;
