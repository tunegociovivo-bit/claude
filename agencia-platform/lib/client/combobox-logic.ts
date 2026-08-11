/**
 * Lógica PURA del combobox async de clientes (FASE 2 · objetivo 3).
 * Framework-agnóstica y testeable: recientes (localStorage), dedupe de páginas
 * y navegación por teclado. El componente React solo orquesta esto + fetch.
 */

export type ClientOption = { id: string; name: string; status?: string };

/** Une páginas incrementales sin duplicar por id, preservando el orden. */
export function mergeDedupe(prev: ClientOption[], next: ClientOption[]): ClientOption[] {
  const seen = new Set(prev.map((o) => o.id));
  const out = prev.slice();
  for (const o of next) {
    if (!seen.has(o.id)) {
      seen.add(o.id);
      out.push(o);
    }
  }
  return out;
}

/** Añade `item` al frente de recientes, deduplicado por id y acotado a `cap`. */
export function addRecent(list: ClientOption[], item: ClientOption, cap = 6): ClientOption[] {
  const rest = list.filter((o) => o.id !== item.id);
  return [item, ...rest].slice(0, cap);
}

// ── Recientes persistidos (localStorage inyectable para testear) ──
export interface KVStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}
export const RECENTS_KEY = "tareas.client-combobox.recents.v1";

export function loadRecents(store: KVStore | null | undefined, key = RECENTS_KEY): ClientOption[] {
  if (!store) return [];
  try {
    const raw = store.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((o) => o && typeof o.id === "string" && typeof o.name === "string")
      .map((o) => ({ id: o.id, name: o.name, status: typeof o.status === "string" ? o.status : undefined }));
  } catch {
    return [];
  }
}

export function saveRecent(store: KVStore | null | undefined, item: ClientOption, cap = 6, key = RECENTS_KEY): ClientOption[] {
  const next = addRecent(loadRecents(store, key), item, cap);
  try {
    store?.setItem(key, JSON.stringify(next));
  } catch {
    // cuota/entorno sin storage: recientes en memoria de esta sesión
  }
  return next;
}

/**
 * Nuevo índice activo (para aria-activedescendant) al pulsar una tecla de
 * navegación sobre una lista de `count` opciones. Envuelve por los extremos.
 * `current` = -1 significa "ninguno activo aún".
 */
export function nextActiveIndex(
  current: number,
  key: "ArrowDown" | "ArrowUp" | "Home" | "End",
  count: number
): number {
  if (count <= 0) return -1;
  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp":
      return current <= 0 ? count - 1 : current - 1;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return current;
  }
}

/**
 * Ventana de virtualización para una lista larga: dado scrollTop, alto de fila
 * y alto del viewport, devuelve [start, end) a renderizar con un overscan.
 * Mantiene el DOM acotado aunque la lista crezca con la carga incremental.
 */
export function virtualWindow(
  scrollTop: number,
  rowHeight: number,
  viewportHeight: number,
  count: number,
  overscan = 4
): { start: number; end: number; padTop: number; padBottom: number } {
  if (rowHeight <= 0 || count <= 0) return { start: 0, end: count, padTop: 0, padBottom: 0 };
  const first = Math.floor(scrollTop / rowHeight);
  const visible = Math.ceil(viewportHeight / rowHeight);
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, first + visible + overscan);
  return { start, end, padTop: start * rowHeight, padBottom: (count - end) * rowHeight };
}
