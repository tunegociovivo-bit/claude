import { sendEmailWithAttachment } from "@/lib/integrations/email";
import { buildInvoiceEmailHtml } from "./invoice-html";
import { invoiceRecipientEmail } from "./invoice-form";
import { buildInvoicePdf } from "./invoice-pdf";

export async function sendInvoiceAutomatically(workspaceId: string, invoice: any, idempotencyKey: string): Promise<void> {
  const client = (invoice.clientSnapshot ?? {}) as any;
  const issuer = (invoice.issuerSnapshot ?? {}) as any;
  const recipient = invoiceRecipientEmail(client);
  const number = invoice.number ?? "sin número";
  const label = invoice.type === "PRESUPUESTO" ? "Presupuesto" : "Factura";
  const html = buildInvoiceEmailHtml({
    ...invoice,
    lines: Array.isArray(invoice.lines) ? invoice.lines : [],
    issuer,
    client
  });

  const pdf = await buildInvoicePdf({ ...invoice, lines: Array.isArray(invoice.lines) ? invoice.lines : [], issuer, client });
  await sendEmailWithAttachment({
    workspaceId,
    to: recipient,
    subject: `${label} ${number} · ${issuer.name ?? "Negocio Vivo"}`,
    html,
    text: `${label} ${number}. Puedes consultar el documento completo en este correo.`,
    replyTo: issuer.email ?? undefined,
    idempotencyKey,
    attachment: { filename: `${number}.pdf`.replace(/[^A-Za-z0-9._-]/g, "_"), content: pdf, contentType: "application/pdf" }
  });
}
