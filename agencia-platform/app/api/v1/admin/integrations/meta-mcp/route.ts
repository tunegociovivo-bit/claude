/**
 * Conector MCP oficial de Meta (acceso total como el usuario).
 *
 * GET    → { configured }  (si hay token guardado o env META_MCP_TOKEN)
 * PUT    → body: { token } guarda el token de autorización (cifrado) en
 *          workspace.settings.integrations.metaMcp.tokenEnc
 * DELETE → borra el token guardado
 *
 * Con el token puesto, Sonia usa meta_via_mcp automáticamente cuando el
 * token permanente no tiene permisos sobre una cuenta.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import { encryptSecret } from "@/lib/ai/crypto";
import { isMetaMcpConfigured, runMetaViaMcp } from "@/lib/integrations/meta-mcp";

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

  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { settings: true } });
  const settings: any = ws?.settings ?? {};
  settings.integrations = settings.integrations ?? {};
  settings.integrations.metaMcp = {
    ...(settings.integrations.metaMcp ?? {}),
    tokenEnc: encryptSecret(parsed.data.token.trim()),
    updatedAt: new Date().toISOString()
  };
  await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  return NextResponse.json({ ok: true, configured: true });
});

// POST → prueba el conector listando cuentas (solo lectura), para validar
// que el token guardado funciona como bearer del MCP de Meta.
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
    if (e?.constructor?.name === "MetaMcpNotConfiguredError") {
      throw new ApiError(400, "not_configured", "Guarda primero un token del MCP de Meta.");
    }
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 500) }, { status: 502 });
  }
});

export const DELETE = withApi({ scope: "*", rate: "destructive" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId }, select: { settings: true } });
  const settings: any = ws?.settings ?? {};
  if (settings.integrations?.metaMcp) {
    delete settings.integrations.metaMcp;
    await prisma.workspace.update({ where: { id: api.workspaceId }, data: { settings } });
  }
  return NextResponse.json({ ok: true, configured: false });
});
