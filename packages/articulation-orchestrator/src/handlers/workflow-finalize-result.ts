import { z } from 'zod';
import { dynamo } from '../aws/clients.js';
import { getDegreeProgram } from '../degree-programs/registry-service.js';
import { FinalizeResult } from '../pipeline/finalize-result.js';
import { ResultsStore } from '../store/results-store.js';
import { RunsStore } from '../store/runs-store.js';
import { WorkStore } from '../store/work-store.js';

const InputSchema = z.object({ runId: z.string().uuid() }).strict();

/** Finalizes a run using compact workflow input and transactional persistence. */
export async function handler(event: unknown) {
  const { runId } = InputSchema.parse(event);
  const runsTableName = requiredEnvironment('RUNS_TABLE_NAME');
  const resultsTableName = requiredEnvironment('RESULTS_TABLE_NAME');
  const finalizer = new FinalizeResult({
    runs: new RunsStore(dynamo, runsTableName),
    workStore: new WorkStore(dynamo, requiredEnvironment('WORK_TABLE_NAME')),
    results: new ResultsStore(dynamo, resultsTableName, runsTableName),
    getDegreeProgram: (degreeProgramId) => {
      const result = getDegreeProgram(degreeProgramId);
      return result.kind === 'found' ? result.program : undefined;
    },
  });
  return finalizer.execute(runId);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
