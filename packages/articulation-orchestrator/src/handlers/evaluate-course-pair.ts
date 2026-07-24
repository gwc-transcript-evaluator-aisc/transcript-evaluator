import { z } from 'zod';
import { lambda, dynamo } from '../aws/clients.js';
import { loadConfig } from '../config.js';
import { EvaluatorClient } from '../evaluator/evaluator-client.js';
import { EvaluateCoursePair } from '../pipeline/evaluate-course-pair.js';
import { WorkStore } from '../store/work-store.js';

const InputSchema = z.object({ runId: z.string().uuid(), pairId: z.string().min(1) }).strict();

/** Step Functions worker handler. It receives and returns bounded identifiers/outcomes only. */
export async function handler(event: unknown) {
  const input = InputSchema.parse(event);
  const config = loadConfig();
  return new EvaluateCoursePair({
    workStore: new WorkStore(dynamo, config.workTableName),
    evaluatorClient: new EvaluatorClient({ lambda, functionName: config.evaluatorFunctionArn }),
  }).execute(input);
}
