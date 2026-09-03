import { describe, expect, it } from "vitest";
import { normalizeGoogleAdsInvoices } from "@/lib/integrations/google-ads";

describe("Google Ads invoice normalization", () => {
  it("keeps downloadable invoices and preserves their accounting total", () => {
    expect(normalizeGoogleAdsInvoices({
      invoices: [
        {
          resourceName: "customers/123/invoices/5679420359",
          id: "5679420359",
          issueDate: "2026-08-31",
          totalAmountMicros: "2179070000",
          currencyCode: "EUR",
          pdfUrl: "https://example.test/invoice.pdf"
        },
        { id: "not-downloadable" }
      ]
    })).toEqual([{
      id: "customers/123/invoices/5679420359",
      number: "5679420359",
      issueDate: "2026-08-31",
      totalAmountMicros: 2179070000,
      currency: "EUR",
      pdfUrl: "https://example.test/invoice.pdf"
    }]);
  });
});
