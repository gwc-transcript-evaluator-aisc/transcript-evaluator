import { describe, expect, it, vi } from 'vitest';
import { assembleArticulationResult, FinalizeResult } from '../src/pipeline/finalize-result.js';
import { ResultsStore } from '../src/store/results-store.js';
import type { DegreeProgram } from '../src/domain/degree-program.js';
import type { OrchestrationRun } from '../src/domain/orchestration-run.js';
import type { WorkRecord } from '../src/domain/work-record.js';

const runId = '11111111-1111-4111-8111-111111111111';
const createdAt = '2025-01-01T00:00:00.000Z';
const run: OrchestrationRun = {
  runId, requestId: runId, transcriptId: 7, degreeProgramId: 'program', status: 'evaluating', createdAt, updatedAt: createdAt,
};
const program: DegreeProgram = {
  id: 'program', name: 'Program', requiredCourses: [
    { institution: 'Example University', academicYear: '2024', courseCode: 'CS 101' },
    { institution: 'Example University', academicYear: '2024', courseCode: 'MATH 101' },
  ],
};
const resolution = {
  kind: 'resolved' as const,
  original: { institution: 'Example University', academicYear: '2024' },
  resolved: { institution: 'Example University', academicYear: '2024' },
  method: 'exact' as const,
};
const student = { studentKey: 'transcript-processor:12', processorStudentId: 12, displayName: 'Student 12' };
const records: WorkRecord[] = [
  { recordType: 'STUDENT', runId, createdAt, updatedAt: createdAt, student },
  { recordType: 'EXCLUDED_TAKEN', runId, createdAt, updatedAt: createdAt, sourceCourseId: 9, takenCourse: { sourceCourseId: 9 }, reasonCode: 'MISSING_COURSE_CODE', message: 'Course information is incomplete.' },
  { recordType: 'REQUIRED', runId, createdAt, updatedAt: createdAt, requiredCourseId: 'EXAMPLE UNIVERSITY|2024|CS 101', requiredCourse: program.requiredCourses[0]!, resolution, result: { requiredCourseId: 'EXAMPLE UNIVERSITY|2024|CS 101', requiredCourse: program.requiredCourses[0]!, requiredResolution: resolution, matchingOutcome: 'matched', pairResults: [] } },
  { recordType: 'REQUIRED', runId, createdAt, updatedAt: createdAt, requiredCourseId: 'EXAMPLE UNIVERSITY|2024|MATH 101', requiredCourse: program.requiredCourses[1]!, resolution, result: { requiredCourseId: 'EXAMPLE UNIVERSITY|2024|MATH 101', requiredCourse: program.requiredCourses[1]!, requiredResolution: resolution, matchingOutcome: 'unmatched', pairResults: [] } },
  { recordType: 'PAIR', runId, createdAt, updatedAt: createdAt, pairId: 'pair-cs', requiredCourseId: 'EXAMPLE UNIVERSITY|2024|CS 101', sourceCourseId: 1, requiredIdentifier: { institution: 'Example University', academicYear: '2024', courseCode: 'CS 101' }, takenIdentifier: { institution: 'Example University', academicYear: '2024', courseCode: 'CSC 100' } },
  { recordType: 'PAIR_RESULT', runId, createdAt, updatedAt: createdAt, result: { pairId: 'pair-cs', takenCourse: { sourceCourseId: 1, courseCode: 'CSC 100' }, takenResolution: resolution, outcome: 'evaluated', decision: 'EQUIVALENT', confidence: 'HIGH', rationale: 'Equivalent content.' } },
];

describe('result finalization', () => {
  it('assembles a deterministic complete aggregate including exclusions and every requirement', () => {
    const result = assembleArticulationResult(run, program, records);
    expect(result).toMatchObject({ resultId: runId, runId, createdAt, excludedTakenCourses: [{ reasonCode: 'MISSING_COURSE_CODE' }] });
    expect(result.requiredCourseResults.map((item) => item.requiredCourseId)).toEqual(['EXAMPLE UNIVERSITY|2024|CS 101', 'EXAMPLE UNIVERSITY|2024|MATH 101']);
    expect(result.requiredCourseResults[0]?.pairResults).toEqual([expect.objectContaining({ pairId: 'pair-cs', outcome: 'evaluated' })]);
  });

  it('refuses completion when any program requirement or selected pair result is absent', () => {
    expect(() => assembleArticulationResult(run, program, records.filter((record) => record.recordType !== 'REQUIRED' || record.requiredCourseId !== 'EXAMPLE UNIVERSITY|2024|MATH 101'))).toThrow(/Required course work records are incomplete/);
    expect(() => assembleArticulationResult(run, program, records.filter((record) => record.recordType !== 'PAIR_RESULT'))).toThrow(/Course pair evaluation results are incomplete/);
  });

  it('converges after an ambiguous transaction response when the run has the deterministic locator', async () => {
    const locator = { resultKey: 'RESULT#7#program', resultSortKey: `${createdAt}#${runId}` };
    const finalizer = new FinalizeResult({
      runs: { get: vi.fn().mockResolvedValueOnce(run).mockResolvedValueOnce({ ...run, status: 'completed', resultLocator: locator }) },
      workStore: { list: vi.fn().mockResolvedValue(records) },
      results: { persistAndComplete: vi.fn().mockRejectedValue(new Error('ambiguous')) },
      getDegreeProgram: () => program,
    });
    await expect(finalizer.execute(runId)).resolves.toEqual({ runId, resultLocator: locator });
  });

  it('uses an atomic older-result directory update without replacing latest metadata', async () => {
    const send = vi.fn().mockResolvedValueOnce({ Item: { pk: 'STUDENT_DIRECTORY', sk: student.studentKey, ...student, latestResultAt: '2026-01-01T00:00:00.000Z', latestResultId: '22222222-2222-4222-8222-222222222222', resultCount: 3 } }).mockResolvedValueOnce({});
    const result = assembleArticulationResult(run, program, records);
    await new ResultsStore({ send } as never, 'results', 'runs', () => new Date(createdAt)).persistAndComplete(result);
    const transaction = send.mock.calls[1]?.[0].input.TransactItems;
    expect(transaction[1].Update.UpdateExpression).toBe('ADD resultCount :one');
    expect(transaction[2].Update.ConditionExpression).toBe('#status = :evaluating');
  });
});
