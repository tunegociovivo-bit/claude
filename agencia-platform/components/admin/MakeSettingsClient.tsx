"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import {
  Loader2,
  Save,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  ExternalLink
} from "lucide-react";

type Status = {
  hasToken: boolean;
  zone: "eu1" | "eu2" | "us1" | "us2";
  teamId: number | null;
};

const ZONES: Array<{ id: Status["zone"]; label: string }> = [
  { id: "eu1", label: "EU 1 (eu1.make.com)" },
  { id: "eu2", label: "EU 2 (eu2.make.com)" },
  { id: "us1", label: "US 1 (us1.make.com)" },
  { id: "us2", label: "US 2 (us2.make.com)" }
];

export default function MakeSettingsClient() {
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState("");
  const [zone, setZone] = useState<Status["zone"]>("eu1");
  const [teamId, setTeamId] = useState<string>("");
  const [teamsAvailable, setTeamsAvailable] = useState<Array<{ id: number; name: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function load() {
    const r = await fetch("/api/v1/admin/make-settings");
    if (r.ok) {
      const d: Status = await r.json();
      setStatus(d);
      setZone(d.zone);
      setTeamId(d.teamId ? String(d.teamId) : "");
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/v1/admin/make-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiToken: token,
          zone,
          teamId: teamId ? Number(teamId) : null
        })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setMsg({
        type: "ok",
        text:
          `✅ Conectado a Make (zona ${d.zone}). Team activo: ${d.teamId ?? "—"}. ` +
          (d.teamsAvailable?.length > 1
            ? `Tienes ${d.teamsAvailable.length} teams disponibles — abajo puedes cambiar.`
            : "")
      });
      setTeamsAvailable(d.teamsAvailable ?? []);
      setToken("");
      await load();
    } catch (e: any) {
      setMsg({ type: "err", text: e?.message ?? String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function disable() {
    if (!confirm("¿Desactivar Make? Sonia perderá acceso a los escenarios.")) return;
    await fetch("/api/v1/admin/make-settings", { method: "DELETE" });
    setMsg(null);
    await load();
  }

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Make.com (automatizaciones)"
        description="Sonia puede listar, duplicar y activar escenarios Make. Útil tras crear una campaña Meta Lead Ads para clonar el escenario que manda leads por email al cliente."
      />

      {/* Estado */}
      <div
        className={
          "rounded-xl border p-4 mb-4 flex items-center justify-between " +
          (status?.hasToken
            ? "bg-emerald-50 border-emerald-200"
            : "bg-amber-50 border-amber-200")
        }
      >
        <div className="text-sm">
          {status?.hasToken ? (
            <>
              <strong className="text-emerald-800 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Make conectado
              </strong>
              <div className="text-xs text-emerald-700 mt-1">
                Zona: <code className="bg-white px-1 rounded">{status.zone}</code>
                {status.teamId && (
                  <>
                    {" · "}
                    Team default: <code className="bg-white px-1 rounded">{status.teamId}</code>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <strong className="text-amber-800 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Make no configurado
              </strong>
              <p className="text-xs text-amber-700 mt-1 max-w-xl">
                Sonia no podrá crear/duplicar escenarios automáticamente — los
                pondrá como "pendientes humanos" en los comentarios.
              </p>
            </>
          )}
        </div>
        {status?.hasToken && (
          <button
            onClick={disable}
            className="inline-flex items-center gap-1 text-xs text-rose-600 hover:bg-rose-50 px-2 py-1 rounded-lg"
          >
            <Trash2 className="h-3.5 w-3.5" /> Desactivar
          </button>
        )}
      </div>

      {/* Cómo crear el token */}
      <details className="bg-white border rounded-xl p-4 mb-4">
        <summary className="cursor-pointer font-semibold text-sm">
          ❓ Cómo crear el API token de Make (1 minuto)
        </summary>
        <ol className="mt-3 space-y-2 text-sm text-slate-700 list-decimal pl-5">
          <li>
            En Make: clic en tu avatar (arriba derecha) →{" "}
            <strong>Profile</strong> → pestaña <strong>API</strong>.
          </li>
          <li>
            Click "Add Token". Pon nombre "Hub Sonia". Marca estos scopes:
            <ul className="list-disc pl-5 mt-1 text-xs">
              <li>
                <code>scenarios:read</code> y <code>scenarios:write</code>
              </li>
              <li>
                <code>teams:read</code>
              </li>
              <li>
                <code>connections:read</code>
              </li>
            </ul>
          </li>
          <li>
            Copia el token (formato largo de ~36 chars). Pégalo abajo.
          </li>
          <li>
            Elige la <strong>zona</strong> correcta según la URL de tu Make.
            Si tu URL es <code>eu1.make.com/...</code> → zona EU 1, etc.
          </li>
          <li>
            Link rápido:{" "}
            <a
              href="https://eu1.make.com/profile/api"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-600 hover:underline inline-flex items-center gap-0.5"
            >
              eu1.make.com/profile/api <ExternalLink className="h-3 w-3" />
            </a>
            {" · "}
            <a
              href="https://eu2.make.com/profile/api"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-600 hover:underline inline-flex items-center gap-0.5"
            >
              eu2 <ExternalLink className="h-3 w-3" />
            </a>
            {" · "}
            <a
              href="https://us1.make.com/profile/api"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-600 hover:underline inline-flex items-center gap-0.5"
            >
              us1 <ExternalLink className="h-3 w-3" />
            </a>
          </li>
        </ol>
      </details>

      {/* Form */}
      <div className="bg-white border rounded-xl p-5">
        <h2 className="font-semibold text-sm mb-3">Configuración</h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-600 block mb-1">
              API Token{" "}
              {status?.hasToken && (
                <span className="text-slate-400">(deja vacío para mantener)</span>
              )}
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Pega aquí el token de Make"
              className="w-full rounded-lg border border-slate-300 p-2 text-sm font-mono"
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-600 block mb-1">Zona</label>
              <select
                value={zone}
                onChange={(e) => setZone(e.target.value as Status["zone"])}
                className="w-full rounded-lg border border-slate-300 p-2 text-sm"
              >
                {ZONES.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-600 block mb-1">
                Team ID default (opcional)
              </label>
              {teamsAvailable.length > 0 ? (
                <select
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 text-sm"
                >
                  <option value="">— auto-detectar —</option>
                  {teamsAvailable.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} (ID {t.id})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value)}
                  placeholder="(se detecta al guardar)"
                  className="w-full rounded-lg border border-slate-300 p-2 text-sm font-mono"
                />
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={save}
              disabled={saving || (!token && !status?.hasToken)}
              className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-300 text-white text-sm px-4 py-2 rounded-lg font-medium"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Validar y guardar
            </button>
            <p className="text-xs text-slate-500">
              Probamos contra Make antes de guardar.
            </p>
          </div>
          {msg && (
            <div
              className={
                "rounded-lg p-3 text-sm " +
                (msg.type === "ok"
                  ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                  : "bg-rose-50 border border-rose-200 text-rose-800")
              }
            >
              {msg.text}
            </div>
          )}
        </div>
      </div>

      {/* Cómo lo usa Sonia */}
      <div className="mt-4 bg-violet-50 border border-violet-200 rounded-xl p-4 text-xs text-violet-800">
        <strong>Flujo típico tras configurar:</strong>
        <ol className="list-decimal pl-5 mt-2 space-y-1">
          <li>
            Creas un escenario plantilla en Make: Facebook Lead Ads trigger →
            Email destinatarios. Lo dejas activo con un cliente cualquiera.
          </li>
          <li>
            Cuando Sonia cree una campaña Meta Lead Ads nueva, automáticamente:
            (a) busca tu escenario plantilla, (b) lee su blueprint, (c) cambia
            el form ID + destinatarios al cliente nuevo, (d) crea + activa el
            escenario clonado. Sin tu intervención.
          </li>
          <li>
            Si no encuentra plantilla, te lo dice en el comentario para que
            crees una. La duplicación necesita un escenario base para
            funcionar.
          </li>
        </ol>
      </div>
    </div>
  );
}
