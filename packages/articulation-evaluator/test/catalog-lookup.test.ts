import { afterEach, describe, expect, it, vi } from 'vitest';
import { dynamo } from '../src/aws/clients.js';
import { lookupCourse } from '../src/store/catalog-lookup.js';

describe('lookupCourse', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds the catalogId/sk key and returns a validated course record when found', async () => {
    const sendMock = vi.spyOn(dynamo, 'send').mockResolvedValue({
      Item: {
        catalogId: 'example-college#2025-2026',
        sk: 'COURSE#ACCT 101',
        courseCode: 'ACCT 101',
        courseTitle: 'Intro Accounting',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    } as never);

    const result = await lookupCourse({ institution: 'Example College', academicYear: '2025-2026', courseCode: 'acct 101' });

    expect(result?.courseCode).toBe('ACCT 101');
    const sentCommand = sendMock.mock.calls[0][0] as unknown as { input: { Key: { catalogId: string; sk: string } } };
    expect(sentCommand.input.Key).toEqual({ catalogId: 'example-college#2025-2026', sk: 'COURSE#ACCT 101' });
  });

  it('returns undefined when the course is not found', async () => {
    vi.spyOn(dynamo, 'send').mockResolvedValue({} as never);
    const result = await lookupCourse({ institution: 'Example College', academicYear: '2025-2026', courseCode: 'ACCT 999' });
    expect(result).toBeUndefined();
  });
});
