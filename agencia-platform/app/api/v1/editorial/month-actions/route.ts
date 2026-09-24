/**
 * Acciones en masa sobre todas las publicaciones de un mes/cliente:
 *   - approve: cambia DRAFT/REVIEW → APPROVED
 *   - schedule: requires explicit destination selection through publish-meta
 *   - publish: marca SCHEDULED → PUBLISHED + sella publishedAt = now
 *   - duplicate: copia las del mes origen al mes destino con status DRAFT
 *   - archive: cualquier → ARCHIVED
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { lockEditorialEdit, syncPublicationEdit } from "@/lib/editorial/sync-publication-edit";

const baseSchema = z.object({
  action: z.enum(["approve", "schedule", "publish", "duplicate", "archive"]),
  clientId: z.string().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  targetMonth: z.string().regex(/^\d{4}-\d{2}$/).optional() // solo para duplicate
});

function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split("-").map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m, 1))
  };
}

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => null);
  const parsed = baseSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  const { action, clientId, month, targetMonth } = parsed.data;

  const { start, end } = monthRange(month);
  const where: any = {
    workspaceId: api.workspaceId,
    scheduledFor: { gte: start, lt: end }
  };
  if (clientId) where.clientId = clientId;

  async function changeStatus(status: string, filter: any = where, manualPublished = false) {
    return prisma.$transaction(async tx => {
      const posts = await tx.editorialPost.findMany({ where: filter, orderBy: { id: "asc" }, select: { id: true } });
      const now = new Date();
      for (const item of posts) {
        const locked = await lockEditorialEdit(tx, item.id, api.workspaceId);
        await syncPublicationEdit(tx, locked, { status: manualPublished ? "ARCHIVED" : status }, api.userId);
        const updated = await tx.editorialPost.update({ where: { id: item.id }, data: { status, ...(manualPublished ? { publishedAt: now } : {}) } });
        await tx.editorialRevision.create({ data: {
          postId: item.id, authorId: api.userId ?? null,
          changeSummary: manualPublished ? "Marcada publicada manualmente (sin envío a Meta)" : `Estado del mes: ${status}`,
          body: JSON.stringify({ before: locked.post, after: updated })
        } });
      }
      return { count: posts.length };
    }, { timeout: 30000 });
  }

  if (action === "approve") {
    const r = await changeStatus("APPROVED", { ...where, status: { in: ["DRAFT", "REVIEW"] } });
    // Disparar webhook Make si está configurado en el workspace y hubo
    // pubs aprobadas. No bloquea la respuesta.
    if (r.count > 0) {
      const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
      const settings: any = ws?.settings ?? {};
      const webhookUrl: string | undefined = settings?.editorial?.makeWebhookUrl;
      if (webhookUrl && /^https:\/\//.test(webhookUrl)) {
        let clientName: string | undefined;
        if (clientId) {
          const c = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } });
          clientName = c?.name;
        }
        const payload = {
          event: "editorial.month_approved",
          workspace: ws?.name ?? null,
          cliente: clientName ?? null,
          clienteId: clientId ?? null,
          mes: month,
          aprobadas: r.count,
          timestamp: new Date().toISOString()
        };
        // Fire & forget, con timeout
        fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(8000)
        }).catch((err) => console.error("[editorial webhook] error:", err?.message ?? err));
      }
    }
    return NextResponse.json({ ok: true, affected: r.count });
  }
  if (action === "schedule") {
    throw new ApiError(400, "destinations_required", "Abre cada publicación, elige sus cuentas de destino y pulsa Programar en Meta.");
  }
  if (action === "publish") {
    const r = await changeStatus("PUBLISHED", { ...where, status: { in: ["SCHEDULED", "APPROVED"] } }, true);
    return NextResponse.json({ ok: true, affected: r.count });
  }
  if (action === "archive") {
    const r = await changeStatus("ARCHIVED");
    return NextResponse.json({ ok: true, affected: r.count });
  }
  if (action === "duplicate") {
    if (!targetMonth) throw new ApiError(400, "missing_target", "Falta targetMonth para duplicate");
    if (targetMonth === month) throw new ApiError(400, "same_month", "El mes destino no puede ser el mismo");
    const source = await prisma.editorialPost.findMany({ where });
    const [ty, tm] = targetMonth.split("-").map(Number);
    let created = 0;
    for (const p of source) {
      if (!p.scheduledFor) continue;
      const origDay = p.scheduledFor.getUTCDate();
      const daysInTarget = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
      const newDay = Math.min(origDay, daysInTarget);
      const newDate = new Date(Date.UTC(ty, tm - 1, newDay, p.scheduledFor.getUTCHours(), p.scheduledFor.getUTCMinutes()));
      await prisma.editorialPost.create({
        data: {
          workspaceId: p.workspaceId,
          clientId: p.clientId,
          title: p.title,
          content: p.content,
          excerpt: p.excerpt,
          hashtags: p.hashtags,
          firstComment: p.firstComment,
          copyByNetwork: p.copyByNetwork as any,
          status: "DRAFT",
          format: p.format,
          networks: p.networks,
          mediaUrls: p.mediaUrls,
          thumbnail: p.thumbnail,
          metaJson: p.metaJson ?? undefined,
          scheduledFor: newDate
        }
      });
      created++;
    }
    return NextResponse.json({ ok: true, created });
  }
  throw new ApiError(400, "unknown_action", action);
});
