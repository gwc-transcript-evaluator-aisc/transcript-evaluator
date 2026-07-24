import { GetCommand, QueryCommand, TransactWriteCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ArticulationResultSchema, StudentDirectorySummarySchema, type ArticulationResult, type StudentDirectorySummary } from '../domain/articulation-result.js';
import type { ResultLocator } from '../domain/orchestration-run.js';

const DIRECTORY_PK = 'STUDENT_DIRECTORY';
const BY_STUDENT_INDEX = 'byStudent';

type PageRequest = { cursor?: string; limit: number };
type Page<T> = { items: T[]; cursor?: string };
type DynamoKey = Record<string, unknown>;

export function resultLocatorFor(result: ArticulationResult): ResultLocator {
  return {
    resultKey: `RESULT#${result.transcriptId}#${result.degreeProgramId}`,
    resultSortKey: `${result.createdAt}#${result.resultId}`,
  };
}

/** Transactional immutable-result persistence and query access for the student directory. */
export class ResultsStore {
  public constructor(
    private readonly client: Pick<DynamoDBDocumentClient, 'send'>,
    private readonly tableName: string,
    private readonly runsTableName: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async persistAndComplete(result: ArticulationResult): Promise<ResultLocator> {
    const locator = resultLocatorFor(result);
    const directory = await this.getDirectory(result.student.studentKey);
    const directoryIsNewest = !directory || directory.latestResultAt <= result.createdAt;
    const timestamp = this.now().toISOString();
    const directoryValues = {
      ':studentKey': result.student.studentKey,
      ':displayName': result.student.displayName,
      ':createdAt': result.createdAt,
      ':resultId': result.resultId,
      ':one': 1,
      ...(result.student.externalStudentId ? { ':externalStudentId': result.student.externalStudentId } : {}),
    };
    const latestDirectoryUpdate = result.student.externalStudentId
      ? 'SET studentKey = :studentKey, displayName = :displayName, externalStudentId = :externalStudentId, latestResultAt = :createdAt, latestResultId = :resultId ADD resultCount :one'
      : 'SET studentKey = :studentKey, displayName = :displayName, latestResultAt = :createdAt, latestResultId = :resultId REMOVE externalStudentId ADD resultCount :one';

    await this.client.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: this.tableName,
            Item: {
              pk: locator.resultKey,
              sk: locator.resultSortKey,
              studentKey: result.student.studentKey,
              studentResultKey: locator.resultSortKey,
              ...result,
            },
            ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
          },
        },
        directoryIsNewest
          ? {
              Update: {
                TableName: this.tableName,
                Key: { pk: DIRECTORY_PK, sk: result.student.studentKey },
                UpdateExpression: latestDirectoryUpdate,
                ConditionExpression: 'attribute_not_exists(latestResultAt) OR latestResultAt <= :createdAt',
                ExpressionAttributeValues: directoryValues,
              },
            }
          : {
              Update: {
                TableName: this.tableName,
                Key: { pk: DIRECTORY_PK, sk: result.student.studentKey },
                UpdateExpression: 'ADD resultCount :one',
                ConditionExpression: 'latestResultAt > :createdAt',
                ExpressionAttributeValues: directoryValues,
              },
            },
        {
          Update: {
            TableName: this.runsTableName,
            Key: { runId: result.runId },
            UpdateExpression: 'SET #status = :completed, #updatedAt = :updatedAt, resultLocator = :locator',
            ConditionExpression: '#status = :evaluating',
            ExpressionAttributeNames: { '#status': 'status', '#updatedAt': 'updatedAt' },
            ExpressionAttributeValues: { ':completed': 'completed', ':evaluating': 'evaluating', ':updatedAt': timestamp, ':locator': locator },
          },
        },
      ],
    }));
    return locator;
  }

  public async getDirectory(studentKey: string): Promise<StudentDirectorySummary | undefined> {
    const response = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: DIRECTORY_PK, sk: studentKey },
      ConsistentRead: true,
    })) as { Item?: Record<string, unknown> };
    return response.Item ? directoryFromItem(response.Item) : undefined;
  }

  public async listDirectories(page: PageRequest): Promise<Page<StudentDirectorySummary>> {
    const cursor = decodeCursor(page.cursor, (key) => key.pk === DIRECTORY_PK && typeof key.sk === 'string');
    const response = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': DIRECTORY_PK },
      Limit: page.limit,
      ExclusiveStartKey: cursor,
      ScanIndexForward: true,
    })) as { Items?: Record<string, unknown>[]; LastEvaluatedKey?: DynamoKey };
    return pageFrom(response, directoryFromItem);
  }

  public async listStudentResults(studentKey: string, page: PageRequest): Promise<Page<ArticulationResult>> {
    const cursor = decodeCursor(page.cursor, (key) => key.studentKey === studentKey && typeof key.studentResultKey === 'string');
    const response = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      IndexName: BY_STUDENT_INDEX,
      KeyConditionExpression: 'studentKey = :studentKey',
      ExpressionAttributeValues: { ':studentKey': studentKey },
      Limit: page.limit,
      ExclusiveStartKey: cursor,
      ScanIndexForward: false,
    })) as { Items?: Record<string, unknown>[]; LastEvaluatedKey?: DynamoKey };
    return pageFrom(response, resultFromItem);
  }

  public async getLatest(transcriptId: number, degreeProgramId: string): Promise<ArticulationResult | undefined> {
    const response = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': `RESULT#${transcriptId}#${degreeProgramId}` },
      Limit: 1,
      ScanIndexForward: false,
    })) as { Items?: Record<string, unknown>[] };
    return response.Items?.[0] ? resultFromItem(response.Items[0]) : undefined;
  }

  public async getByLocator(locator: ResultLocator): Promise<ArticulationResult | undefined> {
    const response = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: locator.resultKey, sk: locator.resultSortKey },
      ConsistentRead: true,
    })) as { Item?: Record<string, unknown> };
    return response.Item ? resultFromItem(response.Item) : undefined;
  }
}

function pageFrom<T>(response: { Items?: Record<string, unknown>[]; LastEvaluatedKey?: DynamoKey }, parse: (item: Record<string, unknown>) => T): Page<T> {
  return {
    items: (response.Items ?? []).map(parse),
    ...(response.LastEvaluatedKey ? { cursor: encodeCursor(response.LastEvaluatedKey) } : {}),
  };
}

function directoryFromItem(item: Record<string, unknown>): StudentDirectorySummary {
  return StudentDirectorySummarySchema.parse({
    studentKey: item.studentKey,
    displayName: item.displayName,
    externalStudentId: item.externalStudentId,
    latestResultAt: item.latestResultAt,
    latestResultId: item.latestResultId,
    resultCount: item.resultCount,
  });
}

function resultFromItem(item: Record<string, unknown>): ArticulationResult {
  const { pk: _pk, sk: _sk, studentKey: _studentKey, studentResultKey: _studentResultKey, ...result } = item;
  return ArticulationResultSchema.parse(result);
}

function encodeCursor(key: DynamoKey): string {
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

function decodeCursor(cursor: string | undefined, valid: (key: DynamoKey) => boolean): DynamoKey | undefined {
  if (!cursor) return undefined;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded) || !valid(decoded as DynamoKey)) throw new Error('Invalid cursor');
    return decoded as DynamoKey;
  } catch {
    throw new Error('Invalid continuation cursor');
  }
}
