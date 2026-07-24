import { StartExecutionCommand, type SFNClient } from '@aws-sdk/client-sfn';
import { z } from 'zod';
import { getDegreeProgram, type DegreeProgramLookup } from '../degree-programs/registry-service.js';
import type { OrchestrationRun } from '../domain/orchestration-run.js';
import type { TranscriptClient } from '../transcript/transcript-client.js';
import type { RunsStore } from '../store/runs-store.js';

const CreateRunRequestSchema = z.object({
  requestId: z.string().uuid(),
  transcriptId: z.number().int().positive(),
  degreeProgramId: z.string().trim().min(1).max(200),
}).strict();

export type CreateRunResponse =
  | { statusCode: 202; body: OrchestrationRun }
  | { statusCode: 400 | 404 | 409 | 422 | 503; body: PublicRunError };
export interface PublicRunError { code: string; message: string; }

export interface CreateRunDependencies {
  readonly runs: RunsStore;
  readonly transcripts: Pick<TranscriptClient, 'getStatus' | 'getDetail'>;
  readonly stepFunctions: Pick<SFNClient, 'send'>;
  readonly stateMachineArn: string;
  readonly getProgram?: (id: string) => DegreeProgramLookup;
}

/** Creates an idempotent run only after program and transcript identity validation. */
export async function createRun(request: unknown, dependencies: CreateRunDependencies): Promise<CreateRunResponse> {
  const parsed = CreateRunRequestSchema.safeParse(request);
  if (!parsed.success) return publicError(400, 'INVALID_REQUEST', 'Run request is invalid.');
  const input = parsed.data;
  const programLookup = (dependencies.getProgram ?? getDegreeProgram)(input.degreeProgramId);
  if (programLookup.kind === 'not-found') return publicError(404, 'DEGREE_PROGRAM_NOT_FOUND', 'Degree program was not found.');

  try {
    const [status, detail] = await Promise.all([
      dependencies.transcripts.getStatus(input.transcriptId),
      dependencies.transcripts.getDetail(input.transcriptId),
    ]);
    if (status.status !== 'completed' || detail.status !== 'completed' || !detail.student?.id) {
      return publicError(422, 'TRANSCRIPT_NOT_READY', 'Transcript is not completed with student details.');
    }
  } catch {
    return publicError(503, 'TRANSCRIPT_VALIDATION_UNAVAILABLE', 'Transcript could not be validated.');
  }

  const creation = await dependencies.runs.create({ ...input, runId: input.requestId });
  if (creation.kind === 'conflict') return publicError(409, 'REQUEST_ID_CONFLICT', 'Request ID was already used for different input.');
  if (creation.kind === 'existing') return { statusCode: 202, body: creation.run };

  try {
    await dependencies.stepFunctions.send(new StartExecutionCommand({
      stateMachineArn: dependencies.stateMachineArn,
      name: creation.run.runId,
      input: JSON.stringify({ runId: creation.run.runId }),
    }));
    return { statusCode: 202, body: creation.run };
  } catch (error) {
    if (errorName(error) === 'ExecutionAlreadyExists') return { statusCode: 202, body: creation.run };
    const failed = await dependencies.runs.markFailed(creation.run.runId, 'pending', 'starting', 'STATE_MACHINE_START_FAILED', 'Workflow could not be started.');
    return { statusCode: 202, body: failed ?? creation.run };
  }
}

export async function getRunStatus(runId: string, runs: Pick<RunsStore, 'get'>): Promise<{ statusCode: 200; body: OrchestrationRun } | { statusCode: 404; body: PublicRunError }> {
  const run = await runs.get(runId);
  return run
    ? { statusCode: 200, body: run }
    : { statusCode: 404, body: { code: 'RUN_NOT_FOUND', message: 'Run was not found.' } };
}

function publicError(statusCode: 400 | 404 | 409 | 422 | 503, code: string, message: string): CreateRunResponse {
  return { statusCode, body: { code, message } } as CreateRunResponse;
}

function errorName(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : undefined;
}
