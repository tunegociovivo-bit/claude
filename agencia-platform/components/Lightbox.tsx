"use client";

import { useEffect } from "react";
import { X, Download, ExternalLink } from "lucide-react";

/**
 * Modal de imagen a tamaño real. Se monta con `src` !== null y se
 * cierra al click fuera, click en la X o pulsar Escape.
 *
 * Botón "Descargar" fuerza la descarga (no solo abrir). Usa el
 * atributo `download` del <a>; si el servidor sirve la imagen con
 * un Content-Disposition o si es cross-origin, algunos browsers
 * ignoran el atributo y abren en pestaña — por eso también dejamos
 * "Abrir en nueva pestaña" como fallback.
 */
export default function Lightbox({
  src,
  alt,
  onClose
}: {
  src: string | null;
  alt?: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!src) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    // Bloquea scroll del body mientras está abierto.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [src, onClose]);

  if (!src) return null;

  const filename = guessFilename(src, alt);

  return (
    <div
      className="fixed inset-0 z-[100] bg-slate-900/90 backdrop-blur-sm grid place-items-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute top-3 right-3 flex items-center gap-2 z-[101]">
        <a
          href={src}
          download={filename}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-white/95 hover:bg-white text-slate-900 text-sm shadow-lg"
          title="Descargar imagen"
        >
          <Download className="h-4 w-4" />
          Descargar
        </a>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-white/80 hover:bg-white text-slate-900 text-sm shadow-lg"
          title="Abrir en nueva pestaña"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center justify-center h-9 w-9 rounded-md bg-white/95 hover:bg-white text-slate-900 shadow-lg"
          title="Cerrar (Esc)"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt ?? ""}
        className="max-w-full max-h-[92vh] rounded-md shadow-2xl select-none"
        onMouseDown={(e) => e.stopPropagation()}
      />
      {alt && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 max-w-[80%] text-center text-white/80 text-xs bg-black/40 rounded px-3 py-1.5">
          {alt}
        </div>
      )}
    </div>
  );
}

function guessFilename(src: string, alt: string | null | undefined): string {
  if (alt && /\.[a-z0-9]{2,5}$/i.test(alt)) return alt;
  try {
    const u = new URL(src);
    const last = u.pathname.split("/").pop() ?? "";
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return last;
  } catch {}
  return "imagen.png";
}
