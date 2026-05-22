/**
 * Inicia el OAuth "conectar una vez" del MCP de Meta. Registra el cliente
 * (DCR) si hace falta, genera PKCE+state y redirige al login de Facebook.
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { buildMcpAuthUrl } from "@/lib/integrations/meta-mcp";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const url = await buildMcpAuthUrl(api.workspaceId);
  return NextResponse.redirect(url);
});
