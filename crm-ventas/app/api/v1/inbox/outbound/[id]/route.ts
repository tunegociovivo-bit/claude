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
    const original = await prisma.outboundMessage.findFirst({
      where: { id: params.id, workspaceId: user.workspaceId, status: { in: ["failed", "blocked"] } },
    });
    if (!original) return Response.json({ error: "No hay nada que reintentar" }, { status: 404 });
    await prisma.outboundMessage.update({ where: { id: original.id }, data: { status: "canceled" } });
    const { outbound, decision } = await enqueueOutbound({
      workspaceId: user.workspaceId,
      conversationId: original.conversationId,
      body: original.body,
      origin: "manual",
      userId: user.userId,
      aiDraft: original.aiDraft,
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
