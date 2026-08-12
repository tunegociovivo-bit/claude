/**
 * Aprobaciones de autonomía (G6) — admin only, flag-gated (AI_RUN_ORCHESTRATOR).
 *   GET  → lista aprobaciones del workspace (vivas y revocadas), sin secretos.
 *   POST → CONCEDE una aprobación con TTL/actor/motivo/caps ESTRICTOS y registra el
 *          evento de auditoría inmutable. Rechaza comodines amplios y topes nulos
 *          para acciones sensibles (fail-closed reforzado).
 * Nunca hay aprobación implícita: este es el único camino de poblado.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { orchestratorEnabled } from "@/lib/ai/orchestrator/flags";
import { validateApprovalGrant } from "@/lib/ai/orchestrator/approvals";
import { grantApproval } from "@/lib/ai/orchestrator/store";

export const dynamic = "force-dynamic";

const disabled = () => NextResponse.json({ error: { code: "disabled", message: "Orquestador desactivado" } }, { status: 404 });

export const GET = withApi({ scope: "*", rate: "admin", admin: true }, async (_req, { api }) => {
  if (!orchestratorEnabled()) return disabled();
  await requireAdmin(api);
  const rows = await prisma.aiApproval.findMany({
    where: { workspaceId: api.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, action: true, scope: true, sensitive: true, maxAmountCents: true, maxVolume: true, remaining: true, reason: true, grantedById: true, expiresAt: true, revokedAt: true, revokedById: true, createdAt: true }
  });
  return NextResponse.json({ approvals: rows });
});

export const POST = withApi({ scope: "*", rate: "admin", admin: true }, async (req, { api }) => {
  if (!orchestratorEnabled()) return disabled();
  await requireAdmin(api);

  const body = await req.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action.trim() : "";
  const scope = typeof body?.scope === "string" && body.scope.trim() ? body.scope.trim() : null;
  const sensitive = body?.sensitive === true;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const maxAmountCents = Number.isFinite(body?.maxAmountCents) ? Math.floor(Number(body.maxAmountCents)) : null;
  const maxVolume = Number.isFinite(body?.maxVolume) ? Math.floor(Number(body.maxVolume)) : null;
  const remaining = Number.isFinite(body?.remaining) ? Math.floor(Number(body.remaining)) : null;
  const expiresAtMs = Date.parse(body?.expiresAt ?? "");
  const expiresAt = Number.isFinite(expiresAtMs) ? new Date(expiresAtMs) : null;

  const check = validateApprovalGrant({ action, scope, maxAmountCents, maxVolume, expiresAt, reason, sensitive, now: new Date() });
  if (!check.ok) {
    return NextResponse.json({ error: { code: "invalid_grant", message: check.error } }, { status: 400 });
  }

  const { id } = await grantApproval(prisma, {
    workspaceId: api.workspaceId,
    action,
    scope,
    sensitive,
    maxAmountCents,
    maxVolume,
    remaining,
    expiresAt: expiresAt!,
    grantedById: api.userId ?? null,
    reason
  });
  return NextResponse.json({ id, granted: true });
});
