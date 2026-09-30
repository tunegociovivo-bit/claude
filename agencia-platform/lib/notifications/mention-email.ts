/**
 * Plantilla del email "Te han mencionado en el Hub".
 *
 * HTML de email "a la antigua" (tablas + estilos inline) para que se vea
 * igual en Gmail, Outlook y webmails tipo Roundcube. El cuerpo del
 * comentario/tarea llega ya renderizado desde `rich-text.ts`.
 */

import { escapeHtml } from "@/lib/notifications/rich-text";

export type MentionEmailInput = {
  actorName: string;
  /** "un comentario", "la tarea", "el documento" */
  whereLabel: string;
  /** Título de la tarea o documento. */
  sourceTitle: string;
  /** Etiqueta del contenedor: "Tarea" / "Documento". */
  sourceKindLabel: string;
  /** URL absoluta para abrir en el Hub. */
  url: string;
  /** Texto del botón. */
  ctaLabel: string;
  /** HTML ya renderizado del fragmento (o "" si no hay). */
  excerptHtml: string;
  excerptTruncated: boolean;
  /** Versión texto plano del fragmento (para text/plain y el preheader). */
  excerptText: string;
};

const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function buildMentionEmail(input: MentionEmailInput): { subject: string; html: string; text: string } {
  const subject = `${input.actorName} te ha mencionado en «${input.sourceTitle}»`;
  const initials = getInitials(input.actorName);
  const preheader = input.excerptText
    ? input.excerptText.replace(/\s+/g, " ").slice(0, 110)
    : `${input.actorName} te ha mencionado en ${input.whereLabel}.`;

  const excerptBlock = input.excerptHtml
    ? `
          <tr>
            <td style="padding:0 28px 8px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
                <tr>
                  <td style="background:#f8f9fc;border:1px solid #e6e8f0;border-left:4px solid #3f47d8;border-radius:8px;padding:16px 18px 6px 18px;font-family:${FONT};font-size:14px;line-height:1.6;color:#1f2937;word-break:break-word;">
                    ${input.excerptHtml}
                  </td>
                </tr>
              </table>
              ${
                input.excerptTruncated
                  ? `<p style="margin:8px 0 0 2px;font-family:${FONT};font-size:12px;color:#6b7280;">El mensaje continúa en el Hub…</p>`
                  : ""
              }
            </td>
          </tr>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">

          <!-- Cabecera -->
          <tr>
            <td style="padding:0 4px 14px 4px;font-family:${FONT};font-size:13px;font-weight:700;color:#3f47d8;letter-spacing:0.2px;">
              Negocio Vivo <span style="color:#9ca3af;font-weight:500;">· Hub</span>
            </td>
          </tr>

          <!-- Tarjeta -->
          <tr>
            <td style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

                <!-- Quién y dónde -->
                <tr>
                  <td style="padding:24px 28px 18px 28px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td valign="top" style="padding-right:14px;">
                          <div style="width:42px;height:42px;line-height:42px;border-radius:21px;background:#3f47d8;color:#ffffff;text-align:center;font-family:${FONT};font-size:15px;font-weight:700;">${escapeHtml(initials)}</div>
                        </td>
                        <td valign="middle" style="font-family:${FONT};">
                          <div style="font-size:16px;line-height:1.4;color:#111827;"><strong>${escapeHtml(input.actorName)}</strong> te ha mencionado en ${escapeHtml(input.whereLabel)}</div>
                          <div style="margin-top:4px;font-size:13px;line-height:1.4;color:#6b7280;">${escapeHtml(input.sourceKindLabel)}: <strong style="color:#374151;">${escapeHtml(input.sourceTitle)}</strong></div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
${excerptBlock}
                <!-- Botón -->
                <tr>
                  <td style="padding:18px 28px 26px 28px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td align="center" bgcolor="#3f47d8" style="border-radius:8px;">
                          <a href="${escapeHtml(input.url)}" target="_blank" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(input.ctaLabel)} →</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Pie -->
          <tr>
            <td style="padding:16px 4px 0 4px;font-family:${FONT};font-size:12px;line-height:1.5;color:#9ca3af;">
              Recibes este aviso porque alguien te ha mencionado con @ en el Hub de Negocio Vivo.<br>
              Si el botón no funciona, copia este enlace: <a href="${escapeHtml(input.url)}" style="color:#6b7280;word-break:break-all;">${escapeHtml(input.url)}</a>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `${input.actorName} te ha mencionado en ${input.whereLabel}`,
    `${input.sourceKindLabel}: ${input.sourceTitle}`,
    input.excerptText ? `\n${input.excerptText}` : "",
    input.excerptTruncated ? "\n(El mensaje continúa en el Hub)" : "",
    `\n${input.ctaLabel}: ${input.url}`
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

function getInitials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase() || "?";
}
