import type { ExcludedTakenCourse } from '../domain/articulation-result.js';
import {
  NormalizedStudentSchema,
  TakenCourseSchema,
  type NormalizedStudent,
  type TakenCourse,
  type TranscriptDetailDto,
} from '../domain/transcript.js';

export interface NormalizedTranscript {
  student: NormalizedStudent;
  takenCourses: TakenCourse[];
  excludedTakenCourses: ExcludedTakenCourse[];
}

/** Normalizes one authoritative Transcript_API detail response for use throughout a run. */
export function normalizeTranscript(detail: TranscriptDetailDto): NormalizedTranscript {
  if (detail.student === null) throw new TranscriptNormalizationError('STUDENT_MISSING', 'Transcript has no student record.');

  const student = NormalizedStudentSchema.parse({
    studentKey: `transcript-processor:${detail.student.id}`,
    processorStudentId: detail.student.id,
    externalStudentId: nonBlank(detail.student.student_id),
    displayName: nonBlank(detail.student.full_name) ?? `Student ${detail.student.id}`,
  });
  const rawInstitution = nonBlank(detail.student.institution);
  const takenCourses: TakenCourse[] = [];
  const excludedTakenCourses: ExcludedTakenCourse[] = [];

  for (const course of detail.student.courses) {
    const takenCourse = TakenCourseSchema.parse({
      sourceCourseId: course.id,
      courseCode: nonBlank(course.course_code),
      courseTitle: nonBlank(course.course_name),
      department: nonBlank(course.department),
      credits: course.credits ?? undefined,
      rawInstitution,
      rawAcademicYear: firstAcademicYear(course.term_year, course.year),
    });
    const missing = missingIdentifierFields(takenCourse);
    if (missing.length > 0) {
      excludedTakenCourses.push({
        takenCourse,
        reasonCode: 'MISSING_REQUIRED_IDENTIFIER',
        message: `Missing required identifier: ${missing.join(', ')}.`,
      });
    } else {
      takenCourses.push(takenCourse);
    }
  }

  return { student, takenCourses, excludedTakenCourses };
}

export class TranscriptNormalizationError extends Error {
  public constructor(public readonly code: 'STUDENT_MISSING', message: string) {
    super(message);
    this.name = 'TranscriptNormalizationError';
  }
}

function firstAcademicYear(termYear: string | number | null, year: string | number | null): string | undefined {
  return asAcademicYear(termYear) ?? asAcademicYear(year);
}

function asAcademicYear(value: string | number | null): string | undefined {
  const normalized = nonBlank(value === null ? undefined : String(value));
  return normalized && /^\d{4}(?:-\d{4})?$/.test(normalized) ? normalized : undefined;
}

function nonBlank(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function missingIdentifierFields(course: TakenCourse): string[] {
  const missing: string[] = [];
  if (!course.rawInstitution) missing.push('institution');
  if (!course.rawAcademicYear) missing.push('academicYear');
  if (!course.courseCode) missing.push('courseCode');
  return missing;
}
