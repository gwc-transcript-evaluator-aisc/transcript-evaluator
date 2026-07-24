import { z } from 'zod';
import { CourseRecordSchema } from './course-record.js';

/** One side of an evaluation request: the caller supplies the natural identifiers, not
 * the derived catalogId, so this module owns turning them into the right DynamoDB key
 * (see domain/course-key.ts). */
export const CourseIdentifierSchema = z.object({
  institution: z.string().trim().min(1),
  academicYear: z.string().trim().min(1),
  courseCode: z.string().trim().min(1),
});
export type CourseIdentifier = z.infer<typeof CourseIdentifierSchema>;

export const EvaluateArticulationRequestSchema = z.object({
  home: CourseIdentifierSchema,
  transfer: CourseIdentifierSchema,
});
export type EvaluateArticulationRequest = z.infer<typeof EvaluateArticulationRequestSchema>;

export const ArticulationDecisionSchema = z.enum(['EQUIVALENT', 'PARTIAL', 'NOT_EQUIVALENT']);
export type ArticulationDecision = z.infer<typeof ArticulationDecisionSchema>;

export const ConfidenceSchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

/** Structured output the model must produce (forced via Bedrock tool use). Kept
 * intentionally small and decision-oriented -- this is the part that's genuinely
 * judgment-based; the raw course data it was judged against is attached separately by
 * the handler so the AI never has to echo it back verbatim. */
export const ArticulationAssessmentSchema = z.object({
  decision: ArticulationDecisionSchema,
  confidence: ConfidenceSchema,
  rationale: z.string().trim().min(1),
  creditHoursComparable: z.boolean(),
  contentCoverageNotes: z.string().trim().min(1).optional(),
});
export type ArticulationAssessment = z.infer<typeof ArticulationAssessmentSchema>;

/** Persisted + returned record for a completed evaluation. Includes the full input
 * course data (not just identifiers) so downstream consumers can display the comparison
 * without a second lookup. */
export const EvaluationRecordSchema = z.object({
  evaluationId: z.string(),
  /** `${homeCatalogId}#${homeCourseSk}__${transferCatalogId}#${transferCourseSk}` --
   * lets callers find prior evaluations of the same course pair without a table scan,
   * while evaluationId stays the primary key so every invocation still creates a new,
   * append-only record. */
  pairKey: z.string(),
  home: CourseIdentifierSchema,
  transfer: CourseIdentifierSchema,
  homeCourse: CourseRecordSchema,
  transferCourse: CourseRecordSchema,
  assessment: ArticulationAssessmentSchema,
  modelId: z.string(),
  createdAt: z.string(),
});
export type EvaluationRecord = z.infer<typeof EvaluationRecordSchema>;

/** Which side(s) of the request couldn't be found in the catalog. Returned instead of
 * calling the AI -- an evaluation without real course content isn't trustworthy, and per
 * requirements the caller (an upstream orchestrator) is expected to have already
 * resolved the right catalog keys before invoking this Lambda. */
export const NotFoundSideSchema = z.enum(['home', 'transfer', 'both']);
export type NotFoundSide = z.infer<typeof NotFoundSideSchema>;

export type EvaluateArticulationResult =
  | { kind: 'EVALUATED'; evaluation: EvaluationRecord }
  | { kind: 'NOT_FOUND'; missing: NotFoundSide; message: string };
