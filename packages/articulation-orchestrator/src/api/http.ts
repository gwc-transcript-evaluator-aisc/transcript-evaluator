import { ZodError } from 'zod';

export interface PublicErrorEnvelope {
  readonly code: string;
  readonly message: string;
  readonly correlationId?: string;
}

export interface ApiResponse<T = unknown> {
  readonly statusCode: number;
  readonly body: T;
}

/** An error whose stable public code and status are intentional API contract. */
export class PublicHttpError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PublicHttpError';
  }
}

export function publicError(statusCode: number, code: string, message: string): ApiResponse<PublicErrorEnvelope> {
  return { statusCode, body: { code, message } };
}

/**
 * Converts expected and unexpected failures into the only public error envelope.
 * Error details deliberately stay out of the response body.
 */
export function toPublicError(error: unknown, correlationId: string): ApiResponse<PublicErrorEnvelope> {
  if (error instanceof PublicHttpError) {
    return { statusCode: error.statusCode, body: { code: error.code, message: error.message, correlationId } };
  }
  if (error instanceof ZodError) {
    return { statusCode: 400, body: { code: 'INVALID_REQUEST', message: 'Request is invalid.', correlationId } };
  }
  return { statusCode: 500, body: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', correlationId } };
}

export function attachCorrelationId<T>(response: ApiResponse<T>, correlationId: string): ApiResponse<T | PublicErrorEnvelope> {
  if (!isPublicErrorEnvelope(response.body)) return response;
  return { ...response, body: { ...response.body, correlationId } };
}

/** Logs only correlation-safe error metadata; request bodies and downstream messages are never logged. */
export function logServerFailure(error: unknown, correlationId: string, route: string, method: string): void {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : 'UnknownError';
  console.error('Articulation Orchestrator request failed', { correlationId, route, method, errorName: name });
}

function isPublicErrorEnvelope(value: unknown): value is PublicErrorEnvelope {
  return typeof value === 'object' && value !== null && 'code' in value && 'message' in value
    && typeof value.code === 'string' && typeof value.message === 'string';
}
