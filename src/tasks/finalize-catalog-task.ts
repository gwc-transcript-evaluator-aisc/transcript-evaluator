import { GetObjectCommand } from '@aws-sdk/client-s3';
import { s3 } from '../aws/clients.js';
import { makeCatalogId, type Course } from '../domain/course.js';
import { putCatalogMetadata, putCourses } from '../jobs/catalog-store.js';
import { updateJob } from '../jobs/store.js';

export interface PageResult {
  jobId: string;
  pageNumber: number;
  institution?: string;
  catalogTitle?: string;
  catalogAcademicYear?: string;
  courses: Course[];
}

/** A page that failed its InvokePage state (BDA error, or the task token was never
 * resolved) has no `courses` field -- see the state machine's Catch config in the CDK
 * stack, which substitutes `{ failed: true }` for a failed iteration's result rather
 * than aborting the whole Map. */
type PageOutcome = PageResult | { failed: true };

export interface FinalizeCatalogInput {
  jobId: string;
  catalogId?: string;
  pageResults: {
    ResultWriterDetails: {
      Bucket: string;
      Key: string;
    };
  } | PageOutcome[]; // Support both DistributedMap (S3 ref) and inline Map (direct array)
}

function isSuccessfulPage(outcome: PageOutcome): outcome is PageResult {
  return 'courses' in outcome;
}

/** Drops courses with no usable content and deduplicates the rest by course code.
 *
 * BDA occasionally emits a course-shaped object with every field blank after
 * normalization -- typically a header line split across a page boundary, or a
 * low-confidence non-course line the model tried to fit into the schema anyway. Without
 * a course code or title there's nothing to identify the course by, so these are dropped
 * rather than stored as empty placeholder rows.
 *
 * Also requires a description. Catalogs commonly include a "Courses by Quarter" program
 * schedule table -- a plain list of course code/title/credits with no description --
 * which is course-shaped enough for BDA to extract as if it were a real catalog entry,
 * but it's just a program's suggested sequence, not the actual course listing. The real
 * course entry for that same code appears elsewhere in the catalog with a full
 * description; requiring one here filters out the schedule-table duplicates without
 * losing the genuine entries.
 *
 * Exported for testing. */
export function mergeCourses(courses: Course[]): Course[] {
  const meaningful = courses.filter((course) => (course.courseCode || course.courseTitle) && course.description);
  const merged = new Map<string, Course>();
  for (const course of meaningful) {
    const key = course.courseCode ?? `uncoded-${merged.size}`;
    const existing = merged.get(key);
    if (!existing) { merged.set(key, course); continue; }
    const sourcePages = [...new Set([...(existing.sourcePages ?? []), ...(course.sourcePages ?? [])])];
    merged.set(key, { ...existing, ...course, sourcePages });
  }
  return [...merged.values()];
}

/** Step Functions task: the final state after every page's InvokePage has resolved
 * (successfully or not). Merges every page's extracted courses into the final catalog
 * and writes the METADATA + course items into the Catalog table. If the caller pinned a
 * catalogId up front (create-job.ts), that key is used regardless of what BDA extracted;
 * otherwise the catalogId is derived from whatever institution/academic year the pages
 * actually returned. */
export const handler = async (input: FinalizeCatalogInput): Promise<{ jobId: string; status: 'SUCCEEDED' | 'FAILED'; catalogId?: string; courseCount: number }> => {
  const { jobId, catalogId: pinnedCatalogId, pageResults } = input;
  
  // If pageResults has ResultWriterDetails, it's from DistributedMap - read from S3
  let outcomes: PageOutcome[];
  if ('ResultWriterDetails' in pageResults) {
    const { Bucket, Key } = pageResults.ResultWriterDetails;
    const response = await s3.send(new GetObjectCommand({ Bucket, Key }));
    if (!response.Body) throw new Error('Empty S3 result manifest');
    const manifestText = await response.Body.transformToString();
    const manifest = JSON.parse(manifestText);
    
    // Manifest is a JSON Lines file where each line has: {"Input": {...}, "Output": <PageResult>, "ResultWriterDetails": {...}}
    outcomes = manifestText.trim().split('\n').map((line) => {
      const entry = JSON.parse(line);
      return entry.Output ?? { failed: true };
    });
  } else {
    // Inline array from regular Map state
    outcomes = pageResults;
  }
  
  const succeeded = outcomes.filter(isSuccessfulPage);
  const anyFailed = succeeded.length < outcomes.length;

  const institution = succeeded.find((page) => page.institution)?.institution;
  const academicYear = succeeded.find((page) => page.catalogAcademicYear)?.catalogAcademicYear;
  const catalogTitle = succeeded.find((page) => page.catalogTitle)?.catalogTitle;
  const catalogId = pinnedCatalogId ?? makeCatalogId(institution, academicYear);

  const allCourses = succeeded.flatMap((page) => page.courses);
  const finalCourses = mergeCourses(allCourses);

  if (finalCourses.length === 0) {
    await putCatalogMetadata({ catalogId, status: 'FAILED', institution, academicYear, catalogTitle, jobId, errorMessage: 'No courses could be extracted from this document' });
    await updateJob(jobId, 'FAILED', { catalogId, errorMessage: 'No courses could be extracted from this document' });
    return { jobId, status: 'FAILED', catalogId, courseCount: 0 };
  }

  await putCourses(catalogId, finalCourses);
  await putCatalogMetadata({ catalogId, status: 'EXISTS', institution, academicYear, catalogTitle, courseCount: finalCourses.length, jobId });
  await updateJob(jobId, 'SUCCEEDED', {
    catalogId,
    courseCount: finalCourses.length,
    errorMessage: anyFailed ? 'Some pages could not be processed; results may be incomplete' : undefined,
  });
  return { jobId, status: 'SUCCEEDED', catalogId, courseCount: finalCourses.length };
};
