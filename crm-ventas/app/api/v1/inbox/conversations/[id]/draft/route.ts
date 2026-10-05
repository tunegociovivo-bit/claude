import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSameOrigin } from "@/lib/auth";
import { inboxError, requireInboxUser } from "@/lib/inbox/api";
import { regenerateDraft } from "@/lib/inbox/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const lastRegeneration = new Map<string, number>();

// POST → nueva propuesta de la IA para este chat (no envía nada).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!isSameOrigin(req)) return Response.json({ error: "Origen no permitido" }, { status: 403 });
    const { workspaceId } = await requireInboxUser();
    const last = lastRegeneration.get(params.id) ?? 0;
    if (Date.now() - last < 4_000) {
      return Response.json({ error: "Espera unos segundos antes de pedir otra propuesta" }, { status: 429 });
    }
    lastRegeneration.set(params.id, Date.now());
    const updated = await regenerateDraft(workspaceId, params.id);
    if (!updated) return Response.json({ error: "Conversación no encontrada" }, { status: 404 });
    return Response.json({ aiDraft: updated.aiDraft, aiError: updated.aiError });
  } catch (error) {
    console.error("[inbox-draft]", (error as Error)?.message);
    if ((error as Error)?.message === "UNAUTHORIZED") return inboxError(error);
    return Response.json({ error: "La IA no está disponible ahora mismo" }, { status: 503 });
  }
}

// DELETE → descartar la propuesta actual.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!isSameOrigin(req)) return Response.json({ error: "Origen no permitido" }, { status: 403 });
    const { workspaceId } = await requireInboxUser();
    const result = await prisma.conversation.updateMany({
      where: { id: params.id, workspaceId },
      data: { aiDraft: null, aiDraftForId: null, aiError: null },
    });
    if (!result.count) return Response.json({ error: "Conversación no encontrada" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return inboxError(error);
  }
}
