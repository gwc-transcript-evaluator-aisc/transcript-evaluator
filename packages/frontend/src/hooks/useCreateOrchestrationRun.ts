import { useCallback, useEffect, useRef, useState } from "react";
import { OrchestratorApiError, orchestratorApi } from "@/lib/api/orchestratorApi";
import type { CreateOrchestrationRunRequest, OrchestrationRunDto } from "@/lib/api/orchestratorTypes";

export function useCreateOrchestrationRun() {
  const [run, setRun] = useState<OrchestrationRunDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => () => activeRequest.current?.abort(), []);

  const createRun = useCallback(async (request: CreateOrchestrationRunRequest) => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setError(null);
    setRun(null);
    try {
      const response = await orchestratorApi.createRun(request, { signal: controller.signal });
      if (!controller.signal.aborted) setRun(response);
      return response;
    } catch (cause) {
      if (!controller.signal.aborted) {
        setRun(null);
        setError(cause instanceof OrchestratorApiError ? cause.message : "The orchestration run could not be created.");
      }
      throw cause;
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    activeRequest.current?.abort();
    setRun(null);
    setError(null);
    setLoading(false);
  }, []);

  return { run, loading, error, createRun, reset };
}
