"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Sparkles, Copy, Check, Loader2 } from "lucide-react";
import clsx from "clsx";

type Client = { id: string; name: string };

const CHANNELS = [
  { id: "instagram", label: "Instagram" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "tiktok", label: "TikTok" },
  { id: "email", label: "Email" },
  { id: "blog", label: "Blog" },
  { id: "ads", label: "Anuncios" }
] as const;

type Channel = (typeof CHANNELS)[number]["id"];

export default function RedactorPage() {
  const [channel, setChannel] = useState<Channel>("instagram");
  const [brief, setBrief] = useState("");
  const [tone, setTone] = useState("");
  const [clientId, setClientId] = useState<string>("");
  const [clients, setClients] = useState<Client[]>([]);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/v1/clients")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setClients(d.items?.map((c: any) => ({ id: c.id, name: c.name })) ?? []))
      .catch(() => {});
  }, []);

  async function generate() {
    setBusy(true);
    setError(null);
    setOutput(null);
    try {
      const r = await fetch("/api/v1/ai/generate-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel,
          brief,
          tone: tone || undefined,
          clientId: clientId || undefined
        })
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error?.message ?? "Error");
      }
      const d = await r.json();
      setOutput(d.text);
    } catch (e: any) {
      setError(e?.message ?? "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Redactor IA"
        description="Genera copy listo para publicar adaptado a cada canal y cliente."
      />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-700">Canal</label>
            <div className="mt-2 grid grid-cols-3 gap-1">
              {CHANNELS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setChannel(c.id)}
                  className={clsx(
                    "px-2 py-1.5 text-xs rounded-md border",
                    channel === c.id
                      ? "bg-brand-600 text-white border-brand-600"
                      : "bg-white text-slate-600 hover:bg-slate-50"
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">Cliente</label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border text-sm bg-white"
            >
              <option value="">Sin contexto de cliente</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">Tono</label>
            <input
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              placeholder="Ej. cercano, juvenil, profesional…"
              className="mt-1 w-full px-3 py-2 rounded-lg border text-sm"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">Brief</label>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={6}
              placeholder="Describe el producto/servicio, audiencia, ángulo, llamada a la acción…"
              className="mt-1 w-full px-3 py-2 rounded-lg border text-sm resize-y"
            />
          </div>

          <button
            onClick={generate}
            disabled={busy || !brief.trim()}
            className="w-full inline-flex items-center justify-center gap-2 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Generar
          </button>
        </div>

        <div className="lg:col-span-3 bg-white rounded-xl border p-5 min-h-[400px]">
          {busy && (
            <div className="text-sm text-slate-500 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Generando…
            </div>
          )}
          {error && <div className="text-sm text-rose-600">{error}</div>}
          {!busy && !error && !output && (
            <div className="text-sm text-slate-400 text-center py-12">
              El copy generado aparecerá aquí.
            </div>
          )}
          {output && (
            <>
              <div className="flex justify-end mb-3">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(output);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="text-xs inline-flex items-center gap-1.5 px-2 py-1 rounded border bg-white hover:bg-slate-50"
                >
                  {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                  Copiar
                </button>
              </div>
              <pre className="whitespace-pre-wrap text-sm text-slate-700 font-sans">{output}</pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
