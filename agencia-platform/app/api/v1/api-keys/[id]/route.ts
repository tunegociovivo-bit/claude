/**
 * DELETE /api/v1/api-keys/[id] — REVOCACIÓN real de una API key (admin, tenant-scoped).
 *
 * Marca `revokedAt` (soft-revoke) de forma IDEMPOTENTE y guardada por tenant: una key de
 * otro workspace o ya revocada → 404 (no filtra existencia cross-tenant). Tras revocar,
 * `authenticate()` la rechaza de inmediato (comprueba `revokedAt`). No borra la fila (deja
 * rastro de auditoría: quién/ cuándo se creó y usó por última vez).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";

export const dynamic = "force-dynamic";

export const DELETE = withApi({ scope: "admin", admin: true }, async (_req, { api, params }) => {
  await requireAdmin(api); // defensa en profundidad (además del gate central de withApi)
  const id = String((params as any)?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: { code: "bad_request", message: "id requerido" } }, { status: 400 });

  // Revoca SOLO si es del workspace del solicitante y aún está viva. updateMany guardado por
  // tenant + revokedAt:null → idempotente (una segunda revocación no reescribe la fecha).
  const res = await prisma.apiKey.updateMany({
    where: { id, workspaceId: api.workspaceId, revokedAt: null },
    data: { revokedAt: new Date() }
  });
  if (res.count !== 1) {
    // No existe, es de otro tenant, o ya estaba revocada → 404 uniforme (sin filtrar cuál).
    return NextResponse.json({ error: { code: "not_found", message: "API key no encontrada o ya revocada" } }, { status: 404 });
  }
  console.info(`[api-keys] revoked key ws=${api.workspaceId} id=${id} by=${api.userId ?? "?"}`);
  return NextResponse.json({ ok: true, id, revoked: true });
});
