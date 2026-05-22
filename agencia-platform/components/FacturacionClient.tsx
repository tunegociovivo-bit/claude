"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Users, X, Loader2, Search, Check, FileText, Wallet, Upload } from "lucide-react";
import { formatMoney } from "@/lib/invoicing/core";
import FacturasClient from "@/components/admin/FacturasClient";
import GastosClient from "@/components/GastosClient";
import ImporterClient from "@/components/admin/ImporterClient";

const MONTH_LABEL = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" });
type MonthSummary = {
  facturado: number;
  cobrado: number;
  pendiente: number;
  count: number;
  gastos: number;
  resultado: number;
};

// Las 4 empresas iniciales (para detectar si falta crearlas).
const DEFAULT_NAMES = ["Negocio Vivo S.C.A.", "Pronsia S.L.", "LemonRoi L.L.C.", "Rixus Solutions L.L.C."];

// Cuenta como "facturado" lo que no es presupuesto/proforma ni borrador/anulada.
const REAL_TYPES_EXCLUDED = ["PRESUPUESTO", "PROFORMA"];
const NON_BILLED_STATUS = ["DRAFT", "CANCELLED", "REJECTED"];

type ClientLite = { id: string; name: string; taxId: string | null };
type Issuer = {
  id: string;
  name: string;
  legalName?: string | null;
  taxId: string;
  isDefault?: boolean;
  [k: string]: any;
};

const LS_KEY = "facturacion-empresa-v1";

export default function FacturacionClient({
  clients,
  initialIssuers
}: {
  clients: ClientLite[];
  initialIssuers: Issuer[];
}) {
  const [issuers, setIssuers] = useState<Issuer[]>(initialIssuers ?? []);
  const [selectedId, setSelectedId] = useState<string>("");
  const [summary, setSummary] = useState<MonthSummary | null>(null);
  const [tick, setTick] = useState(0);
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [tab, setTab] = useState<"facturas" | "gastos" | "importar">("facturas");

  const missingDefaults = DEFAULT_NAMES.filter(
    (n) => !issuers.some((i) => i.name.toLowerCase().trim() === n.toLowerCase().trim())
  );

  async function seedDefaults() {
    setSeeding(true);
    try {
      const r = await fetch("/api/v1/admin/invoice-issuers/seed-defaults", { method: "POST" });
      if (r.ok) await refreshIssuers();
    } finally {
      setSeeding(false);
    }
  }

  // Selección inicial: localStorage → emisor por defecto → primero.
  useEffect(() => {
    const saved = (() => {
      try {
        return localStorage.getItem(LS_KEY) ?? "";
      } catch {
        return "";
      }
    })();
    const valid = issuers.find((i) => i.id === saved);
    const fallback = issuers.find((i) => i.isDefault) ?? issuers[0];
    setSelectedId(valid?.id ?? fallback?.id ?? "");
    // solo al montar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function select(id: string) {
    setSelectedId(id);
    try {
      localStorage.setItem(LS_KEY, id);
    } catch {}
  }

  const refreshIssuers = useCallback(async () => {
    const r = await fetch("/api/v1/invoice-issuers", { cache: "no-store" });
    if (!r.ok) return;
    const list: Issuer[] = (await r.json()).items ?? [];
    setIssuers(list);
    // Si no había selección válida (p.ej. acaban de crear la primera), elige una.
    setSelectedId((cur) => {
      if (list.find((i) => i.id === cur)) return cur;
      const next = list.find((i) => i.isDefault) ?? list[0];
      if (next) {
        try {
          localStorage.setItem(LS_KEY, next.id);
        } catch {}
        return next.id;
      }
      return "";
    });
  }, []);

  // Resumen mensual de la empresa seleccionada (independiente de los
  // filtros de la tabla). Se refresca cuando cambian las facturas.
  useEffect(() => {
    if (!selectedId) {
      setSummary(null);
      return;
    }
    let aborted = false;
    (async () => {
      const [ir, er] = await Promise.all([
        fetch(`/api/v1/invoices?issuerId=${selectedId}`, { cache: "no-store" }),
        fetch(`/api/v1/expenses?issuerId=${selectedId}`, { cache: "no-store" })
      ]);
      if (aborted) return;
      const items: any[] = ir.ok ? (await ir.json()).items ?? [] : [];
      const expItems: any[] = er.ok ? (await er.json()).items ?? [] : [];
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const real = items.filter(
        (i) =>
          !REAL_TYPES_EXCLUDED.includes(i.type) &&
          !NON_BILLED_STATUS.includes(i.status) &&
          new Date(i.issueDate).getTime() >= monthStart
      );
      const facturado = real.reduce((s, i) => s + (i.totalCents ?? 0), 0);
      const cobrado = real.filter((i) => i.status === "PAID").reduce((s, i) => s + (i.totalCents ?? 0), 0);
      const pendiente = real
        .filter((i) => i.status === "ISSUED")
        .reduce((s, i) => s + ((i.totalCents ?? 0) - (i.paidCents ?? 0)), 0);
      const gastos = expItems
        .filter((e) => new Date(e.date).getTime() >= monthStart)
        .reduce((s, e) => s + (e.totalCents ?? 0), 0);
      if (!aborted) setSummary({ facturado, cobrado, pendiente, count: real.length, gastos, resultado: facturado - gastos });
    })();
    return () => {
      aborted = true;
    };
  }, [selectedId, tick]);

  const bump = useCallback(() => setTick((t) => t + 1), []);

  // Clientes asignados a la empresa seleccionada.
  useEffect(() => {
    if (!selectedId) {
      setAssignedIds([]);
      return;
    }
    let aborted = false;
    (async () => {
      const r = await fetch(`/api/v1/invoice-issuers/${selectedId}/clients`, { cache: "no-store" });
      if (!r.ok || aborted) return;
      const data = await r.json();
      if (!aborted) setAssignedIds(data.clientIds ?? []);
    })();
    return () => {
      aborted = true;
    };
  }, [selectedId]);

  const selected = issuers.find((i) => i.id === selectedId) ?? null;
  const monthName = MONTH_LABEL.format(new Date());

  return (
    <div className="space-y-4">
      {/* Aviso para crear las 4 empresas iniciales si faltan */}
      {missingDefaults.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
          <div className="text-sm text-amber-800 flex-1 min-w-[200px]">
            Faltan {missingDefaults.length} de las 4 empresas iniciales ({missingDefaults.join(", ")}). Puedes crearlas de
            golpe y completar sus datos fiscales luego.
          </div>
          <button
            onClick={seedDefaults}
            disabled={seeding}
            className="inline-flex items-center gap-1.5 bg-amber-600 text-white text-sm px-3 py-2 rounded-lg hover:bg-amber-700 disabled:opacity-50"
          >
            {seeding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
            Crear empresas iniciales
          </button>
        </div>
      )}

      {/* Selector de empresa — lo primero de Facturación */}
      <div className="bg-white border rounded-xl p-4">
        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
          <Building2 className="h-3.5 w-3.5" /> Empresa de facturación
        </label>
        {issuers.length === 0 ? (
          <div className="text-sm text-slate-600">
            Aún no tienes ninguna empresa emisora. Usa el botón de arriba para crear las 4 empresas iniciales, o crea una
            con el botón{" "}
            <span className="inline-flex items-center gap-1 font-medium">
              <Building2 className="h-3.5 w-3.5" /> Emisores
            </span>{" "}
            de abajo.
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={selectedId}
              onChange={(e) => select(e.target.value)}
              className="min-w-[260px] px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {issuers.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                  {i.taxId ? ` · ${i.taxId}` : ""}
                  {i.isDefault ? " (por defecto)" : ""}
                </option>
              ))}
            </select>
            {selected && (
              <button
                onClick={() => setAssignOpen(true)}
                className="inline-flex items-center gap-1.5 bg-white border text-sm px-3 py-2 rounded-lg hover:bg-slate-50"
              >
                <Users className="h-4 w-4" /> Clientes de esta empresa ({assignedIds.length})
              </button>
            )}
            {selected && (
              <span className="text-xs text-slate-500">
                Se emitirá desde <span className="font-medium text-slate-700">{selected.name}</span>.
              </span>
            )}
          </div>
        )}

        {/* Resumen rápido del mes para la empresa elegida */}
        {selected && summary && (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 border-t pt-3">
            <SummaryStat
              label={`Facturado · ${monthName}`}
              value={formatMoney(summary.facturado)}
              hint={`${summary.count} ${summary.count === 1 ? "documento" : "documentos"}`}
              color="text-slate-900"
            />
            <SummaryStat label="Cobrado" value={formatMoney(summary.cobrado)} color="text-emerald-700" />
            <SummaryStat label="Pendiente de cobro" value={formatMoney(summary.pendiente)} color="text-blue-700" />
            <SummaryStat label="Gastos del mes" value={formatMoney(summary.gastos)} color="text-rose-700" />
            <SummaryStat
              label="Resultado"
              value={formatMoney(summary.resultado)}
              color={summary.resultado >= 0 ? "text-emerald-700" : "text-rose-700"}
            />
          </div>
        )}
      </div>

      {/* Pestañas: Facturas / Gastos */}
      {selected && (
        <div className="flex items-center gap-1 border-b">
          <TabButton active={tab === "facturas"} onClick={() => setTab("facturas")} icon={<FileText className="h-4 w-4" />}>
            Facturas
          </TabButton>
          <TabButton active={tab === "gastos"} onClick={() => setTab("gastos")} icon={<Wallet className="h-4 w-4" />}>
            Gastos
          </TabButton>
          <TabButton active={tab === "importar"} onClick={() => setTab("importar")} icon={<Upload className="h-4 w-4" />}>
            Importar facturas
          </TabButton>
        </div>
      )}

      {/* Contenido de la pestaña activa, limitado a la empresa elegida */}
      {tab === "gastos" && selected ? (
        <GastosClient key={`g-${selected.id}`} issuerId={selected.id} onExpensesChanged={bump} />
      ) : tab === "importar" && selected ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Sube un listado de facturas en PDF, CSV o Excel, o tráelas directamente de Holded. Lo importado se asigna a{" "}
            <span className="font-medium text-slate-800">{selected.name}</span>. Las facturas duplicadas (mismo número) se
            omiten y los clientes ya existentes solo se completan.
          </p>
          <ImporterClient initialEntity="invoices" lockEntity issuerId={selected.id} enableHolded />
        </div>
      ) : (
        <FacturasClient
          key={selected?.id ?? "none"}
          clients={clients}
          initialIssuers={issuers as any}
          lockedIssuerId={selected?.id}
          clientFilterIds={assignedIds}
          onIssuersChanged={refreshIssuers}
          onInvoicesChanged={bump}
        />
      )}

      {assignOpen && selected && (
        <AssignClientsModal
          issuer={selected}
          allClients={clients}
          assignedIds={assignedIds}
          onClose={() => setAssignOpen(false)}
          onSaved={(ids) => {
            setAssignedIds(ids);
            setAssignOpen(false);
          }}
        />
      )}
    </div>
  );
}

function AssignClientsModal({
  issuer,
  allClients,
  assignedIds,
  onClose,
  onSaved
}: {
  issuer: Issuer;
  allClients: ClientLite[];
  assignedIds: string[];
  onClose: () => void;
  onSaved: (ids: string[]) => void;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set(assignedIds));
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return allClients;
    return allClients.filter(
      (c) => c.name.toLowerCase().includes(needle) || (c.taxId ?? "").toLowerCase().includes(needle)
    );
  }, [allClients, q]);

  function toggle(id: string) {
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const r = await fetch(`/api/v1/invoice-issuers/${issuer.id}/clients`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientIds: [...sel] })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(j?.error?.message ?? `Error ${r.status}`);
        return;
      }
      const data = await r.json();
      onSaved(data.clientIds ?? [...sel]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-4">
        <div className="flex items-center justify-between px-5 py-3 border-b sticky top-0 bg-white rounded-t-2xl">
          <h2 className="font-semibold text-sm">
            Clientes de {issuer.name}
            <span className="ml-2 text-slate-400 font-normal">{sel.size} seleccionados</span>
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar cliente por nombre o NIF…"
              className="w-full pl-9 pr-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div className="max-h-[55vh] overflow-y-auto border rounded-lg divide-y">
            {filtered.length === 0 ? (
              <div className="p-4 text-sm text-slate-400 text-center">No hay clientes que coincidan.</div>
            ) : (
              filtered.map((c) => {
                const on = sel.has(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => toggle(c.id)}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <span
                      className={`h-4 w-4 rounded border grid place-items-center shrink-0 ${
                        on ? "bg-brand-600 border-brand-600 text-white" : "border-slate-300"
                      }`}
                    >
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className="text-sm truncate flex-1">{c.name}</span>
                    {c.taxId && <span className="text-xs text-slate-400 shrink-0">{c.taxId}</span>}
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t">
          <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg hover:bg-slate-100">
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 bg-brand-600 text-white text-sm px-3 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
        active
          ? "border-brand-600 text-brand-700 font-medium"
          : "border-transparent text-slate-500 hover:text-slate-700"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function SummaryStat({
  label,
  value,
  hint,
  color
}: {
  label: string;
  value: string;
  hint?: string;
  color: string;
}) {
  return (
    <div>
      <div className="text-xs text-slate-500 truncate capitalize">{label}</div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}
