/**
 * Módulo Empleos — re-buscar el email de las empresas detectadas que se quedaron
 * sin él. Vuelve a enriquecer (Places + web, extractor mejorado) y redacta el
 * borrador de las que ahora sí tienen email.
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { reEnrichJobsLeads } from "@/lib/leads/search-manager";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*" }, async (_req, { api }) => {
  const res = await reEnrichJobsLeads(api.workspaceId);
  return NextResponse.json({ ok: true, ...res });
});
