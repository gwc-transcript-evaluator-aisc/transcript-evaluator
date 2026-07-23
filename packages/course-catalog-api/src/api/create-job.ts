import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3 } from '../aws/clients.js';
import { config, requireConfig } from '../config.js';
import { makeCatalogId } from '../domain/course.js';
import { json } from './http.js';
import { createJob } from '../jobs/store.js';

/** Creating a job optionally accepts { institution, academicYear } when the caller
 * already knows which school/year they're triggering extraction for -- e.g. the
 * existence-check flow (catalog-status.ts) found no METADATA item and now needs to
 * kick off parsing for that exact key. Pinning catalogId up front means the final
 * result lands under the key the caller asked for, rather than solely whatever
 * institution/year BDA happens to extract from the document. */
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  requireConfig(['INPUT_BUCKET_NAME', config.inputBucket], ['JOBS_TABLE_NAME', config.jobsTable]);
  const body = event.body ? JSON.parse(event.body) as { institution?: string; academicYear?: string } : {};
  const catalogId = body.institution && body.academicYear ? makeCatalogId(body.institution, body.academicYear) : undefined;

  const jobId = randomUUID();
  const inputKey = `inputs/${jobId}/catalog.pdf`;
  const now = new Date().toISOString();
  const uploadUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: config.inputBucket, Key: inputKey, ContentType: 'application/pdf' }), { expiresIn: config.uploadUrlTtlSeconds });
  await createJob({ jobId, inputKey, status: 'UPLOADING', createdAt: now, updatedAt: now, catalogId });
  return json(201, { jobId, status: 'UPLOADING', catalogId, uploadUrl, expiresInSeconds: config.uploadUrlTtlSeconds, maxUploadBytes: config.maxUploadBytes });
};
