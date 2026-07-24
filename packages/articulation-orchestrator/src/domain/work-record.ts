import { z } from 'zod';
import { CatalogResolutionSchema, CourseIdentifierSchema } from './catalog-resolution.js';
import { RequiredCourseSchema } from './degree-program.js';
import { CatalogContentSchema, PairResultSchema, RequiredCourseResultSchema } from './course-result.js';
import { NormalizedStudentSchema, TakenCourseSchema } from './transcript.js';

export type { CatalogContent } from './course-result.js';

const WorkRecordBaseSchema = z.object({
  runId: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const WorkRecordSchema = z.discriminatedUnion('recordType', [
  WorkRecordBaseSchema.extend({ recordType: z.literal('STUDENT'), student: NormalizedStudentSchema }).strict(),
  WorkRecordBaseSchema.extend({
    recordType: z.literal('EXCLUDED_TAKEN'),
    sourceCourseId: z.number().int().positive(),
    takenCourse: TakenCourseSchema,
    reasonCode: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(500),
  }).strict(),
  WorkRecordBaseSchema.extend({
    recordType: z.literal('CANDIDATE'),
    sourceCourseId: z.number().int().positive(),
    takenCourse: TakenCourseSchema,
    resolution: CatalogResolutionSchema,
    identifier: CourseIdentifierSchema,
    catalogContent: CatalogContentSchema,
  }).strict(),
  WorkRecordBaseSchema.extend({
    recordType: z.literal('REQUIRED'),
    requiredCourseId: z.string().min(1),
    requiredCourse: RequiredCourseSchema,
    resolution: CatalogResolutionSchema,
    catalogContent: CatalogContentSchema.optional(),
    result: RequiredCourseResultSchema.optional(),
  }).strict(),
  WorkRecordBaseSchema.extend({
    recordType: z.literal('PAIR'),
    pairId: z.string().min(1),
    requiredCourseId: z.string().min(1),
    sourceCourseId: z.number().int().positive(),
    requiredIdentifier: CourseIdentifierSchema,
    takenIdentifier: CourseIdentifierSchema,
  }).strict(),
  WorkRecordBaseSchema.extend({ recordType: z.literal('PAIR_RESULT'), result: PairResultSchema }).strict(),
]);
export type WorkRecord = z.infer<typeof WorkRecordSchema>;

export const workSortKey = {
  student: () => 'STUDENT',
  excludedTaken: (sourceCourseId: number) => `EXCLUDED_TAKEN#${sourceCourseId}`,
  candidate: (sourceCourseId: number) => `CANDIDATE#${sourceCourseId}`,
  required: (requiredCourseId: string) => `REQUIRED#${requiredCourseId}`,
  pair: (pairId: string) => `PAIR#${pairId}`,
  pairResult: (pairId: string) => `PAIR_RESULT#${pairId}`,
} as const;
