import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { withApi } from "@/lib/api/handler";
import { complete } from "@/lib/ai/anthropic";
import { prisma } from "@/lib/db/prisma";
import { loadMobileAutomationAccess, requireLinkedMobile } from "@/lib/mobile/automation-access";
import {
  mobileAutomationDraftSchema,
  validateAutomationTargetUrl
} from "@/lib/mobile/automation-policy";

export const dynamic = "force-dynamic";

function generationSystemPrompt(sourceKind: string) {
  const purpose = sourceKind === "REAL_REVIEW"
    ? "Redacta una reseña personal sobre una visita real."
    : sourceKind === "OWNED_POST"
      ? "Redacta una publicación para una cuenta gestionada por el usuario."
      : sourceKind === "GENUINE_COMMENT"
        ? "Redacta un comentario genuino para el destino indicado por el usuario."
        : "Redacta un texto breve para compartir el enlace indicado.";
  return [
    purpose,
    "Escribe solo el texto final, en español natural y listo para revisar.",
    "No inventes visitas, fechas, compras, platos, precios, conversaciones, resultados ni ubicaciones.",
    "Usa exclusivamente los hechos aportados. Si faltan detalles, mantén el texto prudente y general.",
    "No incluyas spam, llamadas repetitivas, afirmaciones engañosas ni hashtags innecesarios."
  ].join("\n");
}

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  const { phones } = await loadMobileAutomationAccess(api.workspaceId, api.userId, { manager: true });
  const parsed = mobileAutomationDraftSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw new ApiError(
      400,
      "validation_error",
      parsed.error.issues[0]?.message ?? "Datos de automatización no válidos"
    );
  }
  requireLinkedMobile(phones, parsed.data.phoneKey, parsed.data.deviceSerial);
  const targetUrl = validateAutomationTargetUrl(parsed.data.platform, parsed.data.targetUrl);
  const text = (await complete({
    workspaceId: api.workspaceId,
    userId: api.userId,
    feature: "mobile_automation_draft",
    system: generationSystemPrompt(parsed.data.sourceKind),
    user: [
      parsed.data.targetName ? `Destino: ${parsed.data.targetName}` : null,
      `Plataforma: ${parsed.data.platform}`,
      parsed.data.tone ? `Tono: ${parsed.data.tone}` : null,
      `Hechos e instrucciones aportados por el usuario:\n${parsed.data.facts}`
    ].filter(Boolean).join("\n\n"),
    maxTokens: 1200
  })).trim().slice(0, 4000);
  if (!text) throw new ApiError(502, "empty_ai_draft", "La IA no ha generado ningún texto");

  const now = new Date();
  const scheduledAt = parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : now;
  const idempotencyKey = randomUUID();
  const job = await prisma.$transaction(async (tx) => {
    const created = await tx.mobileAutomationJob.create({
      data: {
        workspaceId: api.workspaceId,
        phoneKey: parsed.data.phoneKey,
        deviceSerial: parsed.data.deviceSerial,
        platform: parsed.data.platform,
        action: "OPEN_URL_AND_COPY_TEXT",
        targetUrl,
        text,
        facts: parsed.data.facts,
        sourceKind: parsed.data.sourceKind,
        sourceRef: parsed.data.targetName || null,
        status: "PENDING_APPROVAL",
        scheduledAt,
        expiresAt: new Date(scheduledAt.getTime() + 7 * 24 * 60 * 60 * 1000),
        idempotencyKey,
        createdById: api.userId
      }
    });
    await tx.mobileAutomationJobEvent.create({
      data: {
        workspaceId: api.workspaceId,
        jobId: created.id,
        event: "DRAFT_CREATED",
        actorType: "USER",
        actorId: api.userId,
        metadata: { platform: parsed.data.platform, sourceKind: parsed.data.sourceKind }
      }
    });
    return created;
  });
  return NextResponse.json({ ok: true, job }, { status: 201 });
});

