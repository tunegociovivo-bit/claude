"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import ImageUpload from "@/components/ui/ImageUpload";
import { Loader2, Save } from "lucide-react";

type Workspace = { id: string; name: string; slug: string; logo: string | null };

export default function WorkspaceSettingsClient() {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [name, setName] = useState("");
  const [logo, setLogo] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  async function load() {
    setLoading(true);
    const r = await fetch("/api/v1/workspace");
    if (r.ok) {
      const d = await r.json();
      if (d) {
        setWs(d);
        setName(d.name);
        setLogo(d.logo ?? "");
      }
    }
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

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader
        title="Identidad del workspace"
        description="Cambia el nombre y el logo que ven todos los miembros en el sidebar y en pantallas públicas."
      />

      {loading ? (
        <div className="bg-white rounded-xl border p-8 text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : (
        <form onSubmit={save} className="bg-white rounded-xl border p-5 space-y-5">
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
      )}

      <p className="mt-4 text-xs text-slate-500">
        Tras guardar, los cambios se ven en cuanto recargues la página (el sidebar y el TopBar consultan al cargar).
      </p>
    </div>
  );
}
