import { z } from 'zod';
import { dynamo } from '../aws/clients.js';
import { workSortKey, type WorkRecord } from '../domain/work-record.js';
import { WorkStore } from '../store/work-store.js';

const InputSchema = z.object({ runId: z.string().uuid(), requiredCourseId: z.string().min(1) }).passthrough();

/** Persists a per-requirement error when a Map worker fails outside its normal isolation boundary. */
export async function handler(event: unknown) {
  const input = InputSchema.parse(event);
  const tableName = process.env.WORK_TABLE_NAME;
  if (!tableName) throw new Error('WORK_TABLE_NAME is required');
  const store = new WorkStore(dynamo, tableName);
  const record = await store.get(input.runId, workSortKey.required(input.requiredCourseId));
  if (!record || record.recordType !== 'REQUIRED') return { runId: input.runId, requiredCourseId: input.requiredCourseId };
  const timestamp = new Date().toISOString();
  await store.put({ ...record, createdAt: timestamp, updatedAt: timestamp, result: {
    requiredCourseId: record.requiredCourseId, requiredCourse: record.requiredCourse, requiredResolution: record.resolution,
    matchingOutcome: 'errored', message: 'Course matching could not be completed.', pairResults: [],
  } } as WorkRecord);
  return { runId: input.runId, requiredCourseId: input.requiredCourseId };
}
