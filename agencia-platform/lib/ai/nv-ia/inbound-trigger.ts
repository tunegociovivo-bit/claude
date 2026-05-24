/**
 * Helper para Fase 10: cuando llega un evento externo (WhatsApp o
 * email entrante) y Sonia está configurada con inbound activo,
 * creamos una TASK en el proyecto buzón con el contenido del mensaje
 * y disparamos un AiAgentRun con el trigger adecuado.
 *
 * Sonia lo procesa: clasifica, busca contexto del cliente
 * (clientMemory si existe), y o redacta un draft de respuesta o
 * deja un comentario con propuesta de acción.
 *
 * SAFETY:
 * - Si Sonia no está configurada → no-op silencioso (devuelve null)
 * - Si inbound no está activo en settings → no-op
 * - Tope: no creamos task duplicada si ya hay otra del mismo
 *   externalMessageId en las últimas 24h
 */

import { prisma } from "@/lib/db/prisma";

export type InboundTriggerOpts = {
  workspaceId: string;
  /** Identificador externo único (whatsapp messageId, email Message-Id) — para dedupe. */
  externalId: string;
  /** Trigger type a usar. */
  trigger: "WHATSAPP_INBOUND" | "EMAIL_INBOUND" | "CALL_INBOUND";
  /** Título de la task (corto, accionable). Ej: "WhatsApp de +34600... — info sobre presupuesto". */
  taskTitle: string;
  /** Cuerpo del mensaje original (lo guardamos en description de la task). */
  body: string;
  /** Metadatos extra (from, to, subject...) — se serializan al description. */
  metadata: Record<string, string>;
  /** Si conocemos el clientId asociado (lead/cliente), lo enlazamos. */
  clientId?: string | null;
};

export async function triggerNvIaFromInbound(
  opts: InboundTriggerOpts
): Promise<{ taskId: string; runId: string } | null> {
  const ws = await prisma.workspace.findUnique({
    where: { id: opts.workspaceId },
    select: { settings: true }
  });
  const aiCfg = (ws?.settings as any)?.aiAgent;
  if (!aiCfg?.userId || !aiCfg?.inboxProjectId) return null;

  // Inbound config: settings.aiAgent.inbound.{whatsapp,email,call}.enabled
  const inboundKey =
    opts.trigger === "WHATSAPP_INBOUND"
      ? "whatsapp"
      : opts.trigger === "CALL_INBOUND"
      ? "call"
      : "email";
  const inboundCfg = aiCfg?.inbound?.[inboundKey];
  if (!inboundCfg?.enabled) return null;

  // Proyecto destino: cada canal puede tener el suyo
  // (settings.aiAgent.inbound.<canal>.projectId); si no, cae al buzón.
  const targetProjectId: string = inboundCfg?.projectId ?? aiCfg.inboxProjectId;

  // Dedupe: si hay una task creada en las últimas 24h con este
  // externalId en su descripción, no creamos otra (el msg vuelve a
  // llegar por webhook duplicado, retry de WAHA, reforward de email).
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existing = await prisma.task.findFirst({
    where: {
      workspaceId: opts.workspaceId,
      projectId: targetProjectId,
      createdAt: { gte: since },
      description: { contains: `external_id=${opts.externalId}` }
    },
    select: { id: true }
  });
  if (existing) return null;

  // Construir description con metadatos parseables + cuerpo
  const metaLines = Object.entries(opts.metadata)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const description =
    `[ENTRADA EXTERNA · ${opts.trigger}]\n` +
    `external_id=${opts.externalId}\n` +
    `${metaLines}\n\n` +
    `---\n\n${opts.body.slice(0, 8000)}`;

  const task = await prisma.task.create({
    data: {
      workspaceId: opts.workspaceId,
      projectId: targetProjectId,
      clientId: opts.clientId ?? null,
      title: opts.taskTitle.slice(0, 500),
      description,
      status: "TODO",
      priority: "MEDIUM"
    }
  });

  const triggerCtx =
    opts.trigger === "WHATSAPP_INBOUND"
      ? `WhatsApp entrante de ${opts.metadata.from ?? "?"}. Asunto: "${opts.taskTitle.slice(0, 100)}"`
      : opts.trigger === "CALL_INBOUND"
      ? `Llamada de ${opts.metadata.from ?? "?"} (${opts.metadata.durationSec ?? "?"}s). Transcripción en description.`
      : `Email entrante de ${opts.metadata.from ?? "?"} a ${opts.metadata.to ?? "?"}. Asunto: "${opts.metadata.subject ?? opts.taskTitle.slice(0, 100)}"`;

  const run = await prisma.aiAgentRun.create({
    data: {
      workspaceId: opts.workspaceId,
      taskId: task.id,
      status: "PENDING",
      trigger: opts.trigger,
      triggerContext: triggerCtx
    }
  });

  return { taskId: task.id, runId: run.id };
}
