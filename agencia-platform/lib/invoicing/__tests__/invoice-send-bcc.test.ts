import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sendEmailWithAttachment: vi.fn(async () => ({ id: "mail-1" })) }));
vi.mock("@/lib/integrations/email", () => ({ sendEmailWithAttachment: mocks.sendEmailWithAttachment }));
vi.mock("@/lib/invoicing/invoice-html", () => ({ buildInvoiceEmailHtml: vi.fn(() => "<p>Invoice</p>") }));
vi.mock("@/lib/invoicing/invoice-pdf", () => ({ buildInvoicePdf: vi.fn(async () => Buffer.from("pdf")) }));

import { sendInvoiceAutomatically } from "@/lib/invoicing/send";

describe("invoice BCC delivery", () => {
  it("sends recurring invoice copies as hidden recipients", async () => {
    await sendInvoiceAutomatically("workspace-1", {
      id: "invoice-1", type: "NORMAL", number: "INV-2026-0002", currency: "USD", lines: [],
      clientSnapshot: {
        name: "Calle Ancha Rohrmoser, S.A.", billingEmail: "client@example.com",
        invoiceBcc: ["info@negociovivo.com", "control@example.com"]
      },
      issuerSnapshot: { name: "Rixus Solutions L.L.C." }
    }, "invoice:1:send");

    expect(mocks.sendEmailWithAttachment).toHaveBeenCalledWith(expect.objectContaining({
      to: "client@example.com",
      bcc: ["info@negociovivo.com", "control@example.com"]
    }));
  });
});
