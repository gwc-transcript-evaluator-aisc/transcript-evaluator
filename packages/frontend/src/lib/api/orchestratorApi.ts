import type {
  ArticulationResultDto,
  CreateOrchestrationRunRequest,
  DegreeProgramDto,
  OrchestrationRunDto,
  PageDto,
  PublicErrorDto,
  StudentDirectorySummaryDto,
} from "./orchestratorTypes";

import { getConfig } from "@/lib/runtimeConfig";

export class OrchestratorApiError extends Error {
  public constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
    public readonly correlationId?: string,
  ) {
    super(message);
    this.name = "OrchestratorApiError";
  }
}

export interface OrchestratorRequestOptions {
  signal?: AbortSignal;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    const { orchestratorApiBaseUrl: baseUrl, orchestratorApiKey: apiKey } = getConfig();
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body !== undefined) headers.set("content-type", "application/json");
    if (apiKey) headers.set("x-api-key", apiKey);

    const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
    const body = await readJson(response);
    if (!response.ok) {
      const error = isPublicError(body) ? body : undefined;
      throw new OrchestratorApiError(
        error?.message ?? "The request could not be completed.",
        response.status,
        error?.code,
        error?.correlationId ?? response.headers.get("x-correlation-id") ?? undefined,
      );
    }
    return body as T;
  } catch (error) {
    if (error instanceof OrchestratorApiError || error instanceof DOMException) throw error;
    throw new OrchestratorApiError("Unable to reach the articulation service.");
  }
}

function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => undefined);
}

function isPublicError(value: unknown): value is PublicErrorDto {
  return typeof value === "object" && value !== null
    && "code" in value && typeof value.code === "string"
    && "message" in value && typeof value.message === "string";
}

function pageQuery(cursor?: string, limit?: number): string {
  const query = new URLSearchParams();
  if (cursor) query.set("cursor", cursor);
  if (limit !== undefined) query.set("limit", String(limit));
  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}

export const orchestratorApi = {
  createRun(requestBody: CreateOrchestrationRunRequest, options: OrchestratorRequestOptions = {}) {
    return request<OrchestrationRunDto>("/runs", { method: "POST", body: JSON.stringify(requestBody), signal: options.signal });
  },
  getRunStatus(runId: string, options: OrchestratorRequestOptions = {}) { return request<OrchestrationRunDto>(`/runs/${encodeURIComponent(runId)}`, { signal: options.signal }); },
  getRunResult(runId: string, options: OrchestratorRequestOptions = {}) { return request<ArticulationResultDto>(`/runs/${encodeURIComponent(runId)}/result`, { signal: options.signal }); },
  listDegreePrograms(options: OrchestratorRequestOptions = {}) { return request<DegreeProgramDto[]>("/degree-programs", { signal: options.signal }); },
  getDegreeProgram(programId: string, options: OrchestratorRequestOptions = {}) { return request<DegreeProgramDto>(`/degree-programs/${encodeURIComponent(programId)}`, { signal: options.signal }); },
  listStudents(cursor?: string, limit?: number, options: OrchestratorRequestOptions = {}) { return request<PageDto<StudentDirectorySummaryDto>>(`/students${pageQuery(cursor, limit)}`, { signal: options.signal }); },
  listStudentResults(studentKey: string, cursor?: string, limit?: number, options: OrchestratorRequestOptions = {}) { return request<PageDto<ArticulationResultDto>>(`/students/${encodeURIComponent(studentKey)}/results${pageQuery(cursor, limit)}`, { signal: options.signal }); },
  getLatestResult(transcriptId: number, degreeProgramId: string, options: OrchestratorRequestOptions = {}) { return request<ArticulationResultDto>(`/results/${encodeURIComponent(String(transcriptId))}/${encodeURIComponent(degreeProgramId)}`, { signal: options.signal }); },
};
