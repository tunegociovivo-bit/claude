import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isSameOrigin } from "@/lib/auth";
import { inboxError, requireInboxUser } from "@/lib/inbox/api";
import { listLines, MAX_LINES_PER_WORKSPACE } from "@/lib/inbox/lines";
import { attachCrmWebhook } from "@/lib/waha-connection";

export const dynamic = "force-dynamic";

const schema = z.object({
  sessionName: z.string().trim().regex(/^[a-zA-Z0-9_.-]{1,64}$/),
  label: z.string().trim().min(1).max(60),
});

// Solo operadores NV: enlazar una sesión WAHA que ya existe (p.ej. un número
// del Hub) para leer y responder sus WhatsApp desde esta bandeja. No se
// desvincula ni se reinicia el móvil; solo se añade el webhook del CRM.
export async function POST(req: NextRequest) {
  try {
    if (!isSameOrigin(req)) return Response.json({ error: "Origen no permitido" }, { status: 403 });
    const user = await requireInboxUser();
    if (!user.isOperator || !user.isAdmin) {
      return Response.json({ error: "Solo un operador de Negocio Vivo puede enlazar números existentes" }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: "Nombre de sesión o etiqueta no válidos" }, { status: 400 });
    const lines = await listLines(user.workspaceId);
    if (lines.length >= MAX_LINES_PER_WORKSPACE) {
      return Response.json({ error: `Máximo ${MAX_LINES_PER_WORKSPACE} números por negocio` }, { status: 409 });
    }
    if (lines.some((l) => l.sessionName === parsed.data.sessionName)) {
      return Response.json({ error: "Ese número ya está en la bandeja" }, { status: 409 });
    }
    const elsewhere = await prisma.whatsappLine.findFirst({
      where: { sessionName: parsed.data.sessionName, NOT: { workspaceId: user.workspaceId } },
      select: { id: true },
    });
    if (elsewhere) return Response.json({ error: "Esa sesión ya está enlazada a otro negocio" }, { status: 409 });

    const state = await attachCrmWebhook(user.workspaceId, parsed.data.sessionName);
    const line = await prisma.whatsappLine.create({
      data: {
        workspaceId: user.workspaceId,
        sessionName: parsed.data.sessionName,
        label: parsed.data.label,
        mode: "linked",
        aiMode: "suggest",
        newChatsPerDay: 0,
        phone: state.phone,
        lastStatus: state.status,
        lastStatusAt: new Date(),
        // Número que ya estaba en uso: no necesita calentamiento.
        warmupSince: new Date(Date.now() - 30 * 86_400_000),
      },
    });
    return Response.json({ line: { id: line.id }, status: state.status }, { status: 201 });
  } catch (error) {
    return inboxError(error);
  }
}
