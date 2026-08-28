"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  computeTotals,
  computeInvoiceLineAmounts,
  formatMoney,
  formatRate,
  defaultSeriesForType,
  defaultSeriesForIssuer,
  TYPE_LABEL,
  STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  INVOICE_TYPES,
  PAYMENT_METHODS,
  CURRENCIES,
  type InvoiceLine,
  type InvoiceType
} from "@/lib/invoicing/core";
import {
  addInvoicePaymentDays,
  addInvoiceInterval,
  automationStatus,
  invoiceTaxLabel,
  normalizeCustomInvoiceNumber,
  mergeInvoiceClients,
  normalizeInitialInvoiceSequence,
  RIXUS_ISSUER_PROFILE,
  type InvoiceRecurrenceUnit,
  type InvoiceAutomationWorkflow
} from "@/lib/invoicing/invoice-form";
import {
  Plus,
  Building2,
  FileText,
  Download,
  Copy,
  CheckCircle2,
  Trash2,
  Pencil,
  CreditCard,
  X,
  Repeat,
  Ban
} from "lucide-react";

type ClientLite = { id: string; name: string; taxId: string | null; email?: string | null; billingEmail?: string | null };
type Issuer = {
  id: string;
  name: string;
  legalName?: string | null;
  taxId: string;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  province?: string | null;
  countryCode?: string;
  email?: string | null;
  phone?: string | null;
  web?: string | null;
  iban?: string | null;
  logoUrl?: string | null;
  personType?: string;
  residenceType?: string;
  isDefault?: boolean;
};
type InvoiceRow = {
  id: string;
  type: string;
  status: string;
  series: string | null;
  number: string | null;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  paymentMethod: string;
  totalCents: number;
  paidCents: number;
  recurring: boolean;
  deliveryError?: string | null;
  clientSnapshot: { name?: string } | null;
  client: { id: string; name: string } | null;
  issuer: { id: string; name: string } | null;
};

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  ISSUED: "bg-blue-50 text-blue-700",
  PAID: "bg-emerald-50 text-emerald-700",
  CANCELLED: "bg-rose-50 text-rose-700",
  SENT: "bg-amber-50 text-amber-700",
  ACCEPTED: "bg-emerald-50 text-emerald-700",
  REJECTED: "bg-rose-50 text-rose-700"
};

function toDateInput(d?: string | Date | null): string {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  return dt.toISOString().slice(0, 10);
}

export default function FacturasClient({
  clients,
  initialIssuers,
  lockedIssuerId,
  clientFilterIds,
  onIssuersChanged,
  onInvoicesChanged
}: {
  clients: ClientLite[];
  initialIssuers: Issuer[];
  /** Si se pasa, la facturación se limita a esta empresa emisora:
   *  la lista solo muestra sus facturas y el editor fija el emisor. */
  lockedIssuerId?: string;
  /** Si se pasa (no vacío), el desplegable de cliente en el editor
   *  solo muestra estos clientes (los asignados a la empresa). */
  clientFilterIds?: string[];
  onIssuersChanged?: () => void;
  /** Se llama tras (re)cargar la lista de facturas (crear/editar/borrar). */
  onInvoicesChanged?: () => void;
}) {
  const [availableClients, setAvailableClients] = useState<ClientLite[]>(clients);
  useEffect(() => setAvailableClients((current) => {
    let merged = current;
    for (const client of clients) merged = mergeInvoiceClients(merged, client);
    return merged;
  }), [clients]);
  // El selector de facturas siempre debe permitir reutilizar cualquier cliente
  // del workspace. La asignación por emisor se conserva para informes/gestión,
  // pero nunca vuelve invisible un cliente recién creado.
  const editorClients = availableClients;
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [issuers, setIssuers] = useState<Issuer[]>(initialIssuers ?? []);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<InvoiceRow | "new" | null>(null);
  const [issuersOpen, setIssuersOpen] = useState(false);
  const [sepaExcluded, setSepaExcluded] = useState<Set<string>>(new Set());
  const [excludeNumber, setExcludeNumber] = useState("");

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (typeFilter) params.set("type", typeFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (lockedIssuerId) params.set("issuerId", lockedIssuerId);
      if (q.trim()) params.set("q", q.trim());
      const [r, exclusionsResponse] = await Promise.all([
        fetch(`/api/v1/invoices?${params.toString()}`, { cache: "no-store" }),
        fetch("/api/v1/facturacion/remesas/exclusions", { cache: "no-store" })
      ]);
      if (r.ok) {
        const data = await r.json();
        setInvoices(data.items ?? []);
        onInvoicesChanged?.();
      }
      if (exclusionsResponse.ok) {
        const data = await exclusionsResponse.json();
        setSepaExcluded(new Set((data.numbers ?? []).map((number: string) => number.toUpperCase())));
      }
    } finally {
      setLoading(false);
    }
  }, [typeFilter, statusFilter, q, lockedIssuerId, onInvoicesChanged]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  const reloadIssuers = useCallback(async () => {
    const r = await fetch("/api/v1/invoice-issuers", { cache: "no-store" });
    if (r.ok) setIssuers((await r.json()).items ?? []);
    onIssuersChanged?.();
  }, [onIssuersChanged]);

  async function action(path: string, method = "POST", body?: any) {
    const r = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j?.error?.message ?? j?.message ?? `Error ${r.status}`);
      return null;
    }
    return r.json().catch(() => ({}));
  }

  async function setRemittanceExclusion(number: string, excluded: boolean) {
    const normalized = number.trim().toUpperCase();
    if (!normalized) return;
    const result = await action("/api/v1/facturacion/remesas/exclusions", "PATCH", { number: normalized, excluded });
    if (!result) return;
    setSepaExcluded(new Set((result.numbers ?? []).map((item: string) => item.toUpperCase())));
    setExcludeNumber("");
  }

  const totalsByStatus = useMemo(() => {
    const issued = invoices.filter((i) => i.status === "ISSUED");
    const paid = invoices.filter((i) => i.status === "PAID");
    const sum = (arr: InvoiceRow[]) => arr.reduce((s, i) => s + i.totalCents, 0);
    return { pending: sum(issued), paid: sum(paid), pendingCount: issued.length, paidCount: paid.length };
  }, [invoices]);

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          onClick={() => setEditing("new")}
          className="inline-flex items-center gap-1.5 bg-brand-600 text-white text-sm px-3 py-2 rounded-lg hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" /> Nueva factura
        </button>
        <button
          onClick={() => setIssuersOpen(true)}
          className="inline-flex items-center gap-1.5 bg-white border text-sm px-3 py-2 rounded-lg hover:bg-slate-50"
        >
          <Building2 className="h-4 w-4" /> Emisores ({issuers.length})
        </button>
        <div className="inline-flex items-center gap-1 rounded-lg border bg-white p-1">
          <input
            value={excludeNumber}
            onChange={(event) => setExcludeNumber(event.target.value)}
            placeholder="Nº a excluir (FAC-...)"
            className="w-40 px-2 py-1 text-sm outline-none"
          />
          <button
            onClick={() => setRemittanceExclusion(excludeNumber, true)}
            disabled={!excludeNumber.trim()}
            className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700 disabled:opacity-40"
            title="Registrar una factura para que nunca genere remesa automática, aunque aún no se haya importado"
          >
            <Ban className="h-3.5 w-3.5" /> Excluir remesa
          </button>
        </div>
        <div className="flex-1" />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="text-sm border rounded-lg px-2 py-2 bg-white"
        >
          <option value="">Todos los tipos</option>
          {INVOICE_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-sm border rounded-lg px-2 py-2 bg-white"
        >
          <option value="">Todos los estados</option>
          {Object.keys(STATUS_LABEL).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar nº o cliente…"
          className="text-sm border rounded-lg px-3 py-2 bg-white w-44"
        />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <div className="bg-white border rounded-xl p-3">
          <div className="text-xs text-slate-500">Pendiente de cobro</div>
          <div className="text-lg font-bold text-blue-700">{formatMoney(totalsByStatus.pending)}</div>
          <div className="text-[11px] text-slate-400">{totalsByStatus.pendingCount} emitidas</div>
        </div>
        <div className="bg-white border rounded-xl p-3">
          <div className="text-xs text-slate-500">Cobrado</div>
          <div className="text-lg font-bold text-emerald-700">{formatMoney(totalsByStatus.paid)}</div>
          <div className="text-[11px] text-slate-400">{totalsByStatus.paidCount} pagadas</div>
        </div>
        <div className="bg-white border rounded-xl p-3">
          <div className="text-xs text-slate-500">Documentos</div>
          <div className="text-lg font-bold">{invoices.length}</div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-3 py-2">Número</th>
              <th className="text-left px-3 py-2">Cliente</th>
              <th className="text-left px-3 py-2">Fecha</th>
              <th className="text-right px-3 py-2">Total</th>
              <th className="text-left px-3 py-2">Estado</th>
              <th className="text-right px-3 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                  Cargando…
                </td>
              </tr>
            ) : invoices.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                  No hay documentos. Crea tu primera factura.
                </td>
              </tr>
            ) : (
              invoices.map((inv) => (
                <tr key={inv.id} onClick={() => window.open(`/api/v1/invoices/${inv.id}/pdf`, "_blank")} className="border-t hover:bg-slate-50/50 cursor-pointer" title="Abrir factura">
                  <td className="px-3 py-2">
                    <div className="font-medium flex items-center gap-1.5">
                      {inv.recurring && <Repeat className="h-3.5 w-3.5 text-violet-500" />}
                      {inv.number ?? "(borrador)"}
                    </div>
                    <div className="text-[11px] text-slate-400">{TYPE_LABEL[inv.type as InvoiceType] ?? inv.type}</div>
                    {(inv.type === "RECTIFICATIVA" || /^R-/i.test(inv.number ?? "")) && (
                      <div className="text-[11px] text-rose-600">Rectificativa · nunca se remesa</div>
                    )}
                    {inv.number && sepaExcluded.has(inv.number.toUpperCase()) && (
                      <div className="text-[11px] text-amber-700">Excluida de remesas automáticas</div>
                    )}
                  </td>
                  <td className="px-3 py-2">{inv.client?.name ?? inv.clientSnapshot?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-500">{toDateInput(inv.issueDate)}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatMoney(inv.totalCents, inv.currency)}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[11px] px-2 py-0.5 rounded-md ${STATUS_STYLE[inv.status] ?? "bg-slate-100"}`}>
                      {STATUS_LABEL[inv.status] ?? inv.status}
                    </span>
                    {inv.deliveryError && <div className="mt-1 text-[11px] text-rose-600">Error de envío: requiere reintento</div>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1 text-slate-500">
                      {inv.number && inv.type !== "RECTIFICATIVA" && !/^R-/i.test(inv.number) && (
                        <IconBtn
                          title={sepaExcluded.has(inv.number.toUpperCase()) ? "Permitir remesa automática" : "Excluir de remesas automáticas"}
                          onClick={() => setRemittanceExclusion(inv.number!, !sepaExcluded.has(inv.number!.toUpperCase()))}
                        >
                          <Ban className={`h-4 w-4 ${sepaExcluded.has(inv.number.toUpperCase()) ? "text-rose-600" : ""}`} />
                        </IconBtn>
                      )}
                      <IconBtn title="Editar" onClick={() => setEditing(inv)}>
                        <Pencil className="h-4 w-4" />
                      </IconBtn>
                      <IconBtn title="Ver PDF" onClick={() => window.open(`/api/v1/invoices/${inv.id}/pdf`, "_blank")}>
                        <FileText className="h-4 w-4" />
                      </IconBtn>
                      <IconBtn
                        title="Exportar Factura-e (XML)"
                        onClick={() => window.open(`/api/v1/invoices/${inv.id}/facturae`, "_blank")}
                      >
                        <Download className="h-4 w-4" />
                      </IconBtn>
                      <IconBtn
                        title="Duplicar"
                        onClick={async () => {
                          await action(`/api/v1/invoices/${inv.id}/duplicate`);
                          loadInvoices();
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </IconBtn>
                      {inv.status !== "PAID" && (
                        <IconBtn
                          title="Marcar como pagada"
                          onClick={async () => {
                            await action(`/api/v1/invoices/${inv.id}/mark-paid`);
                            loadInvoices();
                          }}
                        >
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        </IconBtn>
                      )}
                      {inv.paymentMethod === "STRIPE" && inv.status !== "PAID" && (
                        <IconBtn
                          title="Crear link de pago Stripe"
                          onClick={async () => {
                            const res = await action(`/api/v1/invoices/${inv.id}/payment-link`);
                            if (res?.url) {
                              navigator.clipboard?.writeText(res.url).catch(() => {});
                              alert(`Link de pago creado y copiado:\n${res.url}`);
                            }
                          }}
                        >
                          <CreditCard className="h-4 w-4" />
                        </IconBtn>
                      )}
                      <IconBtn
                        title="Borrar / anular"
                        onClick={async () => {
                          if (!confirm("¿Borrar/anular este documento?")) return;
                          await action(`/api/v1/invoices/${inv.id}`, "DELETE");
                          loadInvoices();
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-rose-500" />
                      </IconBtn>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <InvoiceFormModal
          invoice={editing === "new" ? null : editing}
          clients={editorClients}
          issuers={issuers}
          invoices={invoices}
          lockedIssuerId={lockedIssuerId}
          onClientCreated={(client) => setAvailableClients((current) => mergeInvoiceClients(current, client))}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            loadInvoices();
          }}
        />
      )}

      {issuersOpen && (
        <IssuersModal
          issuers={issuers}
          onClose={() => setIssuersOpen(false)}
          onChanged={reloadIssuers}
        />
      )}
    </div>
  );
}

function IconBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button title={title} onClick={(event) => { event.stopPropagation(); onClick(); }} className="p-1.5 rounded-md hover:bg-slate-100">
      {children}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────
// Modal de creación / edición de factura
// ──────────────────────────────────────────────────────────────────
function InvoiceFormModal({
  invoice,
  clients,
  issuers,
  invoices,
  lockedIssuerId,
  onClientCreated,
  onClose,
  onSaved
}: {
  invoice: InvoiceRow | null;
  clients: ClientLite[];
  issuers: Issuer[];
  invoices: InvoiceRow[];
  lockedIssuerId?: string;
  onClientCreated: (client: ClientLite) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const isEdit = !!invoice;
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  const defaultIssuer = issuers.find((i) => i.isDefault) ?? issuers[0];
  const [type, setType] = useState<InvoiceType>("NORMAL");
  const [clientId, setClientId] = useState<string>("");
  const [formClients, setFormClients] = useState<ClientLite[]>(clients);
  const [creatingClient, setCreatingClient] = useState(false);
  const [newClient, setNewClient] = useState({ name: "", taxId: "", email: "", billingEmail: "", useBillingEmail: false, fiscalAddress: "" });
  const [issuerId, setIssuerId] = useState<string>(lockedIssuerId ?? defaultIssuer?.id ?? "");
  const [currency, setCurrency] = useState("EUR");
  const [paymentMethod, setPaymentMethod] = useState("STRIPE");
  const [issueDate, setIssueDate] = useState(toDateInput(new Date()));
  const [dueDate, setDueDate] = useState(addInvoicePaymentDays(toDateInput(new Date()), 30));
  const [dueDateManuallyChanged, setDueDateManuallyChanged] = useState(false);
  const [nextNumber, setNextNumber] = useState("Calculando…");
  const [customNumber, setCustomNumber] = useState("");
  const [initialSequence, setInitialSequence] = useState("");
  const [automationWorkflow, setAutomationWorkflow] = useState<InvoiceAutomationWorkflow>("DRAFT");
  const [creationKey] = useState(() => crypto.randomUUID());
  const [deliveryFailed, setDeliveryFailed] = useState(false);
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [lines, setLines] = useState<InvoiceLine[]>([
    { concept: "", description: "", quantity: 1, unitPriceCents: 0, taxRate: 21 }
  ]);
  const [recurring, setRecurring] = useState(false);
  const [recurrenceUnit, setRecurrenceUnit] = useState<InvoiceRecurrenceUnit>("MONTHS");
  const [recurrenceValue, setRecurrenceValue] = useState(1);
  const [billingEmail, setBillingEmail] = useState("");
  const [useBillingEmail, setUseBillingEmail] = useState(false);
  const [rectifiesInvoiceId, setRectifiesInvoiceId] = useState("");
  const [rectifyReason, setRectifyReason] = useState("");
  const [status, setStatus] = useState("DRAFT");

  useEffect(() => {
    if (!invoice) return;
    (async () => {
      const r = await fetch(`/api/v1/invoices/${invoice.id}`, { cache: "no-store" });
      if (r.ok) {
        const d = await r.json();
        setType(d.type);
        setCustomNumber(d.number ?? "");
        setClientId(d.clientId ?? "");
        setIssuerId(d.issuerId ?? "");
        setCurrency(d.currency);
        setPaymentMethod(d.paymentMethod);
        setIssueDate(toDateInput(d.issueDate));
        setDueDate(toDateInput(d.dueDate));
        setNotes(d.notes ?? "");
        setTerms(d.terms ?? "");
        setLines((d.lines ?? []).length ? d.lines : [{ concept: "", description: "", quantity: 1, unitPriceCents: 0, taxRate: 21 }]);
        setRecurring(!!d.recurring);
        setRecurrenceUnit(d.recurrenceConfig?.intervalUnit ?? "MONTHS");
        setRecurrenceValue(d.recurrenceConfig?.intervalValue ?? d.recurrenceConfig?.intervalMonths ?? 1);
        setRectifiesInvoiceId(d.rectifiesInvoiceId ?? "");
        setRectifyReason(d.rectifyReason ?? "");
        setStatus(d.status);
      }
      setLoading(false);
    })();
  }, [invoice]);

  useEffect(() => {
    setFormClients((current) => {
      const byId = new Map([...clients, ...current].map((client) => [client.id, client]));
      return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
    });
  }, [clients]);

  useEffect(() => {
    if (isEdit) return;
    const selected = formClients.find((client) => client.id === clientId);
    setBillingEmail(selected?.billingEmail ?? "");
    setUseBillingEmail(Boolean(selected?.billingEmail));
  }, [clientId, formClients, isEdit]);

  useEffect(() => {
    if (!isEdit && !dueDateManuallyChanged) setDueDate(addInvoicePaymentDays(issueDate, 30));
  }, [issueDate, dueDateManuallyChanged, isEdit]);

  useEffect(() => {
    if (isEdit) return;
    const series = defaultSeriesForIssuer(type, issuers.find((issuer) => issuer.id === issuerId));
    const year = Number(issueDate.slice(0, 4)) || new Date().getFullYear();
    void fetch(`/api/v1/invoices/next-number?series=${encodeURIComponent(series)}&year=${year}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => setNextNumber(data.number ?? "No disponible"))
      .catch(() => setNextNumber("No disponible"));
  }, [type, issueDate, isEdit, issuerId, issuers]);

  const totals = useMemo(() => computeTotals(lines), [lines]);
  const locked = isEdit && !!invoice?.number && status !== "DRAFT";

  function setLine(i: number, patch: Partial<InvoiceLine>) {
    setLines((arr) => arr.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((arr) => [...arr, { concept: "", description: "", quantity: 1, unitPriceCents: 0, taxRate: 21 }]);
  }
  function removeLine(i: number) {
    setLines((arr) => (arr.length > 1 ? arr.filter((_, idx) => idx !== i) : arr));
  }

  async function createClientInline() {
    if (!newClient.name.trim()) return alert("Indica el nombre del cliente");
    if (newClient.useBillingEmail && !newClient.billingEmail.trim()) return alert("Indica el correo alternativo de facturación");
    const response = await fetch("/api/v1/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newClient.name.trim(),
        legalName: newClient.name.trim(),
        taxId: newClient.taxId.trim() || null,
        email: newClient.email.trim() || undefined,
        billingEmail: newClient.useBillingEmail ? newClient.billingEmail.trim() || null : null,
        fiscalAddress: newClient.fiscalAddress.trim() || null,
        status: "ACTIVE",
        mrr: 0
      })
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return alert(body?.error?.message ?? "No se pudo crear el cliente");
    }
    const created = await response.json();
    const lite = { id: created.id, name: created.name, taxId: created.taxId ?? null, email: created.email ?? null, billingEmail: created.billingEmail ?? null };
    if (issuerId) {
      const assignment = await fetch(`/api/v1/invoice-issuers/${issuerId}/clients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: created.id })
      });
      if (!assignment.ok) return alert("El cliente se creó, pero no pudo asignarse a esta empresa emisora");
    }
    setFormClients((current) => mergeInvoiceClients(current, lite));
    onClientCreated(lite);
    setClientId(created.id);
    setCreatingClient(false);
    setNewClient({ name: "", taxId: "", email: "", billingEmail: "", useBillingEmail: false, fiscalAddress: "" });
    router.refresh();
  }

  async function setInitialInvoiceNumber() {
    let next: number;
    try {
      next = normalizeInitialInvoiceSequence(initialSequence);
    } catch (error: any) {
      return alert(error?.message ?? "Número inicial inválido");
    }
    const series = defaultSeriesForIssuer(type, issuers.find((issuer) => issuer.id === issuerId));
    const year = Number(issueDate.slice(0, 4)) || new Date().getFullYear();
    const response = await fetch("/api/v1/invoices/next-number", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ series, year, next })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return alert(body?.error?.message ?? "No se pudo establecer el número inicial");
    setNextNumber(body.number);
    setInitialSequence("");
  }

  async function save(issue?: boolean) {
    if (!clientId) return alert("Selecciona un cliente");
    if (!issuerId) return alert("Selecciona una empresa emisora (créala en 'Emisores')");
    if (lines.some((l) => !l.concept?.trim() && !l.description.trim())) return alert("Cada línea necesita al menos un concepto o una descripción");
    if (useBillingEmail && !billingEmail.trim()) return alert("Indica el correo alternativo de facturación");

    const finalStatus = isEdit
      ? (issue ? (type === "PRESUPUESTO" ? "SENT" : "ISSUED") : "DRAFT")
      : automationStatus(automationWorkflow);
    let normalizedCustomNumber: string | undefined;
    try {
      normalizedCustomNumber = customNumber.trim() ? normalizeCustomInvoiceNumber(customNumber) : undefined;
    } catch (error: any) {
      return alert(error?.message ?? "Número de factura inválido");
    }
    const selectedSeries = normalizedCustomNumber?.split("-")[0] ?? defaultSeriesForIssuer(type, issuers.find((issuer) => issuer.id === issuerId));
    const payload: any = {
      type,
      status: finalStatus,
      clientId,
      issuerId,
      series: selectedSeries,
      number: normalizedCustomNumber,
      currency,
      paymentMethod,
      issueDate: new Date(issueDate || new Date()).toISOString(),
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      notes: notes || null,
      terms: terms || null,
      lines: lines.map((l) => ({
        concept: l.concept?.trim() || undefined,
        description: l.description.trim(),
        quantity: Number(l.quantity) || 0,
        unitPriceCents: Math.round(Number(l.unitPriceCents) || 0),
        taxRate: Number(l.taxRate) || 0,
        discountPct: l.discountPct ? Number(l.discountPct) : undefined
      })),
      recurring,
      recurrenceConfig: recurring ? {
        intervalMonths: recurrenceUnit === "YEARS" ? recurrenceValue * 12 : recurrenceUnit === "MONTHS" ? recurrenceValue : 1,
        intervalUnit: recurrenceUnit,
        intervalValue: Number(recurrenceValue) || 1,
        nextRunAt: `${addInvoiceInterval(issueDate, recurrenceUnit, Number(recurrenceValue) || 1)}T00:00:00.000Z`
      } : null,
      rectifiesInvoiceId: type === "RECTIFICATIVA" ? rectifiesInvoiceId || null : null,
      rectifyReason: type === "RECTIFICATIVA" ? rectifyReason || null : null
    };

    setSaving(true);
    try {
      const selectedClient = formClients.find((client) => client.id === clientId);
      const desiredBillingEmail = useBillingEmail ? billingEmail.trim() : null;
      if (!isEdit && selectedClient && (selectedClient.billingEmail ?? null) !== desiredBillingEmail) {
        const clientResponse = await fetch(`/api/v1/clients/${clientId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ billingEmail: desiredBillingEmail })
        });
        if (!clientResponse.ok) return alert("No se pudo guardar el correo de facturación del cliente");
      }
      const r = await fetch(isEdit ? `/api/v1/invoices/${invoice!.id}` : "/api/v1/invoices", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": creationKey },
        body: JSON.stringify(payload)
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        return alert(j?.error?.message ?? j?.message ?? `Error ${r.status}`);
      }
      const saved = await r.json();
      if (saved.deliveryError) {
        setDeliveryFailed(true);
        alert("La factura se creó, pero no pudo enviarse. Pulsa «Reintentar envío» para volver a enviar la misma factura.");
        return;
      }
      if (!isEdit && automationWorkflow === "SEND" && saved.status !== "SENT") {
        alert("La factura no alcanzó el estado Enviada. Se ha detenido el cierre para que puedas reintentar sin duplicarla.");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full px-2.5 py-1.5 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl my-4">
        <div className="flex items-center justify-between px-5 py-3 border-b sticky top-0 bg-white rounded-t-2xl">
          <h2 className="font-semibold">
            {isEdit ? `Editar ${invoice?.number ?? "borrador"}` : "Nueva factura"}
            {locked && <span className="ml-2 text-[11px] text-amber-600">(emitida — solo lectura)</span>}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-400">Cargando…</div>
        ) : (
          <div className={`p-5 space-y-4 ${deliveryFailed ? "pointer-events-none opacity-70" : ""}`}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Tipo</label>
                <select disabled={locked} value={type} onChange={(e) => setType(e.target.value as InvoiceType)} className={inputCls}>
                  {INVOICE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Divisa</label>
                <select disabled={locked} value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputCls}>
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c === "EUR" ? "€ EUR" : "$ USD"}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Fecha emisión</label>
                <input disabled={locked} type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Vencimiento</label>
                <input disabled={locked} type="date" value={dueDate} onChange={(e) => { setDueDate(e.target.value); setDueDateManuallyChanged(true); }} className={inputCls} />
              </div>
              {!locked && (
                <div className="col-span-2 md:col-span-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
                  <label className="block text-xs text-blue-700 mb-1">N.º de factura actual (editable)</label>
                  <input value={customNumber} onChange={(e) => setCustomNumber(e.target.value)} placeholder={isEdit ? "Sin número" : nextNumber} className={inputCls} />
                  <p className="mt-1 text-[11px] text-blue-700">{isEdit ? "Solo puede cambiarse mientras sea borrador." : `Si lo dejas vacío se usará ${nextNumber}.`} No se admiten números duplicados.</p>
                  {!isEdit && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-blue-200 pt-2">
                      <label className="text-xs font-medium text-blue-800">Número correlativo inicial</label>
                      <input type="number" min={1} step={1} value={initialSequence} onChange={(e) => setInitialSequence(e.target.value)} placeholder="Ej. 3001" className="w-32 rounded-lg border px-2 py-1 text-sm" />
                      <button type="button" onClick={() => void setInitialInvoiceNumber()} disabled={!initialSequence} className="rounded-lg border border-blue-300 bg-white px-3 py-1 text-xs font-medium text-blue-800 disabled:opacity-40">Establecer desde aquí</button>
                      <span className="text-[11px] text-blue-700">Las siguientes facturas continuarán automáticamente; nunca se permite retroceder.</span>
                    </div>
                  )}
                </div>
              )}
              <div className="col-span-2">
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-xs text-slate-500">Cliente</label>
                  {!locked && <button type="button" onClick={() => setCreatingClient((value) => !value)} className="text-xs font-medium text-brand-600 hover:underline">+ Crear cliente</button>}
                </div>
                <select disabled={locked} value={clientId} onChange={(e) => setClientId(e.target.value)} className={inputCls}>
                  <option value="">— Selecciona cliente —</option>
                  {formClients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.taxId ? "" : " (sin NIF)"}
                    </option>
                  ))}
                </select>
                {clientId && (() => {
                  const selected = formClients.find((client) => client.id === clientId);
                  return <div className="mt-2 rounded-lg border bg-slate-50 p-2 text-xs text-slate-600">
                    <div>Email del cliente: <strong>{selected?.email || "No informado"}</strong></div>
                    {!locked && <>
                      <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={useBillingEmail} onChange={(e) => setUseBillingEmail(e.target.checked)} />Enviar facturas a un correo alternativo</label>
                      {useBillingEmail && <input type="email" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} placeholder="facturas@cliente.com" className={`${inputCls} mt-1`} />}
                    </>}
                  </div>;
                })()}
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-slate-500 mb-1">Empresa emisora</label>
                <select disabled={locked || (!!lockedIssuerId && !isEdit)} value={issuerId} onChange={(e) => setIssuerId(e.target.value)} className={inputCls}>
                  <option value="">— Selecciona emisor —</option>
                  {issuers.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-slate-500 mb-1">Método de pago</label>
                <select disabled={locked} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={inputCls}>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABEL[m]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 flex items-end gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" disabled={locked} checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
                  Recurrente
                </label>
                {recurring && (
                  <div className="flex items-center gap-1 text-sm">
                    cada
                    <input
                      type="number"
                      min={1}
                      disabled={locked}
                      value={recurrenceValue}
                      onChange={(e) => setRecurrenceValue(Math.max(1, Number(e.target.value)))}
                      className="w-16 px-2 py-1 border rounded-lg"
                    />
                    <select value={recurrenceUnit} onChange={(e) => setRecurrenceUnit(e.target.value as InvoiceRecurrenceUnit)} className="px-2 py-1 border rounded-lg">
                      <option value="DAYS">día(s)</option>
                      <option value="MONTHS">mes(es)</option>
                      <option value="YEARS">año(s)</option>
                    </select>
                  </div>
                )}
              </div>
            </div>

            {creatingClient && !locked && (
              <div className="rounded-xl border border-brand-200 bg-brand-50 p-3">
                <div className="mb-2 text-sm font-semibold text-brand-900">Nuevo cliente</div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <input aria-label="Nombre del nuevo cliente" placeholder="Nombre o razón social *" value={newClient.name} onChange={(e) => setNewClient((v) => ({ ...v, name: e.target.value }))} className={inputCls} />
                  <input aria-label="NIF del nuevo cliente" placeholder="NIF/CIF" value={newClient.taxId} onChange={(e) => setNewClient((v) => ({ ...v, taxId: e.target.value }))} className={inputCls} />
                  <input aria-label="Email del nuevo cliente" type="email" placeholder="Email" value={newClient.email} onChange={(e) => setNewClient((v) => ({ ...v, email: e.target.value }))} className={inputCls} />
                  <textarea rows={3} aria-label="Dirección fiscal del nuevo cliente" placeholder="Dirección fiscal (varias líneas)" value={newClient.fiscalAddress} onChange={(e) => setNewClient((v) => ({ ...v, fiscalAddress: e.target.value }))} className={inputCls} />
                  <label className="md:col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={newClient.useBillingEmail} onChange={(e) => setNewClient((v) => ({ ...v, useBillingEmail: e.target.checked }))} />Usar un correo alternativo para las facturas</label>
                  {newClient.useBillingEmail && <input aria-label="Correo alternativo de facturación" type="email" placeholder="facturas@cliente.com" value={newClient.billingEmail} onChange={(e) => setNewClient((v) => ({ ...v, billingEmail: e.target.value }))} className={`${inputCls} md:col-span-2`} />}
                </div>
                <div className="mt-2 flex justify-end gap-2">
                  <button type="button" onClick={() => setCreatingClient(false)} className="rounded-lg border bg-white px-3 py-1.5 text-sm">Cancelar</button>
                  <button type="button" onClick={() => void createClientInline()} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white">Crear y seleccionar</button>
                </div>
              </div>
            )}

            {!locked && !isEdit && (
              <fieldset className="rounded-xl border p-3">
                <legend className="px-1 text-sm font-semibold text-slate-800">Automatización de la factura</legend>
                <div className="grid gap-2 md:grid-cols-3">
                  {([
                    ["DRAFT", "Crear automáticamente facturas en borrador", "Quedarán pendientes de revisión."],
                    ["APPROVE", "Aprobar las facturas automáticamente", "Se emitirán sin revisión previa."],
                    ["SEND", "Enviar las facturas automáticamente", "Se emitirán y quedarán marcadas como enviadas."],
                  ] as const).map(([value, label, help]) => (
                    <label key={value} className={`cursor-pointer rounded-lg border p-3 ${automationWorkflow === value ? "border-brand-500 bg-brand-50" : "bg-white"}`}>
                      <span className="flex items-start gap-2 text-sm font-medium"><input type="radio" name="invoiceAutomation" value={value} checked={automationWorkflow === value} onChange={() => setAutomationWorkflow(value)} className="mt-0.5" />{label}</span>
                      <span className="mt-1 block pl-5 text-xs text-slate-500">{help}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {type === "RECTIFICATIVA" && (
              <div className="grid grid-cols-2 gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Factura que rectifica</label>
                  <select disabled={locked} value={rectifiesInvoiceId} onChange={(e) => setRectifiesInvoiceId(e.target.value)} className={inputCls}>
                    <option value="">— Selecciona —</option>
                    {invoices
                      .filter((i) => i.number && i.type === "NORMAL")
                      .map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.number} · {i.client?.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Motivo</label>
                  <input disabled={locked} value={rectifyReason} onChange={(e) => setRectifyReason(e.target.value)} className={inputCls} />
                </div>
              </div>
            )}

            {/* Líneas */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-slate-500">Líneas</label>
                {!locked && (
                  <button onClick={addLine} className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1">
                    <Plus className="h-3 w-3" /> Añadir línea
                  </button>
                )}
              </div>
              <div className="overflow-x-auto">
                <div className="min-w-[980px]">
                  <div className="grid grid-cols-[1.3fr_2fr_.9fr_.7fr_1fr_1.2fr_1fr_36px] gap-1.5 px-1 pb-1 text-[11px] font-medium text-slate-500">
                    <span>Concepto</span><span>Descripción</span><span>Precio</span><span>Unidades</span><span>Subtotal</span><span>Impuestos</span><span>Total</span><span />
                  </div>
                  <div className="space-y-1.5">
                {lines.map((ln, i) => {
                  const amounts = computeInvoiceLineAmounts(ln);
                  return (
                  <div key={i} className="grid grid-cols-[1.3fr_2fr_.9fr_.7fr_1fr_1.2fr_1fr_36px] gap-1.5 items-center">
                    <input
                      disabled={locked}
                      placeholder="Concepto"
                      value={ln.concept ?? ""}
                      onChange={(e) => setLine(i, { concept: e.target.value })}
                      className={inputCls}
                    />
                    <input
                      disabled={locked}
                      placeholder="Descripción"
                      value={ln.description}
                      onChange={(e) => setLine(i, { description: e.target.value })}
                      className={inputCls}
                    />
                    <input
                      disabled={locked}
                      type="number"
                      step="0.01"
                      placeholder={currency === "USD" ? "Precio $" : "Precio €"}
                      value={ln.unitPriceCents / 100}
                      onChange={(e) => setLine(i, { unitPriceCents: Math.round(Number(e.target.value) * 100) })}
                      className={inputCls}
                    />
                    <input
                      disabled={locked}
                      type="number"
                      step="0.01"
                      placeholder="Unid."
                      value={ln.quantity}
                      onChange={(e) => setLine(i, { quantity: Number(e.target.value) })}
                      className={inputCls}
                    />
                    <output className="rounded-lg bg-slate-50 px-2 py-2 text-right text-xs">{formatMoney(amounts.subtotalCents, currency)}</output>
                    <div>
                      <select
                        disabled={locked}
                        value={ln.taxRate}
                        onChange={(e) => setLine(i, { taxRate: Number(e.target.value) })}
                        className={inputCls}
                      >
                        {[21, 10, 4, 0].map((r) => (
                          <option key={r} value={r}>
                            {invoiceTaxLabel(r, currency)}
                          </option>
                        ))}
                      </select>
                      <output className="mt-0.5 block text-right text-[11px] text-slate-500">{formatMoney(amounts.taxCents, currency)}</output>
                    </div>
                    <output className="rounded-lg bg-slate-50 px-2 py-2 text-right text-xs">{formatMoney(amounts.totalCents, currency)}</output>
                    {!locked && (
                      <button onClick={() => removeLine(i)} className="p-1.5 rounded-md hover:bg-rose-50 text-rose-500">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                );})}
                  </div>
                </div>
              </div>
            </div>

            {/* Totales */}
            <div className="flex justify-end">
              <div className="w-64 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Base imponible</span>
                  <span>{formatMoney(totals.subtotalCents, currency)}</span>
                </div>
                {totals.taxBreakdown.map((t) => (
                  <div key={t.rate} className="flex justify-between text-slate-500">
                    <span>{invoiceTaxLabel(t.rate, currency)}</span>
                    <span>{formatMoney(t.taxCents, currency)}</span>
                  </div>
                ))}
                <div className="flex justify-between font-bold text-base border-t pt-1">
                  <span>Total</span>
                  <span className="text-brand-700">{formatMoney(totals.totalCents, currency)}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Notas (visibles en la factura)</label>
                <textarea disabled={locked} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Condiciones / pie legal</label>
                <textarea disabled={locked} value={terms} onChange={(e) => setTerms(e.target.value)} rows={2} className={inputCls} />
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t sticky bottom-0 bg-white rounded-b-2xl">
          <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg border hover:bg-slate-50">
            Cancelar
          </button>
          {!locked && (
            <>
              {isEdit ? <>
                <button onClick={() => save(false)} disabled={saving} className="text-sm px-3 py-2 rounded-lg border hover:bg-slate-50 disabled:opacity-50">Guardar borrador</button>
                <button onClick={() => save(true)} disabled={saving} className="text-sm px-4 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">{type === "PRESUPUESTO" ? "Emitir presupuesto" : "Emitir factura"}</button>
              </> : (
                <button onClick={() => save()} disabled={saving} className="text-sm px-4 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
                  {saving ? "Procesando…" : deliveryFailed ? "Reintentar envío" : automationWorkflow === "SEND" ? "Crear, aprobar y enviar" : automationWorkflow === "APPROVE" ? "Crear y aprobar" : type === "PRESUPUESTO" ? "Crear presupuesto" : "Crear borrador"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Modal de gestión de emisores
// ──────────────────────────────────────────────────────────────────
function IssuersModal({
  issuers,
  onClose,
  onChanged
}: {
  issuers: Issuer[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const empty: Issuer = {
    id: "",
    name: "",
    legalName: "",
    taxId: "",
    address: "",
    postalCode: "",
    city: "",
    province: "",
    countryCode: "ESP",
    email: "",
    phone: "",
    web: "",
    iban: "",
    logoUrl: "",
    personType: "J",
    residenceType: "R",
    isDefault: false
  };
  const [form, setForm] = useState<Issuer>(empty);
  const [saving, setSaving] = useState(false);

  function patch<K extends keyof Issuer>(k: K, v: Issuer[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function loadRixusPreset() {
    const existing = issuers.find(
      (issuer) => issuer.taxId === RIXUS_ISSUER_PROFILE.taxId || /rixus solutions/i.test(issuer.name)
    );
    setForm((current) => ({
      ...current,
      ...existing,
      ...RIXUS_ISSUER_PROFILE,
      isDefault: true
    }));
  }

  function loadLogo(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 1_000_000) return alert("El logo debe ser una imagen de menos de 1 MB");
    const reader = new FileReader();
    reader.onload = () => patch("logoUrl", String(reader.result ?? ""));
    reader.readAsDataURL(file);
  }

  async function save() {
    if (!form.name.trim() || !form.taxId.trim()) return alert("Nombre y NIF/CIF son obligatorios");
    setSaving(true);
    try {
      const isEdit = !!form.id;
      const { id, ...body } = form;
      const r = await fetch(isEdit ? `/api/v1/invoice-issuers/${id}` : "/api/v1/invoice-issuers", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        return alert(j?.error?.message ?? `Error ${r.status}`);
      }
      setForm(empty);
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("¿Eliminar este emisor?")) return;
    await fetch(`/api/v1/invoice-issuers/${id}`, { method: "DELETE" });
    onChanged();
  }

  const inputCls = "w-full px-2.5 py-1.5 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-4">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h2 className="font-semibold">Empresas emisoras</h2>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {issuers.length > 0 && (
            <div className="space-y-1.5">
              {issuers.map((i) => (
                <div key={i.id} className="flex items-center justify-between border rounded-lg px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium">{i.name}</span>{" "}
                    <span className="text-slate-400">· {i.taxId}</span>
                    {i.isDefault && <span className="ml-2 text-[11px] text-emerald-600">por defecto</span>}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => setForm({ ...empty, ...i })} className="p-1.5 rounded-md hover:bg-slate-100">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => remove(i.id)} className="p-1.5 rounded-md hover:bg-rose-50 text-rose-500">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border-t pt-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{form.id ? "Editar emisor" : "Nuevo emisor"}</h3>
              {!form.id && <button type="button" onClick={loadRixusPreset} className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700">Cargar datos de RIXUS SOLUTIONS LLC</button>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Nombre comercial *" value={form.name} onChange={(e) => patch("name", e.target.value)} className={inputCls} />
              <input placeholder="Razón social" value={form.legalName ?? ""} onChange={(e) => patch("legalName", e.target.value)} className={inputCls} />
              <input placeholder="NIF / CIF *" value={form.taxId} onChange={(e) => patch("taxId", e.target.value)} className={inputCls} />
              <input placeholder="IBAN" value={form.iban ?? ""} onChange={(e) => patch("iban", e.target.value)} className={inputCls} />
              <textarea rows={2} placeholder="Dirección fiscal (varias líneas)" value={form.address ?? ""} onChange={(e) => patch("address", e.target.value)} className={`${inputCls} col-span-2`} />
              <input placeholder="Código postal" value={form.postalCode ?? ""} onChange={(e) => patch("postalCode", e.target.value)} className={inputCls} />
              <input placeholder="Ciudad" value={form.city ?? ""} onChange={(e) => patch("city", e.target.value)} className={inputCls} />
              <input placeholder="Provincia" value={form.province ?? ""} onChange={(e) => patch("province", e.target.value)} className={inputCls} />
              <input placeholder="País (ISO, ej. ESP)" value={form.countryCode ?? "ESP"} onChange={(e) => patch("countryCode", e.target.value)} className={inputCls} />
              <input placeholder="Email" value={form.email ?? ""} onChange={(e) => patch("email", e.target.value)} className={inputCls} />
              <input placeholder="Teléfono" value={form.phone ?? ""} onChange={(e) => patch("phone", e.target.value)} className={inputCls} />
              <input placeholder="Web" value={form.web ?? ""} onChange={(e) => patch("web", e.target.value)} className={inputCls} />
              <input placeholder="URL del logo" value={form.logoUrl ?? ""} onChange={(e) => patch("logoUrl", e.target.value)} className={inputCls} />
              <label className="col-span-2 rounded-lg border border-dashed p-3 text-sm text-slate-600">
                <span className="block font-medium">Subir logo desde el ordenador</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => loadLogo(e.target.files?.[0])} className="mt-2 block w-full text-xs" />
                {form.logoUrl?.startsWith("data:image/") && <img src={form.logoUrl} alt="Vista previa del logo" className="mt-2 max-h-28 rounded bg-white object-contain" />}
              </label>
              <label className="flex items-center gap-2 text-sm col-span-2">
                <input type="checkbox" checked={!!form.isDefault} onChange={(e) => patch("isDefault", e.target.checked)} />
                Emisor por defecto
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-3">
              {form.id && (
                <button onClick={() => setForm(empty)} className="text-sm px-3 py-2 rounded-lg border hover:bg-slate-50">
                  Cancelar edición
                </button>
              )}
              <button onClick={save} disabled={saving} className="text-sm px-4 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
                {form.id ? "Guardar cambios" : "Crear emisor"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
