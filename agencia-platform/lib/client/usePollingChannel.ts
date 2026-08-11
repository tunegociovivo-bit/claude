"use client";

/**
 * Hook de polling con pausa automática al ocultar la pestaña (FASE 2 · objetivo 6).
 *
 * Envuelve createPoller (probado aparte) y añade:
 *   - pausa cuando document.hidden (visibilitychange) → 0 red/CPU con la pestaña
 *     de fondo; reanuda disparando YA al volver, para refrescar al instante.
 *   - un `task` siempre "fresco" (ref) para no reprogramar el poller en cada
 *     render aunque cambie la closure.
 *
 * Adopción incremental: cada bloque `setInterval(fn, ms)` de LeadsClient se
 * sustituye por `usePollingChannel(fn, ms, enabled)`. Esto elimina el
 * solapamiento y el gasto en segundo plano SIN reescribir el componente.
 */
import { useEffect, useRef } from "react";
import { createPoller } from "./poller";

export function usePollingChannel(
  task: () => void | Promise<void>,
  intervalMs: number,
  enabled: boolean = true
): void {
  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;

    const poller = createPoller({
      intervalMs,
      task: () => taskRef.current(),
      onError: () => {} // errores tragados a propósito: un tick fallido no rompe el canal
    });

    const onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.hidden) poller.pause();
      else poller.resume({ runNow: true }); // al volver, refresca al instante
    };

    poller.start();
    // Si arrancamos con la pestaña ya oculta, pausa de inmediato.
    if (typeof document !== "undefined" && document.hidden) poller.pause();
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
      poller.stop();
    };
  }, [intervalMs, enabled]);
}
