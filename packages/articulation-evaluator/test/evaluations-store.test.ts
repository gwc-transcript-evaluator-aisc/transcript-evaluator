import { afterEach, describe, expect, it, vi } from 'vitest';
import { dynamo } from '../src/aws/clients.js';
import { makePairKey, putEvaluation } from '../src/store/evaluations-store.js';
import type { CourseIdentifier } from '../src/domain/evaluation.js';
import type { CourseRecord } from '../src/domain/course-record.js';

const home: CourseIdentifier = { institution: 'Home College', academicYear: '2025-2026', courseCode: 'ACCT 101' };
const transfer: CourseIdentifier = { institution: 'Transfer College', academicYear: '2024-2025', courseCode: 'ACC& 101' };

const homeCourse: CourseRecord = { catalogId: 'home-college#2025-2026', sk: 'COURSE#ACCT 101', courseCode: 'ACCT 101', updatedAt: '2025-01-01T00:00:00.000Z' };
const transferCourse: CourseRecord = { catalogId: 'transfer-college#2024-2025', sk: 'COURSE#ACC& 101', courseCode: 'ACC& 101', updatedAt: '2025-01-01T00:00:00.000Z' };

describe('makePairKey', () => {
  it('combines both sides deterministic catalog keys', () => {
    expect(makePairKey(home, transfer)).toBe('home-college#2025-2026#COURSE#ACCT 101__transfer-college#2024-2025#COURSE#ACC& 101');
  });

  it('is stable across repeated calls for the same pair', () => {
    expect(makePairKey(home, transfer)).toBe(makePairKey(home, transfer));
  });
});

describe('putEvaluation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes an append-only record with a generated evaluationId and the pairKey', async () => {
    const sendMock = vi.spyOn(dynamo, 'send').mockResolvedValue({} as never);

    const record = await putEvaluation({
      home,
      transfer,
      homeCourse,
      transferCourse,
      assessment: { decision: 'EQUIVALENT', confidence: 'HIGH', rationale: 'Matches.', creditHoursComparable: true },
      modelId: 'us.anthropic.claude-sonnet-5',
    });

    expect(record.evaluationId).toBeTruthy();
    expect(record.pairKey).toBe(makePairKey(home, transfer));
    const sentCommand = sendMock.mock.calls[0][0] as unknown as { input: { Item: { evaluationId: string } } };
    expect(sentCommand.input.Item.evaluationId).toBe(record.evaluationId);
  });
});
