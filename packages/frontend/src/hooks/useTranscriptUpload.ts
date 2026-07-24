import { useCallback, useEffect, useRef, useState } from "react";
import { TranscriptApiError, transcriptApi, type UploadedTranscriptDto } from "@/lib/api/transcriptApi";

export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function useTranscriptUpload() {
  const [upload, setUpload] = useState<UploadedTranscriptDto | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => () => activeRequest.current?.abort(), []);

  const submit = useCallback(async (file: File) => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setUploading(true);
    setError(null);
    setUpload(null);
    try {
      const response = await transcriptApi.uploadTranscript(file, controller.signal);
      if (!controller.signal.aborted) setUpload(response);
      return response;
    } catch (cause) {
      if (!controller.signal.aborted) {
        setUpload(null);
        setError(cause instanceof TranscriptApiError ? cause.message : "The transcript upload failed.");
      }
      throw cause;
    } finally {
      if (!controller.signal.aborted) setUploading(false);
    }
  }, []);

  const reset = useCallback(() => {
    activeRequest.current?.abort();
    setUpload(null);
    setUploading(false);
    setError(null);
  }, []);

  return { upload, uploading, error, submit, reset };
}
