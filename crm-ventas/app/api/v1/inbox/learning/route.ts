import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isSameOrigin } from "@/lib/auth";
import { inboxError, requireInboxAdmin, requireInboxUser } from "@/lib/inbox/api";
import { learningOverview, refreshStyleGuide } from "@/lib/inbox/learning";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET → lo que ha aprendido la IA: guía de estilo, tasa de aceptación y últimas correcciones.
export async function GET() {
  try {
    const { workspaceId } = await requireInboxUser();
    return Response.json(await learningOverview(workspaceId));
  } catch (error) {
    return inboxError(error);
  }
}

const putSchema = z.object({
  styleGuide: z.string().max(4000).optional(),
  locked: z.boolean().optional(),
});

// PUT → editar la guía a mano (queda bloqueada para que no se reescriba sola).
export async function PUT(req: NextRequest) {
  try {
    if (!isSameOrigin(req)) return Response.json({ error: "Origen no permitido" }, { status: 403 });
    const { workspaceId } = await requireInboxAdmin();
    const parsed = putSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: "Datos no válidos" }, { status: 400 });
    const data = {
      ...(parsed.data.styleGuide !== undefined ? { styleGuide: parsed.data.styleGuide.trim(), locked: true } : {}),
      ...(parsed.data.locked !== undefined ? { locked: parsed.data.locked } : {}),
    };
    await prisma.inboxLearning.upsert({ where: { workspaceId }, create: { workspaceId, ...data }, update: data });
    return Response.json(await learningOverview(workspaceId));
  } catch (error) {
    return inboxError(error);
  }
}

// POST → volver a destilar la guía ahora con las últimas respuestas del equipo.
export async function POST(req: NextRequest) {
  try {
    if (!isSameOrigin(req)) return Response.json({ error: "Origen no permitido" }, { status: 403 });
    const { workspaceId } = await requireInboxAdmin();
    const result = await refreshStyleGuide(workspaceId, { force: true });
    if (!result) {
      return Response.json(
        { error: "Aún no hay suficientes respuestas del equipo (mínimo 3) o ya se está actualizando" },
        { status: 409 }
      );
    }
    return Response.json(await learningOverview(workspaceId));
  } catch (error) {
    console.error("[inbox-learning]", (error as Error)?.message);
    if ((error as Error)?.message === "UNAUTHORIZED" || (error as Error)?.message === "FORBIDDEN") return inboxError(error);
    return Response.json({ error: "La IA no está disponible ahora mismo" }, { status: 503 });
  }
}
