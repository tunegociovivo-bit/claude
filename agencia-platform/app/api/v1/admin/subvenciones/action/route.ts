import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { createSubvencionTask, saveSubvencionFeedback } from "@/lib/subvenciones/operations";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  const parsed = z.discriminatedUnion("action", [
    z.object({ action: z.literal("feedback"), clientId: z.string().min(1), convocatoriaId: z.string().min(1), verdict: z.enum(["interesa", "no_encaja"]), reason: z.string().max(300).optional() }),
    z.object({ action: z.literal("create_task"), clientId: z.string().min(1), convocatoriaId: z.string().min(1) })
  ]).safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  if (parsed.data.action === "feedback") {
    await saveSubvencionFeedback({ workspaceId: api.workspaceId, ...parsed.data });
    return NextResponse.json({ ok: true });
  }
  try {
    const task = await createSubvencionTask({ workspaceId: api.workspaceId, clientId: parsed.data.clientId, convocatoriaId: parsed.data.convocatoriaId });
    return NextResponse.json({ ok: true, task });
  } catch (error) {
    throw new ApiError(400, "task_error", error instanceof Error ? error.message : "No se pudo crear la tarea");
  }
});
