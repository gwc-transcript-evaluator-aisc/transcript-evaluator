import type { APIGatewayProxyResultV2 } from 'aws-lambda';

export function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function pathJobId(event: { pathParameters?: Record<string, string | undefined> }): string | undefined {
  return event.pathParameters?.jobId;
}
