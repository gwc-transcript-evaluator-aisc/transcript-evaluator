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

/** Shape of a single record inside one of the manifest's referenced result files
 * (e.g. SUCCEEDED_0.json / FAILED_0.json). This is the DistributedMap's default `NONE`
 * transformation: workflow metadata plus the child execution's actual output/error as a
 * JSON-encoded string, not a nested object -- see ResultWriter (Map) in the Step
 * Functions docs. */
interface MapRunResultRecord {
  Output?: string;
  Error?: string;
  Cause?: string;
}

/** Reads and parses one of the manifest's SUCCEEDED/FAILED/PENDING result files. Each is
 * a plain JSON array (not JSON Lines) of MapRunResultRecord. */
async function readResultFile(bucket: string, key: string): Promise<MapRunResultRecord[]> {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) return [];
  const text = await response.Body.transformToString();
  return JSON.parse(text) as MapRunResultRecord[];
}

/** Reads a Distributed Map's exported result set given its manifest.json location.
 *
 * manifest.json itself is a JSON object -- not JSON Lines -- of the form
 * `{ DestinationBucket, ResultFiles: { SUCCEEDED: [{Key, Size}], FAILED: [...], PENDING: [...] } }`.
 * The actual per-page results live in the files it references, each a JSON array whose
 * entries carry the child execution's output as a JSON-encoded *string* in `Output`
 * (successes) rather than the result object itself, so that string needs a second parse.
 * Failed/pending entries have no usable `Output` and become `{ failed: true }`. */
async function readManifest(bucket: string, key: string): Promise<PageOutcome[]> {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) throw new Error('Empty S3 result manifest');
  const manifestText = await response.Body.transformToString();
  const manifest = JSON.parse(manifestText) as {
    DestinationBucket?: string;
    ResultFiles?: { SUCCEEDED?: { Key: string }[]; FAILED?: { Key: string }[]; PENDING?: { Key: string }[] };
  };
  const destinationBucket = manifest.DestinationBucket ?? bucket;
  const resultFiles = manifest.ResultFiles ?? {};

  const succeededFiles = resultFiles.SUCCEEDED ?? [];
  const failedFiles = [...(resultFiles.FAILED ?? []), ...(resultFiles.PENDING ?? [])];

  const succeededRecords = (await Promise.all(succeededFiles.map((file) => readResultFile(destinationBucket, file.Key)))).flat();
  const failedRecords = (await Promise.all(failedFiles.map((file) => readResultFile(destinationBucket, file.Key)))).flat();

  const succeededOutcomes: PageOutcome[] = succeededRecords.map((record) => {
    if (!record.Output) return { failed: true };
    try {
      return JSON.parse(record.Output) as PageResult;
    } catch {
      return { failed: true };
    }
  });
  const failedOutcomes: PageOutcome[] = failedRecords.map(() => ({ failed: true }));

  return [...succeededOutcomes, ...failedOutcomes];
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
  const outcomes: PageOutcome[] = 'ResultWriterDetails' in pageResults
    ? await readManifest(pageResults.ResultWriterDetails.Bucket, pageResults.ResultWriterDetails.Key)
    : pageResults; // Inline array from regular Map state
  
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
