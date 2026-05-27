/**
 * Callback OAuth del MCP de Meta. Facebook redirige aquí con ?code&state.
 * Intercambia el code por tokens y vuelve a /admin/meta-mcp.
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { handleMcpCallback } from "@/lib/integrations/meta-mcp";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const url = new URL(req.url);
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://hub.negociovivo.app").replace(/\/+$/, "");
  const err = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (err) {
    return NextResponse.redirect(`${base}/admin/meta-mcp?error=${encodeURIComponent(err)}`);
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return NextResponse.redirect(`${base}/admin/meta-mcp?error=${encodeURIComponent("Faltan code/state")}`);
  }
  try {
    await handleMcpCallback(api.workspaceId, code, state);
    return NextResponse.redirect(`${base}/admin/meta-mcp?connected=1`);
  } catch (e: any) {
    return NextResponse.redirect(`${base}/admin/meta-mcp?error=${encodeURIComponent(String(e?.message ?? e).slice(0, 200))}`);
  }
});
