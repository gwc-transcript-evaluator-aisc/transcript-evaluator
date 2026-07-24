import { describe, expect, it, vi } from 'vitest';
import { type CatalogDirectory } from '../src/catalog/catalog-cache-store.js';
import { PrepareRun } from '../src/pipeline/prepare-run.js';
import { WorkStore } from '../src/store/work-store.js';
import type { TranscriptDetailDto } from '../src/domain/transcript.js';

const runId = '11111111-1111-4111-8111-111111111111';
const directory: CatalogDirectory = { snapshotId: 'snapshot', institutions: [] };
const detail: TranscriptDetailDto = {
  id: 17,
  status: 'completed',
  student: {
    id: 7, student_id: null, full_name: null, institution: 'Example University',
    courses: [
      { id: 1, course_code: 'CS 101', course_name: 'Intro', department: 'CS', term_year: '2024', year: null, credits: 3 },
      { id: 2, course_code: 'HIST 1', course_name: 'History', department: 'History', term_year: '2024', year: null, credits: 3 },
      { id: 3, course_code: null, course_name: null, department: null, term_year: null, year: null, credits: null },
    ],
  },
};

const resolved = (courseCode: string) => ({
  identifier: { institution: 'Example University', academicYear: '2024', courseCode },
  resolution: {
    kind: 'resolved' as const,
    original: { institution: 'Example University', academicYear: '2024' },
    resolved: { institution: 'Example University', academicYear: '2024' },
    method: 'exact' as const,
  },
});

describe('PrepareRun', () => {
  it('normalizes one snapshot and overwrites deterministic student, exclusion, candidate, and required records', async () => {
    const send = vi.fn().mockResolvedValue({});
    const getDetail = vi.fn().mockResolvedValue(detail);
    const resolve = vi.fn(({ courseCode }: { courseCode: string }) => Promise.resolve(resolved(courseCode)));
    const get = vi.fn(({ courseCode }: { courseCode: string }) => Promise.resolve(
      courseCode === 'HIST 1' || courseCode === 'MATH 999'
        ? undefined
        : { courseCode, title: `${courseCode} title`, description: 'Complete content' },
    ));
    const workStore = new WorkStore({ send } as never, 'work');
    const prepare = new PrepareRun({
      transcriptClient: { getDetail },
      getDegreeProgram: () => ({
        id: 'program', name: 'Program', requiredCourses: [
          { institution: 'Example University', academicYear: '2024', courseCode: 'CS 101' },
          { institution: 'Example University', academicYear: '2024', courseCode: 'MATH 999' },
        ],
      }),
      getCatalogDirectory: vi.fn().mockResolvedValue(directory),
      catalogKeyResolver: { resolve },
      catalogContentLookup: { get },
      workStore,
      now: () => new Date('2025-01-01T00:00:00.000Z'),
    });

    await expect(prepare.execute({ runId, transcriptId: 17, degreeProgramId: 'program' })).resolves.toEqual({
      runId, requiredCourseIds: ['EXAMPLE UNIVERSITY|2024|CS 101', 'EXAMPLE UNIVERSITY|2024|MATH 999'],
    });
    await prepare.execute({ runId, transcriptId: 17, degreeProgramId: 'program' });

    expect(getDetail).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenCalledTimes(8);
    expect(get).toHaveBeenCalledTimes(8);
    const items = send.mock.calls.map(([command]) => command.input.Item);
    const firstRun = items.slice(0, 6);
    expect(firstRun.map((item) => item.sk)).toEqual([
      'STUDENT', 'EXCLUDED_TAKEN#3', 'CANDIDATE#1', 'EXCLUDED_TAKEN#2',
      'REQUIRED#EXAMPLE UNIVERSITY|2024|CS 101', 'REQUIRED#EXAMPLE UNIVERSITY|2024|MATH 999',
    ]);
    expect(firstRun).toEqual(expect.arrayContaining([
      expect.objectContaining({ recordType: 'STUDENT', student: expect.objectContaining({ studentKey: 'transcript-processor:7', displayName: 'Student 7' }) }),
      expect.objectContaining({ recordType: 'CANDIDATE', sourceCourseId: 1, identifier: expect.objectContaining({ courseCode: 'CS 101' }) }),
      expect.objectContaining({ recordType: 'EXCLUDED_TAKEN', sourceCourseId: 2, reasonCode: 'CATALOG_COURSE_NOT_FOUND' }),
      expect.objectContaining({
        recordType: 'REQUIRED',
        requiredCourseId: 'EXAMPLE UNIVERSITY|2024|MATH 999',
        resolution: expect.objectContaining({ kind: 'unresolved', reasonCode: 'CATALOG_COURSE_NOT_FOUND' }),
        result: expect.objectContaining({
          matchingOutcome: 'unresolved',
          pairResults: [],
          requiredResolution: expect.objectContaining({ kind: 'unresolved', reasonCode: 'CATALOG_COURSE_NOT_FOUND' }),
        }),
      }),
    ]));
    expect(new Set(items.map((item) => item.sk)).size).toBe(6);
  });
});
