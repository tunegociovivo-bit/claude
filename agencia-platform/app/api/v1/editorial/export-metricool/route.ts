/**
 * Exporta publicaciones del calendario editorial al formato CSV de Metricool.
 *
 * Modos:
 *  - body.email + sendEmail=true: si Resend está configurado, manda el CSV
 *    como adjunto al email indicado. Devuelve { sent: true } + CSV inline.
 *  - sendEmail=false (o sin Resend): solo devuelve el CSV inline + metadata.
 *
 * Filtros opcionales en body:
 *   { month: "YYYY-MM", clientId, statuses: ["APPROVED","SCHEDULED"],
 *     onlyNotExported: boolean, email, sendEmail }
 *
 * Tras exportar, marca lastExportedAt = now en cada publicación incluida,
 * para que `onlyNotExported` permita exportar incrementalmente.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { buildMetricoolCsv } from "@/lib/integrations/metricool-csv";
import { resignPostMediaLong } from "@/lib/storage/resign";
import { isEmailEnabled, sendEmailWithAttachment } from "@/lib/integrations/email";

const inputSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  clientId: z.string().optional(),
  statuses: z.array(z.string()).optional(),
  onlyNotExported: z.boolean().default(false),
  email: z.string().email().optional(),
  sendEmail: z.boolean().default(false),
  markAsScheduled: z.boolean().default(false)
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => ({}));
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const { month, clientId, statuses, onlyNotExported, email, sendEmail, markAsScheduled } = parsed.data;

  const where: any = { workspaceId: api.workspaceId, scheduledFor: { not: null } };
  if (clientId) where.clientId = clientId;
  if (month) {
    const [y, m] = month.split("-").map(Number);
    where.scheduledFor = {
      gte: new Date(Date.UTC(y, m - 1, 1)),
      lt: new Date(Date.UTC(y, m, 1))
    };
  }
  // Defaults: APPROVED + SCHEDULED (publicaciones listas para Metricool)
  where.status = { in: statuses && statuses.length > 0 ? statuses : ["APPROVED", "SCHEDULED"] };
  if (onlyNotExported) where.lastExportedAt = null;

  const posts = await prisma.editorialPost.findMany({
    where,
    include: { client: { select: { name: true } } },
    orderBy: { scheduledFor: "asc" }
  });

  if (posts.length === 0) {
    return NextResponse.json(
      { ok: false, error: { code: "empty", message: "No hay publicaciones que exportar con esos filtros." } },
      { status: 400 }
    );
  }

  // Re-firmamos las imágenes con validez de 7 días: las URLs guardadas en
  // BD están firmadas a 1h y ya habían caducado al importar en Metricool
  // (por eso le faltaban TODAS las imágenes). Metricool descarga el fichero
  // al importar, que puede ser horas/días después de exportar.
  const postsFresh = await Promise.all(posts.map((p) => resignPostMediaLong(p)));

  const { csv, rowCount, postIds } = buildMetricoolCsv(postsFresh as any);

  const monthLabel = month ?? "todos";
  const filename = `metricool-${monthLabel}-${new Date().toISOString().slice(0, 10)}.csv`;

  let emailResult: any = null;
  if (sendEmail && email) {
    if (!isEmailEnabled()) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "email_disabled",
            message: "El envío por email no está configurado. Añade RESEND_API_KEY en Railway o descarga el CSV manualmente."
          }
        },
        { status: 503 }
      );
    }
    try {
      const html = renderEmailHtml({
        recipientName: email,
        rowCount,
        postCount: postIds.length,
        month: monthLabel,
        filename
      });
      emailResult = await sendEmailWithAttachment({
        to: email,
        subject: `Hub · Programación Metricool ${monthLabel} (${rowCount} filas)`,
        html,
        text: `Se adjunta el CSV con ${rowCount} filas para importar en Metricool. ${postIds.length} publicaciones incluidas.`,
        attachment: {
          filename,
          content: csv,
          contentType: "text/csv"
        }
      });
    } catch (e: any) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "send_failed", message: String(e?.message ?? e).slice(0, 300) }
        },
        { status: 502 }
      );
    }
  }

  // Marcar lastExportedAt para todas las publicaciones incluidas
  if (postIds.length > 0) {
    const now = new Date();
    const data: any = { lastExportedAt: now };
    if (markAsScheduled) data.status = "SCHEDULED";
    await prisma.editorialPost.updateMany({
      where: { id: { in: postIds } },
      data
    });
  }

  return NextResponse.json({
    ok: true,
    rowCount,
    postCount: postIds.length,
    filename,
    csv,
    emailSent: Boolean(emailResult),
    emailId: emailResult?.id ?? null
  });
});

function renderEmailHtml(opts: {
  recipientName: string;
  rowCount: number;
  postCount: number;
  month: string;
  filename: string;
}): string {
  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;padding:24px;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px">
    <h1 style="margin:0 0 8px;font-size:20px">Programación para Metricool</h1>
    <p style="color:#475569;font-size:14px;line-height:1.55;margin:0 0 18px">
      Adjunto el CSV con <strong>${opts.rowCount} filas</strong> correspondientes a <strong>${opts.postCount} publicaciones</strong> del mes <strong>${opts.month}</strong>, listas para subirlas al importador masivo de Metricool.
    </p>
    <div style="background:#f1f5f9;border-radius:10px;padding:14px;font-size:13px;color:#475569;margin-bottom:18px">
      <strong>Cómo importarlo:</strong>
      <ol style="margin:6px 0 0 18px;padding:0">
        <li>Abre Metricool → Calendario → "Importar CSV".</li>
        <li>Sube el archivo adjunto <code style="background:#e2e8f0;padding:2px 4px;border-radius:4px">${opts.filename}</code>.</li>
        <li>Cuando te pregunte el formato, elige fecha <strong>YYYY-MM-DD</strong> y hora <strong>HH:MM:SS</strong>.</li>
        <li>Revisa la previsualización y confirma.</li>
      </ol>
    </div>
    <p style="color:#94a3b8;font-size:11px;margin:0">
      Enviado automáticamente desde Hub. Si no esperabas este email, ignóralo.
    </p>
  </div>
</body></html>`;
}
