import { z } from 'zod';
import { dynamo } from '../aws/clients.js';
import { workSortKey, type WorkRecord } from '../domain/work-record.js';
import { WorkStore } from '../store/work-store.js';

const InputSchema = z.object({ runId: z.string().uuid(), pairId: z.string().min(1) }).passthrough();

/** Persists a sanitized failed pair result so a single Map failure cannot lose a pair outcome. */
export async function handler(event: unknown) {
  const input = InputSchema.parse(event);
  const tableName = process.env.WORK_TABLE_NAME;
  if (!tableName) throw new Error('WORK_TABLE_NAME is required');
  const store = new WorkStore(dynamo, tableName);
  const pair = await store.get(input.runId, workSortKey.pair(input.pairId));
  if (!pair || pair.recordType !== 'PAIR') return { runId: input.runId, pairId: input.pairId };
  const candidate = await store.get(input.runId, workSortKey.candidate(pair.sourceCourseId));
  if (!candidate || candidate.recordType !== 'CANDIDATE') return { runId: input.runId, pairId: input.pairId };
  const timestamp = new Date().toISOString();
  await store.putIfAbsent({ recordType: 'PAIR_RESULT', runId: input.runId, createdAt: timestamp, updatedAt: timestamp, result: {
    pairId: pair.pairId, takenCourse: candidate.takenCourse, takenResolution: candidate.resolution,
    outcome: 'failed', message: 'Course evaluation could not be completed.',
  } } as WorkRecord);
  return { runId: input.runId, pairId: input.pairId };
}
