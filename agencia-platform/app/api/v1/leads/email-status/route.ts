/**
 * GET /api/v1/leads/email-status — comprobación NO DESTRUCTIVA de si el envío de email
 * está configurado para este workspace (env var RESEND_API_KEY o clave en la bóveda). No
 * envía ningún correo y NUNCA expone la clave (solo `configured` + `source`).
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { emailConfigStatus } from "@/lib/integrations/email";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  const status = await emailConfigStatus(api.workspaceId);
  return NextResponse.json(status); // { configured: boolean, source: "env" | "vault" | "none" }
});
