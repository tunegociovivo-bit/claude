import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isSameOrigin, requireWorkspaceId, unauthorized } from "@/lib/auth";
import { backfillConversations } from "@/lib/inbox/conversations";
import { describeDecision, enqueueOutbound, processIfDue } from "@/lib/inbox/outbound";

// GET  → lista de conversaciones (o mensajes de un hilo con ?phone=)
// POST → responder manualmente a un hilo
export async function GET(req: NextRequest) {
  let workspaceId: string;
  try {
    workspaceId = await requireWorkspaceId();
  } catch {
    return unauthorized();
  }
  const { searchParams } = new URL(req.url);
  const phone = searchParams.get("phone");

  if (phone) {
    const messages = await prisma.message.findMany({
      where: { workspaceId, phone },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    return NextResponse.json({ messages });
  }

  // Agrupar por teléfono con el último mensaje de cada hilo
  const recent = await prisma.message.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: 500,
    include: { contact: { select: { id: true, name: true, stage: true } } },
  });
  const threads = new Map<string, (typeof recent)[number]>();
  for (const m of recent) {
    if (!threads.has(m.phone)) threads.set(m.phone, m);
  }
  return NextResponse.json({
    conversations: Array.from(threads.values()).map((m) => ({
      phone: m.phone,
      lastMessage: m.body,
      direction: m.direction,
      at: m.createdAt,
      contact: m.contact,
    })),
  });
}

const replySchema = z.object({
  phone: z.string().min(5),
  text: z.string().min(1).max(4000),
});

// Compatibilidad: la respuesta manual ahora pasa por la cola anti-baneo de la
// bandeja unificada (mismo número por el que escribió el cliente).
export async function POST(req: NextRequest) {
  let workspaceId: string;
  try {
    workspaceId = await requireWorkspaceId();
  } catch {
    return unauthorized();
  }
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const parsed = replySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { phone, text } = parsed.data;
  try {
    await backfillConversations(workspaceId);
    const conversation = await prisma.conversation.findUnique({
      where: { workspaceId_phone: { workspaceId, phone } },
      select: { id: true, aiDraft: true, aiDraftForId: true, lastInboundId: true },
    });
    if (!conversation) return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    const { outbound, decision } = await enqueueOutbound({
      workspaceId,
      conversationId: conversation.id,
      body: text,
      origin: "manual",
      aiDraft:
        conversation.aiDraft && conversation.aiDraftForId === conversation.lastInboundId ? conversation.aiDraft : null,
    });
    if (decision.kind === "block") {
      return NextResponse.json({ error: decision.reason, code: decision.code }, { status: 422 });
    }
    const final = await processIfDue(outbound);
    return NextResponse.json({ outbound: final, result: describeDecision(decision) }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "No se pudo enviar" },
      { status: 502 }
    );
  }
}
