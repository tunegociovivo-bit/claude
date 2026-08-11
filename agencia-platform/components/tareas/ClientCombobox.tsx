"use client";

/**
 * Combobox async accesible de clientes (FASE 2 · objetivos 3 y 4).
 *
 * Sustituye al <select> nativo con cientos de <option> del filtro de clientes.
 * - Búsqueda remota con debounce (useClientSearch → /api/v1/clients/search).
 * - Recientes (localStorage) cuando no se está buscando.
 * - Carga incremental por cursor al hacer scroll.
 * - Lista VIRTUALIZADA (solo se renderizan las filas visibles) → DOM acotado.
 * - Accesible: patrón ARIA combobox (role=combobox + listbox + option,
 *   aria-expanded / aria-activedescendant), teclado completo y gestión de foco.
 *
 * No cambia el diseño visual del resto de filtros: mismo tamaño/estilo del chip.
 */
import type React from "react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useClientSearch } from "@/lib/client/useClientSearch";
import {
  loadRecents,
  saveRecent,
  mergeDedupe,
  nextActiveIndex,
  virtualWindow,
  type ClientOption,
  type KVStore
} from "@/lib/client/combobox-logic";

const ROW_H = 34; // px por fila (fijo → virtualización estable)
const VIEWPORT_H = 280; // alto máximo de la lista

type Props = {
  value: string; // id de cliente o "all"
  onChange: (id: string) => void;
  /** Clientes ya cargados por la página (para resolver la etiqueta y sembrar recientes). */
  knownClients?: ClientOption[];
  allLabel?: string;
  className?: string;
};

export default function ClientCombobox({ value, onChange, knownClients = [], allLabel = "Todos los clientes", className }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [recents, setRecents] = useState<ClientOption[]>([]);

  const rootId = useId();
  const listId = `${rootId}-listbox`;
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const store: KVStore | null = typeof window !== "undefined" ? window.localStorage : null;

  const { items: results, loading, hasMore, loadMore, error } = useClientSearch(query, open);

  // Etiqueta seleccionada: resuelta de knownClients / recientes / resultados.
  const labelFor = useMemo(() => {
    if (value === "all") return allLabel;
    const pool = [...knownClients, ...recents, ...results];
    return pool.find((c) => c.id === value)?.name ?? "Cliente";
  }, [value, knownClients, recents, results, allLabel]);

  // Opciones planas: "Todos" + (recientes cuando no se busca) + resultados.
  const options: ClientOption[] = useMemo(() => {
    const base = query.trim() ? results : mergeDedupe(recents, results);
    return [{ id: "all", name: allLabel }, ...base];
  }, [query, results, recents, allLabel]);

  useEffect(() => {
    if (open) {
      setRecents(loadRecents(store));
      setActive(0);
      // Foco al input al abrir.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    setQuery("");
    setScrollTop(0);
    if (returnFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const select = useCallback(
    (opt: ClientOption) => {
      onChange(opt.id);
      if (opt.id !== "all") setRecents(saveRecent(store, opt));
      close();
    },
    [onChange, close, store]
  );

  // Mantén el activo dentro de la ventana visible al navegar por teclado.
  const ensureVisible = useCallback((idx: number) => {
    const el = listRef.current;
    if (!el) return;
    const top = idx * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (!open) return;
      switch (e.key) {
        case "ArrowDown":
        case "ArrowUp":
        case "Home":
        case "End": {
          e.preventDefault();
          const idx = nextActiveIndex(active, e.key as any, options.length);
          setActive(idx);
          ensureVisible(idx);
          break;
        }
        case "Enter":
          e.preventDefault();
          if (options[active]) select(options[active]);
          break;
        case "Escape":
          e.preventDefault();
          close();
          break;
        case "Tab":
          close(false);
          break;
      }
    },
    [open, active, options, select, close, ensureVisible]
  );

  // Carga incremental al acercarse al fondo.
  const onScroll = useCallback(
    (e: React.UIEvent<HTMLUListElement>) => {
      const el = e.currentTarget;
      setScrollTop(el.scrollTop);
      if (hasMore && !loading && el.scrollHeight - el.scrollTop - el.clientHeight < ROW_H * 4) loadMore();
    },
    [hasMore, loading, loadMore]
  );

  const win = virtualWindow(scrollTop, ROW_H, VIEWPORT_H, options.length);
  const visible = options.slice(win.start, win.end);

  return (
    <div className={`relative inline-block ${className ?? ""}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Filtrar por cliente. Selección actual: ${labelFor}`}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={onKeyDown}
        className="px-3 py-1.5 rounded-lg bg-white border text-xs focus:outline-none focus:ring-2 focus:ring-brand-500 shrink-0 max-w-[12rem] truncate text-left"
      >
        {labelFor}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-64 rounded-lg border bg-white shadow-lg p-1" role="presentation">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={options[active] ? `${rootId}-opt-${active}` : undefined}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setScrollTop(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Buscar cliente…"
            className="w-full px-2 py-1.5 text-xs border-b outline-none"
          />
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Clientes"
            onScroll={onScroll}
            style={{ maxHeight: VIEWPORT_H, overflowY: "auto" }}
            className="mt-1"
          >
            <li aria-hidden style={{ height: win.padTop }} />
            {visible.map((opt, i) => {
              const idx = win.start + i;
              const selected = value === opt.id;
              const isActive = idx === active;
              return (
                <li
                  key={opt.id}
                  id={`${rootId}-opt-${idx}`}
                  role="option"
                  aria-selected={selected}
                  onMouseDown={(e) => e.preventDefault()} // no robar foco al input
                  onClick={() => select(opt)}
                  onMouseEnter={() => setActive(idx)}
                  style={{ height: ROW_H }}
                  className={`flex items-center px-2 text-xs cursor-pointer truncate ${
                    isActive ? "bg-brand-50" : ""
                  } ${selected ? "font-semibold text-brand-700" : "text-slate-700"}`}
                >
                  {opt.name}
                </li>
              );
            })}
            <li aria-hidden style={{ height: win.padBottom }} />
            {loading && (
              <li role="option" aria-disabled className="px-2 py-1.5 text-xs text-slate-400" style={{ height: ROW_H }}>
                Cargando…
              </li>
            )}
            {error && !loading && (
              <li role="option" aria-disabled className="px-2 py-1.5 text-xs text-rose-500" style={{ height: ROW_H }}>
                Error al buscar. Reintenta.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
