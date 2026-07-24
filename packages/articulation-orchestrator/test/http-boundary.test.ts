import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { requireApiKey } from '../src/api/auth.js';
import { PublicHttpError, attachCorrelationId, logServerFailure, publicError, toPublicError } from '../src/api/http.js';

function event(apiKey?: string): APIGatewayProxyEventV2 {
  return {
    version: '2.0', routeKey: '$default', rawPath: '/students', rawQueryString: '', headers: apiKey ? { 'x-api-key': apiKey } : {},
    requestContext: { accountId: 'account', apiId: 'api', domainName: 'example.test', domainPrefix: 'example', http: { method: 'GET', path: '/students', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' }, requestId: 'request', routeKey: '$default', stage: '$default', time: '', timeEpoch: 0 },
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

describe('shared HTTP boundary', () => {
  it('returns only stable safe details and a correlation id for unexpected failures', () => {
    const response = toPublicError(new Error('AWS arn:aws:lambda:secret prompt and downstream payload'), 'correlation-1');
    expect(response).toEqual({ statusCode: 500, body: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', correlationId: 'correlation-1' } });
    expect(JSON.stringify(response)).not.toContain('arn:aws');

    expect(toPublicError(new PublicHttpError(403, 'FORBIDDEN', 'Access is denied.'), 'correlation-2')).toEqual({
      statusCode: 403, body: { code: 'FORBIDDEN', message: 'Access is denied.', correlationId: 'correlation-2' },
    });
    expect(attachCorrelationId(publicError(404, 'RESOURCE_NOT_FOUND', 'Resource was not found.'), 'correlation-3').body).toMatchObject({ correlationId: 'correlation-3' });
  });

  it('logs correlation-safe failure metadata without raw error details', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logServerFailure(new Error('sensitive prompt'), 'correlation-4', '/runs', 'POST');
    expect(error).toHaveBeenCalledWith('Articulation Orchestrator request failed', expect.objectContaining({ correlationId: 'correlation-4', errorName: 'Error' }));
    expect(JSON.stringify(error.mock.calls)).not.toContain('sensitive prompt');
    error.mockRestore();
  });
});

describe('prototype API-key authorization', () => {
  const secretReader = { read: vi.fn(async () => 'prototype-key') };

  it('accepts only the configured x-api-key for non-local requests', async () => {
    await expect(requireApiKey(event('prototype-key'), false, 'secret-arn', secretReader)).resolves.toBeUndefined();
    await expect(requireApiKey(event('wrong-key'), false, 'secret-arn', secretReader)).rejects.toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Unauthorized.' });
    await expect(requireApiKey(event(), false, 'secret-arn', secretReader)).rejects.toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Unauthorized.' });
  });

  it('bypasses secret reads only for explicitly local requests', async () => {
    const localReader = { read: vi.fn(async () => undefined) };
    await expect(requireApiKey(event(), true, 'secret-arn', localReader)).resolves.toBeUndefined();
    expect(localReader.read).not.toHaveBeenCalled();
  });
});
