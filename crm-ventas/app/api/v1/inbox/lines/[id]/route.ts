import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isSameOrigin } from "@/lib/auth";
import { inboxError, requireInboxAdmin } from "@/lib/inbox/api";
import { AI_MODES, syncPrimaryAiMode, type AiMode } from "@/lib/inbox/lines";
import { detachCrmWebhook, isOwnSessionName, unlinkSession } from "@/lib/waha-connection";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  active: z.boolean().optional(),
  aiMode: z.enum(AI_MODES as [AiMode, ...AiMode[]]).optional(),
  instructions: z.string().max(4000).optional(),
  dailyLimit: z.number().int().min(10).max(1000).optional(),
  hourlyLimit: z.number().int().min(5).max(200).optional(),
  newChatsPerDay: z.number().int().min(0).max(50).optional(),
  resetWarmup: z.literal(true).optional(),
  resume: z.literal(true).optional(), // quitar la pausa de seguridad
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!isSameOrigin(req)) return Response.json({ error: "Origen no permitido" }, { status: 403 });
    const user = await requireInboxAdmin();
    const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: "Valores no válidos" }, { status: 400 });
    const line = await prisma.whatsappLine.findFirst({ where: { id: params.id, workspaceId: user.workspaceId } });
    if (!line) return Response.json({ error: "Número no encontrado" }, { status: 404 });
    const { resetWarmup, resume, instructions, ...rest } = parsed.data;
    const updated = await prisma.whatsappLine.update({
      where: { id: line.id },
      data: {
        ...rest,
        ...(instructions !== undefined ? { instructions: instructions.trim() || null } : {}),
        ...(resetWarmup ? { warmupSince: new Date() } : {}),
        ...(resume ? { pausedUntil: null, pauseReason: null, consecutiveFailures: 0, lastStatusAt: null } : {}),
      },
    });
    if (line.isPrimary && rest.aiMode && rest.aiMode !== line.aiMode) {
      await syncPrimaryAiMode(user.workspaceId, rest.aiMode);
    }
    if (rest.active === false || rest.aiMode === "off") {
      // Nada pendiente de la IA debe salir por un número apagado.
      await prisma.outboundMessage.updateMany({
        where: { lineId: line.id, status: "queued", ...(rest.active === false ? {} : { origin: "auto" }) },
        data: { status: "canceled", lastError: "Número desactivado o IA apagada" },
      });
    }
    return Response.json({ ok: true, line: { id: updated.id } });
  } catch (error) {
    return inboxError(error);
  }
}

// DELETE → quitar un número adicional del CRM. Los propios se desvinculan
// (logout con las comprobaciones de seguridad); en los enlazados solo se retira
// el webhook del CRM. ?force=1 lo quita del CRM aunque WAHA no responda.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!isSameOrigin(req)) return Response.json({ error: "Origen no permitido" }, { status: 403 });
    const user = await requireInboxAdmin();
    const force = new URL(req.url).searchParams.get("force") === "1";
    const line = await prisma.whatsappLine.findFirst({ where: { id: params.id, workspaceId: user.workspaceId } });
    if (!line) return Response.json({ error: "Número no encontrado" }, { status: 404 });
    if (line.isPrimary) {
      return Response.json({ error: "El número principal se gestiona desde Ajustes → WhatsApp" }, { status: 400 });
    }
    if (line.mode === "linked" && !user.isOperator) {
      return Response.json({ error: "Solo un operador de Negocio Vivo puede quitar un número enlazado" }, { status: 403 });
    }
    try {
      if (line.mode === "own" && isOwnSessionName(user.workspaceId, line.sessionName)) {
        await unlinkSession(user.workspaceId, line.sessionName);
      } else if (line.mode === "linked") {
        await detachCrmWebhook(user.workspaceId, line.sessionName);
      }
    } catch (error) {
      if (!force) {
        return Response.json(
          { error: `${(error as Error)?.message ?? "WAHA no respondió"}. Puedes quitarlo igualmente del CRM.`, canForce: true },
          { status: 502 }
        );
      }
    }
    // Los chats de ese número NO pasan a otro número: el cliente escribió a
    // ese teléfono y recibir la respuesta desde otro sería confuso (y la IA
    // automática de otro número podría contestarle). Quedan como historial.
    await prisma.$transaction([
      prisma.outboundMessage.updateMany({
        where: { lineId: line.id, status: "queued" },
        data: { status: "canceled", lastError: "Número eliminado del CRM" },
      }),
      prisma.conversation.updateMany({
        where: { workspaceId: user.workspaceId, lineId: line.id },
        data: { aiStatus: "idle", aiDueAt: null, aiDraft: null, aiDraftForId: null },
      }),
      prisma.whatsappLine.delete({ where: { id: line.id } }),
    ]);
    return Response.json({ ok: true });
  } catch (error) {
    return inboxError(error);
  }
}
