import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { makeCatalogId } from '../domain/course.js';
import { getCourse } from '../jobs/catalog-store.js';
import { json } from './http.js';

/** Access pattern 2: exact course details for a specific school + academic year + course code.
 *
 * GET /catalogs/{institution}/{academicYear}/courses/{courseCode}
 *
 * A single GetItem on the catalog table's COURSE#<code> item -- no scan, no filtering. */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const institution = event.pathParameters?.institution;
  const academicYear = event.pathParameters?.academicYear;
  const courseCode = event.pathParameters?.courseCode;
  if (!institution || !academicYear || !courseCode) {
    return json(400, { error: 'institution, academicYear, and courseCode are required' });
  }

  const catalogId = makeCatalogId(institution, academicYear);
  const course = await getCourse(catalogId, decodeURIComponent(courseCode));
  if (!course) return json(404, { error: 'Course not found', catalogId, courseCode });

  return json(200, { catalogId, course });
};
