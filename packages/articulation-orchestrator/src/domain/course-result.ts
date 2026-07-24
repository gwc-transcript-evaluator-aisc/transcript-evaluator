import { z } from 'zod';
import { CatalogResolutionSchema } from './catalog-resolution.js';
import { RequiredCourseSchema } from './degree-program.js';
import { TakenCourseSchema } from './transcript.js';

/** Catalog course content surfaced on results so consumers (e.g. the UI) can show
 * side-by-side descriptions without a second lookup. Single source of truth, also used
 * by the work records. */
export const CatalogContentSchema = z.object({
  department: z.string().trim().min(1).max(200).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(20_000).optional(),
  credits: z.number().finite().optional(),
  learningOutcomes: z.array(z.string().trim().min(1).max(2_000)).optional(),
  topics: z.array(z.string().trim().min(1).max(2_000)).optional(),
  competencies: z.array(z.string().trim().min(1).max(2_000)).optional(),
}).strict();
export type CatalogContent = z.infer<typeof CatalogContentSchema>;

export const MatchingOutcomeSchema = z.enum(['matched', 'unmatched', 'unresolved', 'errored']);
export type MatchingOutcome = z.infer<typeof MatchingOutcomeSchema>;

export const PairOutcomeSchema = z.enum(['evaluated', 'unresolved', 'failed']);
export type PairOutcome = z.infer<typeof PairOutcomeSchema>;

export const PairResultSchema = z.object({
  pairId: z.string().min(1),
  takenCourse: TakenCourseSchema,
  takenResolution: CatalogResolutionSchema,
  outcome: PairOutcomeSchema,
  decision: z.enum(['EQUIVALENT', 'PARTIAL', 'NOT_EQUIVALENT']).optional(),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
  rationale: z.string().trim().min(1).max(10_000).optional(),
  message: z.string().trim().min(1).max(500).optional(),
  // Catalog content of the matched transcript course, attached at finalize time.
  takenCatalogContent: CatalogContentSchema.optional(),
}).strict();
export type PairResult = z.infer<typeof PairResultSchema>;

export const RequiredCourseResultSchema = z.object({
  requiredCourseId: z.string().min(1),
  requiredCourse: RequiredCourseSchema,
  requiredResolution: CatalogResolutionSchema,
  matchingOutcome: MatchingOutcomeSchema,
  message: z.string().trim().min(1).max(500).optional(),
  // Catalog content of the required (destination) course, attached at finalize time.
  requiredCatalogContent: CatalogContentSchema.optional(),
  pairResults: z.array(PairResultSchema),
}).strict().superRefine((result, context) => {
  if (result.matchingOutcome !== 'matched' && result.pairResults.length > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['pairResults'], message: 'Only matched requirements may contain pair results' });
  }
});
export type RequiredCourseResult = z.infer<typeof RequiredCourseResultSchema>;
