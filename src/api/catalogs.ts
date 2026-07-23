import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { listCatalogs } from '../jobs/catalog-store.js';
import { json } from './http.js';

/** Browse-the-database list view: every catalog that has ever been requested. */
export const handler: APIGatewayProxyHandlerV2 = async () => {
  const catalogs = await listCatalogs();
  return json(200, { catalogs });
};
