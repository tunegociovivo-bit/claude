import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { last9 } from "@/lib/phone";
import { inboxError, requireInboxUser } from "@/lib/inbox/api";

export const dynamic = "force-dynamic";

// GET ?contactId= → conversación de WhatsApp de una tarjeta del pipeline.
export async function GET(req: NextRequest) {
  try {
    const { workspaceId } = await requireInboxUser();
    const contactId = new URL(req.url).searchParams.get("contactId") ?? "";
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, workspaceId },
      select: { id: true, name: true, phone: true },
    });
    if (!contact) return Response.json({ error: "Contacto no encontrado" }, { status: 404 });
    let conversation = await prisma.conversation.findFirst({
      where: { workspaceId, contactId: contact.id },
      orderBy: { lastMessageAt: "desc" },
      select: { id: true },
    });
    if (!conversation && contact.phone) {
      const suffix = contact.phone.includes("@") ? contact.phone : last9(contact.phone);
      conversation = await prisma.conversation.findFirst({
        where: { workspaceId, phone: contact.phone.includes("@") ? suffix : { endsWith: suffix } },
        orderBy: { lastMessageAt: "desc" },
        select: { id: true },
      });
    }
    return Response.json({ conversationId: conversation?.id ?? null, contact });
  } catch (error) {
    return inboxError(error);
  }
}
