"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import ImageUpload from "@/components/ui/ImageUpload";
import { Loader2, Save, Webhook, Copy, RefreshCw, CheckCircle2 } from "lucide-react";

type Workspace = { id: string; name: string; slug: string; logo: string | null };

type Integrations = {
  evolution: { hasToken: boolean; webhookToken: string | null; hasUrl: boolean; hasApiKey: boolean };
  metricool: { hasBrand: boolean; hasToken: boolean; blogId: string | null };
  googlePlaces: { hasApiKey: boolean };
  drive: { folderRefs: any };
};

export default function WorkspaceSettingsClient() {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [name, setName] = useState("");
  const [logo, setLogo] = useState("");
  const [integrations, setIntegrations] = useState<Integrations | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true);
    const [wr, ir] = await Promise.all([
      fetch("/api/v1/workspace"),
      fetch("/api/v1/admin/integrations")
    ]);
    if (wr.ok) {
      const d = await wr.json();
      if (d) {
        setWs(d);
        setName(d.name);
        setLogo(d.logo ?? "");
      }
    }
    if (ir.ok) setIntegrations(await ir.json());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const r = await fetch("/api/v1/workspace", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, logo: logo || null })
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j?.error?.message ?? `Error ${r.status}`);
      return;
    }
    const updated = await r.json();
    setWs(updated);
    setSavedAt(new Date());
  }

  async function regenerateToken() {
    if (integrations?.evolution.hasToken) {
      if (!confirm("¿Regenerar el token? El webhook URL actual dejará de funcionar y tendrás que actualizar la URL en Evolution/WAHA.")) {
        return;
      }
    }
    setRegenerating(true);
    const r = await fetch("/api/v1/admin/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "regenerate_evolution_token" })
    });
    setRegenerating(false);
    if (r.ok) {
      load();
    }
  }

  function getWebhookUrl(): string {
    if (!integrations?.evolution.webhookToken || typeof window === "undefined") return "";
    return `${window.location.origin}/api/v1/leads/webhook/${integrations.evolution.webhookToken}`;
  }

  async function copyUrl() {
    const url = getWebhookUrl();
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader
        title="Identidad e integraciones"
        description="Nombre, logo y conexiones externas (Evolution WhatsApp, Metricool, Google Places, Drive)."
      />

      {loading ? (
        <div className="bg-white rounded-xl border p-8 text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : (
        <>
          <form onSubmit={save} className="bg-white rounded-xl border p-5 space-y-5 mb-5">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              Marca
            </h2>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Nombre de la plataforma</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="Ej. Negocio Vivo Hub"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Aparece en el sidebar y en el {"<title>"} del navegador.
              </p>
            </div>

            {ws && (
              <ImageUpload
                value={logo}
                onChange={setLogo}
                targetType="WORKSPACE"
                targetId={ws.id}
                shape="square"
                size={80}
                label="Logo (cuadrado, recomendado 256×256 px)"
              />
            )}

            <div className="flex items-center justify-between pt-2 border-t">
              <div className="text-xs text-slate-500">
                {savedAt && <>✓ Guardado a las {savedAt.toLocaleTimeString("es-ES")}</>}
                {error && <span className="text-rose-600">{error}</span>}
              </div>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Guardar cambios
              </button>
            </div>
          </form>

          {/* ── EVOLUTION / WHATSAPP WEBHOOK ────────────────────────── */}
          <div className="bg-white rounded-xl border p-5 mb-5">
            <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-2">
              <Webhook className="h-4 w-4 text-emerald-600" />
              Webhook de WhatsApp (Evolution API)
            </h2>
            <p className="text-xs text-slate-600 mb-3">
              Para recibir mensajes entrantes de WhatsApp en <a href="/admin/leads" className="underline">/admin/leads → Inbox</a>, pega esta URL como webhook en tu Evolution/WAHA.
            </p>

            {integrations?.evolution.hasToken ? (
              <>
                <div className="flex items-stretch gap-2 mb-2">
                  <input
                    readOnly
                    value={getWebhookUrl()}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    className="flex-1 px-3 py-2 rounded-lg border bg-slate-50 text-xs font-mono"
                  />
                  <button
                    onClick={copyUrl}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm"
                  >
                    {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copied ? "Copiado" : "Copiar"}
                  </button>
                </div>
                <button
                  onClick={regenerateToken}
                  disabled={regenerating}
                  className="text-xs text-slate-600 hover:text-rose-600 inline-flex items-center gap-1"
                >
                  {regenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Regenerar token (invalida el URL actual)
                </button>
              </>
            ) : (
              <button
                onClick={regenerateToken}
                disabled={regenerating}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
              >
                {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Webhook className="h-4 w-4" />}
                Generar URL del webhook
              </button>
            )}

            <details className="mt-3">
              <summary className="text-xs text-slate-500 cursor-pointer">Cómo configurarlo en Evolution/WAHA</summary>
              <ol className="text-xs text-slate-600 mt-2 list-decimal ml-5 space-y-1">
                <li>Entra al panel de tu Evolution API.</li>
                <li>Ve a <strong>Webhooks</strong> de tu instancia.</li>
                <li>Pega la URL copiada arriba.</li>
                <li>Selecciona los eventos <code>messages.upsert</code> (mensajes entrantes).</li>
                <li>Guarda. Prueba enviando un WhatsApp a tu número de empresa — debería aparecer en <a href="/admin/leads" className="underline">/admin/leads → Inbox</a>.</li>
              </ol>
            </details>
          </div>

          {/* ── ESTADO DE OTRAS INTEGRACIONES ────────────────────────── */}
          <div className="bg-white rounded-xl border p-5">
            <h2 className="text-sm font-semibold mb-3">Estado de otras integraciones</h2>
            <ul className="text-sm space-y-2">
              <IntegRow
                ok={Boolean(integrations?.evolution.hasUrl && integrations?.evolution.hasApiKey)}
                label="Evolution API URL + key"
                hint="Necesario para ENVIAR WhatsApp (recibir solo necesita el webhook arriba)."
                source="Importado desde NV Leads WP o configurado manualmente"
              />
              <IntegRow
                ok={integrations?.metricool.hasToken ?? false}
                label="Metricool API (reservada)"
                hint="Por ahora no se usa: el calendario editorial exporta un CSV (descarga o por email) que tú subes manualmente al importador de Metricool. La integración directa por API queda preparada para activarla cuando contrates el plan que la incluye."
                source="Importado desde NV Dashboard WP"
              />
              <IntegRow
                ok={integrations?.googlePlaces.hasApiKey ?? false}
                label="Google Places API key"
                hint="Para procesar búsquedas en NV Leads."
                source="Importado desde NV Leads WP"
              />
              <IntegRow
                ok={Boolean(integrations?.drive.folderRefs)}
                label="Google Drive folder refs"
                hint="Carpetas por cliente para assets editoriales."
                source="Importado desde NV Dashboard WP"
              />
            </ul>
            <p className="mt-3 text-[11px] text-slate-500">
              Las API keys se guardan cifradas (AES-256-GCM) en este workspace. Si falta alguna, vuelve a <a className="underline" href="/admin/wp-import">/admin/wp-import</a> y re-importa solo esa sección.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function IntegRow({ ok, label, hint, source }: { ok: boolean; label: string; hint: string; source: string }) {
  return (
    <li className="flex items-start gap-2 py-1.5 border-b last:border-b-0">
      <span className={ok ? "text-emerald-600" : "text-slate-400"}>{ok ? "✓" : "—"}</span>
      <div className="flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-slate-500">{hint}</div>
        <div className="text-[11px] text-slate-400">Origen: {source}</div>
      </div>
    </li>
  );
}

