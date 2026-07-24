import { useCallback, useEffect, useState } from "react";
import { OrchestratorApiError, orchestratorApi } from "@/lib/api/orchestratorApi";
import type { DegreeProgramDto } from "@/lib/api/orchestratorTypes";

function errorMessage(error: unknown): string {
  return error instanceof OrchestratorApiError ? error.message : "Degree programs could not be loaded.";
}

export function useDegreePrograms() {
  const [programs, setPrograms] = useState<DegreeProgramDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    orchestratorApi.listDegreePrograms({ signal: controller.signal })
      .then((response) => setPrograms(response))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setPrograms([]);
        setError(errorMessage(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadToken]);

  return { programs, loading, error, reload };
}
