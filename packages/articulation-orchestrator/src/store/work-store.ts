import { GetCommand, PutCommand, QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { WorkRecordSchema, workSortKey, type WorkRecord } from '../domain/work-record.js';

const runPartitionKey = (runId: string) => `RUN#${runId}`;

/** Idempotent run-scoped persistence for all expanding orchestration data. */
export class WorkStore {
  public constructor(
    private readonly client: Pick<DynamoDBDocumentClient, 'send'>,
    private readonly tableName: string,
  ) {}

  public async put(record: WorkRecord): Promise<void> {
    const parsed = WorkRecordSchema.parse(record);
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: { pk: runPartitionKey(parsed.runId), sk: sortKeyFor(parsed), ...parsed },
    }));
  }

  /** Writes a deterministic work record once, preserving the first completed outcome on retries. */
  public async putIfAbsent(record: WorkRecord): Promise<boolean> {
    const parsed = WorkRecordSchema.parse(record);
    try {
      await this.client.send(new PutCommand({
        TableName: this.tableName,
        Item: { pk: runPartitionKey(parsed.runId), sk: sortKeyFor(parsed), ...parsed },
        ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
      }));
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return false;
      throw error;
    }
  }

  public async get(runId: string, sortKey: string): Promise<WorkRecord | undefined> {
    const response = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: runPartitionKey(runId), sk: sortKey },
      ConsistentRead: true,
    })) as { Item?: Record<string, unknown> };
    return response.Item ? recordFromItem(response.Item) : undefined;
  }

  public async list(runId: string, prefix?: string): Promise<WorkRecord[]> {
    const records: WorkRecord[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const response = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: prefix ? 'pk = :pk AND begins_with(sk, :prefix)' : 'pk = :pk',
        ExpressionAttributeValues: prefix
          ? { ':pk': runPartitionKey(runId), ':prefix': prefix }
          : { ':pk': runPartitionKey(runId) },
        ExclusiveStartKey: startKey,
      })) as { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> };
      records.push(...(response.Items ?? []).map(recordFromItem));
      startKey = response.LastEvaluatedKey;
    } while (startKey);
    return records;
  }
}

function sortKeyFor(record: WorkRecord): string {
  switch (record.recordType) {
    case 'STUDENT': return workSortKey.student();
    case 'EXCLUDED_TAKEN': return workSortKey.excludedTaken(record.sourceCourseId);
    case 'CANDIDATE': return workSortKey.candidate(record.sourceCourseId);
    case 'REQUIRED': return workSortKey.required(record.requiredCourseId);
    case 'PAIR': return workSortKey.pair(record.pairId);
    case 'PAIR_RESULT': return workSortKey.pairResult(record.result.pairId);
  }
}

function recordFromItem(item: Record<string, unknown>): WorkRecord {
  const { pk: _pk, sk: _sk, expiresAt: _expiresAt, ...record } = item;
  return WorkRecordSchema.parse(record);
}
