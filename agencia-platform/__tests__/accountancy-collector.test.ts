import { describe, expect, it } from "vitest";
import { buildCollectorTarget, sanitizeCollectorFilename } from "@/lib/accountancy-invoices/collector";

describe("accountancy browser collector", () => {
  it("builds a Meta billing URL for the complete requested period", () => {
    const target = buildCollectorTarget({
      source: "META",
      externalAccountId: "290451863303865",
      periodFrom: "2026-08-01T00:00:00.000Z",
      periodTo: "2026-08-31T23:59:59.999Z"
    });
    expect(target.url).toContain("asset_id=290451863303865");
    expect(target.url).toMatch(/date=\d+_\d+/);
    expect(target.mode).toBe("META");
  });

  it("accepts an explicit billing URL for Google Ads", () => {
    expect(buildCollectorTarget({ source: "GOOGLE_ADS", externalAccountId: "https://ads.google.com/aw/billing/documents?ocid=123", periodFrom: "2026-08-01", periodTo: "2026-08-31" }).url)
      .toBe("https://ads.google.com/aw/billing/documents?ocid=123");
  });

  it("uses the Holded revenue page and rejects unsupported identifiers", () => {
    expect(buildCollectorTarget({ source: "HOLDED", externalAccountId: "holded-sales-revenue", periodFrom: "2026-08-01", periodTo: "2026-08-31" }).url)
      .toBe("https://app.holded.com/sales/revenue");
    expect(() => buildCollectorTarget({ source: "GOOGLE_ADS", externalAccountId: "123-456-7890", periodFrom: "2026-08-01", periodTo: "2026-08-31" })).toThrow("URL de facturación");
  });

  it("normalizes uploaded PDF filenames", () => {
    expect(sanitizeCollectorFilename("../Factura Meta agosto.PDF")).toBe("Factura_Meta_agosto.PDF");
    expect(() => sanitizeCollectorFilename("factura.exe")).toThrow("PDF");
  });
});
