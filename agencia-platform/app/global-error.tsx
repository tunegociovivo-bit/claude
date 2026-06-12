"use client";

import { useEffect } from "react";

/**
 * Boundary de error de nivel RAÍZ: captura errores que ocurren en el
 * propio layout raíz o que no son atrapados por un boundary más cercano
 * (es lo que producía la pantalla en blanco con "Application error: a
 * client-side exception"). Debe renderizar su propio <html>/<body>.
 *
 * Igual que app/error.tsx: si es un ChunkLoadError (chunks obsoletos tras
 * un despliegue / caché de la PWA) recargamos una vez para traer la
 * versión nueva; para el resto mostramos una pantalla amable.
 */
function isChunkLoadError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  const msg = `${e?.name ?? ""} ${e?.message ?? ""}`;
  return /ChunkLoadError|Loading chunk [\d]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i.test(
    msg
  );
}

export default function GlobalError({
  error
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (isChunkLoadError(error) && typeof window !== "undefined") {
      const KEY = "hub_chunk_reloaded";
      if (!sessionStorage.getItem(KEY)) {
        sessionStorage.setItem(KEY, "1");
        window.location.reload();
      }
    }
  }, [error]);

  const chunk = isChunkLoadError(error);

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#f8fafc",
          color: "#0f172a",
          padding: "24px"
        }}
      >
        <div style={{ maxWidth: 360, textAlign: "center" }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
            {chunk ? "Actualizando a la última versión…" : "Algo ha fallado"}
          </h2>
          <p style={{ fontSize: 14, color: "#64748b", marginTop: 8 }}>
            {chunk
              ? "Estamos cargando la versión más reciente. Si no se recarga sola, pulsa el botón."
              : "Ha ocurrido un error inesperado. Recarga la página para continuar."}
          </p>
          <button
            onClick={() => {
              try {
                sessionStorage.removeItem("hub_chunk_reloaded");
              } catch {}
              window.location.reload();
            }}
            style={{
              marginTop: 16,
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              background: "#4f46e5",
              color: "#fff",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer"
            }}
          >
            Recargar
          </button>
        </div>
      </body>
    </html>
  );
}
