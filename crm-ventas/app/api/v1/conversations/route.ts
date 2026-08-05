import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireWorkspaceId, unauthorized } from "@/lib/auth";
import { sendText } from "@/lib/waha";

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

export async function POST(req: NextRequest) {
  let workspaceId: string;
  try {
    workspaceId = await requireWorkspaceId();
  } catch {
    return unauthorized();
  }
  const parsed = replySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { phone, text } = parsed.data;
  try {
    const sent = await sendText({ workspaceId, to: phone, text });
    const contact = await prisma.contact.findFirst({
      where: { workspaceId, phone },
      select: { id: true },
    });
    const message = await prisma.message.create({
      data: {
        workspaceId,
        contactId: contact?.id,
        phone,
        direction: "out",
        body: text,
        externalId: sent.messageId,
        meta: { manual: true },
      },
    });
    return NextResponse.json({ message }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "No se pudo enviar" },
      { status: 502 }
    );
  }
}
