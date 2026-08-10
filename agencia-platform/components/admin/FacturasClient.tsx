"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  computeTotals,
  formatMoney,
  formatRate,
  defaultSeriesForType,
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
  Plus,
  Building2,
  FileText,
  Download,
  Copy,
  Trash2,
  Pencil,
  CreditCard,
  X,
  Repeat,
  AlertTriangle,
  Clock3,
  Mail
} from "lucide-react";

type ClientLite = { id: string; name: string; taxId: string | null };
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
  client: { id: string; name: string } | null;
  issuer: { id: string; name: string } | null;
};

type InvoiceSummary = {
  issuedCents: number;
  collectedCents: number;
  outstandingCents: number;
  overdueCents: number;
  dueSoonCents: number;
  draftCents: number;
  documentCount: number;
  overdueCount: number;
  dueSoonCount: number;
};

type PaymentRecord = {
  id: string;
  kind: "PAYMENT" | "REVERSAL";
  amountCents: number;
  occurredAt: string;
  method: keyof typeof PAYMENT_METHOD_LABEL;
  reference: string | null;
  notes: string | null;
  reversesPaymentId: string | null;
};

type InvoiceDeliveryRow = {
  id: string;
  kind: string;
  recipient: string;
  subject: string;
  status: string;
  sentAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  error: string | null;
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
  const editorClients =
    clientFilterIds && clientFilterIds.length > 0
      ? clients.filter((c) => clientFilterIds.includes(c.id))
      : clients;
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [issuers, setIssuers] = useState<Issuer[]>(initialIssuers ?? []);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<InvoiceSummary | null>(null);
  const [editing, setEditing] = useState<InvoiceRow | "new" | null>(null);
  const [collecting, setCollecting] = useState<InvoiceRow | null>(null);
  const [emailing, setEmailing] = useState<InvoiceRow | null>(null);
  const [issuersOpen, setIssuersOpen] = useState(false);
  const [remindersEnabled, setRemindersEnabled] = useState(false);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (typeFilter) params.set("type", typeFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (lockedIssuerId) params.set("issuerId", lockedIssuerId);
      if (debouncedQ) params.set("q", debouncedQ);
      params.set("page", String(page));
      params.set("pageSize", "50");
      const r = await fetch(`/api/v1/invoices?${params.toString()}`, { cache: "no-store" });
      if (r.ok) {
        const data = await r.json();
        setInvoices(data.items ?? []);
        setPages(data.pagination?.pages ?? 1);
        setTotal(data.pagination?.total ?? data.items?.length ?? 0);
        onInvoicesChanged?.();
      }
    } finally {
      setLoading(false);
    }
  }, [typeFilter, statusFilter, debouncedQ, page, lockedIssuerId, onInvoicesChanged]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [q]);

  useEffect(() => setPage(1), [typeFilter, statusFilter, debouncedQ, lockedIssuerId]);

  const loadSummary = useCallback(async () => {
    const params = new URLSearchParams();
    if (lockedIssuerId) params.set("issuerId", lockedIssuerId);
    const response = await fetch(`/api/v1/invoices/summary?${params.toString()}`, { cache: "no-store" });
    if (response.ok) setSummary(await response.json());
  }, [lockedIssuerId]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    fetch("/api/v1/invoices/reminder-settings", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((body) => body && setRemindersEnabled(body.enabled === true))
      .catch(() => {});
  }, []);

  async function toggleReminders() {
    const enabled = !remindersEnabled;
    if (enabled && !confirm("¿Activar recordatorios automáticos a clientes 3 días antes y 1, 7 y 15 días después del vencimiento?")) return;
    const response = await fetch("/api/v1/invoices/reminder-settings", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled })
    });
    if (response.ok) setRemindersEnabled(enabled);
  }

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
    void loadSummary();
    return r.json().catch(() => ({}));
  }

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
        <button onClick={toggleReminders} className={`inline-flex items-center gap-1.5 border text-sm px-3 py-2 rounded-lg ${remindersEnabled ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-white hover:bg-slate-50"}`}>
          <Clock3 className="h-4 w-4" /> Recordatorios {remindersEnabled ? "activos" : "inactivos"}
        </button>
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
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <div className="bg-white border rounded-xl p-3">
          <div className="text-xs text-slate-500">Pendiente de cobro</div>
          <div className="text-lg font-bold text-blue-700">{formatMoney(summary?.outstandingCents ?? 0)}</div>
          <div className="text-[11px] text-slate-400">Saldo real, descontando cobros parciales</div>
        </div>
        <div className="bg-white border rounded-xl p-3">
          <div className="text-xs text-slate-500">Cobrado</div>
          <div className="text-lg font-bold text-emerald-700">{formatMoney(summary?.collectedCents ?? 0)}</div>
          <div className="text-[11px] text-slate-400">Cobros totales y parciales</div>
        </div>
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3">
          <div className="text-xs text-rose-700 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Vencido</div>
          <div className="text-lg font-bold text-rose-700">{formatMoney(summary?.overdueCents ?? 0)}</div>
          <div className="text-[11px] text-rose-500">{summary?.overdueCount ?? 0} factura(s)</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <div className="text-xs text-amber-700 flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> Vence en 7 días</div>
          <div className="text-lg font-bold text-amber-700">{formatMoney(summary?.dueSoonCents ?? 0)}</div>
          <div className="text-[11px] text-amber-600">{summary?.dueSoonCount ?? 0} factura(s)</div>
        </div>
        <div className="bg-white border rounded-xl p-3">
          <div className="text-xs text-slate-500">Borradores</div>
          <div className="text-lg font-bold">{formatMoney(summary?.draftCents ?? 0)}</div>
          <div className="text-[11px] text-slate-400">{summary?.documentCount ?? total} documentos facturables</div>
        </div>
      </div>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
          <span>{total} documentos · Página {page} de {pages}</span>
          <div className="flex gap-2">
            <button className="border rounded-lg px-3 py-1.5 disabled:opacity-40" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Anterior</button>
            <button className="border rounded-lg px-3 py-1.5 disabled:opacity-40" disabled={page >= pages || loading} onClick={() => setPage((value) => value + 1)}>Siguiente</button>
          </div>
        </div>
      )}

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
                <tr key={inv.id} className="border-t hover:bg-slate-50/50">
                  <td className="px-3 py-2">
                    <div className="font-medium flex items-center gap-1.5">
                      {inv.recurring && <Repeat className="h-3.5 w-3.5 text-violet-500" />}
                      {inv.number ?? "(borrador)"}
                    </div>
                    <div className="text-[11px] text-slate-400">{TYPE_LABEL[inv.type as InvoiceType] ?? inv.type}</div>
                  </td>
                  <td className="px-3 py-2">{inv.client?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-500">{toDateInput(inv.issueDate)}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatMoney(inv.totalCents, inv.currency)}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[11px] px-2 py-0.5 rounded-md ${STATUS_STYLE[inv.status] ?? "bg-slate-100"}`}>
                      {STATUS_LABEL[inv.status] ?? inv.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1 text-slate-500">
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
                      {(["ISSUED", "PAID"].includes(inv.status)) && (
                        <IconBtn title="Enviar por email e historial" onClick={() => setEmailing(inv)}>
                          <Mail className="h-4 w-4 text-blue-600" />
                        </IconBtn>
                      )}
                      <IconBtn
                        title="Duplicar"
                        onClick={async () => {
                          await action(`/api/v1/invoices/${inv.id}/duplicate`);
                          loadInvoices();
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </IconBtn>
                      {(["ISSUED", "PAID"].includes(inv.status)) && (
                        <IconBtn
                          title={inv.paidCents > 0 ? "Cobros e historial" : "Registrar cobro"}
                          onClick={() => setCollecting(inv)}
                        >
                          <CreditCard className="h-4 w-4 text-emerald-600" />
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
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            loadInvoices();
          }}
        />
      )}

      {collecting && (
        <PaymentModal
          invoice={collecting}
          onClose={() => setCollecting(null)}
          onSaved={() => {
            setCollecting(null);
            void loadInvoices();
            void loadSummary();
          }}
        />
      )}

      {emailing && <InvoiceEmailModal invoice={emailing} onClose={() => setEmailing(null)} />}

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
    <button title={title} onClick={onClick} className="p-1.5 rounded-md hover:bg-slate-100">
      {children}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────
// Modal de creación / edición de factura
// ──────────────────────────────────────────────────────────────────
function InvoiceEmailModal({ invoice, onClose }: { invoice: InvoiceRow; onClose: () => void }) {
  const [recipient, setRecipient] = useState("");
  const [deliveries, setDeliveries] = useState<InvoiceDeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/v1/invoices/${invoice.id}/deliveries`, { cache: "no-store" });
      if (response.ok) setDeliveries((await response.json()).deliveries ?? []);
    } finally { setLoading(false); }
  }, [invoice.id]);

  useEffect(() => { void load(); }, [load]);

  async function send() {
    const target = recipient.trim();
    if (!confirm(`¿Enviar ${invoice.number} ${target ? `a ${target}` : "al email fiscal del cliente"}?`)) return;
    setSending(true);
    try {
      const response = await fetch(`/api/v1/invoices/${invoice.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(target ? { recipient: target } : {}), operationId })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return alert(body?.message ?? body?.error?.message ?? `Error ${response.status}`);
      setRecipient("");
      setOperationId(crypto.randomUUID());
      await load();
    } finally { setSending(false); }
  }

  const statusLabel: Record<string, string> = {
    PENDING: "Preparando", SENT: "Enviado", DELIVERED: "Entregado", DELAYED: "Demorado",
    BOUNCED: "Rebotado", COMPLAINED: "Marcado como spam", FAILED: "Fallido", UNKNOWN: "Confirmación pendiente"
  };
  return <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
    <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl">
      <div className="flex items-center justify-between px-5 py-4 border-b">
        <div><h2 className="font-semibold">Envíos de {invoice.number}</h2><p className="text-xs text-slate-500">Factura por email y seguimiento de entrega</p></div>
        <button onClick={onClose} className="p-1 rounded-md hover:bg-slate-100"><X className="h-5 w-5" /></button>
      </div>
      <div className="p-5 space-y-4">
        <div className="flex gap-2">
          <input type="email" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Email alternativo (vacío = email fiscal)" className="flex-1 px-3 py-2 rounded-lg border text-sm" />
          <button disabled={sending} onClick={send} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50">{sending ? "Enviando…" : "Enviar"}</button>
        </div>
        <p className="text-[11px] text-slate-400">Antes de enviar se pide confirmación. Un doble clic no genera dos correos.</p>
        <div className="border-t pt-4">
          <h3 className="text-sm font-semibold mb-2">Historial</h3>
          {loading ? <p className="text-xs text-slate-400">Cargando…</p> : deliveries.length === 0 ? <p className="text-xs text-slate-400">Aún no hay envíos.</p> : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {deliveries.map((delivery) => <div key={delivery.id} className="rounded-lg border p-3 text-xs">
                <div className="flex justify-between gap-3"><strong>{delivery.kind === "REMINDER" ? "Recordatorio" : "Factura"}</strong><span className={delivery.status === "DELIVERED" ? "text-emerald-600" : ["FAILED", "BOUNCED", "COMPLAINED"].includes(delivery.status) ? "text-rose-600" : delivery.status === "UNKNOWN" ? "text-amber-600" : "text-blue-600"}>{statusLabel[delivery.status] ?? delivery.status}</span></div>
                <div className="text-slate-500 mt-1">{delivery.recipient} · {new Date(delivery.createdAt).toLocaleString("es-ES")}</div>
                {delivery.error && <div className="text-rose-500 mt-1">{delivery.error}</div>}
              </div>)}
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-end px-5 py-3 border-t"><button onClick={onClose} className="text-sm px-3 py-2 rounded-lg border">Cerrar</button></div>
    </div>
  </div>;
}

function PaymentModal({ invoice, onClose, onSaved }: { invoice: InvoiceRow; onClose: () => void; onSaved: () => void }) {
  const outstandingCents = Math.max(invoice.totalCents - invoice.paidCents, 0);
  const [amount, setAmount] = useState((outstandingCents / 100).toFixed(2));
  const [occurredAt, setOccurredAt] = useState(toDateInput(new Date()));
  const [method, setMethod] = useState(invoice.paymentMethod || "TRANSFER");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(true);

  const loadPayments = useCallback(async () => {
    setLoadingPayments(true);
    try {
      const response = await fetch(`/api/v1/invoices/${invoice.id}/payments`, { cache: "no-store" });
      if (response.ok) setPayments((await response.json()).payments ?? []);
    } finally {
      setLoadingPayments(false);
    }
  }, [invoice.id]);

  useEffect(() => { void loadPayments(); }, [loadPayments]);

  async function reverse(payment: PaymentRecord) {
    const reason = prompt("Motivo de la reversión (quedará en el historial):");
    if (reason === null) return;
    if (reason.trim().length < 3) return alert("Indica un motivo de al menos 3 caracteres.");
    const response = await fetch(`/api/v1/invoices/${invoice.id}/payments/${payment.id}/reverse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() })
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return alert(body?.message ?? body?.error?.message ?? `Error ${response.status}`);
    }
    onSaved();
  }

  async function save() {
    const amountCents = Math.round(Number(amount.replace(",", ".")) * 100);
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > outstandingCents) {
      return alert("Introduce un importe válido que no supere el saldo pendiente.");
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/v1/invoices/${invoice.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountCents,
          occurredAt: new Date(`${occurredAt}T12:00:00`).toISOString(),
          method,
          reference: reference || null,
          notes: notes || null
        })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        return alert(body?.message ?? body?.error?.message ?? `Error ${response.status}`);
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <h2 className="font-semibold">Cobros de la factura</h2>
            <p className="text-xs text-slate-500">{invoice.number} · {invoice.client?.name ?? "Sin cliente"}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="rounded-xl bg-slate-50 p-3 flex justify-between text-sm">
            <span className="text-slate-500">Saldo pendiente</span>
            <strong>{formatMoney(outstandingCents, invoice.currency)}</strong>
          </div>
          {outstandingCents > 0 && <><div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-slate-500">Importe
              <input autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={`${inputCls} mt-1`} />
            </label>
            <label className="text-xs text-slate-500">Fecha del cobro
              <input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} className={`${inputCls} mt-1`} />
            </label>
          </div>
          <label className="block text-xs text-slate-500">Método
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={`${inputCls} mt-1`}>
              {PAYMENT_METHODS.map((value) => <option key={value} value={value}>{PAYMENT_METHOD_LABEL[value]}</option>)}
            </select>
          </label>
          <label className="block text-xs text-slate-500">Referencia bancaria o recibo
            <input value={reference} onChange={(e) => setReference(e.target.value)} className={`${inputCls} mt-1`} />
          </label>
          <label className="block text-xs text-slate-500">Notas internas
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${inputCls} mt-1`} />
          </label>
          </>}

          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-2">Historial inmutable</h3>
            {loadingPayments ? <p className="text-xs text-slate-400">Cargando cobros…</p> : payments.length === 0 ? (
              <p className="text-xs text-slate-400">Todavía no hay movimientos.</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {payments.map((payment) => {
                  const reversed = payment.kind === "PAYMENT" && payments.some((item) => item.reversesPaymentId === payment.id);
                  return <div key={payment.id} className="flex items-start justify-between gap-3 rounded-lg border p-2.5 text-xs">
                    <div>
                      <div className="font-medium">
                        {payment.kind === "REVERSAL" ? "Reversión" : "Cobro"} · {formatMoney(Math.abs(payment.amountCents), invoice.currency)}
                      </div>
                      <div className="text-slate-500">{toDateInput(payment.occurredAt)} · {PAYMENT_METHOD_LABEL[payment.method] ?? payment.method}</div>
                      {(payment.reference || payment.notes) && <div className="text-slate-400 mt-0.5">{payment.reference || payment.notes}</div>}
                    </div>
                    {payment.kind === "PAYMENT" && !reversed && (
                      <button onClick={() => reverse(payment)} className="text-rose-600 hover:underline">Revertir</button>
                    )}
                    {reversed && <span className="text-slate-400">Revertido</span>}
                  </div>;
                })}
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t">
          <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg border hover:bg-slate-50">Cancelar</button>
          {outstandingCents > 0 && <button disabled={saving} onClick={save} className="text-sm px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
            {saving ? "Guardando…" : "Registrar cobro"}
          </button>}
        </div>
      </div>
    </div>
  );
}

function InvoiceFormModal({
  invoice,
  clients,
  issuers,
  invoices,
  lockedIssuerId,
  onClose,
  onSaved
}: {
  invoice: InvoiceRow | null;
  clients: ClientLite[];
  issuers: Issuer[];
  invoices: InvoiceRow[];
  lockedIssuerId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!invoice;
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  const defaultIssuer = issuers.find((i) => i.isDefault) ?? issuers[0];
  const [type, setType] = useState<InvoiceType>("NORMAL");
  const [clientId, setClientId] = useState<string>("");
  const [issuerId, setIssuerId] = useState<string>(lockedIssuerId ?? defaultIssuer?.id ?? "");
  const [currency, setCurrency] = useState("EUR");
  const [paymentMethod, setPaymentMethod] = useState("STRIPE");
  const [issueDate, setIssueDate] = useState(toDateInput(new Date()));
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [lines, setLines] = useState<InvoiceLine[]>([
    { description: "", quantity: 1, unitPriceCents: 0, taxRate: 21 }
  ]);
  const [recurring, setRecurring] = useState(false);
  const [intervalMonths, setIntervalMonths] = useState(1);
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
        setClientId(d.clientId ?? "");
        setIssuerId(d.issuerId ?? "");
        setCurrency(d.currency);
        setPaymentMethod(d.paymentMethod);
        setIssueDate(toDateInput(d.issueDate));
        setDueDate(toDateInput(d.dueDate));
        setNotes(d.notes ?? "");
        setTerms(d.terms ?? "");
        setLines((d.lines ?? []).length ? d.lines : [{ description: "", quantity: 1, unitPriceCents: 0, taxRate: 21 }]);
        setRecurring(!!d.recurring);
        setIntervalMonths(d.recurrenceConfig?.intervalMonths ?? 1);
        setRectifiesInvoiceId(d.rectifiesInvoiceId ?? "");
        setRectifyReason(d.rectifyReason ?? "");
        setStatus(d.status);
      }
      setLoading(false);
    })();
  }, [invoice]);

  const totals = useMemo(() => computeTotals(lines), [lines]);
  const locked = isEdit && !!invoice?.number && status !== "DRAFT";

  function setLine(i: number, patch: Partial<InvoiceLine>) {
    setLines((arr) => arr.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((arr) => [...arr, { description: "", quantity: 1, unitPriceCents: 0, taxRate: 21 }]);
  }
  function removeLine(i: number) {
    setLines((arr) => (arr.length > 1 ? arr.filter((_, idx) => idx !== i) : arr));
  }

  async function save(issue: boolean) {
    if (!clientId) return alert("Selecciona un cliente");
    if (!issuerId) return alert("Selecciona una empresa emisora (créala en 'Emisores')");
    if (lines.some((l) => !l.description.trim())) return alert("Todas las líneas necesitan descripción");

    const finalStatus = issue ? (type === "PRESUPUESTO" ? "SENT" : "ISSUED") : "DRAFT";
    const payload: any = {
      type,
      status: finalStatus,
      clientId,
      issuerId,
      series: defaultSeriesForType(type),
      currency,
      paymentMethod,
      issueDate: new Date(issueDate || new Date()).toISOString(),
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      notes: notes || null,
      terms: terms || null,
      lines: lines.map((l) => ({
        description: l.description,
        quantity: Number(l.quantity) || 0,
        unitPriceCents: Math.round(Number(l.unitPriceCents) || 0),
        taxRate: Number(l.taxRate) || 0,
        discountPct: l.discountPct ? Number(l.discountPct) : undefined
      })),
      recurring,
      recurrenceConfig: recurring ? { intervalMonths: Number(intervalMonths) || 1 } : null,
      rectifiesInvoiceId: type === "RECTIFICATIVA" ? rectifiesInvoiceId || null : null,
      rectifyReason: type === "RECTIFICATIVA" ? rectifyReason || null : null
    };

    setSaving(true);
    try {
      const r = await fetch(isEdit ? `/api/v1/invoices/${invoice!.id}` : "/api/v1/invoices", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        return alert(j?.error?.message ?? j?.message ?? `Error ${r.status}`);
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
          <div className="p-5 space-y-4">
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
                      {c}
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
                <input disabled={locked} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-slate-500 mb-1">Cliente</label>
                <select disabled={locked} value={clientId} onChange={(e) => setClientId(e.target.value)} className={inputCls}>
                  <option value="">— Selecciona cliente —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.taxId ? "" : " (sin NIF)"}
                    </option>
                  ))}
                </select>
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
                      value={intervalMonths}
                      onChange={(e) => setIntervalMonths(Number(e.target.value))}
                      className="w-16 px-2 py-1 border rounded-lg"
                    />
                    mes(es)
                  </div>
                )}
              </div>
            </div>

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
              <div className="space-y-1.5">
                {lines.map((ln, i) => (
                  <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
                    <input
                      disabled={locked}
                      placeholder="Descripción"
                      value={ln.description}
                      onChange={(e) => setLine(i, { description: e.target.value })}
                      className={`${inputCls} col-span-5`}
                    />
                    <input
                      disabled={locked}
                      type="number"
                      step="0.01"
                      placeholder="Cant."
                      value={ln.quantity}
                      onChange={(e) => setLine(i, { quantity: Number(e.target.value) })}
                      className={`${inputCls} col-span-1`}
                    />
                    <input
                      disabled={locked}
                      type="number"
                      step="0.01"
                      placeholder="Precio €"
                      value={ln.unitPriceCents / 100}
                      onChange={(e) => setLine(i, { unitPriceCents: Math.round(Number(e.target.value) * 100) })}
                      className={`${inputCls} col-span-2`}
                    />
                    <input
                      disabled={locked}
                      type="number"
                      placeholder="Dto%"
                      value={ln.discountPct ?? ""}
                      onChange={(e) => setLine(i, { discountPct: e.target.value ? Number(e.target.value) : undefined })}
                      className={`${inputCls} col-span-1`}
                    />
                    <select
                      disabled={locked}
                      value={ln.taxRate}
                      onChange={(e) => setLine(i, { taxRate: Number(e.target.value) })}
                      className={`${inputCls} col-span-2`}
                    >
                      {[21, 10, 4, 0].map((r) => (
                        <option key={r} value={r}>
                          IVA {r}%
                        </option>
                      ))}
                    </select>
                    {!locked && (
                      <button onClick={() => removeLine(i)} className="col-span-1 p-1.5 rounded-md hover:bg-rose-50 text-rose-500">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
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
                    <span>IVA {formatRate(t.rate)}</span>
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
              <button
                onClick={() => save(false)}
                disabled={saving}
                className="text-sm px-3 py-2 rounded-lg border hover:bg-slate-50 disabled:opacity-50"
              >
                Guardar borrador
              </button>
              <button
                onClick={() => save(true)}
                disabled={saving}
                className="text-sm px-4 py-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {type === "PRESUPUESTO" ? "Emitir presupuesto" : "Emitir factura"}
              </button>
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
            <h3 className="text-sm font-medium mb-2">{form.id ? "Editar emisor" : "Nuevo emisor"}</h3>
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Nombre comercial *" value={form.name} onChange={(e) => patch("name", e.target.value)} className={inputCls} />
              <input placeholder="Razón social" value={form.legalName ?? ""} onChange={(e) => patch("legalName", e.target.value)} className={inputCls} />
              <input placeholder="NIF / CIF *" value={form.taxId} onChange={(e) => patch("taxId", e.target.value)} className={inputCls} />
              <input placeholder="IBAN" value={form.iban ?? ""} onChange={(e) => patch("iban", e.target.value)} className={inputCls} />
              <input placeholder="Dirección" value={form.address ?? ""} onChange={(e) => patch("address", e.target.value)} className={`${inputCls} col-span-2`} />
              <input placeholder="Código postal" value={form.postalCode ?? ""} onChange={(e) => patch("postalCode", e.target.value)} className={inputCls} />
              <input placeholder="Ciudad" value={form.city ?? ""} onChange={(e) => patch("city", e.target.value)} className={inputCls} />
              <input placeholder="Provincia" value={form.province ?? ""} onChange={(e) => patch("province", e.target.value)} className={inputCls} />
              <input placeholder="País (ISO, ej. ESP)" value={form.countryCode ?? "ESP"} onChange={(e) => patch("countryCode", e.target.value)} className={inputCls} />
              <input placeholder="Email" value={form.email ?? ""} onChange={(e) => patch("email", e.target.value)} className={inputCls} />
              <input placeholder="Teléfono" value={form.phone ?? ""} onChange={(e) => patch("phone", e.target.value)} className={inputCls} />
              <input placeholder="Web" value={form.web ?? ""} onChange={(e) => patch("web", e.target.value)} className={inputCls} />
              <input placeholder="URL del logo" value={form.logoUrl ?? ""} onChange={(e) => patch("logoUrl", e.target.value)} className={inputCls} />
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
