import { afterEach, describe, expect, it, vi } from 'vitest';
import { s3 } from '../src/aws/clients.js';
import { handler } from '../src/tasks/finalize-catalog-task.js';

vi.mock('../src/jobs/catalog-store.js', () => ({
  putCatalogMetadata: vi.fn(),
  putCourses: vi.fn(),
}));
vi.mock('../src/jobs/store.js', () => ({
  updateJob: vi.fn(),
}));

function s3Body(payload: unknown): { Body: { transformToString: () => Promise<string> } } {
  return { Body: { transformToString: async () => JSON.stringify(payload) } };
}

describe('finalize-catalog-task handler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads a DistributedMap manifest.json (ResultFiles pointer format, not JSON Lines) and merges its courses', async () => {
    const pageOutput = JSON.stringify({
      jobId: 'job-1',
      pageNumber: 1,
      institution: 'Example College',
      courses: [{ courseCode: 'ACCT 101', courseTitle: 'Intro Accounting', description: 'Basics.', sourcePages: [1] }],
    });

    const sendMock = vi.spyOn(s3, 'send').mockImplementation(async (command: unknown) => {
      const input = (command as { input: { Bucket: string; Key: string } }).input;
      if (input.Key === 'manifest.json') {
        return s3Body({
          DestinationBucket: 'results-bucket',
          ResultFiles: { SUCCEEDED: [{ Key: 'succeeded-0.json', Size: 1 }] },
        });
      }
      if (input.Key === 'succeeded-0.json') {
        return s3Body([{ Output: pageOutput }]);
      }
      throw new Error(`Unexpected S3 GetObject for key ${input.Key}`);
    });

    const result = await handler({
      jobId: 'job-1',
      pageResults: { ResultWriterDetails: { Bucket: 'input-bucket', Key: 'manifest.json' } },
    });

    expect(result.status).toBe('SUCCEEDED');
    expect(result.courseCount).toBe(1);
    sendMock.mockRestore();
  });

  it('treats FAILED/PENDING manifest entries as failed pages without throwing', async () => {
    const sendMock = vi.spyOn(s3, 'send').mockImplementation(async (command: unknown) => {
      const input = (command as { input: { Bucket: string; Key: string } }).input;
      if (input.Key === 'manifest.json') {
        return s3Body({
          DestinationBucket: 'results-bucket',
          ResultFiles: { FAILED: [{ Key: 'failed-0.json', Size: 1 }] },
        });
      }
      if (input.Key === 'failed-0.json') {
        return s3Body([{ Error: 'States.TaskFailed', Cause: 'BDA error' }]);
      }
      throw new Error(`Unexpected S3 GetObject for key ${input.Key}`);
    });

    const result = await handler({
      jobId: 'job-2',
      pageResults: { ResultWriterDetails: { Bucket: 'input-bucket', Key: 'manifest.json' } },
    });

    expect(result.status).toBe('FAILED');
    expect(result.courseCount).toBe(0);
    sendMock.mockRestore();
  });
});
