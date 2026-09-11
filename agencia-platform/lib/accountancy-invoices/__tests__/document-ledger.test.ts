import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");

describe("accountancy document ledger", () => {
  it("exposes archived PDFs and a durable download route", () => {
    const api = readFileSync(resolve(root, "app/api/accountancy-invoices/route.ts"), "utf8");
    const ui = readFileSync(resolve(root, "components/AccountancyInvoicesClient.tsx"), "utf8");
    const download = readFileSync(resolve(root, "app/api/accountancy-invoices/files/[id]/route.ts"), "utf8");

    expect(api).toContain("documents");
    expect(ui).toContain("Facturas publicitarias por cliente");
    expect(ui).toContain("Visualizar");
    expect(download).toContain("signedDownloadUrl");
  });

  it("links downloaded Google Ads invoices to expenses idempotently", () => {
    const ledger = readFileSync(resolve(root, "lib/accountancy-invoices/expense-ledger.ts"), "utf8");
    const agent = readFileSync(resolve(root, "app/api/v1/admin/accountancy-invoices/agent/route.ts"), "utf8");
    const service = readFileSync(resolve(root, "lib/accountancy-invoices/service.ts"), "utf8");

    expect(ledger).toContain("[accountancy-file:");
    expect(ledger).toContain('source !== "GOOGLE_ADS"');
    expect(agent).toContain("syncAccountancyRunItemExpenses");
    expect(service).toContain("syncAccountancyRunItemExpenses");
  });
});
