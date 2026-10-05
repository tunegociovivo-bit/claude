import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { inboxError, requireInboxAdmin } from "@/lib/inbox/api";
import { fetchQrPng, isOwnSessionName } from "@/lib/waha-connection";

export const dynamic = "force-dynamic";

// Proxy same-origin del QR: la URL y la API key de WAHA nunca llegan al navegador.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireInboxAdmin();
    const line = await prisma.whatsappLine.findFirst({ where: { id: params.id, workspaceId: user.workspaceId } });
    if (!line || line.mode !== "own") return Response.json({ error: "Número no encontrado" }, { status: 404 });
    const session = isOwnSessionName(user.workspaceId, line.sessionName) ? line.sessionName : undefined;
    const png = await fetchQrPng(user.workspaceId, session);
    return new Response(png, { status: 200, headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
  } catch (error) {
    return inboxError(error);
  }
}
