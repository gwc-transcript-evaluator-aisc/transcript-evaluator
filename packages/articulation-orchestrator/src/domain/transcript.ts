import { z } from 'zod';
import { AcademicYearSchema } from './degree-program.js';

// The processor reports `submitted` after upload, in addition to its later lifecycle states.
export const TranscriptStatusSchema = z.enum(['pending', 'submitted', 'processing', 'completed', 'failed']);
export type TranscriptStatus = z.infer<typeof TranscriptStatusSchema>;

export const TranscriptStatusDtoSchema = z.object({
  id: z.number().int().positive(),
  status: TranscriptStatusSchema,
}).passthrough();

export type TranscriptStatusDto = z.infer<typeof TranscriptStatusDtoSchema>;

export const TranscriptCourseDtoSchema = z.object({
  id: z.number().int().positive(),
  course_code: z.string().nullable(),
  course_name: z.string().nullable(),
  department: z.string().nullable(),
  term_year: z.union([z.string(), z.number()]).nullable(),
  year: z.union([z.string(), z.number()]).nullable(),
  credits: z.number().nullable(),
}).strict();

export type TranscriptCourseDto = z.infer<typeof TranscriptCourseDtoSchema>;

export const TranscriptStudentDtoSchema = z.object({
  id: z.number().int().positive(),
  student_id: z.string().nullable(),
  full_name: z.string().nullable(),
  institution: z.string().nullable(),
  courses: z.array(TranscriptCourseDtoSchema),
}).strict();

export type TranscriptStudentDto = z.infer<typeof TranscriptStudentDtoSchema>;

export const TranscriptDetailDtoSchema = z.object({
  id: z.number().int().positive(),
  status: TranscriptStatusSchema,
  student: TranscriptStudentDtoSchema.nullable(),
}).passthrough();

export type TranscriptDetailDto = z.infer<typeof TranscriptDetailDtoSchema>;

export const NormalizedStudentSchema = z.object({
  studentKey: z.string().min(1),
  processorStudentId: z.number().int().positive(),
  externalStudentId: z.string().min(1).optional(),
  displayName: z.string().min(1),
}).strict();
export type NormalizedStudent = z.infer<typeof NormalizedStudentSchema>;

export const TakenCourseSchema = z.object({
  sourceCourseId: z.number().int().positive(),
  courseCode: z.string().trim().min(1).max(20).optional(),
  courseTitle: z.string().trim().min(1).max(200).optional(),
  department: z.string().trim().min(1).max(200).optional(),
  credits: z.number().finite().optional(),
  rawInstitution: z.string().trim().min(1).max(200).optional(),
  rawAcademicYear: AcademicYearSchema.optional(),
}).strict();
export type TakenCourse = z.infer<typeof TakenCourseSchema>;
