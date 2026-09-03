import { describe, expect, it } from "vitest";
import { decodeHoldedPdfPayload, extractSafeHoldedPdfUrl } from "@/lib/integrations/holded";

const pdf = Buffer.from("%PDF-1.7\ninvoice");

describe("decodeHoldedPdfPayload", () => {
  it("accepts a binary PDF response", () => {
    expect(decodeHoldedPdfPayload(pdf)).toEqual(pdf);
  });

  it("accepts legacy Holded JSON with base64 PDF content", () => {
    const wrapped = Buffer.from(JSON.stringify({ data: pdf.toString("base64") }));
    expect(decodeHoldedPdfPayload(wrapped)).toEqual(pdf);
  });

  it("rejects unrelated response content", () => {
    expect(() => decodeHoldedPdfPayload(Buffer.from('{"ok":true}'))).toThrow(/PDF/);
  });

  it("accepts an HTTPS URL returned by legacy Holded and blocks local URLs", () => {
    expect(extractSafeHoldedPdfUrl(Buffer.from(JSON.stringify({ data: "https://cdn.holded.com/invoice.pdf" })))).toBe("https://cdn.holded.com/invoice.pdf");
    expect(() => extractSafeHoldedPdfUrl(Buffer.from('"http://127.0.0.1/invoice.pdf"'))).toThrow(/segura/);
  });
});
