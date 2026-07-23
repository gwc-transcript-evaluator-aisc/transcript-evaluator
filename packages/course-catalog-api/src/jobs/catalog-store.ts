import { BatchWriteCommand, type BatchWriteCommandInput, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { dynamo } from '../aws/clients.js';
import { METADATA_SK, makeCourseSk, normalizeCourseCode, type CatalogMetadataRecord, type CatalogStatus, type Course, type CourseRecord } from '../domain/course.js';

const doc = DynamoDBDocumentClient.from(dynamo);
const catalogTableName = () => process.env.CATALOG_TABLE_NAME ?? '';

/** DynamoDB BatchWriteItem accepts at most 25 items per call. */
const BATCH_SIZE = 25;

/** Point-lookup access patterns (existence check + exact course lookup):
 *   1. GetItem(PK=catalogId, SK=METADATA) -- does a catalog exist for school+year?
 *   2. GetItem(PK=catalogId, SK=COURSE#<code>) -- exact course lookup for school+year+code
 * Plus the browse/upload UI's list access patterns (listCatalogs / listCoursesForCatalog
 * below) -- both live in the same single table since courses and their catalog's
 * metadata share a partition key. */

export async function getCatalogMetadata(catalogId: string): Promise<CatalogMetadataRecord | undefined> {
  const response = await doc.send(new GetCommand({ TableName: catalogTableName(), Key: { catalogId, sk: METADATA_SK } }));
  return response.Item as CatalogMetadataRecord | undefined;
}

export async function putCatalogMetadata(input: {
  catalogId: string;
  status: CatalogStatus;
  institution?: string;
  academicYear?: string;
  catalogTitle?: string;
  courseCount?: number;
  jobId: string;
  errorMessage?: string;
}): Promise<void> {
  const record: CatalogMetadataRecord = {
    catalogId: input.catalogId,
    sk: METADATA_SK,
    status: input.status,
    institution: input.institution,
    academicYear: input.academicYear,
    catalogTitle: input.catalogTitle,
    courseCount: input.courseCount,
    jobId: input.jobId,
    errorMessage: input.errorMessage,
    updatedAt: new Date().toISOString(),
  };
  await doc.send(new PutCommand({ TableName: catalogTableName(), Item: record }));
}

export async function getCourse(catalogId: string, courseCode: string): Promise<CourseRecord | undefined> {
  const response = await doc.send(new GetCommand({ TableName: catalogTableName(), Key: { catalogId, sk: makeCourseSk(courseCode) } }));
  return response.Item as CourseRecord | undefined;
}

/** Lists every catalog's METADATA item, for the "browse the database" UI. This is a
 * table scan filtered to sk=METADATA -- fine at prototype scale, but note this is a
 * scan (cost grows with total table size) rather than a point lookup like the two
 * access patterns above. If the catalog count grows large, a GSI projecting just
 * METADATA items would avoid scanning past course items. */
export async function listCatalogs(): Promise<CatalogMetadataRecord[]> {
  const items: CatalogMetadataRecord[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const response = await doc.send(new ScanCommand({
      TableName: catalogTableName(),
      FilterExpression: 'sk = :metadata',
      ExpressionAttributeValues: { ':metadata': METADATA_SK },
      ExclusiveStartKey: exclusiveStartKey,
    }));
    items.push(...(response.Items as CatalogMetadataRecord[] ?? []));
    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}

/** Lists every course under a catalog, for the "browse the database" UI. A Query on the
 * catalog's partition key filtered to SK begins_with COURSE# -- cheap, since it only
 * reads that one catalog's items, not the whole table. */
export async function listCoursesForCatalog(catalogId: string): Promise<CourseRecord[]> {
  const items: CourseRecord[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const response = await doc.send(new QueryCommand({
      TableName: catalogTableName(),
      KeyConditionExpression: 'catalogId = :catalogId AND begins_with(sk, :coursePrefix)',
      ExpressionAttributeValues: { ':catalogId': catalogId, ':coursePrefix': 'COURSE#' },
      ExclusiveStartKey: exclusiveStartKey,
    }));
    items.push(...(response.Items as CourseRecord[] ?? []));
    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}

export async function putCourses(catalogId: string, courses: Course[]): Promise<void> {
  if (courses.length === 0) return;
  const now = new Date().toISOString();
  const records: CourseRecord[] = courses.map((course, index) => {
    const courseCode = course.courseCode ?? `UNCODED-${index + 1}`;
    return { ...course, catalogId, sk: makeCourseSk(courseCode), courseCode: normalizeCourseCode(courseCode), updatedAt: now };
  });
  for (let start = 0; start < records.length; start += BATCH_SIZE) {
    const batch = records.slice(start, start + BATCH_SIZE);
    let pending: NonNullable<BatchWriteCommandInput['RequestItems']> | undefined = {
      [catalogTableName()]: batch.map((item) => ({ PutRequest: { Item: item } })),
    };
    // DynamoDB can return UnprocessedItems under throttling; retry those rather than
    // silently dropping course records.
    for (let attempt = 0; attempt < 5 && pending && Object.keys(pending).length > 0; attempt += 1) {
      const toSend: NonNullable<BatchWriteCommandInput['RequestItems']> = pending;
      const response: { UnprocessedItems?: BatchWriteCommandInput['RequestItems'] } = await doc.send(new BatchWriteCommand({ RequestItems: toSend }));
      pending = response.UnprocessedItems;
    }
  }
}
