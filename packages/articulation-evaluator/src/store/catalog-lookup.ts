import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { dynamo } from '../aws/clients.js';
import { config } from '../config.js';
import { makeCatalogId, makeCourseSk } from '../domain/course-key.js';
import { CourseRecordSchema, type CourseRecord } from '../domain/course-record.js';
import type { CourseIdentifier } from '../domain/evaluation.js';

const doc = DynamoDBDocumentClient.from(dynamo);

/** Read-only point lookup against course-catalog-api's Catalog table -- this package
 * never writes to that table, only reads the course record needed to run an evaluation.
 * Mirrors the GetItem(PK=catalogId, SK=COURSE#<code>) access pattern documented in
 * course-catalog-api's DYNAMODB.md. */
export async function lookupCourse(identifier: CourseIdentifier): Promise<CourseRecord | undefined> {
  const catalogId = makeCatalogId(identifier.institution, identifier.academicYear);
  const sk = makeCourseSk(identifier.courseCode);
  const response = await doc.send(new GetCommand({ TableName: config.catalogTable, Key: { catalogId, sk } }));
  if (!response.Item) return undefined;
  return CourseRecordSchema.parse(response.Item);
}
