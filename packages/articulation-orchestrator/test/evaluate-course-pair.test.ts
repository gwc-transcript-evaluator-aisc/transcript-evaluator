import { InvokeCommand } from '@aws-sdk/client-lambda';
import { describe, expect, it, vi } from 'vitest';
import { EvaluatorClient, EvaluatorClientError } from '../src/evaluator/evaluator-client.js';
import { EvaluateCoursePair } from '../src/pipeline/evaluate-course-pair.js';
import type { WorkRecord } from '../src/domain/work-record.js';

const runId = '11111111-1111-4111-8111-111111111111';
const pairId = 'pair-abc';
const timestamp = '2025-01-01T00:00:00.000Z';
const resolution = { kind: 'resolved' as const, original: { institution: 'Example University', academicYear: '2024' }, resolved: { institution: 'Example University', academicYear: '2024' }, method: 'exact' as const };
const requiredId = 'EXAMPLE UNIVERSITY|2024|CS 201';
const requiredIdentifier = { institution: 'Example University', academicYear: '2024', courseCode: 'CS 201' };
const takenIdentifier = { institution: 'Example University', academicYear: '2024', courseCode: 'CS 101' };

function records(): WorkRecord[] {
  return [
    { recordType: 'PAIR', runId, createdAt: timestamp, updatedAt: timestamp, pairId, requiredCourseId: requiredId, sourceCourseId: 101, requiredIdentifier, takenIdentifier },
    { recordType: 'REQUIRED', runId, createdAt: timestamp, updatedAt: timestamp, requiredCourseId: requiredId, requiredCourse: { institution: 'Example University', academicYear: '2024', courseCode: 'CS 201' }, resolution, catalogContent: {} },
    { recordType: 'CANDIDATE', runId, createdAt: timestamp, updatedAt: timestamp, sourceCourseId: 101, takenCourse: { sourceCourseId: 101, rawInstitution: 'Example University', rawAcademicYear: '2024', courseCode: 'CS 101' }, resolution, identifier: takenIdentifier, catalogContent: {} },
  ];
}

function storeFor(workRecords = records()) {
  const byKey = new Map<string, WorkRecord>([
    [`PAIR#${pairId}`, workRecords[0]!], [`REQUIRED#${requiredId}`, workRecords[1]!], ['CANDIDATE#101', workRecords[2]!],
  ]);
  return { get: vi.fn(async (_runId: string, key: string) => byKey.get(key)), putIfAbsent: vi.fn().mockResolvedValue(true) };
}

describe('EvaluatorClient', () => {
  it('synchronously invokes with validated identifiers and returns only valid EVALUATED payloads', async () => {
    const send = vi.fn().mockResolvedValue({ StatusCode: 200, Payload: new TextEncoder().encode(JSON.stringify({ kind: 'EVALUATED', evaluation: { assessment: { decision: 'PARTIAL', confidence: 'MEDIUM', rationale: 'Some overlap.' } } })) });
    const client = new EvaluatorClient({ lambda: { send } as never, functionName: 'evaluator' });

    await expect(client.evaluate(requiredIdentifier, takenIdentifier)).resolves.toMatchObject({ kind: 'EVALUATED' });
    expect(send).toHaveBeenCalledWith(expect.any(InvokeCommand));
    const command = send.mock.calls[0]![0] as InvokeCommand;
    expect(command.input).toMatchObject({ FunctionName: 'evaluator', InvocationType: 'RequestResponse' });
  });

  it('sanitizes function errors and malformed responses', async () => {
    const client = new EvaluatorClient({ lambda: { send: vi.fn().mockResolvedValue({ StatusCode: 200, FunctionError: 'Unhandled', Payload: new Uint8Array() }) } as never, functionName: 'evaluator' });
    await expect(client.evaluate(requiredIdentifier, takenIdentifier)).rejects.toBeInstanceOf(EvaluatorClientError);
  });
});

describe('EvaluateCoursePair', () => {
  it('reads only pair prerequisites, invokes once, and conditionally persists an evaluated result', async () => {
    const store = storeFor();
    const evaluator = { evaluate: vi.fn().mockResolvedValue({ kind: 'EVALUATED', evaluation: { assessment: { decision: 'EQUIVALENT', confidence: 'HIGH', rationale: 'Equivalent coverage.' } } }) };
    const worker = new EvaluateCoursePair({ workStore: store as never, evaluatorClient: evaluator, now: () => new Date(timestamp) });

    await expect(worker.execute({ runId, pairId })).resolves.toEqual({ runId, pairId, outcome: 'evaluated', persisted: true });
    expect(store.get).toHaveBeenCalledTimes(3);
    expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
    expect(store.putIfAbsent).toHaveBeenCalledWith(expect.objectContaining({ recordType: 'PAIR_RESULT', result: expect.objectContaining({ outcome: 'evaluated', decision: 'EQUIVALENT' }) }));
  });

  it('maps NOT_FOUND to unresolved and evaluator failures to sanitized failed results', async () => {
    const unresolvedStore = storeFor();
    const unresolvedWorker = new EvaluateCoursePair({ workStore: unresolvedStore as never, evaluatorClient: { evaluate: vi.fn().mockResolvedValue({ kind: 'NOT_FOUND', missing: 'transfer', message: 'raw evaluator detail' }) }, now: () => new Date(timestamp) });
    await expect(unresolvedWorker.execute({ runId, pairId })).resolves.toMatchObject({ outcome: 'unresolved' });
    expect(unresolvedStore.putIfAbsent).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ outcome: 'unresolved', message: 'A catalog course for this pair is unavailable.' }) }));

    const failedStore = storeFor();
    const failedWorker = new EvaluateCoursePair({ workStore: failedStore as never, evaluatorClient: { evaluate: vi.fn().mockRejectedValue(new Error('arn:aws:lambda:secret')) }, now: () => new Date(timestamp) });
    await expect(failedWorker.execute({ runId, pairId })).resolves.toMatchObject({ outcome: 'failed' });
    expect(failedStore.putIfAbsent).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ outcome: 'failed', message: 'Course evaluation could not be completed.' }) }));
  });
});
