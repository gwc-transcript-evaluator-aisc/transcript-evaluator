import { useEffect, useState } from "react";
import { OrchestratorApiError, orchestratorApi } from "@/lib/api/orchestratorApi";
import type { OrchestrationRunDto } from "@/lib/api/orchestratorTypes";

export const ORCHESTRATION_POLL_INTERVAL_MS = 5_000;
export const ORCHESTRATION_POLL_TIMEOUT_MS = 10 * 60 * 1_000;
const TERMINAL_STATUSES = new Set(["completed", "failed"]);

export function useOrchestrationRunPolling(runId: string | null) {
  const [run, setRun] = useState<OrchestrationRunDto | null>(null);
  const [polling, setPolling] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      setRun(null);
      setPolling(false);
      setTimedOut(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setRun(null);
    setPolling(true);
    setTimedOut(false);
    setError(null);

    const poll = async () => {
      if (Date.now() - startedAt >= ORCHESTRATION_POLL_TIMEOUT_MS) {
        setPolling(false);
        setTimedOut(true);
        return;
      }
      try {
        const response = await orchestratorApi.getRunStatus(runId, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setRun(response);
        if (TERMINAL_STATUSES.has(response.status)) {
          setPolling(false);
          return;
        }
        if (Date.now() - startedAt >= ORCHESTRATION_POLL_TIMEOUT_MS) {
          setPolling(false);
          setTimedOut(true);
          return;
        }
        timer = setTimeout(poll, ORCHESTRATION_POLL_INTERVAL_MS);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setRun(null);
        setPolling(false);
        setError(cause instanceof OrchestratorApiError ? cause.message : "Run status could not be loaded.");
      }
    };

    void poll();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [runId]);

  return { run, polling, timedOut, error };
}
