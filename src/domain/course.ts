import { z } from 'zod';

const optionalString = z.string().trim().min(1).optional();
const stringList = z.array(z.string().trim().min(1)).optional();

export const CourseSchema = z.object({
  department: optionalString,
  courseCode: optionalString,
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
});

export const CourseCatalogSchema = z.object({
  institution: optionalString,
  catalogTitle: optionalString,
  catalogAcademicYear: optionalString,
  courses: z.array(CourseSchema),
});

export type Course = z.infer<typeof CourseSchema>;
export type CourseCatalog = z.infer<typeof CourseCatalogSchema>;

export const JobStatusSchema = z.enum(['UPLOADING', 'QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const PageStatusSchema = z.enum(['PROCESSING', 'SUCCEEDED', 'FAILED']);
export type PageStatus = z.infer<typeof PageStatusSchema>;

export interface JobPage {
  pageNumber: number;
  invocationArn: string;
  status: PageStatus;
  errorMessage?: string;
}

export interface JobRecord {
  jobId: string;
  status: JobStatus;
  inputKey: string;
  createdAt: string;
  updatedAt: string;
  /** One BDA invocation per page of the uploaded PDF; extraction runs per-page to avoid
   * the multi-course enumeration cap BDA's blueprint hits on long documents. */
  pages?: JobPage[];
  totalPages?: number;
  /** Caller-supplied school + academic year, when known up front (e.g. the caller is
   * asking "does school X's Y catalog exist" and triggering extraction for that exact
   * key). Pinning this avoids relying solely on whatever institution/year BDA happens to
   * extract from the document to determine where results get stored. */
  catalogId?: string;
  courseCount?: number;
  errorMessage?: string;
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

/** Stable key for an institution + academic year, so re-processing the same catalog
 * updates existing course records instead of creating duplicates. */
export function makeCatalogId(institution: string | undefined, academicYear: string | undefined): string {
  return `${slugify(institution ?? 'unknown-institution')}#${slugify(academicYear ?? 'unknown-year')}`;
}

/** Normalizes a course code for use as a lookup/dedup key: uppercased, whitespace
 * collapsed, and common formatting variants (e.g. "ACCT&201" vs "ACCT& 201" vs
 * "ACCT & 201") unified. Catalogs are inconsistent about spacing and ampersand
 * placement around the department prefix, and extraction across different pages of the
 * same catalog can return either style for the same course -- without normalizing here,
 * those would incorrectly be treated as two different courses. */
export function normalizeCourseCode(courseCode: string): string {
  return courseCode
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*&\s*/g, '& ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A course, stored in the single Catalog table under PK=catalogId, SK=`COURSE#<code>`
 * (see makeCourseSk), alongside the catalog's METADATA item. */
export interface CourseRecord extends Course {
  catalogId: string;
  sk: string;
  courseCode: string;
  sourcePages?: number[];
  updatedAt: string;
}

export const METADATA_SK = 'METADATA';

/** Sort key for a course item within the single-table design. Course codes are
 * normalized first so lookups are insensitive to spacing/case/ampersand formatting
 * variants (see normalizeCourseCode). */
export function makeCourseSk(courseCode: string): string {
  return `COURSE#${normalizeCourseCode(courseCode)}`;
}

export const CatalogStatusSchema = z.enum(['PROCESSING', 'EXISTS', 'FAILED']);
export type CatalogStatus = z.infer<typeof CatalogStatusSchema>;

export interface CatalogMetadataRecord {
  catalogId: string;
  sk: 'METADATA';
  status: CatalogStatus;
  institution?: string;
  academicYear?: string;
  catalogTitle?: string;
  courseCount?: number;
  jobId: string;
  errorMessage?: string;
  updatedAt: string;
}
