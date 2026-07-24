import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { dynamo } from '../aws/clients.js';

const inputSchema = z.object({ runId: z.string().uuid(), cursor: z.record(z.unknown()).optional(), pageSize: z.number().int().positive().max(100) }).strict();

/** Returns one bounded page of pair IDs; Catalog and result records never enter workflow state. */
export async function handler(event: unknown) {
  const input = inputSchema.parse(event);
  const tableName = process.env.WORK_TABLE_NAME;
  if (!tableName) throw new Error('WORK_TABLE_NAME is required');
  const response = await dynamo.send(new QueryCommand({
    TableName: tableName, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
    ExpressionAttributeValues: { ':pk': `RUN#${input.runId}`, ':prefix': 'PAIR#' },
    ExclusiveStartKey: input.cursor, Limit: input.pageSize, ProjectionExpression: 'pairId',
  })) as { Items?: { pairId?: unknown }[]; LastEvaluatedKey?: Record<string, unknown> };
  const pairIds = (response.Items ?? []).map((item) => item.pairId).filter((id): id is string => typeof id === 'string');
  return response.LastEvaluatedKey ? { runId: input.runId, pairIds, nextCursor: response.LastEvaluatedKey } : { runId: input.runId, pairIds };
}
