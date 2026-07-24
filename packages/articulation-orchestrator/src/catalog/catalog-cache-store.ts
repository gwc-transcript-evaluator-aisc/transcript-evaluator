import { DeleteCommand, GetCommand, PutCommand, QueryCommand, ScanCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { makeCatalogKey, normalizeInstitution } from './course-key.js';

const DIRECTORY_PK = 'CACHE#CATALOG_DIRECTORY';
const ACTIVE_SK = 'ACTIVE';
const LOCK_SK = 'REFRESH_LOCK';
const INSTITUTION_PREFIX = 'INSTITUTION#';
const LOCK_SECONDS = 120;

export interface CatalogMetadataSourceRecord {
  catalogId: string;
  sk: 'METADATA';
  status: 'EXISTS' | 'PROCESSING' | 'FAILED';
  institution?: string;
  academicYear?: string;
}

export interface CatalogDirectoryRecord {
  pk: string;
  sk: string;
  snapshotId: string;
  institution: string;
  normalizedInstitution: string;
  academicYears: string[];
  catalogKeys: string[];
  updatedAt: string;
}

interface ActiveSnapshotRecord {
  pk: typeof DIRECTORY_PK;
  sk: typeof ACTIVE_SK;
  snapshotId: string;
  updatedAt: string;
}

export interface CatalogDirectory {
  snapshotId: string;
  institutions: CatalogDirectoryRecord[];
}

export interface CatalogCacheStoreOptions {
  cacheClient: Pick<DynamoDBDocumentClient, 'send'>;
  catalogClient: Pick<DynamoDBDocumentClient, 'send'>;
  cacheTableName: string;
  catalogTableName: string;
  now?: () => Date;
  snapshotId?: () => string;
}

/** Bounded per-institution snapshots of Catalog metadata. Course content remains in Catalog. */
export class CatalogCacheStore {
  private readonly now: () => Date;
  private readonly snapshotId: () => string;

  public constructor(private readonly options: CatalogCacheStoreOptions) {
    this.now = options.now ?? (() => new Date());
    this.snapshotId = options.snapshotId ?? (() => crypto.randomUUID());
  }

  public async getActiveDirectory(): Promise<CatalogDirectory | undefined> {
    const active = await this.options.cacheClient.send(new GetCommand({
      TableName: this.options.cacheTableName,
      Key: { pk: DIRECTORY_PK, sk: ACTIVE_SK },
      ConsistentRead: true,
    })) as { Item?: ActiveSnapshotRecord };
    if (!active.Item?.snapshotId) return undefined;

    const institutions: CatalogDirectoryRecord[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const response = await this.options.cacheClient.send(new QueryCommand({
        TableName: this.options.cacheTableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `${DIRECTORY_PK}#${active.Item.snapshotId}`,
          ':prefix': INSTITUTION_PREFIX,
        },
        ExclusiveStartKey: startKey,
      })) as { Items?: CatalogDirectoryRecord[]; LastEvaluatedKey?: Record<string, unknown> };
      institutions.push(...(response.Items ?? []));
      startKey = response.LastEvaluatedKey;
    } while (startKey);
    return { snapshotId: active.Item.snapshotId, institutions };
  }

  /** Refreshes all directory records before making the new snapshot visible. */
  public async refresh(): Promise<CatalogDirectory> {
    const metadata = await this.listExistingCatalogs();
    const snapshotId = this.snapshotId();
    const updatedAt = this.now().toISOString();
    const grouped = new Map<string, { institution: string; years: Set<string>; catalogKeys: Set<string> }>();
    for (const item of metadata) {
      if (!item.institution || !item.academicYear) continue;
      const normalizedInstitution = normalizeInstitution(item.institution);
      if (!normalizedInstitution) continue;
      const group = grouped.get(normalizedInstitution) ?? { institution: item.institution.trim(), years: new Set<string>(), catalogKeys: new Set<string>() };
      group.years.add(item.academicYear.trim());
      group.catalogKeys.add(item.catalogId || makeCatalogKey(item.institution, item.academicYear));
      grouped.set(normalizedInstitution, group);
    }
    const institutions = [...grouped.entries()].map(([normalizedInstitution, group]) => ({
      pk: `${DIRECTORY_PK}#${snapshotId}`,
      sk: `${INSTITUTION_PREFIX}${normalizedInstitution}`,
      snapshotId,
      institution: group.institution,
      normalizedInstitution,
      academicYears: [...group.years].sort(),
      catalogKeys: [...group.catalogKeys].sort(),
      updatedAt,
    } satisfies CatalogDirectoryRecord));

    for (const record of institutions) {
      await this.options.cacheClient.send(new PutCommand({ TableName: this.options.cacheTableName, Item: record }));
    }
    await this.options.cacheClient.send(new PutCommand({
      TableName: this.options.cacheTableName,
      Item: { pk: DIRECTORY_PK, sk: ACTIVE_SK, snapshotId, updatedAt } satisfies ActiveSnapshotRecord,
    }));
    return { snapshotId, institutions };
  }

  /** Bootstrap only when no active snapshot exists; a conditional lock prevents stampedes. */
  public async getOrRefresh(): Promise<CatalogDirectory> {
    const active = await this.getActiveDirectory();
    if (active) return active;
    const expiresAt = Math.floor(this.now().getTime() / 1000) + LOCK_SECONDS;
    try {
      await this.options.cacheClient.send(new PutCommand({
        TableName: this.options.cacheTableName,
        Item: { pk: DIRECTORY_PK, sk: LOCK_SK, expiresAt },
        ConditionExpression: 'attribute_not_exists(pk) OR expiresAt < :now',
        ExpressionAttributeValues: { ':now': Math.floor(this.now().getTime() / 1000) },
      }));
    } catch (error) {
      const refreshed = await this.getActiveDirectory();
      if (refreshed) return refreshed;
      throw new Error('Catalog directory refresh is already in progress');
    }
    try {
      return await this.refresh();
    } finally {
      await this.options.cacheClient.send(new DeleteCommand({ TableName: this.options.cacheTableName, Key: { pk: DIRECTORY_PK, sk: LOCK_SK } }));
    }
  }

  private async listExistingCatalogs(): Promise<CatalogMetadataSourceRecord[]> {
    const items: CatalogMetadataSourceRecord[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const response = await this.options.catalogClient.send(new ScanCommand({
        TableName: this.options.catalogTableName,
        FilterExpression: 'sk = :metadata AND #status = :exists',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':metadata': 'METADATA', ':exists': 'EXISTS' },
        ExclusiveStartKey: startKey,
      })) as { Items?: CatalogMetadataSourceRecord[]; LastEvaluatedKey?: Record<string, unknown> };
      items.push(...(response.Items ?? []));
      startKey = response.LastEvaluatedKey;
    } while (startKey);
    return items;
  }
}
