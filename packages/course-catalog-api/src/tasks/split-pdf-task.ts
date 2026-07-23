import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { s3 } from '../aws/clients.js';
import { config, requireConfig } from '../config.js';
import { splitPdfIntoPages } from '../domain/pdf.js';

export interface SplitPdfInput {
  jobId: string;
  inputKey: string;
}

export interface SplitPdfOutput {
  jobId: string;
  totalPages: number;
  pages: Array<{ pageNumber: number; pageKey: string }>;
}

/** Step Functions task: reads the uploaded catalog PDF, splits it into single-page PDFs,
 * and uploads each page back to S3. The page list this returns feeds the state
 * machine's Distributed Map, which fans out one BDA invocation per page. */
export const handler = async (input: SplitPdfInput): Promise<SplitPdfOutput> => {
  requireConfig(['INPUT_BUCKET_NAME', config.inputBucket]);
  const { jobId, inputKey } = input;

  const object = await s3.send(new GetObjectCommand({ Bucket: config.inputBucket, Key: inputKey }));
  const pdfBytes = await object.Body?.transformToByteArray();
  if (!pdfBytes) throw new Error('Uploaded PDF is empty or missing');

  const pages = await splitPdfIntoPages(pdfBytes);
  if (pages.length === 0) throw new Error('The uploaded PDF has no pages');

  const uploaded = await Promise.all(pages.map(async (bytes, index) => {
    const pageNumber = index + 1;
    const pageKey = `pages/${jobId}/page-${pageNumber}.pdf`;
    await s3.send(new PutObjectCommand({ Bucket: config.inputBucket, Key: pageKey, Body: bytes, ContentType: 'application/pdf', ServerSideEncryption: 'AES256' }));
    return { pageNumber, pageKey };
  }));

  return { jobId, totalPages: uploaded.length, pages: uploaded };
};
