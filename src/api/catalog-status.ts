import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { makeCatalogId } from '../domain/course.js';
import { getCatalogMetadata } from '../jobs/catalog-store.js';
import { json } from './http.js';

/** Access pattern 1: does a catalog exist for this school + academic year?
 *
 * GET /catalogs/{institution}/{academicYear}
 *
 * A single GetItem on the catalog table's METADATA item. Returns 404 if no extraction
 * has ever been triggered for this school+year (caller should then create+upload+complete
 * a job to trigger parsing); 200 with status PROCESSING/EXISTS/FAILED otherwise. */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const institution = event.pathParameters?.institution;
  const academicYear = event.pathParameters?.academicYear;
  if (!institution || !academicYear) return json(400, { error: 'institution and academicYear are required' });

  const catalogId = makeCatalogId(institution, academicYear);
  const metadata = await getCatalogMetadata(catalogId);
  if (!metadata) return json(404, { error: 'Catalog has not been requested yet', catalogId });

  return json(200, {
    catalogId,
    status: metadata.status,
    institution: metadata.institution,
    academicYear: metadata.academicYear,
    catalogTitle: metadata.catalogTitle,
    courseCount: metadata.courseCount,
    jobId: metadata.jobId,
    errorMessage: metadata.errorMessage,
    updatedAt: metadata.updatedAt,
  });
};
