import { useEffect, useState } from "react";
import { TranscriptApiError, transcriptApi, type TranscriptStatusDto } from "@/lib/api/transcriptApi";

const POLL_INTERVAL_MS = 2_000;
const TERMINAL_STATUSES = new Set(["completed", "failed"]);

export function useTranscriptStatusPolling(transcriptId: number | null) {
  const [status, setStatus] = useState<TranscriptStatusDto | null>(null);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (transcriptId === null) {
      setStatus(null);
      setPolling(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setStatus(null);
    setPolling(true);
    setError(null);

    const poll = async () => {
      try {
        const response = await transcriptApi.getStatus(transcriptId, controller.signal);
        if (controller.signal.aborted) return;
        setStatus(response);
        if (TERMINAL_STATUSES.has(response.status)) {
          setPolling(false);
          return;
        }
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setPolling(false);
        setError(cause instanceof TranscriptApiError ? cause.message : "Transcript status could not be loaded.");
      }
    };

    void poll();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [transcriptId]);

  return { status, polling, error };
}
