import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isSameOrigin } from "@/lib/auth";
import { inboxError, requireInboxUser } from "@/lib/inbox/api";
import { describeDecision, enqueueOutbound, processIfDue } from "@/lib/inbox/outbound";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const schema = z.object({
  text: z.string().trim().min(1).max(4000),
  idempotencyKey: z.string().min(8).max(80).optional(),
});

// Respuesta manual desde la bandeja. Sale por el mismo número por el que
// escribió el cliente y pasa por todas las reglas anti-baneo.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!isSameOrigin(req)) return Response.json({ error: "Origen no permitido" }, { status: 403 });
    const user = await requireInboxUser();
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: "Escribe un mensaje (máx. 4.000 caracteres)" }, { status: 400 });
    const conversation = await prisma.conversation.findFirst({
      where: { id: params.id, workspaceId: user.workspaceId },
      select: { id: true, aiDraft: true, aiDraftForId: true, lastInboundId: true },
    });
    if (!conversation) return Response.json({ error: "Conversación no encontrada" }, { status: 404 });

    // La propuesta vigente de la IA se guarda junto al envío: así se aprende si
    // se aceptó tal cual, se corrigió o se reescribió.
    const draft =
      conversation.aiDraft && conversation.aiDraftForId === conversation.lastInboundId ? conversation.aiDraft : null;
    const { outbound, decision } = await enqueueOutbound({
      workspaceId: user.workspaceId,
      conversationId: conversation.id,
      body: parsed.data.text,
      origin: "manual",
      userId: user.userId,
      aiDraft: draft,
      idempotencyKey: parsed.data.idempotencyKey ?? null,
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
