import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { dynamo } from '../aws/clients.js';
import type { PageTaskToken } from '../domain/course.js';

const doc = DynamoDBDocumentClient.from(dynamo);
const taskTokensTableName = () => process.env.TASK_TOKENS_TABLE_NAME ?? '';
const TASK_TOKEN_TTL_SECONDS = 60 * 60 * 6; // safety net only; the callback deletes on use

/** Stores the Step Functions task token a page's InvokePage state is waiting on, keyed
 * by BDA's invocation job_id (see PageTaskToken doc comment for why this is the
 * correlation key). Written just before the Lambda returns without a result, so the
 * state machine execution pauses until SendTaskSuccess/SendTaskFailure is called. */
export async function putTaskToken(input: Omit<PageTaskToken, 'expiresAt'>): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + TASK_TOKEN_TTL_SECONDS;
  await doc.send(new PutCommand({ TableName: taskTokensTableName(), Item: { ...input, expiresAt } }));
}

export async function getTaskToken(invocationJobId: string): Promise<PageTaskToken | undefined> {
  const response = await doc.send(new GetCommand({ TableName: taskTokensTableName(), Key: { invocationJobId } }));
  return response.Item as PageTaskToken | undefined;
}

export async function deleteTaskToken(invocationJobId: string): Promise<void> {
  await doc.send(new DeleteCommand({ TableName: taskTokensTableName(), Key: { invocationJobId } }));
}
