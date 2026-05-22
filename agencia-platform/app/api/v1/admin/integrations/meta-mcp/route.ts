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
import {
  isMetaMcpConfigured,
  runMetaViaMcp,
  setManualMcpToken,
  disconnectMetaMcp,
  MetaMcpNotConfiguredError
} from "@/lib/integrations/meta-mcp";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  return NextResponse.json({ configured: await isMetaMcpConfigured(api.workspaceId) });
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

export const POST = withApi({ scope: "*", rate: "ai" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  try {
    const r = await runMetaViaMcp({
      workspaceId: api.workspaceId,
      instruction:
        "Lista las primeras 5 cuentas publicitarias a las que tienes acceso (nombre y act_id). Solo lectura, no cambies nada."
    });
    return NextResponse.json({ ok: r.ok, result: r.text });
  } catch (e: any) {
    if (e instanceof MetaMcpNotConfiguredError) {
      throw new ApiError(400, "not_configured", "Conecta primero el MCP de Meta.");
    }
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 500) }, { status: 502 });
  }
});

export const DELETE = withApi({ scope: "*", rate: "destructive" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  await disconnectMetaMcp(api.workspaceId);
  return NextResponse.json({ ok: true, configured: false });
});
