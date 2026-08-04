/**
 * Módulo Empleos — generar borradores bajo demanda.
 *
 *  POST → redacta con IA el email de revisión para las empresas de la fuente
 *  jobs que tengan email y aún no tengan borrador/secuencia. Útil para búsquedas
 *  antiguas o si el borrado automático al completar la búsqueda no llegó a crearse.
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { generateJobsReviewDrafts } from "@/lib/leads/exec-outreach";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*" }, async (_req, { api }) => {
  const res = await generateJobsReviewDrafts(api.workspaceId);
  return NextResponse.json({ ok: true, ...res });
});
