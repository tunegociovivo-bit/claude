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
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://hub.negociovivo.app").replace(/\/+$/, "");
  try {
    const url = await buildMcpAuthUrl(api.workspaceId);
    return NextResponse.redirect(url);
  } catch (e: any) {
    // Mostramos el motivo REAL (p.ej. fallo del registro dinámico) en la UI
    // en vez de un 500 opaco.
    return NextResponse.redirect(
      `${base}/admin/meta-mcp?error=${encodeURIComponent(String(e?.message ?? e).slice(0, 300))}`
    );
  }
});
