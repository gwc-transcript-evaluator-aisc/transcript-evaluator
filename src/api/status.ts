import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DescribeExecutionCommand } from '@aws-sdk/client-sfn';
import { sfn } from '../aws/clients.js';
import { json, pathJobId } from './http.js';
import { getJob } from '../jobs/store.js';

/** Thin read: the actual extraction pipeline is entirely event-driven (Step Functions +
 * BDA's EventBridge completion events, see the state machine in the CDK stack and
 * src/tasks/*), so this handler never polls BDA itself. It only reads whichever status
 * is cheapest to get: the Jobs table for a terminal job, or the Step Functions
 * execution's own status while a job is still in flight. */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const jobId = pathJobId(event);
  if (!jobId) return json(400, { error: 'jobId is required' });
  const job = await getJob(jobId);
  if (!job) return json(404, { error: 'Job not found' });

  if (job.status === 'PROCESSING' && job.executionArn) {
    const execution = await sfn.send(new DescribeExecutionCommand({ executionArn: job.executionArn }));
    if (execution.status === 'RUNNING') {
      return json(200, { jobId, status: 'PROCESSING', catalogId: job.catalogId });
    }
    if (execution.status === 'SUCCEEDED') {
      // finalize-catalog-task.ts already wrote the terminal job status (SUCCEEDED or
      // FAILED, depending on whether any courses were extracted) before the execution
      // itself completes, so re-read the job record for the definitive result.
      const finalJob = await getJob(jobId);
      return json(200, {
        jobId,
        status: finalJob?.status ?? 'SUCCEEDED',
        catalogId: finalJob?.catalogId ?? job.catalogId,
        courseCount: finalJob?.courseCount,
        errorMessage: finalJob?.errorMessage,
      });
    }
    // ABORTED / TIMED_OUT / FAILED at the state machine level (distinct from a page-level
    // failure, which the Map's Catch already absorbs) -- something broke outside the
    // per-page error handling, e.g. SplitPdf itself threw.
    return json(200, { jobId, status: 'FAILED', catalogId: job.catalogId, errorMessage: execution.cause || execution.error || `Extraction ${execution.status?.toLowerCase()}` });
  }

  return json(200, {
    jobId,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    catalogId: job.catalogId,
    courseCount: job.courseCount,
    errorMessage: job.errorMessage,
  });
};
