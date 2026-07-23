import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { StartExecutionCommand } from '@aws-sdk/client-sfn';
import { s3, sfn } from '../aws/clients.js';
import { config, requireConfig } from '../config.js';
import { putCatalogMetadata } from '../jobs/catalog-store.js';
import { json, pathJobId } from './http.js';
import { getJob, updateJob } from '../jobs/store.js';

/** Starts the catalog-extraction state machine (split -> per-page BDA invocation ->
 * finalize). All the actual work -- PDF splitting, BDA invocation, waiting for BDA's
 * EventBridge completion events, merging results -- happens inside the state machine's
 * own task Lambdas (src/tasks/*), not here. This handler's only job is to kick that off
 * and hand back immediately; nothing in this pipeline polls. */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const jobId = pathJobId(event);
  if (!jobId) return json(400, { error: 'jobId is required' });
  requireConfig(['INPUT_BUCKET_NAME', config.inputBucket], ['STATE_MACHINE_ARN', config.stateMachineArn]);
  const job = await getJob(jobId);
  if (!job) return json(404, { error: 'Job not found' });
  if (job.status !== 'UPLOADING') return json(200, { jobId, status: job.status });

  try {
    await s3.send(new HeadObjectCommand({ Bucket: config.inputBucket, Key: job.inputKey }));
  } catch {
    return json(409, { error: 'Upload the PDF before completing the job' });
  }

  const execution = await sfn.send(new StartExecutionCommand({
    stateMachineArn: config.stateMachineArn,
    name: jobId,
    input: JSON.stringify({ jobId, inputKey: job.inputKey, catalogId: job.catalogId }),
  }));
  if (!execution.executionArn) return json(502, { error: 'Failed to start extraction' });

  await updateJob(jobId, 'PROCESSING', { executionArn: execution.executionArn });

  // If the caller pinned a catalogId up front, reflect PROCESSING on the catalog's
  // METADATA item immediately, so a concurrent existence check sees "in progress"
  // instead of a 404 while extraction is running.
  if (job.catalogId) {
    await putCatalogMetadata({ catalogId: job.catalogId, status: 'PROCESSING', jobId });
  }

  return json(202, { jobId, status: 'PROCESSING', catalogId: job.catalogId });
};
