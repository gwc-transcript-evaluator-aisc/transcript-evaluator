import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { GetDataAutomationStatusCommand } from '@aws-sdk/client-bedrock-data-automation-runtime';
import { bda } from '../aws/clients.js';
import { makeCatalogId, type Course, type JobPage } from '../domain/course.js';
import { extractPageCourses } from '../domain/normalize.js';
import { putCatalogMetadata, putCourses } from '../jobs/catalog-store.js';
import { listPageExtractions, putPageExtraction } from '../jobs/page-extraction-store.js';
import { json, pathJobId } from './http.js';
import { getJob, updateJob } from '../jobs/store.js';

/** Polls every still-PROCESSING per-page BDA invocation for a job. On success, extracts
 * that page's catalog metadata + courses and stashes them in the interim PageExtractions
 * table (the final catalogId may not be known until all pages are in, unless the caller
 * pinned one up front -- see create-job.ts). */
async function pollPages(jobId: string, pages: JobPage[]): Promise<JobPage[]> {
  return Promise.all(pages.map(async (page) => {
    if (page.status !== 'PROCESSING') return page;
    const result = await bda.send(new GetDataAutomationStatusCommand({ invocationArn: page.invocationArn }));
    const state = String(result.status ?? '').toUpperCase();
    if (state === 'SUCCESS') {
      const catalog = await extractPageCourses(result.outputConfiguration?.s3Uri);
      const courses = catalog.courses.map((course) => ({ ...course, sourcePages: [page.pageNumber] }));
      await putPageExtraction(jobId, page.pageNumber, {
        institution: catalog.institution,
        catalogTitle: catalog.catalogTitle,
        catalogAcademicYear: catalog.catalogAcademicYear,
        courses,
      });
      return { ...page, status: 'SUCCEEDED' as const };
    }
    if (state === 'SERVICEERROR' || state === 'CLIENTERROR') {
      return { ...page, status: 'FAILED' as const, errorMessage: result.errorMessage ?? 'BDA processing failed' };
    }
    return page;
  }));
}

/** Drops courses with no usable content and deduplicates the rest by course code.
 *
 * BDA occasionally emits a course-shaped object with every field blank after
 * normalization -- typically a header line split across a page boundary, or a
 * low-confidence non-course line the model tried to fit into the schema anyway. Without
 * a course code or title there's nothing to identify the course by, so these are dropped
 * rather than stored as empty placeholder rows.
 *
 * Exported for testing. */
export function mergeCourses(courses: Course[]): Course[] {
  const meaningful = courses.filter((course) => course.courseCode || course.courseTitle);
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

/** Once every page has resolved, merges each page's interim extraction into the final
 * catalog and writes it into the single Catalog table (METADATA item + one item per
 * course). If the caller pinned a catalogId up front (create-job.ts), that key is used
 * regardless of what BDA extracted, so results land where the caller asked for them;
 * otherwise the catalogId is derived from the extracted institution/academic year. */
async function finalizeCatalog(jobId: string, pinnedCatalogId: string | undefined): Promise<{ catalogId?: string; courseCount: number }> {
  const pageExtractions = await listPageExtractions(jobId);
  const allCourses = pageExtractions.flatMap((page) => page.courses);

  const institution = pageExtractions.find((page) => page.institution)?.institution;
  const academicYear = pageExtractions.find((page) => page.catalogAcademicYear)?.catalogAcademicYear;
  const catalogTitle = pageExtractions.find((page) => page.catalogTitle)?.catalogTitle;
  const catalogId = pinnedCatalogId ?? makeCatalogId(institution, academicYear);

  const finalCourses = mergeCourses(allCourses);
  if (finalCourses.length === 0) {
    await putCatalogMetadata({ catalogId, status: 'FAILED', institution, academicYear, catalogTitle, jobId, errorMessage: 'No courses could be extracted from this document' });
    return { catalogId, courseCount: 0 };
  }

  await putCourses(catalogId, finalCourses);
  await putCatalogMetadata({ catalogId, status: 'EXISTS', institution, academicYear, catalogTitle, courseCount: finalCourses.length, jobId });
  return { catalogId, courseCount: finalCourses.length };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const jobId = pathJobId(event);
  if (!jobId) return json(400, { error: 'jobId is required' });
  const job = await getJob(jobId);
  if (!job) return json(404, { error: 'Job not found' });

  if (job.status === 'PROCESSING' && job.pages && job.pages.length > 0) {
    const pages = await pollPages(jobId, job.pages);
    const allTerminal = pages.every((page) => page.status !== 'PROCESSING');
    if (!allTerminal) {
      await updateJob(jobId, 'PROCESSING', { pages });
      return json(200, {
        jobId,
        status: 'PROCESSING',
        catalogId: job.catalogId,
        totalPages: job.totalPages,
        pagesCompleted: pages.filter((page) => page.status !== 'PROCESSING').length,
      });
    }

    const anySucceeded = pages.some((page) => page.status === 'SUCCEEDED');
    if (!anySucceeded) {
      await updateJob(jobId, 'FAILED', { pages, errorMessage: 'All pages failed to process' });
      if (job.catalogId) await putCatalogMetadata({ catalogId: job.catalogId, status: 'FAILED', jobId, errorMessage: 'All pages failed to process' });
      return json(200, { jobId, status: 'FAILED', catalogId: job.catalogId, errorMessage: 'All pages failed to process' });
    }

    const anyFailed = pages.some((page) => page.status === 'FAILED');
    const { catalogId, courseCount } = await finalizeCatalog(jobId, job.catalogId);
    await updateJob(jobId, 'SUCCEEDED', {
      pages,
      catalogId,
      courseCount,
      errorMessage: anyFailed ? 'Some pages could not be processed; results may be incomplete' : undefined,
    });
    return json(200, { jobId, status: 'SUCCEEDED', catalogId, courseCount });
  }

  return json(200, {
    jobId,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    catalogId: job.catalogId,
    courseCount: job.courseCount,
    errorMessage: job.errorMessage,
  });
};
