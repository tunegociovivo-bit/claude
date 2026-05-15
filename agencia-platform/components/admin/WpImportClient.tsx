"use client";

import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Download, Loader2, Check, X, FileDown, ExternalLink, AlertTriangle } from "lucide-react";

const SECTIONS = [
  { id: "generador_resenas", label: "Generador Reseñas IA", desc: "Clientes + API key OpenAI + histórico" },
  { id: "voice_reviews", label: "Voice Reviews", desc: "Negocios + intro + URLs Google/Trustpilot + API keys" },
  { id: "nv_dashboard", label: "NV Dashboard", desc: "API keys Anthropic/OpenAI + Metricool + Drive + publicaciones (pending schema)" },
  { id: "nv_leads_pro", label: "NV Leads Pro", desc: "API keys Google Places + Evolution + 11 tablas (pending schema)" }
] as const;

export default function WpImportClient() {
  const [wpUrl, setWpUrl] = useState("https://hub.negociovivo.com");
  const [wpUser, setWpUser] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({
    generador_resenas: true,
    voice_reviews: true,
    nv_dashboard: true,
    nv_leads_pro: true
  });
  const [pingResult, setPingResult] = useState<any>(null);
  const [importResult, setImportResult] = useState<any>(null);
  const [pinging, setPinging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleSection(id: string) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }

  async function ping() {
    setError(null);
    setPingResult(null);
    setPinging(true);
    const r = await fetch("/api/v1/admin/wp-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wpUrl, wpUser, appPassword, dryRun: true })
    });
    setPinging(false);
    const data = await r.json();
    if (!r.ok) {
      setError(data?.error?.message ?? `Error ${r.status}`);
      return;
    }
    setPingResult(data);
  }

  async function doImport() {
    setError(null);
    setImportResult(null);
    setImporting(true);
    const sections = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
    const r = await fetch("/api/v1/admin/wp-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wpUrl, wpUser, appPassword, sections })
    });
    setImporting(false);
    const data = await r.json();
    // El nuevo flow devuelve report.sections con per-section ok/message
    if (data?.report) setImportResult(data.report);
    if (!r.ok || data?.report?.errors?.length) {
      setError(
        data?.error?.message
          ?? (data?.report?.errors && data.report.errors.length > 0
                ? data.report.errors.join("; ")
                : `Error ${r.status}`)
      );
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="Importar desde WordPress"
        description="Trae automáticamente API keys, clientes, negocios y datos de los plugins NV instalados en hub.negociovivo.com."
      />

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm">
        <div className="flex items-start gap-2 mb-2">
          <AlertTriangle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
          <p className="text-amber-900 font-medium">
            Antes de importar, tienes que instalar un plugin de exportación en tu WordPress (1 vez).
          </p>
        </div>
        <ol className="text-amber-900 list-decimal ml-9 space-y-1 text-[13px]">
          <li>Descarga <a href="/api/v1/admin/wp-import/exporter-plugin" className="underline font-medium">agencia-exporter.zip</a> (te lo genera Hub).</li>
          <li>En wp-admin → <strong>Plugins → Añadir nuevo → Subir plugin</strong>. Sube el ZIP.</li>
          <li><strong>Activa</strong> el plugin "Agencia Hub Exporter".</li>
          <li>Vuelve aquí, pulsa <strong>"Verificar conexión"</strong> abajo.</li>
          <li>Cuando hayas importado todo, puedes <strong>desactivar y borrar</strong> el plugin de WP.</li>
        </ol>
      </div>

      <div className="bg-white rounded-xl border p-5 mb-4">
        <h2 className="text-sm font-semibold mb-3">Credenciales WordPress</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-3">
            <label className="block text-xs font-medium text-slate-700 mb-1">URL del WordPress</label>
            <input
              value={wpUrl}
              onChange={(e) => setWpUrl(e.target.value)}
              placeholder="https://hub.negociovivo.com"
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Usuario admin de WP</label>
            <input
              value={wpUser}
              onChange={(e) => setWpUser(e.target.value)}
              placeholder="negociovivo"
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Application Password{" "}
              <a
                href="https://wordpress.org/documentation/article/application-passwords/"
                target="_blank"
                rel="noreferrer"
                className="text-brand-600 underline inline-flex items-center gap-0.5"
              >
                cómo generar <ExternalLink className="h-3 w-3" />
              </a>
            </label>
            <input
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              type="password"
              placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Se manda al backend de Hub, NO se guarda. Se usa solo para hacer la importación. Revoca el App Password en wp-admin → tu perfil cuando termines.
            </p>
          </div>
        </div>

        <button
          onClick={ping}
          disabled={pinging || !wpUrl || !wpUser || !appPassword}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm disabled:opacity-50"
        >
          {pinging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Verificar conexión
        </button>

        {pingResult && (
          <div className="mt-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm">
            <p className="text-emerald-800 font-medium">✓ Conexión OK</p>
            <p className="text-emerald-700 text-xs mt-1">
              Sitio: {pingResult.wp?.wp_site} · Admin: {pingResult.wp?.wp_admin}
            </p>
            <ul className="text-xs text-emerald-700 mt-1.5 space-y-0.5">
              {Object.entries(pingResult.wp?.plugins ?? {}).map(([k, v]) => (
                <li key={k}>
                  {v ? "✓" : "—"} {k}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border p-5 mb-4">
        <h2 className="text-sm font-semibold mb-3">Qué importar</h2>
        <div className="space-y-2">
          {SECTIONS.map((s) => (
            <label key={s.id} className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 cursor-pointer">
              <input
                type="checkbox"
                checked={selected[s.id]}
                onChange={() => toggleSection(s.id)}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="text-sm font-medium">{s.label}</div>
                <div className="text-xs text-slate-500">{s.desc}</div>
              </div>
            </label>
          ))}
        </div>

        <button
          onClick={doImport}
          disabled={importing || !pingResult}
          className="mt-4 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
        >
          {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Importar todo
        </button>
        {!pingResult && (
          <p className="text-[11px] text-slate-500 mt-1">Verifica primero la conexión.</p>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 mb-4">
          <p className="text-sm text-rose-800 font-medium flex items-center gap-1.5">
            <X className="h-4 w-4" />
            Error
          </p>
          <p className="text-xs text-rose-700 mt-1">{error}</p>
        </div>
      )}

      {importResult && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
          <h2 className="text-sm font-semibold text-emerald-900 mb-2">
            {importResult.errors && importResult.errors.length > 0 ? "⚠️ Importación parcial" : "✓ Importación completada"}
          </h2>
          <dl className="text-sm text-emerald-800 space-y-1">
            <Row label="Origen">{importResult.site}</Row>
            <Row label="API keys cifradas guardadas">{importResult.keysImported}</Row>
            <Row label="Clientes de Reseñas IA importados">{importResult.reviewClients}</Row>
            <Row label="Negocios de Voice Reviews importados">{importResult.voiceBusinesses}</Row>
            <Row label="Publicaciones NV Dashboard (en cola)">{importResult.pendingNvDashboard}</Row>
            <Row label="Filas NV Leads (en cola)">{importResult.pendingNvLeads}</Row>
          </dl>

          {importResult.sections && (
            <div className="mt-3">
              <h3 className="text-[11px] uppercase tracking-wide text-emerald-700 font-semibold mb-1">Detalle por sección</h3>
              <ul className="text-xs space-y-1">
                {Object.entries<any>(importResult.sections).map(([k, v]) => (
                  <li key={k} className={v.ok ? "text-emerald-700" : "text-rose-700"}>
                    {v.ok ? "✓" : "✗"} <strong>{k}</strong>
                    {v.message ? ` — ${v.message}` : ""}
                    {typeof v.bytes === "number" ? ` (${Math.round(v.bytes / 1024)} KB)` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-emerald-700 mt-3 leading-relaxed">
            Los datos "en cola" se aparcan cifrados dentro del workspace.settings hasta que migremos el schema de NV Dashboard y NV Leads. Las API keys ya están operativas — entra a <a href="/admin/reviews" className="underline">/admin/reviews</a> y <a href="/admin/voice-reviews" className="underline">/admin/voice-reviews</a> para ver los clientes/negocios importados.
          </p>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs uppercase tracking-wide text-emerald-700">{label}</dt>
      <dd className="font-semibold tabular-nums">{children}</dd>
    </div>
  );
}
