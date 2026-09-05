import { describe, expect, it } from "vitest";
import { decodeHoldedPdfPayload, describeHoldedPayload, extractSafeHoldedPdfUrl, holdedV2TotalLimit, normalizeHoldedV2Invoices, parseHoldedAmount } from "@/lib/integrations/holded";

const pdf = Buffer.from("%PDF-1.7\ninvoice");

describe("decodeHoldedPdfPayload", () => {
  it("parses numeric, object and localized Holded totals", () => {
    expect(parseHoldedAmount({ value: "1.234,56 EUR" })).toBe(1234.56);
    expect(parseHoldedAmount({ value: "1,234.56 USD" })).toBe(1234.56);
    expect(parseHoldedAmount({ amount: "242.00" })).toBe(242);
    expect(parseHoldedAmount(363)).toBe(363);
    expect(parseHoldedAmount("1,234")).toBe(0);
  });
  it("caps the complete Holded v2 pagination at 500 invoices", () => {
    expect(holdedV2TotalLimit(5_000)).toBe(500);
    expect(holdedV2TotalLimit(5)).toBe(5);
  });
  it("describes payload shape without exposing invoice values", () => {
    expect(describeHoldedPayload({ data: [{ id: "secret", total: 999 }] })).toEqual({ data: { type: "array", length: 1, sampleKeys: ["id", "total"] } });
  });
  it("normalizes v2 invoice collections and ISO dates", () => {
    expect(normalizeHoldedV2Invoices({ data: [{ id: "inv_1", documentNumber: "FAC-1", issueDate: "2026-08-15", total: 121, currency: "EUR", contact: { name: "Cliente" } }] })).toEqual([
      expect.objectContaining({ id: "inv_1", docNumber: "FAC-1", contactName: "Cliente", total: 121, currency: "EUR", date: 1786752000 })
    ]);
  });
  it("normalizes paginated v2 collections nested under data.items", () => {
    expect(normalizeHoldedV2Invoices({ data: { items: [{ id: "inv_2", documentNumber: "FAC-2", issueDate: "2026-09-05", total: { amount: 242 }, customer: { name: "Cliente 2" } }] } })).toEqual([
      expect.objectContaining({ id: "inv_2", docNumber: "FAC-2", contactName: "Cliente 2", total: 242 })
    ]);
  });
  it("finds invoice rows inside deeper v2 pagination wrappers", () => {
    expect(normalizeHoldedV2Invoices({ response: { payload: { records: [{ invoiceId: "inv_3", number: "FAC-3", date: 1788566400, total: 363 }] } } })).toEqual([
      expect.objectContaining({ id: "inv_3", docNumber: "FAC-3", total: 363 })
    ]);
  });
  it("accepts Holded document identifiers exposed as _id", () => {
    expect(normalizeHoldedV2Invoices({ data: { records: [{ _id: "inv_4", docNumber: "FAC-4", date: 1788566400, total: 484 }] } })).toEqual([
      expect.objectContaining({ id: "inv_4", docNumber: "FAC-4", total: 484 })
    ]);
  });
  it("normalizes the snake_case fields returned by the Holded v2 API", () => {
    expect(normalizeHoldedV2Invoices({ items: [{ id: "inv_5", document_number: "FAC-005", contact_name: "Cliente cinco", contact_id: "c5", description: "Servicio", date: 1788566400, due_date: "2026-10-05", total: 605, currency: "EUR", status: "pending" }] })).toEqual([
      expect.objectContaining({ id: "inv_5", docNumber: "FAC-005", contactName: "Cliente cinco", contact: "c5", desc: "Servicio", total: 605, status: 0 })
    ]);
  });
  it("accepts a binary PDF response", () => {
    expect(decodeHoldedPdfPayload(pdf)).toEqual(pdf);
  });

  it("accepts legacy Holded JSON with base64 PDF content", () => {
    const wrapped = Buffer.from(JSON.stringify({ data: pdf.toString("base64") }));
    expect(decodeHoldedPdfPayload(wrapped)).toEqual(pdf);
  });

  it("accepts the legacy raw base64 response body", () => {
    expect(decodeHoldedPdfPayload(Buffer.from(pdf.toString("base64")))).toEqual(pdf);
  });

  it("accepts legacy Holded responses whose data is JSON encoded more than once", () => {
    const wrapped = Buffer.from(JSON.stringify({ data: JSON.stringify({ data: pdf.toString("base64") }) }));
    expect(decodeHoldedPdfPayload(wrapped)).toEqual(pdf);
  });

  it("accepts legacy byte arrays and chunked base64 responses", () => {
    expect(decodeHoldedPdfPayload(Buffer.from(JSON.stringify({ data: [...pdf] })))).toEqual(pdf);
    const encoded = pdf.toString("base64");
    expect(decodeHoldedPdfPayload(Buffer.from(JSON.stringify({ data: [encoded.slice(0, 8), encoded.slice(8)] })))).toEqual(pdf);
  });

  it("rejects unrelated response content", () => {
    expect(() => decodeHoldedPdfPayload(Buffer.from('{"ok":true}'))).toThrow(/PDF/);
  });

  it("accepts an HTTPS URL returned by legacy Holded and blocks local URLs", () => {
    expect(extractSafeHoldedPdfUrl(Buffer.from(JSON.stringify({ response: { document: { url: "https://cdn.holded.com/invoice.pdf" } } })))).toBe("https://cdn.holded.com/invoice.pdf");
    expect(() => extractSafeHoldedPdfUrl(Buffer.from('"http://127.0.0.1/invoice.pdf"'))).toThrow(/segura/);
  });
});
