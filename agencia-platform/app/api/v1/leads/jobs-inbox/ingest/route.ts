/**
 * Módulo Empleos — revisar la BANDEJA DE ALERTAS ahora (bajo demanda).
 *
 *  POST → lee los emails de alerta nuevos del buzón IMAP configurado, extrae las
 *  ofertas con IA, crea/actualiza los leads (marketing/IA) y deja sus emails en la
 *  cola de revisión. Sin scraping ni créditos de Scrapfly.
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ingestJobsInbox } from "@/lib/leads/search-manager";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*" }, async (_req, { api }) => {
  const res = await ingestJobsInbox(api.workspaceId);
  return NextResponse.json({ ok: true, ...res });
});
