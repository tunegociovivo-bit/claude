/**
 * Contrato FASE 3 — rentabilidad solo con datos trazables; costes/margen "sin datos".
 */
import { describe, it, expect } from "vitest";
import { computeProfitability, type InvoiceForProfit } from "../profitability";

const NOW = new Date("2026-08-11T00:00:00.000Z");
const past = new Date("2026-07-01T00:00:00.000Z");
const future = new Date("2026-09-01T00:00:00.000Z");
const inv = (o: Partial<InvoiceForProfit>): InvoiceForProfit => ({ status: "ISSUED", totalCents: 0, paidCents: 0, dueDate: null, ...o });

describe("computeProfitability", () => {
  it("suma facturado/pagado/pendiente solo de ISSUED/PAID (excluye DRAFT/CANCELLED)", () => {
    const r = computeProfitability({
      mrrEuros: 0,
      now: NOW,
      invoices: [
        inv({ status: "PAID", totalCents: 10000, paidCents: 10000 }),
        inv({ status: "ISSUED", totalCents: 5000, paidCents: 2000 }),
        inv({ status: "DRAFT", totalCents: 9999, paidCents: 0 }),
        inv({ status: "CANCELLED", totalCents: 8888, paidCents: 0 })
      ]
    });
    expect(r.invoiced.count).toBe(2);
    expect(r.invoiced.billedCents).toBe(15000);
    expect(r.invoiced.paidCents).toBe(12000);
    expect(r.invoiced.pendingCents).toBe(3000);
  });

  it("overdue = pendiente con dueDate pasada (no cuenta futura ni pagada)", () => {
    const r = computeProfitability({
      mrrEuros: 0,
      now: NOW,
      invoices: [
        inv({ status: "ISSUED", totalCents: 5000, paidCents: 0, dueDate: past }), // overdue
        inv({ status: "ISSUED", totalCents: 5000, paidCents: 0, dueDate: future }), // aún no
        inv({ status: "PAID", totalCents: 5000, paidCents: 5000, dueDate: past }) // pagada
      ]
    });
    expect(r.invoiced.overdueCents).toBe(5000);
    expect(r.invoiced.overdueCount).toBe(1);
  });

  it("costes y margen SIEMPRE 'sin datos' (no se inventan)", () => {
    const r = computeProfitability({ mrrEuros: 500, now: NOW, invoices: [inv({ status: "PAID", totalCents: 1000, paidCents: 1000 })] });
    expect(r.cost.available).toBe(false);
    expect(r.margin.available).toBe(false);
    expect(r.dataQuality.costsTraceable).toBe(false);
    expect(r.cost.reason).toMatch(/[Ss]in datos/);
  });

  it("MRR recurrente separado de lo facturado; dataQuality refleja ausencias", () => {
    const r = computeProfitability({ mrrEuros: 300, now: NOW, invoices: [] });
    expect(r.recurring).toEqual({ mrrEuros: 300, hasMrr: true });
    expect(r.invoiced.billedCents).toBe(0);
    expect(r.dataQuality.hasInvoices).toBe(false);
    expect(r.dataQuality.hasMrr).toBe(true);
  });

  it("clampa valores negativos/incoherentes (paid>total)", () => {
    const r = computeProfitability({ mrrEuros: -5, now: NOW, invoices: [inv({ status: "PAID", totalCents: 1000, paidCents: 9999 })] });
    expect(r.recurring.mrrEuros).toBe(0);
    expect(r.invoiced.paidCents).toBe(1000); // clamp a total
    expect(r.invoiced.pendingCents).toBe(0);
  });
});
