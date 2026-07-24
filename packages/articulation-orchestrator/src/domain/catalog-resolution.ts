import { z } from 'zod';
import { AcademicYearSchema } from './degree-program.js';

export const CourseIdentifierSchema = z.object({
  institution: z.string().trim().min(1).max(200),
  academicYear: AcademicYearSchema,
  courseCode: z.string().trim().min(1).max(20),
}).strict();
export type CourseIdentifier = z.infer<typeof CourseIdentifierSchema>;

export const ResolutionMethodSchema = z.enum([
  'exact',
  'exact-institution-year-fallback',
  'ai-institution',
  'ai-institution-year-fallback',
]);
export type ResolutionMethod = z.infer<typeof ResolutionMethodSchema>;

const OriginalResolutionSchema = z.object({
  institution: z.string().trim().min(1).max(200).optional(),
  academicYear: AcademicYearSchema.optional(),
}).strict();

export const CatalogResolutionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('resolved'),
    original: OriginalResolutionSchema.extend({
      institution: z.string().trim().min(1).max(200),
      academicYear: AcademicYearSchema,
    }),
    resolved: z.object({
      institution: z.string().trim().min(1).max(200),
      academicYear: AcademicYearSchema,
    }).strict(),
    method: ResolutionMethodSchema,
  }).strict(),
  z.object({
    kind: z.literal('unresolved'),
    original: OriginalResolutionSchema,
    reasonCode: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(500),
  }).strict(),
]);
export type CatalogResolution = z.infer<typeof CatalogResolutionSchema>;
