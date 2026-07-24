import { InvokeCommand, type LambdaClient } from '@aws-sdk/client-lambda';
import { z } from 'zod';
import { CourseIdentifierSchema, type CourseIdentifier } from '../domain/catalog-resolution.js';

// The evaluator returns a richer assessment (e.g. creditHoursComparable,
// contentCoverageNotes); accept and preserve those extra fields rather than rejecting
// them. The orchestrator only requires the three fields below.
const AssessmentSchema = z.object({
  decision: z.enum(['EQUIVALENT', 'PARTIAL', 'NOT_EQUIVALENT']),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  rationale: z.string().trim().min(1).max(10_000),
}).passthrough();

const EvaluatorResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('EVALUATED'),
    evaluation: z.object({ assessment: AssessmentSchema }).passthrough(),
  }).strict(),
  z.object({
    kind: z.literal('NOT_FOUND'),
    missing: z.enum(['home', 'transfer', 'both']),
    message: z.string().trim().min(1).max(10_000),
  }).strict(),
]);

type EvaluatorResponse = z.infer<typeof EvaluatorResponseSchema>;
export type EvaluatorResult = EvaluatorResponse;

/** Public-safe failure for the direct evaluator Lambda boundary. */
export class EvaluatorClientError extends Error {
  public constructor() {
    super('Course evaluation could not be completed.');
    this.name = 'EvaluatorClientError';
  }
}

export interface EvaluatorClientDependencies {
  lambda: Pick<LambdaClient, 'send'>;
  functionName: string;
}

/**
 * Synchronous direct-Lambda boundary for the separately deployed evaluator.
 * Raw Lambda failures and payloads never cross this boundary.
 */
export class EvaluatorClient {
  public constructor(private readonly dependencies: EvaluatorClientDependencies) {}

  public async evaluate(home: CourseIdentifier, transfer: CourseIdentifier): Promise<EvaluatorResult> {
    const request = {
      home: CourseIdentifierSchema.parse(home),
      transfer: CourseIdentifierSchema.parse(transfer),
    };

    try {
      const response = await this.dependencies.lambda.send(new InvokeCommand({
        FunctionName: this.dependencies.functionName,
        InvocationType: 'RequestResponse',
        Payload: new TextEncoder().encode(JSON.stringify(request)),
      }));
      if (response.FunctionError || response.StatusCode !== 200 || !response.Payload) throw new Error('Invalid Lambda invocation response');

      const payload = new TextDecoder().decode(response.Payload);
      const parsed: unknown = JSON.parse(payload);
      return EvaluatorResponseSchema.parse(parsed);
    } catch (error) {
      // Log the underlying cause (invocation failure or response-shape mismatch) rather
      // than collapsing it into an opaque public error with no diagnostics.
      console.error('Evaluator invocation failed', { functionName: this.dependencies.functionName, error });
      throw new EvaluatorClientError();
    }
  }
}
