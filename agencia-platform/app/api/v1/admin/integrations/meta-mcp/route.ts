/**
 * Conector MCP oficial de Meta (acceso total como el usuario).
 *
 * GET    → { configured }
 * PUT    → body: { token }  guarda un token pegado a mano (fallback)
 * POST   → prueba la conexión (lista cuentas, solo lectura)
 * DELETE → desconecta (borra cliente + tokens)
 *
 * El flujo recomendado es "Conectar" (OAuth) en
 *   /api/v1/admin/integrations/meta-mcp/connect
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { prisma } from "@/lib/db/prisma";
import { setManualMcpToken, disconnectMetaMcp } from "@/lib/integrations/meta-mcp";
import { metaAdsListAdAccounts } from "@/lib/integrations/meta-ads";
import { readWorkspaceMetaToken } from "@/lib/meta/connection";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  // "Conectado" = hay un token de Meta a nivel workspace (Facebook Login o MCP).
  return NextResponse.json({ configured: !!(await readWorkspaceMetaToken(api.workspaceId)) });
});

const putSchema = z.object({ token: z.string().min(20) });

export const PUT = withApi({ scope: "*", rate: "destructive" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const raw = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  await setManualMcpToken(api.workspaceId, parsed.data.token);
  return NextResponse.json({ ok: true, configured: true });
});

// Prueba la CONEXIÓN REAL de Meta del workspace (token de usuario de
// Facebook Login) listando las cuentas accesibles vía Graph API.
export const POST = withApi({ scope: "*", rate: "ai" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  try {
    const accounts = await metaAdsListAdAccounts(api.workspaceId);
    const names = accounts.slice(0, 10).map((a: any) => `${a.name} (${a.id})`).join("\n");
    return NextResponse.json({
      ok: true,
      result: `Acceso correcto. ${accounts.length} cuentas accesibles:\n\n${names}${accounts.length > 10 ? "\n…" : ""}`
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 500) }, { status: 502 });
  }
});

export const DELETE = withApi({ scope: "*", rate: "destructive" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  await disconnectMetaMcp(api.workspaceId);
  // Desconecta también el login de Facebook (conexión Meta del workspace).
  await prisma.metaConnection.deleteMany({ where: { workspaceId: api.workspaceId } });
  return NextResponse.json({ ok: true, configured: false });
});
