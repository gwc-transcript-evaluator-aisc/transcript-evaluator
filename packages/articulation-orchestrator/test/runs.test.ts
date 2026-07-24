import { describe, expect, it, vi } from 'vitest';
import { createRun, getRunStatus } from '../src/api/runs.js';
import { isLegalRunTransition, RunsStore } from '../src/store/runs-store.js';

const requestId = '11111111-1111-4111-8111-111111111111';
const now = () => new Date('2025-01-01T00:00:00.000Z');

const conditionalFailure = () => Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' });

function commandClient(send: ReturnType<typeof vi.fn>) {
  return { send } as never;
}

describe('run persistence', () => {
  it('conditionally creates one pending run and returns matching retries', async () => {
    const send = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(conditionalFailure()).mockResolvedValueOnce({ Item: { runId: requestId, requestId, transcriptId: 9, degreeProgramId: 'computer-science-bs', status: 'pending', createdAt: now().toISOString(), updatedAt: now().toISOString() } });
    const store = new RunsStore(commandClient(send), 'runs', now);
    const input = { runId: requestId, requestId, transcriptId: 9, degreeProgramId: 'computer-science-bs' };
    await expect(store.create(input)).resolves.toMatchObject({ kind: 'created', run: { status: 'pending' } });
    await expect(store.create(input)).resolves.toMatchObject({ kind: 'existing' });
    expect(send.mock.calls[0][0].input.ConditionExpression).toBe('attribute_not_exists(runId)');
  });

  it('detects conflicting reuse and makes only legal monotonic transitions', async () => {
    const existing = { runId: requestId, requestId, transcriptId: 9, degreeProgramId: 'computer-science-bs', status: 'pending', createdAt: now().toISOString(), updatedAt: now().toISOString() };
    const send = vi.fn().mockRejectedValueOnce(conditionalFailure()).mockResolvedValueOnce({ Item: existing });
    const store = new RunsStore(commandClient(send), 'runs', now);
    await expect(store.create({ ...existing, transcriptId: 10 })).resolves.toMatchObject({ kind: 'conflict' });
    expect(isLegalRunTransition('pending', 'matching')).toBe(true);
    expect(isLegalRunTransition('matching', 'evaluating')).toBe(true);
    expect(isLegalRunTransition('evaluating', 'completed')).toBe(true);
    expect(isLegalRunTransition('pending', 'completed')).toBe(false);
    await expect(store.transition(requestId, 'pending', 'completed')).rejects.toThrow(/Illegal run transition/);
  });
});

describe('run APIs', () => {
  const foundProgram = () => ({ kind: 'found' as const, program: { id: 'computer-science-bs' } as never });
  const completedTranscript = { getStatus: vi.fn().mockResolvedValue({ id: 9, status: 'completed' }), getDetail: vi.fn().mockResolvedValue({ id: 9, status: 'completed', student: { id: 7 } }) };

  it('validates transcript before creation and starts exactly one deterministic execution', async () => {
    const runs = { create: vi.fn().mockResolvedValue({ kind: 'created', run: { runId: requestId, requestId, transcriptId: 9, degreeProgramId: 'computer-science-bs', status: 'pending' } }), markFailed: vi.fn(), get: vi.fn() } as never;
    const stepFunctions = { send: vi.fn().mockResolvedValue({}) };
    const response = await createRun({ requestId, transcriptId: 9, degreeProgramId: 'computer-science-bs' }, { runs, transcripts: completedTranscript, stepFunctions, stateMachineArn: 'arn:state-machine', getProgram: foundProgram });
    expect(response.statusCode).toBe(202);
    expect(stepFunctions.send).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ name: requestId }) }));
  });

  it('returns existing retry without a second start, conflict for differing input, and failed starting records', async () => {
    const baseRun = { runId: requestId, requestId, transcriptId: 9, degreeProgramId: 'computer-science-bs', status: 'pending' };
    const existingRuns = { create: vi.fn().mockResolvedValue({ kind: 'existing', run: baseRun }), markFailed: vi.fn(), get: vi.fn() } as never;
    const sf = { send: vi.fn() };
    await expect(createRun({ requestId, transcriptId: 9, degreeProgramId: 'computer-science-bs' }, { runs: existingRuns, transcripts: completedTranscript, stepFunctions: sf, stateMachineArn: 'arn', getProgram: foundProgram })).resolves.toMatchObject({ statusCode: 202 });
    expect(sf.send).not.toHaveBeenCalled();

    const conflictRuns = { create: vi.fn().mockResolvedValue({ kind: 'conflict', run: baseRun }), markFailed: vi.fn(), get: vi.fn() } as never;
    await expect(createRun({ requestId, transcriptId: 9, degreeProgramId: 'computer-science-bs' }, { runs: conflictRuns, transcripts: completedTranscript, stepFunctions: sf, stateMachineArn: 'arn', getProgram: foundProgram })).resolves.toMatchObject({ statusCode: 409 });

    const failed = { ...baseRun, status: 'failed', failedStage: 'starting', failureCode: 'STATE_MACHINE_START_FAILED', failureMessage: 'Workflow could not be started.' };
    const failedRuns = { create: vi.fn().mockResolvedValue({ kind: 'created', run: baseRun }), markFailed: vi.fn().mockResolvedValue(failed), get: vi.fn() } as never;
    await expect(createRun({ requestId, transcriptId: 9, degreeProgramId: 'computer-science-bs' }, { runs: failedRuns, transcripts: completedTranscript, stepFunctions: { send: vi.fn().mockRejectedValue(new Error('private arn')) } as never, stateMachineArn: 'arn', getProgram: foundProgram })).resolves.toMatchObject({ body: { status: 'failed', failedStage: 'starting' } });
  });

  it('returns status with completed locator and not found responses', async () => {
    const completed = { runId: requestId, requestId, transcriptId: 9, degreeProgramId: 'computer-science-bs', status: 'completed', createdAt: now().toISOString(), updatedAt: now().toISOString(), resultLocator: { resultKey: 'RESULT#9#computer-science-bs', resultSortKey: '2025-01-01#run' } };
    await expect(getRunStatus(requestId, { get: vi.fn().mockResolvedValue(completed) } as never)).resolves.toMatchObject({ statusCode: 200, body: { resultLocator: completed.resultLocator } });
    await expect(getRunStatus(requestId, { get: vi.fn().mockResolvedValue(undefined) } as never)).resolves.toMatchObject({ statusCode: 404, body: { code: 'RUN_NOT_FOUND' } });
  });
});
