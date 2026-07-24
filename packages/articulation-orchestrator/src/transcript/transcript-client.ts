import { z } from 'zod';
import {
  TranscriptDetailDtoSchema,
  TranscriptStatusDtoSchema,
  type TranscriptDetailDto,
  type TranscriptStatusDto,
} from '../domain/transcript.js';

const ProcessorStatusSchema = z.enum(['pending', 'submitted', 'processing', 'completed', 'failed']);

const StatusResponseSchema = z.object({
  transcript_id: z.number().int().positive(),
  status: ProcessorStatusSchema,
}).passthrough();

const DetailCourseSchema = z.object({
  id: z.number().int().positive(),
  course_code: z.string().nullable(),
  course_name: z.string().nullable(),
  department: z.string().nullable(),
  term_year: z.union([z.string(), z.number()]).nullable(),
  year: z.union([z.string(), z.number()]).nullable(),
  credits: z.number().nullable(),
}).passthrough();

const DetailStudentSchema = z.object({
  id: z.number().int().positive(),
  student_id: z.string().nullable(),
  full_name: z.string().nullable(),
  institution: z.string().nullable(),
  courses: z.array(DetailCourseSchema),
}).passthrough();

const DetailResponseSchema = z.object({
  transcript_id: z.number().int().positive(),
  status: ProcessorStatusSchema,
  student: DetailStudentSchema.nullable().optional(),
}).passthrough();

export type TranscriptApiErrorCode =
  | 'TRANSCRIPT_API_NOT_FOUND'
  | 'TRANSCRIPT_API_UNAUTHORIZED'
  | 'TRANSCRIPT_API_REQUEST_FAILED'
  | 'TRANSCRIPT_API_UNAVAILABLE'
  | 'TRANSCRIPT_API_INVALID_RESPONSE';

/** A safe boundary error: it intentionally excludes downstream response bodies and URLs. */
export class TranscriptApiError extends Error {
  public constructor(
    public readonly code: TranscriptApiErrorCode,
    public readonly status?: number,
  ) {
    super(publicMessageFor(code));
    this.name = 'TranscriptApiError';
  }
}

export interface TranscriptClientOptions {
  baseUrl: string;
  authToken?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** Typed HTTP-only client for the Transcript Processor; it never accesses its database. */
export class TranscriptClient {
  private readonly baseUrl: string;
  private readonly authToken?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;

  public constructor(options: TranscriptClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.authToken = options.authToken;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  public async getStatus(transcriptId: number): Promise<TranscriptStatusDto> {
    try {
      const raw = StatusResponseSchema.parse(await this.get(`/status/${requireTranscriptId(transcriptId)}`));
      return TranscriptStatusDtoSchema.parse({ id: raw.transcript_id, status: raw.status });
    } catch (error) {
      throw normalizedValidationError(error);
    }
  }

  public async getDetail(transcriptId: number): Promise<TranscriptDetailDto> {
    try {
      const raw = DetailResponseSchema.parse(await this.get(`/transcript/${requireTranscriptId(transcriptId)}`));
      return TranscriptDetailDtoSchema.parse({
        id: raw.transcript_id,
        status: raw.status,
        student: raw.student === undefined || raw.student === null ? null : {
          id: raw.student.id,
          student_id: raw.student.student_id,
          full_name: raw.student.full_name,
          institution: raw.student.institution,
          courses: raw.student.courses.map((course) => ({
            id: course.id,
            course_code: course.course_code,
            course_name: course.course_name,
            department: course.department,
            term_year: course.term_year,
            year: course.year,
            credits: course.credits,
          })),
        },
      });
    } catch (error) {
      throw normalizedValidationError(error);
    }
  }

  private async get(path: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.authToken) headers.authorization = `Bearer ${this.authToken}`;

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, { method: 'GET', headers, signal: controller.signal });
      if (!response.ok) throw new TranscriptApiError(errorCodeForStatus(response.status), response.status);
      try {
        return await response.json();
      } catch {
        throw new TranscriptApiError('TRANSCRIPT_API_INVALID_RESPONSE');
      }
    } catch (error) {
      if (error instanceof TranscriptApiError) throw error;
      if (error instanceof z.ZodError) throw new TranscriptApiError('TRANSCRIPT_API_INVALID_RESPONSE');
      throw new TranscriptApiError('TRANSCRIPT_API_UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
    }
  }
}

function requireTranscriptId(transcriptId: number): number {
  if (!Number.isSafeInteger(transcriptId) || transcriptId <= 0) {
    throw new TranscriptApiError('TRANSCRIPT_API_REQUEST_FAILED');
  }
  return transcriptId;
}

function normalizedValidationError(error: unknown): TranscriptApiError {
  return error instanceof TranscriptApiError
    ? error
    : new TranscriptApiError('TRANSCRIPT_API_INVALID_RESPONSE');
}

function errorCodeForStatus(status: number): TranscriptApiErrorCode {
  if (status === 404) return 'TRANSCRIPT_API_NOT_FOUND';
  if (status === 401 || status === 403) return 'TRANSCRIPT_API_UNAUTHORIZED';
  return 'TRANSCRIPT_API_REQUEST_FAILED';
}

function publicMessageFor(code: TranscriptApiErrorCode): string {
  switch (code) {
    case 'TRANSCRIPT_API_NOT_FOUND': return 'Transcript was not found.';
    case 'TRANSCRIPT_API_UNAUTHORIZED': return 'Transcript access was denied.';
    case 'TRANSCRIPT_API_INVALID_RESPONSE': return 'Transcript data could not be validated.';
    case 'TRANSCRIPT_API_UNAVAILABLE': return 'Transcript service is unavailable.';
    case 'TRANSCRIPT_API_REQUEST_FAILED': return 'Transcript request could not be completed.';
  }
}
