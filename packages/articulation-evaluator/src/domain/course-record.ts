import { z } from 'zod';

/**
 * Mirrors the `CourseSchema`/`CourseRecord` shape in
 * `packages/course-catalog-api/src/domain/course.ts`. Duplicated (not imported) for the
 * same reason as course-key.ts: this package reads course-catalog-api's Catalog table
 * directly and must agree on the item shape, but course-catalog-api isn't published as
 * a library for other packages to depend on.
 */

const optionalString = z.string().trim().min(1).optional();
const stringList = z.array(z.string().trim().min(1)).optional();

export const CourseRecordSchema = z.object({
  catalogId: z.string(),
  sk: z.string(),
  courseCode: z.string(),
  department: optionalString,
  courseTitle: optionalString,
  courseLevel: optionalString,
  description: optionalString,
  credits: z.number().nonnegative().optional(),
  contactHours: z.number().nonnegative().optional(),
  lectureHours: z.number().nonnegative().optional(),
  labHours: z.number().nonnegative().optional(),
  studioHours: z.number().nonnegative().optional(),
  deliveryMode: optionalString,
  duration: optionalString,
  learningOutcomes: stringList,
  topics: stringList,
  competencies: stringList,
  assignments: stringList,
  assessmentMethods: stringList,
  requiredMaterials: stringList,
  transferNotes: stringList,
  sourcePages: z.array(z.number().int().positive()).optional(),
  updatedAt: z.string(),
});

export type CourseRecord = z.infer<typeof CourseRecordSchema>;
