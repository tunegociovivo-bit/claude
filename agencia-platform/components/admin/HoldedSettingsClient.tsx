"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, AlertTriangle, KeyRound, ExternalLink } from "lucide-react";

type Status =
  | { configured: false }
  | { configured: true; test: { ok: true; invoicesSample: number; contactsSample: number } | { ok: false; error: string } };

export default function HoldedSettingsClient() {
  const [status, setStatus] = useState<Status | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/v1/admin/integrations/holded", { cache: "no-store" });
      if (r.ok) setStatus(await r.json());
    } catch {}
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (apiKey.trim().length < 10) {
      setMsg({ kind: "err", text: "Pega la API key completa de Holded." });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/v1/admin/integrations/holded", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ kind: "err", text: data?.error?.message ?? `Error ${r.status}` });
        return;
      }
      setApiKey("");
      setMsg({ kind: "ok", text: "API key guardada y cifrada. Comprobando conexión…" });
      await load();
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message ?? "Error al guardar" });
    } finally {
      setSaving(false);
    }
  }

  const connected = status?.configured && (status as any).test?.ok;
  const testErr = status?.configured && !(status as any).test?.ok ? (status as any).test?.error : null;

  return (
    <div className="space-y-5">
      {/* Estado */}
      <div className="bg-white border rounded-xl p-4">
        {status == null ? (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Comprobando estado…
          </div>
        ) : connected ? (
          <div className="flex items-start gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Conectado con Holded.</div>
              <div className="text-xs text-emerald-600 mt-0.5">
                Prueba OK · {(status as any).test.invoicesSample} facturas y {(status as any).test.contactsSample} contactos
                de muestra. Sonia ya puede consultar y crear facturas/contactos, y descargar los datos.
              </div>
            </div>
          </div>
        ) : status.configured ? (
          <div className="flex items-start gap-2 text-sm text-amber-700">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">API key guardada, pero la conexión falla.</div>
              <div className="text-xs text-amber-600 mt-0.5 break-words">{testErr}</div>
              <div className="text-xs text-slate-500 mt-1">Vuelve a pegar la API key correcta abajo.</div>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2 text-sm text-slate-600">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-slate-400" />
            <div>Aún no hay ninguna API key de Holded configurada.</div>
          </div>
        )}
      </div>

      {/* Formulario */}
      <div className="bg-white border rounded-xl p-4 space-y-3">
        <label className="flex items-center gap-1.5 text-sm font-medium">
          <KeyRound className="h-4 w-4 text-brand-600" /> API key de Holded
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={status?.configured ? "•••• (ya configurada — pega una nueva para reemplazar)" : "Pega aquí tu API key de Holded"}
          className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 bg-brand-600 text-white text-sm px-3 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Guardar y conectar
          </button>
          {msg && (
            <span className={`text-xs ${msg.kind === "ok" ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</span>
          )}
        </div>
        <p className="text-xs text-slate-500">
          La key se guarda <strong>cifrada</strong> (AES-256-GCM) y solo la usa el servidor. Se conecta a la cuenta de
          Holded de <strong>Negocio Vivo S.C.A.</strong> para descargar y gestionar sus datos.
        </p>
      </div>

      {/* Cómo obtener la key */}
      <div className="bg-slate-50 border rounded-xl p-4 text-sm text-slate-600 space-y-1">
        <div className="font-medium text-slate-700">¿De dónde saco la API key?</div>
        <p>
          En Holded:{" "}
          <span className="font-medium">Menú de tu cuenta → Configuración → Desarrolladores → API Key</span>. Copia la
          clave y pégala arriba.
        </p>
        <a
          href="https://developers.holded.com/reference/api-key"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-brand-600 hover:underline"
        >
          Documentación de la API de Holded <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
