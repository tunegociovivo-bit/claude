/**
 * Módulo Empleos — regenerar el borrador de un email en revisión.
 *
 *  POST → vuelve a redactar el email con IA (mismo lead) y devuelve el nuevo
 *  {subject, body}. Útil para aplicar cambios de discurso a borradores ya creados.
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { regenerateReviewDraft } from "@/lib/leads/exec-outreach";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*" }, async (_req, { params, api }) => {
  try {
    const mail = await regenerateReviewDraft(api.workspaceId, params.id);
    return NextResponse.json({ ok: true, ...mail });
  } catch (e: any) {
    throw new ApiError(400, "regenerate_failed", String(e?.message ?? e));
  }
});
