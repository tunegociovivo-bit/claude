"use client";

import { useState } from "react";
import { Sparkles, Loader2, X, FileText, Wand2 } from "lucide-react";

export default function DocAIButton({ documentId }: { documentId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function summarize(style: "bullets" | "executive" | "tldr") {
    setBusy(style);
    setError(null);
    setResult(null);
    try {
      const r = await fetch("/api/v1/ai/summarize-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId, style })
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error?.message ?? "Error");
      }
      const data = await r.json();
      setResult(data.summary);
    } catch (e: any) {
      setError(e?.message ?? "Error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="h-9 px-2.5 rounded-lg border bg-gradient-to-br from-brand-50 to-white text-brand-700 hover:from-brand-100 inline-flex items-center gap-1.5 text-xs font-medium"
        title="Acciones IA"
      >
        <Sparkles className="h-4 w-4" />
        IA
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-20 w-64 bg-white border rounded-xl shadow-lg p-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 px-2 py-1">
            Resumir
          </div>
          <button
            onClick={() => summarize("bullets")}
            disabled={!!busy}
            className="w-full text-left px-2 py-2 text-sm rounded hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50"
          >
            {busy === "bullets" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5 text-slate-500" />}
            En viñetas
          </button>
          <button
            onClick={() => summarize("executive")}
            disabled={!!busy}
            className="w-full text-left px-2 py-2 text-sm rounded hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50"
          >
            {busy === "executive" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5 text-slate-500" />}
            Resumen ejecutivo
          </button>
          <button
            onClick={() => summarize("tldr")}
            disabled={!!busy}
            className="w-full text-left px-2 py-2 text-sm rounded hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50"
          >
            {busy === "tldr" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 text-slate-500" />}
            TL;DR (1-2 líneas)
          </button>

          {(result || error) && (
            <div className="mt-3 p-3 rounded-lg bg-slate-50 border text-xs whitespace-pre-wrap relative max-h-72 overflow-y-auto">
              <button
                onClick={() => {
                  setResult(null);
                  setError(null);
                }}
                className="absolute top-1 right-1 text-slate-400 hover:text-slate-900"
              >
                <X className="h-3 w-3" />
              </button>
              {error && <span className="text-rose-600">{error}</span>}
              {result && <span className="text-slate-700">{result}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
