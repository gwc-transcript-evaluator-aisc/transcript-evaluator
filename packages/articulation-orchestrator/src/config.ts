import { z } from 'zod';

const RuntimeConfigSchema = z.object({
  transcriptApiBaseUrl: z.string().url(),
  transcriptApiAuthToken: z.string().min(1).optional(),
  // Only the API handler needs this (for x-api-key auth); workflow Lambdas do not set it,
  // so it is optional to avoid failing loadConfig() in the state-machine tasks.
  orchestratorApiKeySecretArn: z.string().min(1).optional(),
  runsTableName: z.string().min(1),
  workTableName: z.string().min(1),
  resultsTableName: z.string().min(1),
  catalogCacheTableName: z.string().min(1),
  catalogTableName: z.string().min(1),
  stateMachineArn: z.string().min(1),
  evaluatorFunctionArn: z.string().min(1),
  bedrockModelId: z.string().min(1),
});

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

/** Loads Lambda configuration lazily so CDK synthesis and unit tests do not need runtime variables. */
export function loadConfig(environment: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return RuntimeConfigSchema.parse({
    transcriptApiBaseUrl: environment.TRANSCRIPT_API_BASE_URL,
    transcriptApiAuthToken: environment.TRANSCRIPT_API_AUTH_TOKEN || undefined,
    orchestratorApiKeySecretArn: environment.ORCHESTRATOR_API_KEY_SECRET_ARN,
    runsTableName: environment.RUNS_TABLE_NAME,
    workTableName: environment.WORK_TABLE_NAME,
    resultsTableName: environment.RESULTS_TABLE_NAME,
    catalogCacheTableName: environment.CATALOG_CACHE_TABLE_NAME,
    catalogTableName: environment.CATALOG_TABLE_NAME,
    stateMachineArn: environment.STATE_MACHINE_ARN,
    evaluatorFunctionArn: environment.EVALUATOR_FUNCTION_ARN,
    bedrockModelId: environment.BEDROCK_MODEL_ID,
  });
}
