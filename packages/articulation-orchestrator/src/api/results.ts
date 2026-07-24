import { z } from 'zod';
import type { ArticulationResult, StudentDirectorySummary } from '../domain/articulation-result.js';
import type { OrchestrationRun } from '../domain/orchestration-run.js';
import type { ResultsStore } from '../store/results-store.js';

const PageRequestSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

type PublicError = { code: string; message: string };
type Page<T> = { items: T[]; cursor?: string };
type ResultResponse<T> = { statusCode: 200; body: T } | { statusCode: 400 | 404; body: PublicError };

export interface ResultApiDependencies {
  readonly results: Pick<ResultsStore, 'getDirectory' | 'listDirectories' | 'listStudentResults' | 'getLatest' | 'getByLocator'>;
  readonly runs: Pick<{ get(runId: string): Promise<OrchestrationRun | undefined> }, 'get'>;
}

/** Lists the directory partition in its stable student-key sort order. */
export async function listStudents(query: unknown, results: Pick<ResultsStore, 'listDirectories'>): Promise<ResultResponse<Page<StudentDirectorySummary>>> {
  const page = parsePage(query);
  if (!page) return invalidPage();
  try {
    return { statusCode: 200, body: await results.listDirectories(page) };
  } catch {
    return invalidPage();
  }
}

/** Lists one known student's immutable results newest first through the byStudent index. */
export async function listStudentResults(studentKey: string, query: unknown, results: Pick<ResultsStore, 'getDirectory' | 'listStudentResults'>): Promise<ResultResponse<Page<ArticulationResult>>> {
  const page = parsePage(query);
  if (!page) return invalidPage();
  if (!await results.getDirectory(studentKey)) return notFound('STUDENT_NOT_FOUND', 'Student was not found.');
  try {
    return { statusCode: 200, body: await results.listStudentResults(studentKey, page) };
  } catch {
    return invalidPage();
  }
}

/** Retrieves the newest result for a transcript/program pair. */
export async function getLatestResult(transcriptId: string, degreeProgramId: string, results: Pick<ResultsStore, 'getLatest'>): Promise<ResultResponse<ArticulationResult>> {
  const numericTranscriptId = Number(transcriptId);
  if (!Number.isInteger(numericTranscriptId) || numericTranscriptId <= 0 || !degreeProgramId.trim()) {
    return { statusCode: 400, body: { code: 'INVALID_RESULT_LOCATOR', message: 'Result locator is invalid.' } };
  }
  const result = await results.getLatest(numericTranscriptId, degreeProgramId);
  return result ? { statusCode: 200, body: result } : notFound('RESULT_NOT_FOUND', 'Result was not found.');
}

/** Retrieves exactly the result locator committed when a run completed. */
export async function getRunResult(runId: string, dependencies: Pick<ResultApiDependencies, 'runs' | 'results'>): Promise<ResultResponse<ArticulationResult>> {
  const run = await dependencies.runs.get(runId);
  if (!run?.resultLocator) return notFound('RUN_RESULT_NOT_FOUND', 'Run result was not found.');
  const result = await dependencies.results.getByLocator(run.resultLocator);
  return result ? { statusCode: 200, body: result } : notFound('RUN_RESULT_NOT_FOUND', 'Run result was not found.');
}

function parsePage(query: unknown): { cursor?: string; limit: number } | undefined {
  const parsed = PageRequestSchema.safeParse(query ?? {});
  return parsed.success ? parsed.data : undefined;
}

function invalidPage(): ResultResponse<never> {
  return { statusCode: 400, body: { code: 'INVALID_PAGE_REQUEST', message: 'Pagination request is invalid.' } };
}

function notFound(code: string, message: string): ResultResponse<never> {
  return { statusCode: 404, body: { code, message } };
}
