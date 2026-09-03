import { describe, expect, it } from "vitest";
import { decodeHoldedPdfPayload } from "@/lib/integrations/holded";

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
});
