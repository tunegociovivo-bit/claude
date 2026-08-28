import { sendEmailWithAttachment } from "@/lib/integrations/email";
import { buildInvoiceEmailHtml } from "./invoice-html";
import { invoiceRecipientEmail } from "./invoice-form";
import { buildInvoicePdf } from "./invoice-pdf";
import { invoiceLanguage, localizedTypeLabel } from "./invoice-locale";

export async function sendInvoiceAutomatically(workspaceId: string, invoice: any, idempotencyKey: string): Promise<void> {
  const client = (invoice.clientSnapshot ?? {}) as any;
  const issuer = (invoice.issuerSnapshot ?? {}) as any;
  const recipient = invoiceRecipientEmail(client);
  const renderable = {
    ...invoice,
    lines: Array.isArray(invoice.lines) ? invoice.lines : [],
    issuer,
    client
  };
  const language = invoiceLanguage(renderable);
  const number = invoice.number ?? (language === "en" ? "unnumbered" : "sin número");
  const label = localizedTypeLabel(invoice.type, language);
  const html = buildInvoiceEmailHtml(renderable);

  const pdf = await buildInvoicePdf(renderable);
  await sendEmailWithAttachment({
    workspaceId,
    to: recipient,
    subject: `${label} ${number} · ${issuer.name ?? "Negocio Vivo"}`,
    html,
    text: language === "en"
      ? `${label} ${number}. The complete document is attached to this email.`
      : `${label} ${number}. Puedes consultar el documento completo en este correo.`,
    replyTo: issuer.email ?? undefined,
    idempotencyKey,
    attachment: { filename: `${number}.pdf`.replace(/[^A-Za-z0-9._-]/g, "_"), content: pdf, contentType: "application/pdf" }
  });
}
