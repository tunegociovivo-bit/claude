/**
 * Virtualización de ALTURA VARIABLE (FASE 2 · objetivo 4) — lógica pura.
 *
 * A diferencia de `virtualWindow` (fila fija, usada en el combobox), aquí cada
 * fila puede medir distinto (tarjetas de tablón/inbox). El consumidor mide las
 * alturas (ResizeObserver/measure) y construye un prefix-sum de offsets; esta
 * función devuelve el rango a renderizar y el padding, con búsqueda binaria.
 *
 * Kill-switch de adopción: igual que usePollingChannel, cualquier consumidor
 * debe permitir desactivar la virtualización (env NEXT_PUBLIC_DISABLE_VIRTUAL o
 * localStorage 'disable-virtual'=1) y renderizar la lista completa como fallback.
 *
 * NOTA: el cableado en el tablón Kanban (dnd-kit) queda como slice propio: hay
 * que preservar drag/drop, selección, foco y medición de alturas, lo que exige
 * validación interactiva. Esta primitiva es la base testeada de ese trabajo.
 */

/** offsets[i] = top acumulado de la fila i; offsets[count] = alto total. */
export function buildOffsets(heights: number[]): number[] {
  const offsets = new Array<number>(heights.length + 1);
  offsets[0] = 0;
  for (let i = 0; i < heights.length; i++) offsets[i + 1] = offsets[i] + Math.max(0, heights[i] || 0);
  return offsets;
}

/** Primer índice cuya PARTE INFERIOR supera `y` (búsqueda binaria sobre offsets). */
export function firstIndexBelow(offsets: number[], y: number): number {
  const count = offsets.length - 1;
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid + 1] <= y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export type VirtualRange = { start: number; end: number; padTop: number; padBottom: number };

export function variableWindow(offsets: number[], scrollTop: number, viewportHeight: number, overscan = 4): VirtualRange {
  const count = offsets.length - 1;
  if (count <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  const total = offsets[count];
  const clampedTop = Math.max(0, Math.min(scrollTop, total));
  let start = firstIndexBelow(offsets, clampedTop);
  let end = firstIndexBelow(offsets, clampedTop + viewportHeight) + 1; // inclusivo de la parcialmente visible
  start = Math.max(0, start - overscan);
  end = Math.min(count, end + overscan);
  return { start, end, padTop: offsets[start], padBottom: total - offsets[end] };
}

/** ¿Virtualización desactivada por kill-switch? (build o localStorage). */
export function virtualDisabled(): boolean {
  if (process.env.NEXT_PUBLIC_DISABLE_VIRTUAL === "1") return true;
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem("disable-virtual") === "1";
  } catch {
    return false;
  }
}
