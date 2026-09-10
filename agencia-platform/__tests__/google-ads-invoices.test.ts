import { describe, expect, it } from "vitest";
import { googleAdsApiHeaders, googleAdsIssueMonth, normalizeGoogleAdsInvoices } from "@/lib/integrations/google-ads";

describe("Google Ads API headers", () => {
  it("supports Cloud-managed access without a developer token", () => {
    expect(googleAdsApiHeaders("access-token")).toEqual({
      Authorization: "Bearer access-token"
    });
  });

  it("keeps legacy developer-token compatibility", () => {
    expect(googleAdsApiHeaders("access-token", " legacy-token ")).toEqual({
      Authorization: "Bearer access-token",
      "developer-token": "legacy-token"
    });
  });
});

describe("Google Ads invoice request", () => {
  it("serializes the month using the Google Ads enum", () => {
    expect(googleAdsIssueMonth(8)).toBe("AUGUST");
    expect(() => googleAdsIssueMonth(13)).toThrow("Mes de factura de Google Ads no válido");
  });
});

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
