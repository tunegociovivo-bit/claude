"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, X, Loader2 } from "lucide-react";
import { formatMoney, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, CURRENCIES } from "@/lib/invoicing/core";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABEL,
  EXPENSE_STATUS,
  EXPENSE_STATUS_LABEL,
  computeExpenseTotals,
  type ExpenseCategory
} from "@/lib/invoicing/expenses";

type ExpenseRow = {
  id: string;
  date: string;
  category: string;
  supplier: string | null;
  supplierTaxId: string | null;
  concept: string | null;
  currency: string;
  paymentMethod: string;
  status: string;
  baseCents: number;
  taxRate: number;
  taxCents: number;
  totalCents: number;
  deductible: boolean;
  notes: string | null;
};

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700",
  PAID: "bg-emerald-50 text-emerald-700"
};

function fmtDate(s: string): string {
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-ES");
}
function toDateInput(d?: string | Date | null): string {
  if (!d) return "";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "" : dt.toISOString().slice(0, 10);
}

export default function GastosClient({
  issuerId,
  onExpensesChanged
}: {
  issuerId?: string;
  onExpensesChanged?: () => void;
}) {
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<ExpenseRow | "new" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (issuerId) params.set("issuerId", issuerId);
      if (categoryFilter) params.set("category", categoryFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (q.trim()) params.set("q", q.trim());
      const r = await fetch(`/api/v1/expenses?${params.toString()}`, { cache: "no-store" });
      if (r.ok) setExpenses((await r.json()).items ?? []);
    } finally {
      setLoading(false);
    }
  }, [issuerId, categoryFilter, statusFilter, q]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: string) {
    if (!confirm("¿Eliminar este gasto?")) return;
    const r = await fetch(`/api/v1/expenses/${id}`, { method: "DELETE" });
    if (r.ok) {
      load();
      onExpensesChanged?.();
    }
  }

  const kpis = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const month = expenses.filter((e) => new Date(e.date).getTime() >= monthStart);
    const sum = (arr: ExpenseRow[]) => arr.reduce((s, e) => s + e.totalCents, 0);
    const pending = expenses.filter((e) => e.status === "PENDING");
    return { monthTotal: sum(month), monthCount: month.length, pending: sum(pending), pendingCount: pending.length };
  }, [expenses]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          onClick={() => setEditing("new")}
          className="inline-flex items-center gap-1.5 bg-brand-600 text-white text-sm px-3 py-2 rounded-lg hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" /> Nuevo gasto
        </button>
        <div className="flex-1" />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="text-sm border rounded-lg px-2 py-2 bg-white"
        >
          <option value="">Todas las categorías</option>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {EXPENSE_CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-sm border rounded-lg px-2 py-2 bg-white"
        >
          <option value="">Todos los estados</option>
          {EXPENSE_STATUS.map((s) => (
            <option key={s} value={s}>
              {EXPENSE_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar proveedor o concepto…"
          className="text-sm border rounded-lg px-3 py-2 bg-white w-48"
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <div className="bg-white border rounded-xl p-3">
          <div className="text-xs text-slate-500">Gastos este mes</div>
          <div className="text-lg font-bold text-rose-700">{formatMoney(kpis.monthTotal)}</div>
          <div className="text-[11px] text-slate-400">{kpis.monthCount} gastos</div>
        </div>
        <div className="bg-white border rounded-xl p-3">
          <div className="text-xs text-slate-500">Pendiente de pago</div>
          <div className="text-lg font-bold text-amber-700">{formatMoney(kpis.pending)}</div>
          <div className="text-[11px] text-slate-400">{kpis.pendingCount} gastos</div>
        </div>
        <div className="bg-white border rounded-xl p-3">
          <div className="text-xs text-slate-500">Registros</div>
          <div className="text-lg font-bold">{expenses.length}</div>
        </div>
      </div>

      <div className="bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-3 py-2">Fecha</th>
              <th className="text-left px-3 py-2">Proveedor</th>
              <th className="text-left px-3 py-2">Categoría</th>
              <th className="text-left px-3 py-2">Concepto</th>
              <th className="text-right px-3 py-2">Total</th>
              <th className="text-left px-3 py-2">Estado</th>
              <th className="text-right px-3 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                  Cargando…
                </td>
              </tr>
            ) : expenses.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                  No hay gastos registrados todavía.
                </td>
              </tr>
            ) : (
              expenses.map((e) => (
                <tr key={e.id} className="border-t hover:bg-slate-50">
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(e.date)}</td>
                  <td className="px-3 py-2">{e.supplier ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-600 text-xs">
                    {EXPENSE_CATEGORY_LABEL[e.category as ExpenseCategory] ?? e.category}
                  </td>
                  <td className="px-3 py-2 text-slate-600 truncate max-w-[220px]">{e.concept ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatMoney(e.totalCents, e.currency)}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[11px] px-2 py-0.5 rounded-md ${STATUS_STYLE[e.status] ?? "bg-slate-100"}`}>
                      {EXPENSE_STATUS_LABEL[e.status as keyof typeof EXPENSE_STATUS_LABEL] ?? e.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button title="Editar" onClick={() => setEditing(e)} className="p-1.5 rounded-md hover:bg-slate-100">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        title="Eliminar"
                        onClick={() => remove(e.id)}
                        className="p-1.5 rounded-md hover:bg-rose-50 text-rose-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <ExpenseFormModal
          expense={editing === "new" ? null : editing}
          issuerId={issuerId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
            onExpensesChanged?.();
          }}
        />
      )}
    </div>
  );
}

function ExpenseFormModal({
  expense,
  issuerId,
  onClose,
  onSaved
}: {
  expense: ExpenseRow | null;
  issuerId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!expense;
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(toDateInput(expense?.date ?? new Date()));
  const [category, setCategory] = useState<ExpenseCategory>((expense?.category as ExpenseCategory) ?? "OTROS");
  const [supplier, setSupplier] = useState(expense?.supplier ?? "");
  const [supplierTaxId, setSupplierTaxId] = useState(expense?.supplierTaxId ?? "");
  const [concept, setConcept] = useState(expense?.concept ?? "");
  const [base, setBase] = useState(expense ? (expense.baseCents / 100).toString() : "");
  const [taxRate, setTaxRate] = useState(expense ? expense.taxRate.toString() : "21");
  const [currency, setCurrency] = useState(expense?.currency ?? "EUR");
  const [paymentMethod, setPaymentMethod] = useState(expense?.paymentMethod ?? "TRANSFER");
  const [status, setStatus] = useState(expense?.status ?? "PAID");
  const [deductible, setDeductible] = useState(expense?.deductible ?? true);
  const [notes, setNotes] = useState(expense?.notes ?? "");

  const baseCents = Math.round((parseFloat(base.replace(",", ".")) || 0) * 100);
  const rate = parseFloat(taxRate.replace(",", ".")) || 0;
  const totals = computeExpenseTotals(baseCents, rate);

  async function save() {
    if (baseCents <= 0) return alert("Indica un importe (base) mayor que 0");
    setSaving(true);
    try {
      const payload = {
        issuerId: issuerId ?? null,
        date: new Date(date || new Date()).toISOString(),
        category,
        supplier: supplier || null,
        supplierTaxId: supplierTaxId || null,
        concept: concept || null,
        currency,
        paymentMethod,
        status,
        baseCents,
        taxRate: rate,
        deductible,
        notes: notes || null
      };
      const r = await fetch(isEdit ? `/api/v1/expenses/${expense!.id}` : "/api/v1/expenses", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(j?.error?.message ?? `Error ${r.status}`);
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full px-2.5 py-1.5 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-4">
        <div className="flex items-center justify-between px-5 py-3 border-b sticky top-0 bg-white rounded-t-2xl">
          <h2 className="font-semibold">{isEdit ? "Editar gasto" : "Nuevo gasto"}</h2>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Fecha</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-slate-500 mb-1">Categoría</label>
              <select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)} className={inputCls}>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {EXPENSE_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Estado</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
                {EXPENSE_STATUS.map((s) => (
                  <option key={s} value={s}>
                    {EXPENSE_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Proveedor</label>
              <input value={supplier} onChange={(e) => setSupplier(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">NIF/CIF proveedor</label>
              <input value={supplierTaxId} onChange={(e) => setSupplierTaxId(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">Concepto</label>
            <input value={concept} onChange={(e) => setConcept(e.target.value)} className={inputCls} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Base (sin IVA)</label>
              <input
                type="number"
                step="0.01"
                value={base}
                onChange={(e) => setBase(e.target.value)}
                className={inputCls}
                placeholder="0,00"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">IVA %</label>
              <input
                type="number"
                step="0.01"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Divisa</label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputCls}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Método de pago</label>
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={inputCls}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={deductible} onChange={(e) => setDeductible(e.target.checked)} />
              IVA deducible
            </label>
            <div className="text-sm text-slate-600">
              IVA: <span className="font-medium">{formatMoney(totals.taxCents, currency)}</span> · Total:{" "}
              <span className="font-bold text-slate-900">{formatMoney(totals.totalCents, currency)}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">Notas</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} />
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
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isEdit ? "Guardar" : "Crear gasto"}
          </button>
        </div>
      </div>
    </div>
  );
}
