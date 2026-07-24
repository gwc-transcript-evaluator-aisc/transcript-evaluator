import { z } from 'zod';
import { dynamo } from '../aws/clients.js';
import { RunsStore } from '../store/runs-store.js';

const inputSchema = z.object({ runId: z.string().uuid(), failedStage: z.enum(['matching', 'evaluating', 'persisting']), error: z.unknown().optional() }).passthrough();

/** Converts workflow failures to one sanitized terminal run state. */
export async function handler(event: unknown) {
  const input = inputSchema.parse(event);
  const tableName = process.env.RUNS_TABLE_NAME;
  if (!tableName) throw new Error('RUNS_TABLE_NAME is required');
  const runs = new RunsStore(dynamo, tableName);
  const run = await runs.get(input.runId);
  if (!run || run.status === 'completed' || run.status === 'failed') return { runId: input.runId };
  await runs.markFailed(input.runId, run.status, input.failedStage, 'WORKFLOW_FAILED', 'The orchestration run could not be completed.');
  return { runId: input.runId };
}
