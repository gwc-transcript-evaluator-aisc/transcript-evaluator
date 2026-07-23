import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { dynamo } from '../aws/clients.js';
import type { JobRecord, JobStatus } from '../domain/course.js';

const tableName = () => process.env.JOBS_TABLE_NAME ?? '';
const doc = DynamoDBDocumentClient.from(dynamo);

export async function createJob(job: JobRecord): Promise<void> {
  await doc.send(new PutCommand({ TableName: tableName(), Item: job, ConditionExpression: 'attribute_not_exists(jobId)' }));
}

export async function getJob(jobId: string): Promise<JobRecord | undefined> {
  const response = await doc.send(new GetCommand({ TableName: tableName(), Key: { jobId } }));
  return response.Item as JobRecord | undefined;
}

export async function updateJob(jobId: string, status: JobStatus, fields: Record<string, unknown> = {}): Promise<void> {
  const names: Record<string, string> = { '#status': 'status', '#updatedAt': 'updatedAt' };
  const values: Record<string, unknown> = { ':status': status, ':updatedAt': new Date().toISOString() };
  const setAssignments = ['#status = :status', '#updatedAt = :updatedAt'];
  const removeAssignments: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    names[`#${key}`] = key;
    // DynamoDB rejects `undefined` as an attribute value, so an explicit undefined means
    // "clear this field" (REMOVE) rather than "set it to undefined".
    if (value === undefined) {
      removeAssignments.push(`#${key}`);
      continue;
    }
    values[`:${key}`] = value;
    setAssignments.push(`#${key} = :${key}`);
  }
  const expressionParts = [`SET ${setAssignments.join(', ')}`];
  if (removeAssignments.length > 0) expressionParts.push(`REMOVE ${removeAssignments.join(', ')}`);
  await doc.send(new UpdateCommand({
    TableName: tableName(),
    Key: { jobId },
    UpdateExpression: expressionParts.join(' '),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}
