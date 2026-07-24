import { useEffect, useState } from "react";
import { OrchestratorApiError, orchestratorApi } from "@/lib/api/orchestratorApi";
import type { ArticulationResultDto } from "@/lib/api/orchestratorTypes";

export function useRunResult(runId: string | null) {
  const [result, setResult] = useState<ArticulationResultDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      setResult(null);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setResult(null);
    setLoading(true);
    setError(null);
    orchestratorApi.getRunResult(runId, { signal: controller.signal })
      .then((response) => setResult(response))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setResult(null);
        setError(cause instanceof OrchestratorApiError ? cause.message : "Run result could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [runId]);

  return { result, loading, error };
}
