/**
 * Small polling hook shared by the simulator page's live panels (design.md §11 "call-log
 * table refreshes by polling every 2 s"). Deliberately tiny and dependency-free rather
 * than routed through TanStack Query — this page is dev-only tooling, not product UI,
 * and stays out of `apps/web/src/lib/**` (owned by the concurrently-running M7.1
 * milestone) on purpose.
 */
import { useEffect, useRef, useState } from 'react';

export interface PollingState<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  refresh: () => void;
}

export function usePolling<T>(fetcher: () => Promise<T>, intervalMs: number): PollingState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` is a deliberate manual-refetch trigger, never read inside the effect
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetcherRef
      .current()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  useEffect(() => {
    if (intervalMs <= 0) return;
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return { data, error, loading, refresh: () => setTick((t) => t + 1) };
}
