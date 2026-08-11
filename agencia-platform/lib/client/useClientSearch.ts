"use client";

/**
 * Hook de búsqueda remota de clientes (FASE 2 · objetivo 3).
 * Consume GET /api/v1/clients/search con:
 *   - debounce del término (evita una request por tecla),
 *   - paginación por cursor (carga incremental con loadMore),
 *   - cancelación de peticiones obsoletas (AbortController) al cambiar el término.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { mergeDedupe, type ClientOption } from "./combobox-logic";

const PAGE = 20;

export type UseClientSearch = {
  items: ClientOption[];
  loading: boolean;
  error: boolean;
  hasMore: boolean;
  loadMore: () => void;
};

export function useClientSearch(query: string, enabled: boolean, debounceMs = 250): UseClientSearch {
  const [items, setItems] = useState<ClientOption[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const debouncedRef = useRef(query);

  const fetchPage = useCallback(async (q: string, cur: string | null, append: boolean) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(false);
    try {
      const sp = new URLSearchParams({ q, limit: String(PAGE) });
      if (cur) sp.set("cursor", cur);
      const res = await fetch(`/api/v1/clients/search?${sp.toString()}`, { cache: "no-store", signal: ac.signal });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { items: ClientOption[]; nextCursor: string | null };
      setItems((prev) => (append ? mergeDedupe(prev, data.items ?? []) : data.items ?? []));
      setCursor(data.nextCursor ?? null);
    } catch (e: any) {
      if (e?.name === "AbortError") return; // reemplazada por una búsqueda más nueva
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce del término + reset de página al cambiar la búsqueda.
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => {
      debouncedRef.current = query;
      void fetchPage(query, null, false);
    }, debounceMs);
    return () => clearTimeout(t);
  }, [query, enabled, debounceMs, fetchPage]);

  // Al cerrar, cancela cualquier request en vuelo.
  useEffect(() => {
    if (!enabled) abortRef.current?.abort();
  }, [enabled]);

  const loadMore = useCallback(() => {
    if (loading || !cursor) return;
    void fetchPage(debouncedRef.current, cursor, true);
  }, [loading, cursor, fetchPage]);

  return { items, loading, error, hasMore: cursor !== null, loadMore };
}
