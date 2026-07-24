import { describe, expect, it, vi } from 'vitest';
import { getLatestResult, getRunResult, listStudentResults, listStudents } from '../src/api/results.js';
import { ResultsStore } from '../src/store/results-store.js';

const resultId = '11111111-1111-4111-8111-111111111111';
const result = {
  resultId,
  runId: resultId,
  transcriptId: 7,
  student: { studentKey: 'transcript-processor:12', processorStudentId: 12, displayName: 'Student 12' },
  degreeProgramId: 'program',
  createdAt: '2025-01-01T00:00:00.000Z',
  excludedTakenCourses: [],
  requiredCourseResults: [],
};
const directory = {
  studentKey: result.student.studentKey,
  displayName: result.student.displayName,
  latestResultAt: result.createdAt,
  latestResultId: resultId,
  resultCount: 1,
};

function client(send: ReturnType<typeof vi.fn>) {
  return { send } as never;
}

describe('result store access patterns', () => {
  it('queries the directory partition with opaque continuation keys and never scans', async () => {
    const lastKey = { pk: 'STUDENT_DIRECTORY', sk: 'transcript-processor:13' };
    const send = vi.fn().mockResolvedValueOnce({ Items: [{ pk: 'STUDENT_DIRECTORY', sk: directory.studentKey, ...directory }], LastEvaluatedKey: lastKey });
    const store = new ResultsStore(client(send), 'results', 'runs');
    const page = await store.listDirectories({ limit: 20 });
    expect(page.items).toEqual([directory]);
    expect(page.cursor).toBeTypeOf('string');
    expect(send.mock.calls[0]?.[0].input).toMatchObject({ KeyConditionExpression: 'pk = :pk', ScanIndexForward: true, Limit: 20 });
  });

  it('queries byStudent newest first and fetches latest/exact result deterministically', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ Items: [{ pk: 'RESULT#7#program', sk: `${result.createdAt}#${resultId}`, studentKey: directory.studentKey, studentResultKey: `${result.createdAt}#${resultId}`, ...result }] })
      .mockResolvedValueOnce({ Items: [{ pk: 'RESULT#7#program', sk: `${result.createdAt}#${resultId}`, ...result }] })
      .mockResolvedValueOnce({ Item: { pk: 'RESULT#7#program', sk: `${result.createdAt}#${resultId}`, ...result } });
    const store = new ResultsStore(client(send), 'results', 'runs');
    await expect(store.listStudentResults(directory.studentKey, { limit: 10 })).resolves.toMatchObject({ items: [result] });
    await expect(store.getLatest(7, 'program')).resolves.toMatchObject(result);
    await expect(store.getByLocator({ resultKey: 'RESULT#7#program', resultSortKey: `${result.createdAt}#${resultId}` })).resolves.toMatchObject(result);
    expect(send.mock.calls[0]?.[0].input).toMatchObject({ IndexName: 'byStudent', ScanIndexForward: false, KeyConditionExpression: 'studentKey = :studentKey' });
    expect(send.mock.calls[1]?.[0].input).toMatchObject({ ScanIndexForward: false, Limit: 1 });
  });
});

describe('result APIs', () => {
  it('returns stable 404 responses for missing student, result, and run resources', async () => {
    await expect(listStudentResults(directory.studentKey, {}, { getDirectory: vi.fn().mockResolvedValue(undefined), listStudentResults: vi.fn() } as never)).resolves.toMatchObject({ statusCode: 404, body: { code: 'STUDENT_NOT_FOUND' } });
    await expect(getLatestResult('7', 'program', { getLatest: vi.fn().mockResolvedValue(undefined) } as never)).resolves.toMatchObject({ statusCode: 404, body: { code: 'RESULT_NOT_FOUND' } });
    await expect(getRunResult(resultId, { runs: { get: vi.fn().mockResolvedValue(undefined) }, results: { getByLocator: vi.fn() } } as never)).resolves.toMatchObject({ statusCode: 404, body: { code: 'RUN_RESULT_NOT_FOUND' } });
  });

  it('passes bounded pagination through and retrieves an exact completed-run result', async () => {
    const cursor = 'opaque-cursor';
    const listDirectories = vi.fn().mockResolvedValue({ items: [directory], cursor });
    await expect(listStudents({ limit: '2' }, { listDirectories } as never)).resolves.toMatchObject({ statusCode: 200, body: { items: [directory], cursor } });
    expect(listDirectories).toHaveBeenCalledWith({ limit: 2 });

    const getByLocator = vi.fn().mockResolvedValue(result);
    await expect(getRunResult(resultId, {
      runs: { get: vi.fn().mockResolvedValue({ status: 'completed', resultLocator: { resultKey: 'RESULT#7#program', resultSortKey: `${result.createdAt}#${resultId}` } }) },
      results: { getByLocator },
    } as never)).resolves.toMatchObject({ statusCode: 200, body: result });
    expect(getByLocator).toHaveBeenCalledWith({ resultKey: 'RESULT#7#program', resultSortKey: `${result.createdAt}#${resultId}` });
  });
});
