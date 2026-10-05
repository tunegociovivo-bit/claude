import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSameOrigin } from "@/lib/auth";
import { inboxError, requireInboxUser } from "@/lib/inbox/api";
import { describeDecision, enqueueOutbound, processIfDue } from "@/lib/inbox/outbound";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// DELETE → cancelar un mensaje programado que aún no ha salido.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!isSameOrigin(req)) return Response.json({ error: "Origen no permitido" }, { status: 403 });
    const { workspaceId } = await requireInboxUser();
    const result = await prisma.outboundMessage.updateMany({
      where: { id: params.id, workspaceId, status: { in: ["queued", "failed", "blocked"] } },
      data: { status: "canceled", lastError: "Cancelado por el usuario" },
    });
    if (!result.count) return Response.json({ error: "El mensaje ya se está enviando o no existe" }, { status: 409 });
    return Response.json({ ok: true });
  } catch (error) {
    return inboxError(error);
  }
}

// POST → reintentar un mensaje fallido o bloqueado (vuelve a pasar todas las reglas).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!isSameOrigin(req)) return Response.json({ error: "Origen no permitido" }, { status: 403 });
    const user = await requireInboxUser();
    // Reclamación atómica: dos clics (o dos personas) no generan dos envíos.
    const claimed = await prisma.outboundMessage.updateMany({
      where: { id: params.id, workspaceId: user.workspaceId, status: { in: ["failed", "blocked"] } },
      data: { status: "canceled", lastError: "Reintentado" },
    });
    if (!claimed.count) return Response.json({ error: "Ya se ha reintentado o no hay nada que reintentar" }, { status: 409 });
    const original = await prisma.outboundMessage.findUniqueOrThrow({ where: { id: params.id } });
    const { outbound, decision } = await enqueueOutbound({
      workspaceId: user.workspaceId,
      conversationId: original.conversationId,
      body: original.body,
      origin: "manual",
      userId: user.userId,
      aiDraft: original.aiDraft,
      idempotencyKey: `retry-${original.id}`,
    });
    const final = await processIfDue(outbound);
    return Response.json(
      { outbound: final, result: describeDecision(decision) },
      { status: decision.kind === "block" ? 422 : 201 }
    );
  } catch (error) {
    return inboxError(error);
  }
}
