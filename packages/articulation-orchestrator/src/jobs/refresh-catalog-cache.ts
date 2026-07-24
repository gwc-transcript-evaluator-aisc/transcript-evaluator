import { dynamo } from '../aws/clients.js';
import { CatalogCacheStore } from '../catalog/catalog-cache-store.js';

/** EventBridge target: publishes a fully-written Catalog directory snapshot every 15 minutes. */
export async function handler(): Promise<void> {
  const cacheTableName = process.env.CATALOG_CACHE_TABLE_NAME;
  const catalogTableName = process.env.CATALOG_TABLE_NAME;
  if (!cacheTableName || !catalogTableName) throw new Error('Catalog cache table configuration is required');
  await new CatalogCacheStore({
    cacheClient: dynamo,
    catalogClient: dynamo,
    cacheTableName,
    catalogTableName,
  }).refresh();
}
