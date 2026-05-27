"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Loader2, Save, Phone, Copy, Check } from "lucide-react";

export default function VozClient() {
  const [cfg, setCfg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [assistantId, setAssistantId] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    const r = await fetch("/api/v1/admin/voice-settings");
    if (r.ok) {
      const d = await r.json();
      setCfg(d);
      setPhoneNumberId(d.phoneNumberId ?? "");
      setAssistantId(d.assistantId ?? "");
    }
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/v1/admin/voice-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() || undefined, phoneNumberId, assistantId })
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error?.message ?? "Error");
      setMsg("Guardado.");
      setApiKey("");
      load();
    } catch (e: any) {
      setMsg(e?.message ?? "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader
        title="Llamadas de voz (Sonia)"
        description="Sonia hace llamadas conversacionales reales vía Vapi. Configura aquí tu cuenta de Vapi."
      />
      {loading ? (
        <div className="bg-white rounded-xl border p-8 text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900 space-y-1">
            <div className="font-semibold flex items-center gap-1.5">
              <Phone className="h-4 w-4" /> Cómo configurarlo (una vez)
            </div>
            <ol className="list-decimal pl-4 space-y-0.5">
              <li>Crea una cuenta en <a className="underline" href="https://vapi.ai" target="_blank" rel="noreferrer">vapi.ai</a> y copia tu <strong>API key</strong> (Private Key).</li>
              <li>Crea un <strong>Assistant</strong> "Sonia" (voz en español, y en su prompt usa la variable <code>{"{{goal}}"}</code> para el objetivo de cada llamada). Copia su <strong>Assistant ID</strong>.</li>
              <li>Compra/conecta un <strong>número</strong> en Vapi y copia su <strong>Phone Number ID</strong>.</li>
              <li>En Vapi, pon esta <strong>Server URL (webhook)</strong> para recibir transcripciones:</li>
            </ol>
            {cfg?.webhookUrl && (
              <div className="flex items-center gap-2 pt-1">
                <input readOnly value={cfg.webhookUrl} className="flex-1 px-2 py-1.5 rounded border text-[11px] font-mono bg-white" />
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(cfg.webhookUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="h-8 w-8 grid place-items-center rounded border bg-white hover:bg-slate-50"
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border p-5 space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Vapi API key {cfg?.hasApiKey && <span className="text-emerald-600">· configurada</span>}
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={cfg?.hasApiKey ? "•••• guardada" : "Private API key de Vapi"}
                className="w-full px-3 py-2 rounded-lg border text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Phone Number ID (de Vapi)</label>
              <input
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Assistant ID (de Vapi)</label>
              <input
                value={assistantId}
                onChange={(e) => setAssistantId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border text-sm font-mono"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Guardar
              </button>
              {msg && <span className="text-xs text-slate-600">{msg}</span>}
            </div>
            <p className="text-[11px] text-slate-500 pt-2 border-t">
              Cuando esté configurado, pídele a Sonia en el chat: <em>"llama al +34… y confírmale la cita de mañana"</em>.
              Sonia confirmará número y objetivo antes de llamar (gasta dinero por minuto).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
