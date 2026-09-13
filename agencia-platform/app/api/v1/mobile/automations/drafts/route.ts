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
  const purposes: Record<string, string> = {
    REAL_REVIEW: "Redacta una reseña personal sobre una visita real.",
    GROUP_DISCOVERY: "Resume los criterios que debe usar el usuario para seleccionar grupos relevantes de Facebook.",
    GROUP_JOIN_REQUEST: "Redacta una presentación breve y veraz para solicitar acceso a un grupo de Facebook.",
    COMMENT_DISCOVERY: "Resume los temas, preguntas y señales que debe localizar el Radar en la conversación.",
    COMMENT_REPLY: "Redacta una respuesta contextual, útil y genuina al comentario aportado.",
    OWNED_POST: "Redacta una publicación para una cuenta gestionada por el usuario.",
    GENUINE_COMMENT: "Redacta un comentario genuino para el destino indicado por el usuario.",
    LINK_SHARE: "Redacta un texto breve para compartir el enlace indicado."
  };
  const purpose = purposes[sourceKind] ?? purposes.LINK_SHARE;
  return [
    purpose,
    "Escribe solo el texto final, en español natural y listo para revisar.",
    "No inventes visitas, fechas, compras, platos, precios, conversaciones, resultados ni ubicaciones.",
    "Usa exclusivamente los hechos aportados. Si faltan detalles, mantén el texto prudente y general.",
    "No incluyas spam, llamadas repetitivas, afirmaciones engañosas ni hashtags innecesarios."
  ].join("\n");
}

export const POST = withApi({ scope: "*", rate: "ai" }, async (req, { api }) => {
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
  const existing = await prisma.mobileAutomationJob.findUnique({
    where: {
      workspaceId_idempotencyKey: {
        workspaceId: api.workspaceId,
        idempotencyKey: parsed.data.idempotencyKey
      }
    }
  });
  if (existing) {
    return NextResponse.json({ ok: true, job: existing, replayed: true });
  }
  const text = (await complete({
    workspaceId: api.workspaceId,
    userId: api.userId,
    feature: "mobile_automation_draft",
    model: "claude-haiku-4-5-20251001",
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
  const navigationOnly = parsed.data.sourceKind === "GROUP_DISCOVERY"
    || parsed.data.sourceKind === "COMMENT_DISCOVERY";
  const job = await prisma.$transaction(async (tx) => {
    const created = await tx.mobileAutomationJob.create({
      data: {
        workspaceId: api.workspaceId,
        phoneKey: parsed.data.phoneKey,
        deviceSerial: parsed.data.deviceSerial,
        platform: parsed.data.platform,
        action: navigationOnly ? "OPEN_URL" : "OPEN_URL_AND_COPY_TEXT",
        targetUrl,
        text,
        facts: parsed.data.facts,
        sourceKind: parsed.data.sourceKind,
        sourceRef: parsed.data.targetName || null,
        status: "PENDING_APPROVAL",
        scheduledAt,
        expiresAt: new Date(scheduledAt.getTime() + 7 * 24 * 60 * 60 * 1000),
        idempotencyKey: parsed.data.idempotencyKey,
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
