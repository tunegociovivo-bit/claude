/**
 * DELETE /api/v1/ai/approvals/[id] — REVOCA una aprobación (admin, flag-gated).
 * Idempotente; registra el evento de auditoría inmutable. Tenant-scoped.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { orchestratorEnabled } from "@/lib/ai/orchestrator/flags";
import { revokeApproval } from "@/lib/ai/orchestrator/store";

export const dynamic = "force-dynamic";

export const DELETE = withApi({ scope: "*", rate: "admin", admin: true }, async (req, { api, params }) => {
  if (!orchestratorEnabled()) {
    return NextResponse.json({ error: { code: "disabled", message: "Orquestador desactivado" } }, { status: 404 });
  }
  await requireAdmin(api);
  const id = String((params as any)?.id ?? "");
  const body = await req.json().catch(() => null);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : null;

  const { ok } = await revokeApproval(prisma, { workspaceId: api.workspaceId, approvalId: id, revokedById: api.userId ?? null, reason, now: new Date() });
  if (!ok) {
    return NextResponse.json({ error: { code: "not_found", message: "Aprobación no encontrada o ya revocada" } }, { status: 404 });
  }
  return NextResponse.json({ revoked: true });
});
