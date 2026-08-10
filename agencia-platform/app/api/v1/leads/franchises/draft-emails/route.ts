/**
 * Franquicias — generar borradores de EMAIL bajo demanda.
 *
 *  POST → redacta el email de revisión para las centrales de franquicia con
 *  email y sin contactar (el origen Franquicias no admite WhatsApp) y lo deja
 *  en la cola de revisión de Empleos (misma cola: editar → aprobar → enviar).
 *  No envía nada por sí mismo.
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { generateFranchiseReviewDrafts } from "@/lib/leads/exec-outreach";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*", rate: "admin" }, async (_req, { api }) => {
  const res = await generateFranchiseReviewDrafts(api.workspaceId);
  return NextResponse.json({ ok: true, ...res });
});
