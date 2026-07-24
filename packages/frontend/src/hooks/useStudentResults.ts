import { useCallback, useEffect, useRef, useState } from "react";
import { OrchestratorApiError, orchestratorApi } from "@/lib/api/orchestratorApi";
import type { ArticulationResultDto } from "@/lib/api/orchestratorTypes";

export function useStudentResults(studentKey: string | null, limit = 25) {
  const [results, setResults] = useState<ArticulationResultDto[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  const load = useCallback(async (nextCursor?: string, append = false) => {
    if (!studentKey) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    if (append) setLoadingMore(true); else setLoading(true);
    setError(null);
    if (!append) {
      setResults([]);
      setCursor(undefined);
    }
    try {
      const page = await orchestratorApi.listStudentResults(studentKey, nextCursor, limit, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setResults((current) => append ? [...current, ...page.items] : page.items);
      setCursor(page.cursor);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setResults([]);
      setCursor(undefined);
      setError(cause instanceof OrchestratorApiError ? cause.message : "Student results could not be loaded.");
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [limit, studentKey]);

  useEffect(() => {
    if (!studentKey) {
      activeRequest.current?.abort();
      setResults([]);
      setCursor(undefined);
      setLoading(false);
      setLoadingMore(false);
      setError(null);
      return;
    }
    void load();
    return () => activeRequest.current?.abort();
  }, [load, studentKey]);

  const loadNextPage = useCallback(async () => {
    if (!cursor || loading || loadingMore) return;
    await load(cursor, true);
  }, [cursor, load, loading, loadingMore]);

  const reload = useCallback(async () => load(), [load]);

  return { results, cursor, loading, loadingMore, error, reload, loadNextPage };
}
