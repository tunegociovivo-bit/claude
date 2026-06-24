"use client";

/**
 * Panel admin del directorio SEO de Bubui: estadísticas + acciones (generar
 * contenido IA, geocodificar negocios) y acceso rápido a las páginas.
 */
import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Loader2, Store, MapPin, Sparkles, ExternalLink, Star, Percent } from "lucide-react";

type Status = {
  activeTotal: number;
  missingGeo: number;
  categories: number;
  localities: number;
  pairs: number;
  editorialGenerated: number;
  topPairs: { catSlug: string; catLabel: string; citySlug: string; cityLabel: string; count: number }[];
};

const BUBUI = (process.env.NEXT_PUBLIC_BUBUI_URL || "https://bubui.app").replace(/\/+$/, "");

export default function BubuiDirectoryAdmin() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "gen" | "geo" | "google" | "presets">(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/v1/admin/bubui/directory/status");
      if (r.ok) setStatus(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function generate() {
    setBusy("gen");
    setMsg(null);
    try {
      const r = await fetch("/api/v1/admin/bubui/directory/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 12 })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setMsg(`❌ ${j?.error?.message ?? `Error ${r.status}`}`);
      else setMsg(`✅ Generadas ${j.generated} páginas (faltan ~${j.pendingApprox}). Vuelve a pulsar para seguir.`);
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function refreshGoogle() {
    setBusy("google");
    setMsg(null);
    try {
      const r = await fetch("/api/v1/admin/bubui/directory/refresh-google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 25 })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setMsg(`❌ ${j?.error?.message ?? `Error ${r.status}`}`);
      else setMsg(`✅ Notas de Google actualizadas: ${j.updated}. Pendientes de refrescar: ${j.remaining}.`);
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function applyPresets() {
    if (!confirm("Aplicar los descuentos por acción preestablecidos a los comercios existentes que aún tienen el valor antiguo (compartir 10/5 · reseña 8 · seguir 5 · foto 5 · cupón 10 · recordatorio post-compra)? No pisa a quien lo haya personalizado.")) return;
    setBusy("presets");
    setMsg(null);
    try {
      const r = await fetch("/api/v1/admin/bubui/apply-discount-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setMsg(`❌ ${j?.error?.message ?? `Error ${r.status}`}`);
      else {
        const u = j.updated ?? {};
        setMsg(`✅ Presets aplicados — compartir: ${u.compartir}, amigos: ${u.amigos}, reseña: ${u.resena}, seguir: ${u.seguir}, foto: ${u.foto}, cupón: ${u.cuponCruzado}, recordatorio: ${u.recordatorioPostCompra}.`);
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function geocode() {
    setBusy("geo");
    setMsg(null);
    try {
      const r = await fetch("/api/v1/admin/bubui/directory/backfill-geo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 25 })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setMsg(`❌ ${j?.error?.message ?? `Error ${r.status}`}`);
      else setMsg(`✅ Geocodificados ${j.updated} (fallos ${j.failed}). Sin coordenadas aún: ${j.remaining}.`);
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Bubui · Directorio SEO"
        description="Páginas por nicho y localidad para posicionar en Google y captar negocios."
        actions={
          <a href={`${BUBUI}/directorio`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm rounded-lg border bg-white px-3 py-2 hover:bg-slate-50">
            <ExternalLink className="h-4 w-4" /> Ver directorio
          </a>
        }
      />

      {loading ? (
        <div className="grid place-items-center py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : !status ? (
        <p className="text-sm text-rose-600">No se pudo cargar el estado.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Stat label="Negocios activos" value={status.activeTotal} icon={<Store className="h-4 w-4" />} />
            <Stat label="Sectores" value={status.categories} />
            <Stat label="Localidades" value={status.localities} />
            <Stat label="Páginas (nicho+loc)" value={status.pairs} />
            <Stat label="Con texto IA" value={status.editorialGenerated} icon={<Sparkles className="h-4 w-4" />} />
            <Stat label="Sin geo" value={status.missingGeo} icon={<MapPin className="h-4 w-4" />} highlight={status.missingGeo > 0} />
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button onClick={generate} disabled={!!busy} className="inline-flex items-center gap-2 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5">
              {busy === "gen" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generar contenido SEO (IA)
            </button>
            <button onClick={geocode} disabled={!!busy} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5">
              {busy === "geo" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
              Geocodificar negocios ({status.missingGeo})
            </button>
            <button onClick={refreshGoogle} disabled={!!busy} className="inline-flex items-center gap-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5">
              {busy === "google" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className="h-4 w-4" />}
              Actualizar notas de Google
            </button>
            <button onClick={applyPresets} disabled={!!busy} className="inline-flex items-center gap-2 rounded-lg bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5">
              {busy === "presets" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Percent className="h-4 w-4" />}
              Aplicar presets de descuentos
            </button>
          </div>
          {msg && <p className="mt-3 text-sm text-slate-700">{msg}</p>}
          <p className="mt-2 text-xs text-slate-400">
            La generación IA procesa por tandas (12 páginas) y solo las que aún no tienen texto. El geocoding rellena coordenadas y localidad de negocios sin ubicar (tandas de 25).
          </p>

          {status.topPairs.length > 0 && (
            <div className="mt-8">
              <h2 className="text-sm font-semibold text-slate-700 mb-2">Páginas con más negocios</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {status.topPairs.map((p) => (
                  <a key={`${p.catSlug}/${p.citySlug}`} href={`${BUBUI}/${p.catSlug}/${p.citySlug}`} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-lg border bg-white px-3 py-2 text-sm hover:bg-slate-50">
                    <span className="text-slate-700 truncate">{p.catLabel} en {p.cityLabel}</span>
                    <span className="text-xs text-slate-400 shrink-0 ml-2">{p.count}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, icon, highlight }: { label: string; value: number; icon?: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={"rounded-xl border bg-white p-3 " + (highlight ? "border-amber-300 bg-amber-50" : "border-slate-200")}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-500">{icon}{label}</div>
      <div className="mt-1 text-2xl font-black text-slate-900">{value}</div>
    </div>
  );
}
