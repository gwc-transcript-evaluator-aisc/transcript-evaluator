import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { InvokeDataAutomationAsyncCommand } from '@aws-sdk/client-bedrock-data-automation-runtime';
import { bda, s3 } from '../aws/clients.js';
import { config, requireConfig } from '../config.js';
import { splitPdfIntoPages } from '../domain/pdf.js';
import type { JobPage } from '../domain/course.js';
import { putCatalogMetadata } from '../jobs/catalog-store.js';
import { json, pathJobId } from './http.js';
import { getJob, updateJob } from '../jobs/store.js';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const jobId = pathJobId(event);
  if (!jobId) return json(400, { error: 'jobId is required' });
  requireConfig(['INPUT_BUCKET_NAME', config.inputBucket], ['OUTPUT_BUCKET_NAME', config.outputBucket], ['BDA_PROJECT_ARN', config.projectArn], ['BDA_PROFILE_ARN', config.profileArn]);
  const job = await getJob(jobId);
  if (!job) return json(404, { error: 'Job not found' });
  if (job.status !== 'UPLOADING') return json(200, { jobId, status: job.status });

  let pdfBytes: Uint8Array;
  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: config.inputBucket, Key: job.inputKey }));
    const buffer = await object.Body?.transformToByteArray();
    if (!buffer) throw new Error('empty');
    pdfBytes = buffer;
  } catch {
    return json(409, { error: 'Upload the PDF before completing the job' });
  }

  const pages = await splitPdfIntoPages(pdfBytes);
  if (pages.length === 0) return json(400, { error: 'The uploaded PDF has no pages' });

  // Fan out one BDA invocation per page, in bounded-concurrency batches, so large catalogs
  // (hundreds of pages) don't invoke BDA fully sequentially within the Lambda's timeout.
  const CONCURRENCY = 10;
  const invokePage = async (index: number): Promise<JobPage> => {
    const pageNumber = index + 1;
    const pageKey = `pages/${jobId}/page-${pageNumber}.pdf`;
    await s3.send(new PutObjectCommand({ Bucket: config.inputBucket, Key: pageKey, Body: pages[index], ContentType: 'application/pdf', ServerSideEncryption: 'AES256' }));
    const outputUri = `s3://${config.outputBucket}/bda/${jobId}/page-${pageNumber}/`;
    const response = await bda.send(new InvokeDataAutomationAsyncCommand({
      inputConfiguration: { s3Uri: `s3://${config.inputBucket}/${pageKey}` },
      outputConfiguration: { s3Uri: outputUri },
      dataAutomationConfiguration: { dataAutomationProjectArn: config.projectArn, stage: 'LIVE' },
      dataAutomationProfileArn: config.profileArn,
    }));
    if (!response.invocationArn) throw new Error(`BDA did not return an invocation ARN for page ${pageNumber}`);
    return { pageNumber, invocationArn: response.invocationArn, status: 'PROCESSING' };
  };

  const jobPages: JobPage[] = [];
  for (let start = 0; start < pages.length; start += CONCURRENCY) {
    const batchIndexes = Array.from({ length: Math.min(CONCURRENCY, pages.length - start) }, (_, offset) => start + offset);
    const batchResults = await Promise.all(batchIndexes.map(invokePage));
    jobPages.push(...batchResults);
  }

  await updateJob(jobId, 'PROCESSING', { pages: jobPages, totalPages: pages.length });

  // If the caller pinned a catalogId up front (see create-job.ts), reflect PROCESSING on
  // the catalog's METADATA item immediately, so a concurrent existence check sees "in
  // progress" instead of a 404 while extraction is running.
  if (job.catalogId) {
    await putCatalogMetadata({ catalogId: job.catalogId, status: 'PROCESSING', jobId });
  }

  return json(202, { jobId, status: 'PROCESSING', catalogId: job.catalogId, totalPages: pages.length });
};
