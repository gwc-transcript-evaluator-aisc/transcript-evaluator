import { getConfig } from "@/lib/runtimeConfig";

export type TranscriptProcessingStatus = "pending" | "submitted" | "processing" | "completed" | "failed" | string;

export interface UploadedTranscriptDto {
  transcript_id: number;
  filename: string;
  status: TranscriptProcessingStatus;
  status_url: string;
}

export interface TranscriptStatusDto {
  transcript_id: number;
  filename: string;
  status: TranscriptProcessingStatus;
  error_message: string | null;
}

export class TranscriptApiError extends Error {
  public constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "TranscriptApiError";
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  try {
    const baseUrl = getConfig().transcriptApiBaseUrl;
    // No credentials: the transcript API is unauthenticated and its CORS uses a wildcard
    // origin. Browsers block wildcard-origin responses for credentialed requests, so
    // sending credentials here makes every call fail with a network error.
    const response = await fetch(`${baseUrl}${path}`, init);
    const body = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : "The transcript request could not be completed.";
      throw new TranscriptApiError(message, response.status);
    }
    return body as T;
  } catch (error) {
    if (error instanceof TranscriptApiError || error instanceof DOMException) throw error;
    throw new TranscriptApiError("Unable to reach the transcript service.");
  }
}

export const transcriptApi = {
  uploadTranscript(file: File, signal?: AbortSignal) {
    const body = new FormData();
    body.append("pdf_file", file);
    return request<UploadedTranscriptDto>("/upload", { method: "POST", body, signal });
  },

  getStatus(transcriptId: number, signal?: AbortSignal) {
    return request<TranscriptStatusDto>(`/status/${encodeURIComponent(String(transcriptId))}`, { signal });
  },
};
