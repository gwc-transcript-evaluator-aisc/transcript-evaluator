import { afterEach, describe, expect, it, vi } from 'vitest';
import { bedrock } from '../src/aws/clients.js';
import { assessArticulation } from '../src/ai/articulation-assessor.js';
import type { CourseRecord } from '../src/domain/course-record.js';

const homeCourse: CourseRecord = {
  catalogId: 'home#2025-2026',
  sk: 'COURSE#ACCT 101',
  courseCode: 'ACCT 101',
  courseTitle: 'Intro Accounting',
  credits: 5,
  updatedAt: '2025-01-01T00:00:00.000Z',
};
const transferCourse: CourseRecord = {
  catalogId: 'transfer#2024-2025',
  sk: 'COURSE#ACC 100',
  courseCode: 'ACC 100',
  courseTitle: 'Financial Accounting',
  credits: 5,
  updatedAt: '2025-01-01T00:00:00.000Z',
};

describe('assessArticulation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses the forced tool call into a validated ArticulationAssessment', async () => {
    vi.spyOn(bedrock, 'send').mockResolvedValue({
      stopReason: 'tool_use',
      output: {
        message: {
          content: [
            {
              toolUse: {
                name: 'submit_articulation_assessment',
                input: {
                  decision: 'EQUIVALENT',
                  confidence: 'HIGH',
                  rationale: 'Both cover introductory financial accounting at 5 credits.',
                  creditHoursComparable: true,
                },
              },
            },
          ],
        },
      },
    } as never);

    const result = await assessArticulation({ homeCourse, transferCourse });
    expect(result.decision).toBe('EQUIVALENT');
    expect(result.confidence).toBe('HIGH');
  });

  it('throws if the model does not return the expected tool call', async () => {
    vi.spyOn(bedrock, 'send').mockResolvedValue({ stopReason: 'end_turn', output: { message: { content: [{ text: 'no tool call' }] } } } as never);
    await expect(assessArticulation({ homeCourse, transferCourse })).rejects.toThrow(/did not return/);
  });
});
