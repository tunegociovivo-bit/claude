"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, RefreshCw, ShieldCheck } from "lucide-react";

type Dashboard = {
  config: { enabled: boolean; startsAt: string; lastSyncAt: string | null; lastError: string | null };
  summary: { matched: number; unmatched: number };
  items: Array<{
    id: string; bookedAt: string; amountCents: number; currency: string; counterpartyName: string | null;
    reference: string | null; status: string; matchConfidence: string | null;
    invoice: { number: string | null; clientSnapshot: any } | null;
  }>;
};

const money = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

export default function ReconciliationClient() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [syncing, setSyncing] = useState(false);

  async function load() {
    setLoading(true);
    const response = await fetch("/api/v1/facturacion/reconciliation", { cache: "no-store" });
    if (response.ok) setData(await response.json());
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  async function forceSync() {
    setSyncing(true);
    try {
      const response = await fetch("/api/v1/facturacion/reconciliation", { method: "POST" });
      if (!response.ok) throw new Error("No se pudo solicitar la resincronización");
      await load();
      const startedAt = Date.now();
      const timer = window.setInterval(async () => {
        const current = await fetch("/api/v1/facturacion/reconciliation", { cache: "no-store" });
        if (!current.ok) return;
        const next = await current.json() as Dashboard;
        setData(next);
        if (next.config.lastSyncAt || Date.now() - startedAt > 120_000) {
          window.clearInterval(timer);
          setSyncing(false);
        }
      }, 5000);
    } catch (error: any) {
      setSyncing(false);
      window.alert(error?.message ?? "No se pudo solicitar la resincronización");
    }
  }

  async function downloadInstaller() {
    const name = window.prompt("Nombre de este ordenador", "PC-Oficina Negocio Vivo");
    if (!name?.trim()) return;
    setInstalling(true);
    try {
      const response = await fetch("/api/v1/facturacion/agents/bootstrap", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() })
      });
      if (!response.ok) throw new Error("No se pudo generar el instalador");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = `agente-negocio-vivo-${new Date().toISOString().slice(0, 10)}.zip`; link.click();
      URL.revokeObjectURL(url);
    } catch (error: any) { window.alert(error?.message ?? "No se pudo generar el instalador"); }
    finally { setInstalling(false); }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-white p-4 flex flex-wrap gap-4 items-center">
        <div className="flex-1 min-w-[240px]">
          <div className="font-semibold text-slate-900">Conciliación automática Santander</div>
          <div className="text-sm text-slate-600 mt-1">
            Solo importa abonos desde el 10/08/2026. Las coincidencias ambiguas nunca marcan una factura como pagada.
          </div>
          {data && <div className="text-xs text-slate-500 mt-1">Última sincronización: {data.config.lastSyncAt ? new Date(data.config.lastSyncAt).toLocaleString("es-ES") : "pendiente del primer cobro"}</div>}
        </div>
        <button onClick={() => void forceSync()} disabled={syncing} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {syncing ? "Resincronizando…" : "Forzar resincronización"}
        </button>
        <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Actualizar
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border bg-emerald-50 p-4"><div className="text-xs text-emerald-700">Cobros conciliados</div><div className="text-2xl font-semibold text-emerald-900">{data?.summary.matched ?? 0}</div></div>
        <div className="rounded-xl border bg-amber-50 p-4"><div className="text-xs text-amber-700">Pendientes de revisar</div><div className="text-2xl font-semibold text-amber-900">{data?.summary.unmatched ?? 0}</div></div>
      </div>

      <div className="rounded-xl border bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-3">Fecha</th><th className="p-3">Ordenante / concepto</th><th className="p-3">Importe</th><th className="p-3">Factura</th><th className="p-3">Estado</th></tr></thead>
          <tbody>{data?.items.length ? data.items.map((item) => <tr key={item.id} className="border-t">
            <td className="p-3 whitespace-nowrap">{new Date(item.bookedAt).toLocaleDateString("es-ES")}</td>
            <td className="p-3"><div className="font-medium">{item.counterpartyName ?? "Sin ordenante"}</div><div className="text-xs text-slate-500 max-w-md truncate">{item.reference}</div></td>
            <td className="p-3 font-medium">{money.format(item.amountCents / 100)}</td>
            <td className="p-3">{item.invoice?.number ?? "—"}</td>
            <td className="p-3"><span className={`rounded-full px-2 py-1 text-xs ${item.status === "MATCHED" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{item.status === "MATCHED" ? "Conciliado" : "Revisar"}</span></td>
          </tr>) : <tr><td colSpan={5} className="p-8 text-center text-slate-400">Aún no hay movimientos importados desde la fecha de inicio.</td></tr>}</tbody>
        </table>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 flex flex-wrap gap-4 items-center">
        <ShieldCheck className="h-6 w-6 text-blue-700" />
        <div className="flex-1 min-w-[240px]"><div className="font-semibold text-blue-950">Recuperación e instalación del agente</div><div className="text-sm text-blue-800">Descarga un paquete listo para un PC nuevo con la configuración, selectores y token de enrolamiento. No incluye usuario, contraseña ni clave bancaria.</div></div>
        <button onClick={() => void downloadInstaller()} disabled={installing} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50">
          {installing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Descargar instalador
        </button>
      </div>
    </div>
  );
}
