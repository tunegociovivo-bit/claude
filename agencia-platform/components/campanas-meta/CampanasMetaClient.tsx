"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Megaphone, Plus, Settings2, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import MetaGuardBadge from "@/components/admin/MetaGuardBadge";
import MetaConnectionModal from "./MetaConnectionModal";
import CampaignWizard from "./CampaignWizard";
import MetaSuiteNav from "@/components/meta/MetaSuiteNav";

type CampaignRow = {
  id: string;
  name: string;
  objective: string;
  status: string;
  startDate: string;
  endDate: string | null;
  dailyBudgetCents: number;
  adsetsCount: number;
  adsCount: number;
  createdAt: string;
};

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  DRAFT: { label: "Borrador", color: "bg-slate-100 text-slate-700 border-slate-200" },
  PENDING_REVIEW: { label: "Pendiente revisión", color: "bg-amber-100 text-amber-800 border-amber-300" },
  APPROVED: { label: "Aprobada", color: "bg-violet-100 text-violet-800 border-violet-300" },
  LAUNCHING: { label: "Lanzando", color: "bg-sky-100 text-sky-800 border-sky-300" },
  ACTIVE: { label: "Activa", color: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  PAUSED: { label: "Pausada", color: "bg-slate-200 text-slate-700 border-slate-300" },
  COMPLETED: { label: "Finalizada", color: "bg-slate-100 text-slate-600 border-slate-200" },
  FAILED: { label: "Error", color: "bg-rose-100 text-rose-800 border-rose-300" }
};

export default function CampanasMetaClient() {
  const [items, setItems] = useState<CampaignRow[] | null>(null);
  const [connected, setConnected] = useState<{ connected: boolean; metaUserId?: string; shared?: boolean } | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);

  async function load() {
    const [c, cn] = await Promise.all([
      fetch("/api/v1/meta/campaigns").then((r) => r.json()),
      fetch("/api/v1/meta/connection").then((r) => r.json())
    ]);
    setItems(c.items ?? []);
    setConnected(cn);
  }
  useEffect(() => { load(); }, []);

  return (
    <div>
      <MetaSuiteNav />
      <PageHeader
        title="Campañas Meta"
        description="Planifica, lanza y supervisa campañas de Meta (Facebook/Instagram) con ayuda de IA."
        actions={
          <>
            <button
              onClick={() => setTokenOpen(true)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white border text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Settings2 className="h-4 w-4" />
              {connected?.connected ? "Conexión Meta" : "Conectar Meta"}
            </button>
            <button
              onClick={() => {
                if (!connected?.connected) {
                  setTokenOpen(true);
                  return;
                }
                setWizardOpen(true);
              }}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              Nueva campaña
            </button>
          </>
        }
      />

      <MetaGuardBadge />

      {/* Estado de conexión */}
      {connected && (
        <div
          className={`mb-4 px-4 py-3 rounded-lg border text-sm flex items-start gap-2 ${
            connected.connected
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-amber-50 border-amber-200 text-amber-900"
          }`}
        >
          {connected.connected ? (
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          )}
          <div className="flex-1">
            {connected.connected ? (
              connected.shared ? (
                <>
                  Conexión con Meta activa usando el <strong>token permanente guardado</strong> del workspace. Ya puedes crear campañas (o pega tu propio token en "Conexión Meta" si prefieres).
                </>
              ) : (
                <>
                  Conexión con Meta activa (id: {connected.metaUserId ?? "—"}). Ya puedes crear campañas.
                </>
              )
            ) : (
              <>
                <strong>Sin conexión con Meta.</strong> Antes de crear campañas tienes que pegar
                tu Access Token de Meta (lo sacas del Business Manager →{" "}
                <a href="https://business.facebook.com/settings/system-users" className="underline" target="_blank" rel="noreferrer">System Users</a>).
              </>
            )}
          </div>
        </div>
      )}

      {/* Lista */}
      {items === null && (
        <div className="py-12 text-center text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
          Cargando campañas…
        </div>
      )}

      {items && items.length === 0 && (
        <div className="py-16 text-center bg-white rounded-xl border">
          <Megaphone className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-slate-900 mb-1">Sin campañas todavía</h2>
          <p className="text-sm text-slate-500 mb-4">
            Crea tu primera campaña — la plataforma te guía paso a paso.
          </p>
          <button
            onClick={() => {
              if (!connected?.connected) { setTokenOpen(true); return; }
              setWizardOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            Nueva campaña
          </button>
        </div>
      )}

      {items && items.length > 0 && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="text-left px-4 py-2.5">Nombre</th>
                <th className="text-left px-4 py-2.5">Estado</th>
                <th className="text-left px-4 py-2.5">Objetivo</th>
                <th className="text-right px-4 py-2.5">€/día</th>
                <th className="text-right px-4 py-2.5">Conjuntos / Anuncios</th>
                <th className="text-left px-4 py-2.5">Fechas</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((c) => {
                const s = STATUS_LABEL[c.status] ?? { label: c.status, color: "bg-slate-100 text-slate-700" };
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/campanas-meta/${c.id}`} className="font-medium text-slate-900 hover:text-brand-600">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${s.color}`}>
                        {s.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{c.objective}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{(c.dailyBudgetCents / 100).toFixed(2)} €</td>
                    <td className="px-4 py-3 text-right text-slate-700">{c.adsetsCount} / {c.adsCount}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {new Date(c.startDate).toLocaleDateString()}
                      {c.endDate ? ` → ${new Date(c.endDate).toLocaleDateString()}` : " → sin fin"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <MetaConnectionModal open={tokenOpen} onClose={() => setTokenOpen(false)} onSaved={load} />
      <CampaignWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={() => { setWizardOpen(false); load(); }}
      />
    </div>
  );
}
