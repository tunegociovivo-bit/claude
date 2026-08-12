/**
 * POST /api/v1/facturacion/recurring-templates/pause  (Slice D)
 *
 * Pausa/reanuda MASIVA de plantillas Hub (reversible). Acción SENSIBLE (A4):
 *   - admin-only + tenant + doble flag opt-in (recurrentes + pausa),
 *   - selección EXPLÍCITA de ids,
 *   - mode:"preview" → DRY-RUN (plan + frase esperada, NO escribe),
 *   - mode:"commit"  → exige la FRASE de confirmación exacta; procesa por lotes con
 *                      checkpoint, auditoría e idempotencia; resultado parcial,
 *   - mode:"resume"  → reanuda una operación interrumpida desde su checkpoint.
 *
 * SOLO afecta al Hub (flag de estado). NUNCA toca Holded.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { recurringInvoicesEnabled, recurringPauseEnabled } from "@/lib/facturacion/recurring/flags";
import { previewPause, commitPause, resumeOperation } from "@/lib/facturacion/recurring/pause-store";

export const dynamic = "force-dynamic";

const MAX_IDS = 2000;

function gate() {
  return recurringInvoicesEnabled() && recurringPauseEnabled();
}

export const POST = withApi({ scope: "*", rate: "destructive" }, async (req, { api }) => {
  if (!gate()) {
    return NextResponse.json({ error: { code: "disabled", message: "Pausa masiva desactivada" } }, { status: 404 });
  }
  await requireAdmin(api);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: { code: "bad_request", message: "JSON inválido" } }, { status: 400 });
  }
  const action = body.action === "resume" ? "resume" : "pause";
  const mode = body.mode === "commit" || body.mode === "resumeOp" ? body.mode : "preview";
  const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: any) => typeof x === "string").slice(0, MAX_IDS) : [];

  if (mode === "resumeOp") {
    const opId = typeof body.operationId === "string" ? body.operationId : "";
    if (!opId) return NextResponse.json({ error: { code: "bad_request", message: "operationId requerido" } }, { status: 400 });
    return NextResponse.json(await resumeOperation(prisma, api.workspaceId, opId, api.userId ?? null));
  }

  if (mode === "preview") {
    return NextResponse.json({ mode, ...(await previewPause(prisma, api.workspaceId, action, ids)) });
  }

  // commit: exige la frase de confirmación fuerte.
  const phrase = typeof body.phrase === "string" ? body.phrase : "";
  const result = await commitPause(prisma, api.workspaceId, action, ids, phrase, api.userId ?? null);
  if (!result.ok && result.error === "phrase_mismatch") {
    return NextResponse.json({ error: { code: "phrase_mismatch", message: "La frase de confirmación no coincide. No se ha pausado nada." } }, { status: 400 });
  }
  return NextResponse.json({ mode: "commit", ...result });
});
