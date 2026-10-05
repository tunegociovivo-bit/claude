import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSameOrigin } from "@/lib/auth";
import { inboxError, requireInboxAdmin } from "@/lib/inbox/api";
import { ensurePrimaryLine } from "@/lib/inbox/lines";
import { ensureSessionStarted, isOwnSessionName, unlinkSession } from "@/lib/waha-connection";

export const dynamic = "force-dynamic";

async function ownLine(workspaceId: string, id: string) {
  const line = await prisma.whatsappLine.findFirst({ where: { id, workspaceId } });
  if (!line) return { error: Response.json({ error: "Número no encontrado" }, { status: 404 }) };
  if (line.mode !== "own") {
    return { error: Response.json({ error: "Los números enlazados se vinculan desde su propio sistema" }, { status: 400 }) };
  }
  return { line };
}

// POST → arrancar la sesión / renovar el QR del número.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!isSameOrigin(req)) return Response.json({ error: "Origen no permitido" }, { status: 403 });
    const user = await requireInboxAdmin();
    const { line, error } = await ownLine(user.workspaceId, params.id);
    if (error) return error;
    // Principal con sesión heredada (p.ej. "default"): se migra a la sesión
    // propia del negocio, igual que en Ajustes → WhatsApp.
    const session = isOwnSessionName(user.workspaceId, line.sessionName) ? line.sessionName : undefined;
    if (!session && !line.isPrimary) return Response.json({ error: "Sesión no gestionable" }, { status: 403 });
    const connection = await ensureSessionStarted(user.workspaceId, session);
    if (line.isPrimary) await ensurePrimaryLine(user.workspaceId);
    await prisma.whatsappLine.update({
      where: { id: line.id },
      data: { lastStatus: connection.status, lastStatusAt: new Date(), ...(connection.phone ? { phone: connection.phone } : {}) },
    });
    return Response.json({ connection });
  } catch (error) {
    return inboxError(error);
  }
}

// DELETE → desvincular el móvil (logout) para volver a escanear otro QR.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!isSameOrigin(req)) return Response.json({ error: "Origen no permitido" }, { status: 403 });
    const user = await requireInboxAdmin();
    const { line, error } = await ownLine(user.workspaceId, params.id);
    if (error) return error;
    if (!isOwnSessionName(user.workspaceId, line.sessionName)) {
      return Response.json({ error: "Esta sesión no se puede desvincular desde aquí" }, { status: 403 });
    }
    await unlinkSession(user.workspaceId, line.sessionName);
    await prisma.whatsappLine.update({ where: { id: line.id }, data: { lastStatusAt: null } });
    return Response.json({ ok: true });
  } catch (error) {
    return inboxError(error);
  }
}
