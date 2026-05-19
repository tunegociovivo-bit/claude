"use client";

import { useEffect, useState } from "react";

type Captured = {
  id: string;
  message: string;
  count: number;
  capturedAt: number;
};

/**
 * Cliente global de captura de errores. Se monta una vez en el layout.
 *
 * - window.error: errores JS no capturados (sintaxis, refs, etc.)
 * - unhandledrejection: promesas rechazadas sin .catch()
 * - fetch wrapper: respuestas HTTP 5xx (no 4xx — esas son validación del user)
 *
 * Cuando captura un error, hace POST a /api/v1/internal/error-report y
 * muestra un toast no-bloqueante. Si el mismo error vuelve a saltar, lo
 * deduplica server-side (fingerprint).
 */
export default function ErrorReporter() {
  const [active, setActive] = useState<Captured | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    async function report(opts: {
      message: string;
      stack?: string;
      source?: "client" | "server" | "api";
      url?: string;
      context?: any;
    }) {
      try {
        const r = await fetch("/api/v1/internal/error-report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: opts.source ?? "client",
            message: opts.message,
            stack: opts.stack,
            url: opts.url ?? window.location.href,
            userAgent: navigator.userAgent,
            context: opts.context
          })
        });
        if (r.ok) {
          const j = await r.json();
          setActive({ id: j.id, message: opts.message, count: j.count ?? 1, capturedAt: Date.now() });
          // Auto-cerrar el toast a los 12 segundos
          window.setTimeout(() => setActive(null), 12000);
        }
      } catch {}
    }

    const onError = (e: ErrorEvent) => {
      // Ignorar errores de extensiones de navegador / ResizeObserver ruido
      const msg = e.message ?? "Error";
      if (/ResizeObserver|Script error\.?$/.test(msg)) return;
      report({
        message: msg,
        stack: e.error?.stack ?? undefined,
        context: { filename: e.filename, lineno: e.lineno, colno: e.colno }
      });
    };

    const onRejection = (e: PromiseRejectionEvent) => {
      const reason: any = e.reason;
      const msg = reason?.message ?? String(reason ?? "Promesa rechazada");
      if (/ResizeObserver|AbortError/.test(msg)) return;
      report({ message: msg, stack: reason?.stack });
    };

    // Wrapper fetch para captar 5xx (no 4xx)
    const origFetch = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const resp = await origFetch(...args);
      if (resp.status >= 500 && resp.status < 600) {
        // Lee el body de manera no destructiva (clone)
        try {
          const clone = resp.clone();
          const text = await clone.text();
          const url = typeof args[0] === "string" ? args[0] : (args[0] as Request).url;
          report({
            source: "api",
            message: `${resp.status} ${resp.statusText} en ${url}`,
            context: { responsePreview: text.slice(0, 500) }
          });
        } catch {}
      }
      return resp;
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.fetch = origFetch;
    };
  }, []);

  if (!active) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-md w-[calc(100vw-2rem)] sm:w-96 animate-in slide-in-from-bottom-2">
      <ProgressToast captured={active} onDismiss={() => setActive(null)} />
    </div>
  );
}

function ProgressToast({ captured, onDismiss }: { captured: Captured; onDismiss: () => void }) {
  const [secondsOpen, setSecondsOpen] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecondsOpen(Math.floor((Date.now() - captured.capturedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [captured.capturedAt]);

  // Animación de progreso continuo: muestra que "el equipo está en ello" sin
  // inventarse ETA. Llena lentamente y se reinicia si toma más de 30 min.
  const progressPct = Math.min(95, (secondsOpen / 1800) * 100);
  const sessionUrl = "https://claude.ai/code/session_01G1DKhjb6esoaVNydSvcQ38";

  return (
    <div className="rounded-xl border border-amber-300 bg-white shadow-lg overflow-hidden">
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex items-center gap-2">
            <div className="relative h-2.5 w-2.5">
              <div className="absolute inset-0 rounded-full bg-amber-400" />
              <div className="absolute inset-0 rounded-full bg-amber-400 animate-ping opacity-75" />
            </div>
            <span className="text-sm font-semibold text-slate-900">Error capturado</span>
          </div>
          <button
            onClick={onDismiss}
            className="text-slate-400 hover:text-slate-700 text-lg leading-none"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
        <p className="text-xs text-slate-600 line-clamp-2 mb-2">{captured.message}</p>
        <p className="text-[11px] text-slate-500">
          ID <code className="text-[10px]">#{captured.id.slice(0, 8)}</code>
          {captured.count > 1 && <span className="ml-1">· repetido {captured.count} veces</span>}
          <span className="ml-1">· hace {secondsOpen}s</span>
        </p>
      </div>
      <div className="h-1 bg-amber-100">
        <div
          className="h-full bg-amber-500 transition-all duration-1000 ease-linear"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <div className="px-4 py-2 bg-amber-50/60 flex items-center justify-between gap-2 border-t border-amber-100">
        <span className="text-[11px] text-amber-900">El equipo ya está al tanto</span>
        <a
          href={sessionUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-amber-900 hover:text-amber-700 underline"
        >
          Ver sesión soporte →
        </a>
      </div>
    </div>
  );
}
