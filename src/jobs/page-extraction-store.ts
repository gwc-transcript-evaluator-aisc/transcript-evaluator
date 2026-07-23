import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { dynamo } from '../aws/clients.js';
import type { Course } from '../domain/course.js';

const doc = DynamoDBDocumentClient.from(dynamo);
const pageExtractionsTableName = () => process.env.PAGE_EXTRACTIONS_TABLE_NAME ?? '';
const PAGE_EXTRACTION_TTL_SECONDS = 60 * 60 * 24; // interim data only; expires a day after extraction

export interface PageExtraction {
  pageNumber: number;
  institution?: string;
  catalogTitle?: string;
  catalogAcademicYear?: string;
  courses: Course[];
}

/** Interim storage for a single page's extracted catalog metadata + courses, keyed by
 * jobId + pageNumber. Kept separate from the final Catalog table because the final
 * catalogId isn't necessarily known until all pages resolve (unless the caller pinned
 * one up front), and partial/interim results shouldn't be visible under a real catalog
 * while a job is still processing. Entries expire automatically via TTL. */
export async function putPageExtraction(jobId: string, pageNumber: number, extraction: Omit<PageExtraction, 'pageNumber'>): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + PAGE_EXTRACTION_TTL_SECONDS;
  await doc.send(new PutCommand({
    TableName: pageExtractionsTableName(),
    Item: { jobId, pageNumber, ...extraction, expiresAt },
  }));
}

export async function listPageExtractions(jobId: string): Promise<PageExtraction[]> {
  const items: PageExtraction[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const response = await doc.send(new QueryCommand({
      TableName: pageExtractionsTableName(),
      KeyConditionExpression: 'jobId = :jobId',
      ExpressionAttributeValues: { ':jobId': jobId },
      ExclusiveStartKey: exclusiveStartKey,
    }));
    items.push(...(response.Items as PageExtraction[] ?? []));
    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}
