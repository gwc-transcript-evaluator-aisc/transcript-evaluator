import { useCallback, useEffect, useRef, useState } from "react";
import { OrchestratorApiError, orchestratorApi } from "@/lib/api/orchestratorApi";
import type { StudentDirectorySummaryDto } from "@/lib/api/orchestratorTypes";

export function useStudentDirectory(limit = 25) {
  const [students, setStudents] = useState<StudentDirectorySummaryDto[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  const load = useCallback(async (nextCursor?: string, append = false) => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    if (append) setLoadingMore(true); else setLoading(true);
    setError(null);
    if (!append) {
      setStudents([]);
      setCursor(undefined);
    }
    try {
      const page = await orchestratorApi.listStudents(nextCursor, limit, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setStudents((current) => append ? [...current, ...page.items] : page.items);
      setCursor(page.cursor);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setStudents([]);
      setCursor(undefined);
      setError(cause instanceof OrchestratorApiError ? cause.message : "Students could not be loaded.");
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [limit]);

  useEffect(() => {
    void load();
    return () => activeRequest.current?.abort();
  }, [load]);

  const loadNextPage = useCallback(async () => {
    if (!cursor || loading || loadingMore) return;
    await load(cursor, true);
  }, [cursor, load, loading, loadingMore]);

  const reload = useCallback(async () => load(), [load]);

  return { students, cursor, loading, loadingMore, error, reload, loadNextPage };
}
