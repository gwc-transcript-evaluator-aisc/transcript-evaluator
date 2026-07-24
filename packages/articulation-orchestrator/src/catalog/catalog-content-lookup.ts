import { GetCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { CatalogContent } from '../domain/work-record.js';
import type { CourseIdentifier } from '../domain/catalog-resolution.js';
import { makeCatalogKey, makeCourseKey } from './course-key.js';

export interface CatalogCourseContent extends CatalogContent {
  courseCode: string;
}

/** Fetches complete, canonicalized Catalog content only after an identifier resolves. */
export class CatalogContentLookup {
  public constructor(private readonly client: Pick<DynamoDBDocumentClient, 'send'>, private readonly tableName: string) {}

  public async get(identifier: CourseIdentifier): Promise<CatalogCourseContent | undefined> {
    const response = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: { catalogId: makeCatalogKey(identifier.institution, identifier.academicYear), sk: makeCourseKey(identifier.courseCode) },
      ConsistentRead: true,
    })) as { Item?: Record<string, unknown> };
    const item = response.Item;
    if (!item || typeof item.courseCode !== 'string') return undefined;
    return compact({
      courseCode: item.courseCode,
      department: stringValue(item.department),
      title: stringValue(item.courseTitle),
      description: stringValue(item.description),
      credits: typeof item.credits === 'number' && Number.isFinite(item.credits) ? item.credits : undefined,
      learningOutcomes: strings(item.learningOutcomes),
      topics: strings(item.topics),
      competencies: strings(item.competencies),
    });
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.trim()) ? value.map((entry) => (entry as string).trim()) : undefined;
}
function compact(value: CatalogCourseContent): CatalogCourseContent {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as CatalogCourseContent;
}
