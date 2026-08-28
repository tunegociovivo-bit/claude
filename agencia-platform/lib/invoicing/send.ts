import { sendEmail } from "@/lib/integrations/email";
import { buildInvoiceHtml } from "./invoice-html";
import { invoiceRecipientEmail } from "./invoice-form";

export async function sendInvoiceAutomatically(workspaceId: string, invoice: any, idempotencyKey: string): Promise<void> {
  const client = (invoice.clientSnapshot ?? {}) as any;
  const issuer = (invoice.issuerSnapshot ?? {}) as any;
  const recipient = invoiceRecipientEmail(client);
  const number = invoice.number ?? "sin número";
  const label = invoice.type === "PRESUPUESTO" ? "Presupuesto" : "Factura";
  const html = buildInvoiceHtml({
    ...invoice,
    lines: Array.isArray(invoice.lines) ? invoice.lines : [],
    issuer,
    client
  }, { autoprint: false });

  await sendEmail({
    workspaceId,
    to: recipient,
    subject: `${label} ${number} · ${issuer.name ?? "Negocio Vivo"}`,
    html,
    text: `${label} ${number}. Puedes consultar el documento completo en este correo.`,
    replyTo: issuer.email ?? undefined,
    idempotencyKey
  });
}
