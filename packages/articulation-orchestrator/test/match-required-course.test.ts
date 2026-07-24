import { describe, expect, it, vi } from 'vitest';
import { validateMatchDeterminations } from '../src/ai/course-matcher.js';
import { MatchRequiredCourse, deterministicPairId } from '../src/pipeline/match-required-course.js';
import type { WorkRecord } from '../src/domain/work-record.js';

const runId = '11111111-1111-4111-8111-111111111111';
const requiredCourseId = 'EXAMPLE UNIVERSITY|2024|CS 201';
const timestamp = '2025-01-01T00:00:00.000Z';
const resolution = {
  kind: 'resolved' as const,
  original: { institution: 'Example University', academicYear: '2024' },
  resolved: { institution: 'Example University', academicYear: '2024' },
  method: 'exact' as const,
};

function required(overrides: Partial<Extract<WorkRecord, { recordType: 'REQUIRED' }>> = {}): Extract<WorkRecord, { recordType: 'REQUIRED' }> {
  return {
    recordType: 'REQUIRED', runId, createdAt: timestamp, updatedAt: timestamp, requiredCourseId,
    requiredCourse: { institution: 'Example University', academicYear: '2024', courseCode: 'CS 201' },
    resolution, catalogContent: { department: 'CS', title: 'Data Structures', description: 'Algorithms, data structures, and analysis.', credits: 3, learningOutcomes: ['Analyze algorithms'], topics: ['Trees'], competencies: ['Programming'] },
    ...overrides,
  };
}
function candidate(sourceCourseId: number): Extract<WorkRecord, { recordType: 'CANDIDATE' }> {
  return {
    recordType: 'CANDIDATE', runId, createdAt: timestamp, updatedAt: timestamp, sourceCourseId,
    takenCourse: { sourceCourseId, rawInstitution: 'Example University', rawAcademicYear: '2024', courseCode: `CS ${sourceCourseId}`, courseTitle: 'Course' },
    resolution, identifier: { institution: 'Example University', academicYear: '2024', courseCode: `CS ${sourceCourseId}` },
    catalogContent: { department: 'CS', title: `Course ${sourceCourseId}`, description: 'Complete catalog description.', credits: 3, learningOutcomes: ['Learn'], topics: ['Topic'], competencies: ['Competency'] },
  };
}

function storeFor(record: WorkRecord, candidates: WorkRecord[] = []) {
  const put = vi.fn().mockResolvedValue(undefined);
  return {
    put,
    get: vi.fn().mockResolvedValue(record),
    list: vi.fn().mockResolvedValue(candidates),
  };
}

describe('MatchRequiredCourse', () => {
  it('sends complete catalog content, creates only selected deterministic pairs, and records matched', async () => {
    const requirement = required();
    const candidates = [candidate(12), candidate(3)];
    const matcher = { match: vi.fn().mockResolvedValue([
      { candidateId: 'candidate-3', isMatch: true },
      { candidateId: 'candidate-12', isMatch: false },
    ]) };
    const store = storeFor(requirement, candidates);
    const worker = new MatchRequiredCourse({ workStore: store as never, courseMatcher: matcher, now: () => new Date(timestamp) });

    await expect(worker.execute({ runId, requiredCourseId })).resolves.toEqual({
      runId, requiredCourseId, matchingOutcome: 'matched', pairIds: [deterministicPairId(requiredCourseId, 3)],
    });
    expect(matcher.match).toHaveBeenCalledWith(
      expect.objectContaining({ catalogContent: requirement.catalogContent }),
      [expect.objectContaining({ candidateId: 'candidate-3', catalogContent: candidates[1]!.catalogContent }), expect.objectContaining({ candidateId: 'candidate-12' })],
    );
    expect(store.put).toHaveBeenCalledWith(expect.objectContaining({ recordType: 'REQUIRED', result: expect.objectContaining({ matchingOutcome: 'matched', pairResults: [] }) }));
    expect(store.put).toHaveBeenCalledWith(expect.objectContaining({
      recordType: 'PAIR', pairId: deterministicPairId(requiredCourseId, 3), sourceCourseId: 3,
      requiredIdentifier: { institution: 'Example University', academicYear: '2024', courseCode: 'CS 201' },
    }));
  });

  it('records unmatched when all complete candidates are rejected', async () => {
    const store = storeFor(required(), [candidate(1)]);
    const worker = new MatchRequiredCourse({
      workStore: store as never, courseMatcher: { match: vi.fn().mockResolvedValue([{ candidateId: 'candidate-1', isMatch: false }]) }, now: () => new Date(timestamp),
    });

    await expect(worker.execute({ runId, requiredCourseId })).resolves.toMatchObject({ matchingOutcome: 'unmatched', pairIds: [] });
    expect(store.put).toHaveBeenCalledTimes(1);
    expect(store.put).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ matchingOutcome: 'unmatched', pairResults: [] }) }));
  });

  it('preserves unresolved requirements without calling matching and records malformed decisions as errored', async () => {
    const unresolved = required({ resolution: { kind: 'unresolved', original: {}, reasonCode: 'NO_CATALOG', message: 'No catalog course.' }, catalogContent: undefined });
    const unresolvedStore = storeFor(unresolved, [candidate(1)]);
    const unresolvedMatcher = { match: vi.fn() };
    const unresolvedWorker = new MatchRequiredCourse({ workStore: unresolvedStore as never, courseMatcher: unresolvedMatcher, now: () => new Date(timestamp) });
    await expect(unresolvedWorker.execute({ runId, requiredCourseId })).resolves.toMatchObject({ matchingOutcome: 'unresolved', pairIds: [] });
    expect(unresolvedMatcher.match).not.toHaveBeenCalled();

    const malformedStore = storeFor(required(), [candidate(1)]);
    const malformedWorker = new MatchRequiredCourse({
      workStore: malformedStore as never, courseMatcher: { match: vi.fn().mockResolvedValue([]) }, now: () => new Date(timestamp),
    });
    await expect(malformedWorker.execute({ runId, requiredCourseId })).resolves.toMatchObject({ matchingOutcome: 'errored', pairIds: [] });
    expect(malformedStore.put).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ matchingOutcome: 'errored', message: 'Course matching could not be completed.' }) }));
  });
});

describe('validateMatchDeterminations', () => {
  it('rejects missing, duplicate, and unknown candidate decisions', () => {
    expect(() => validateMatchDeterminations({ determinations: [{ candidateId: 'candidate-1', isMatch: true }] }, ['candidate-1', 'candidate-2'])).toThrow();
    expect(() => validateMatchDeterminations({ determinations: [{ candidateId: 'candidate-1', isMatch: true }, { candidateId: 'candidate-1', isMatch: false }] }, ['candidate-1', 'candidate-2'])).toThrow();
    expect(() => validateMatchDeterminations({ determinations: [{ candidateId: 'candidate-1', isMatch: true }, { candidateId: 'unknown', isMatch: false }] }, ['candidate-1', 'candidate-2'])).toThrow();
  });
});
