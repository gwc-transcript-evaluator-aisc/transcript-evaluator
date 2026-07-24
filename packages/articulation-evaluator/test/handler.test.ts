import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/store/catalog-lookup.js', () => ({ lookupCourse: vi.fn() }));
vi.mock('../src/store/evaluations-store.js', () => ({ putEvaluation: vi.fn() }));
vi.mock('../src/ai/articulation-assessor.js', () => ({ assessArticulation: vi.fn() }));

import { assessArticulation } from '../src/ai/articulation-assessor.js';
import { handler } from '../src/handler.js';
import { lookupCourse } from '../src/store/catalog-lookup.js';
import { putEvaluation } from '../src/store/evaluations-store.js';
import type { CourseRecord } from '../src/domain/course-record.js';

const request = {
  home: { institution: 'Home College', academicYear: '2025-2026', courseCode: 'ACCT 101' },
  transfer: { institution: 'Transfer College', academicYear: '2024-2025', courseCode: 'ACC 100' },
};
const homeCourse: CourseRecord = { catalogId: 'home-college#2025-2026', sk: 'COURSE#ACCT 101', courseCode: 'ACCT 101', updatedAt: '2025-01-01T00:00:00.000Z' };
const transferCourse: CourseRecord = { catalogId: 'transfer-college#2024-2025', sk: 'COURSE#ACC 100', courseCode: 'ACC 100', updatedAt: '2025-01-01T00:00:00.000Z' };

describe('handler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns NOT_FOUND without calling the AI when either course is missing', async () => {
    vi.mocked(lookupCourse).mockImplementation(async (id) => (id.institution === 'Home College' ? homeCourse : undefined));

    const result = await handler(request);

    expect(result.kind).toBe('NOT_FOUND');
    if (result.kind === 'NOT_FOUND') expect(result.missing).toBe('transfer');
    expect(assessArticulation).not.toHaveBeenCalled();
    expect(putEvaluation).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND with missing="both" when neither course resolves', async () => {
    vi.mocked(lookupCourse).mockResolvedValue(undefined);
    const result = await handler(request);
    expect(result.kind).toBe('NOT_FOUND');
    if (result.kind === 'NOT_FOUND') expect(result.missing).toBe('both');
  });

  it('evaluates and persists when both courses resolve', async () => {
    vi.mocked(lookupCourse).mockImplementation(async (id) => (id.institution === 'Home College' ? homeCourse : transferCourse));
    vi.mocked(assessArticulation).mockResolvedValue({ decision: 'PARTIAL', confidence: 'MEDIUM', rationale: 'Some overlap.', creditHoursComparable: true });
    vi.mocked(putEvaluation).mockResolvedValue({
      evaluationId: 'eval-1',
      pairKey: 'pair-key',
      home: request.home,
      transfer: request.transfer,
      homeCourse,
      transferCourse,
      assessment: { decision: 'PARTIAL', confidence: 'MEDIUM', rationale: 'Some overlap.', creditHoursComparable: true },
      modelId: 'us.anthropic.claude-sonnet-5',
      createdAt: '2025-01-01T00:00:00.000Z',
    });

    const result = await handler(request);

    expect(result.kind).toBe('EVALUATED');
    if (result.kind === 'EVALUATED') {
      expect(result.evaluation.evaluationId).toBe('eval-1');
      expect(result.evaluation.homeCourse).toEqual(homeCourse);
      expect(result.evaluation.transferCourse).toEqual(transferCourse);
    }
    expect(putEvaluation).toHaveBeenCalledWith(expect.objectContaining({ home: request.home, transfer: request.transfer, homeCourse, transferCourse }));
  });
});

describe('requireConfig', () => {
  it('throws listing every missing key when config values are empty', async () => {
    const { requireConfig } = await import('../src/config.js');
    expect(() => requireConfig(['CATALOG_TABLE_NAME', ''], ['EVALUATIONS_TABLE_NAME', ''])).toThrow(/CATALOG_TABLE_NAME, EVALUATIONS_TABLE_NAME/);
  });
});
