import { describe, expect, it } from "vitest";
import { decodeHoldedPdfPayload, describeHoldedPayload, extractSafeHoldedPdfUrl, normalizeHoldedV2Invoices } from "@/lib/integrations/holded";

const pdf = Buffer.from("%PDF-1.7\ninvoice");

describe("decodeHoldedPdfPayload", () => {
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
