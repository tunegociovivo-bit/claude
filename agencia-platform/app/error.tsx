"use client";

import { useEffect } from "react";

/**
 * Boundary de error a nivel de segmento (se renderiza dentro del layout
 * raíz, así el sidebar sigue visible).
 *
 * Caso principal: tras un despliegue nuevo, el navegador / la PWA tienen
 * cacheada la versión anterior y piden chunks JS que ya no existen
 * (ChunkLoadError). En vez de dejar la pantalla en blanco con el error
 * genérico de Next, recargamos UNA vez para traer la versión nueva.
 * Para cualquier otro error mostramos una pantalla amable con botón.
 */
function isChunkLoadError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  const msg = `${e?.name ?? ""} ${e?.message ?? ""}`;
  return /ChunkLoadError|Loading chunk [\d]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i.test(
    msg
  );
}

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (isChunkLoadError(error) && typeof window !== "undefined") {
      // Recarga una sola vez por sesión para no entrar en bucle si el
      // error fuese determinista en lugar de un chunk obsoleto.
      const KEY = "hub_chunk_reloaded";
      if (!sessionStorage.getItem(KEY)) {
        sessionStorage.setItem(KEY, "1");
        window.location.reload();
      }
    }
  }, [error]);

  const chunk = isChunkLoadError(error);

  return (
    <div className="min-h-[60vh] grid place-items-center p-6">
      <div className="max-w-sm text-center">
        <h2 className="text-lg font-semibold text-slate-800">
          {chunk ? "Actualizando a la última versión…" : "Algo ha fallado"}
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          {chunk
            ? "Estamos cargando la versión más reciente. Si no se recarga sola, pulsa el botón."
            : "Ha ocurrido un error inesperado al cargar esta sección."}
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            onClick={() => {
              try {
                sessionStorage.removeItem("hub_chunk_reloaded");
              } catch {}
              window.location.reload();
            }}
            className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
          >
            Recargar
          </button>
          {!chunk && (
            <button
              onClick={() => reset()}
              className="px-4 py-2 rounded-lg border text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Reintentar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
