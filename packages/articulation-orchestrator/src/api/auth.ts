import { timingSafeEqual } from 'node:crypto';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { PublicHttpError } from './http.js';

export interface ApiKeySecretReader {
  read(secretArn: string): Promise<string | undefined>;
}

/**
 * Enforces the prototype's shared API key. Local stacks deliberately bypass this
 * check so local development stays explicit and does not need AWS credentials.
 */
export async function requireApiKey(
  event: APIGatewayProxyEventV2,
  local: boolean,
  secretArn: string | undefined,
  secretReader: ApiKeySecretReader,
): Promise<void> {
  if (local) return;

  // A missing secret ARN means the auth backend is not configured; deny rather than
  // silently allow unauthenticated access.
  if (!secretArn) throw new PublicHttpError(401, 'UNAUTHORIZED', 'Unauthorized.');

  const suppliedKey = event.headers['x-api-key']?.trim();
  const expectedKey = await secretReader.read(secretArn);
  if (!suppliedKey || !expectedKey || !safeEqual(suppliedKey, expectedKey)) {
    throw new PublicHttpError(401, 'UNAUTHORIZED', 'Unauthorized.');
  }
}

/** Compares equal-length values without leaking matching-prefix timing. */
function safeEqual(supplied: string, expected: string): boolean {
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}
