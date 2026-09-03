import { describe, expect, it } from "vitest";
import { buildAccountancyReport } from "@/lib/accountancy-invoices/report";

describe("accountancy report", () => {
  it("genera un PDF válido con el detalle mensual", async () => {
    const pdf = await buildAccountancyReport("2026-08", [{ clientName: "Negocio Vivo", source: "HOLDED", status: "DOWNLOADED", invoiceCount: 1, amountCents: 12345, currency: "EUR", invoiceDetails: [{ number: "F-1", date: "2026-08-03", amountCents: 12345, currency: "EUR" }], error: null }]);
    expect(pdf.subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
