/**
 * GET    /api/v1/admin/ai-agent/adhoc-credentials
 *        → Lista las KEYs almacenadas (sin valores), con timestamp
 *          y task de origen. Para auditoría / saber qué tiene
 *          Sonia guardado.
 *
 * DELETE /api/v1/admin/ai-agent/adhoc-credentials?key=META_ADS_TOKEN
 *        → Borra una credencial concreta. Útil cuando la integración
 *          oficial vuelve a estar operativa, o tras una rotación.
 *
 * Solo admin del workspace.
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { callerIsAdmin } from "@/lib/api/permissions";
import {
  listStoredAdhocCredentialKeys,
  deleteAdhocCredential
} from "@/lib/ai/nv-ia/adhoc-credentials";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const items = await listStoredAdhocCredentialKeys(api.workspaceId);
  return NextResponse.json({ items });
});

export const DELETE = withApi({ scope: "*" }, async (req, { api }) => {
  if (!(await callerIsAdmin(api))) throw new ApiError(403, "forbidden", "Solo admin");
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (!key) throw new ApiError(400, "missing_key", "Falta ?key=");
  const removed = await deleteAdhocCredential(api.workspaceId, key);
  return NextResponse.json({ ok: true, removed, key });
});
