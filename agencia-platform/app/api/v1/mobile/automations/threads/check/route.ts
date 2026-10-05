import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { loadMobileAutomationAccess } from "@/lib/mobile/automation-access";
import { createThreadCheck } from "@/lib/mobile/thread-check";

export const dynamic = "force-dynamic";
const schema = z.object({ threadId: z.string().uuid() }).strict();

/** «Comprobar ahora»: un móvil de la conversación revisa reacciones y respuestas sin escribir nada. */
export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await loadMobileAutomationAccess(api.workspaceId, api.userId, { manager: true });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "validation_error", "Conversación no válida");
  try {
    const result = await createThreadCheck(api.workspaceId, parsed.data.threadId, { userId: api.userId });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    throw new ApiError(409, "nothing_to_check", error instanceof Error ? error.message : "No se puede comprobar");
  }
});
