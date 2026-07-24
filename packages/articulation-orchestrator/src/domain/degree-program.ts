import { z } from 'zod';

export const AcademicYearSchema = z.string().regex(/^\d{4}(-\d{4})?$/, 'Academic year must use YYYY or YYYY-YYYY format');

export const RequiredCourseSchema = z.object({
  institution: z.string().trim().min(1).max(200),
  academicYear: AcademicYearSchema,
  courseCode: z.string().trim().min(1).max(20),
  courseTitle: z.string().trim().min(1).max(200).optional(),
}).strict();

export type RequiredCourse = z.infer<typeof RequiredCourseSchema>;

export const DegreeProgramSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  requiredCourses: z.array(RequiredCourseSchema).max(500),
}).strict().superRefine((program, context) => {
  const identifiers = new Set<string>();

  program.requiredCourses.forEach((course, index) => {
    const identifier = normalizedRequiredCourseIdentifier(course);
    if (identifiers.has(identifier)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requiredCourses', index],
        message: 'Required course identifiers must be unique after normalization',
      });
    }
    identifiers.add(identifier);
  });
});

export type DegreeProgram = z.infer<typeof DegreeProgramSchema>;

export const DegreeProgramRegistrySchema = z.array(DegreeProgramSchema).superRefine((programs, context) => {
  const identifiers = new Set<string>();
  programs.forEach((program, index) => {
    if (identifiers.has(program.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'id'],
        message: 'Degree program identifiers must be unique',
      });
    }
    identifiers.add(program.id);
  });
});

export function normalizedRequiredCourseIdentifier(course: RequiredCourse): string {
  return [course.institution, course.academicYear, course.courseCode]
    .map((value) => value.trim().replace(/\s+/g, ' ').toLocaleUpperCase('en-US'))
    .join('|');
}
