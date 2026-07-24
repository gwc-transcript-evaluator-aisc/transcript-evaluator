import { z } from 'zod';
import { dynamo } from '../aws/clients.js';
import { RunsStore } from '../store/runs-store.js';

const inputSchema = z.object({ runId: z.string().uuid(), from: z.enum(['pending', 'matching']), to: z.enum(['matching', 'evaluating']) }).strict();

/** Performs only run-level transitions; Map workers never mutate run status. */
export async function handler(event: unknown) {
  const input = inputSchema.parse(event);
  const tableName = process.env.RUNS_TABLE_NAME;
  if (!tableName) throw new Error('RUNS_TABLE_NAME is required');
  const store = new RunsStore(dynamo, tableName);
  let run = await store.transition(input.runId, input.from, input.to);
  if (!run) {
    run = await store.get(input.runId);
    if (!run) throw new Error('Run was not found');
    if (run.status !== input.to) throw new Error('Run status transition was rejected');
  }
  return {
    runId: run.runId,
    transcriptId: run.transcriptId,
    degreeProgramId: run.degreeProgramId,
  };
}
