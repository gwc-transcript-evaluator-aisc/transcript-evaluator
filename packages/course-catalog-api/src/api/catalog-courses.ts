import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { getCatalogMetadata, listCoursesForCatalog } from '../jobs/catalog-store.js';
import { json } from './http.js';

/** Browse-the-database drill-in view: every course under one catalog. */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const catalogId = event.pathParameters?.catalogId;
  if (!catalogId) return json(400, { error: 'catalogId is required' });
  const catalog = await getCatalogMetadata(decodeURIComponent(catalogId));
  if (!catalog) return json(404, { error: 'Catalog not found' });
  const courses = await listCoursesForCatalog(catalog.catalogId);
  return json(200, { catalog, courses });
};
