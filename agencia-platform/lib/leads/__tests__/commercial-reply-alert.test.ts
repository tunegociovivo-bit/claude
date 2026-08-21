import { describe, expect, it } from "vitest";
import { buildCommercialReplyAlert, formatWhatsappAttachmentBody, validateWhatsappAttachment } from "@/lib/leads/commercial-reply-alert";

describe("buildCommercialReplyAlert", () => {
  it("includes the complete ordered conversation and a direct mobile reply link", () => {
    const text = buildCommercialReplyAlert({
      leadName: "Piscinas Ondamar",
      phone: "34677899513",
      taskTitle: "Lead comercial: Piscinas Ondamar",
      conversationUrl: "https://hub.negociovivo.app/admin/leads?tab=inbox&phone=34677899513",
      messages: [
        { direction: "out", body: "Hola, te escribo de Negocio Vivo" },
        { direction: "in", body: "Sí, envíame presupuesto" }
      ]
    });

    expect(text).toContain("Nosotros: Hola, te escribo de Negocio Vivo");
    expect(text).toContain("Lead: Sí, envíame presupuesto");
    expect(text).toContain("https://hub.negociovivo.app/admin/leads?tab=inbox&phone=34677899513");
  });
});

describe("validateWhatsappAttachment", () => {
  it("accepts a normal PDF quote", () => {
    expect(validateWhatsappAttachment({ name: "presupuesto.pdf", type: "application/pdf", size: 2_000_000 })).toBeNull();
  });

  it("rejects executable files and files larger than 20 MB", () => {
    expect(validateWhatsappAttachment({ name: "factura.exe", type: "application/octet-stream", size: 10 })).toMatch(/tipo/i);
    expect(validateWhatsappAttachment({ name: "grande.pdf", type: "application/pdf", size: 21 * 1024 * 1024 })).toMatch(/20 MB/i);
  });
});

describe("formatWhatsappAttachmentBody", () => {
  it("shows the native document and its optional caption in the task conversation", () => {
    expect(formatWhatsappAttachmentBody("Presupuesto 2026.pdf", "Te adjunto la propuesta")).toBe(
      "📎 Presupuesto 2026.pdf\nTe adjunto la propuesta"
    );
  });
});
