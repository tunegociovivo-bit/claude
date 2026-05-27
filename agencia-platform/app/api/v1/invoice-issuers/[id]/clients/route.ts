/**
 * Clientes asignados a una empresa emisora.
 *   GET  → { clientIds: string[] }
 *   PUT  → body { clientIds: string[] } reemplaza la asignación.
 *
 * La relación es N-M: un cliente puede pertenecer a varias empresas.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireAdmin } from "@/lib/api/admin";

async function getIssuer(workspaceId: string, id: string) {
  const issuer = await prisma.invoiceIssuer.findFirst({
    where: { id, workspaceId, deletedAt: null },
    select: { id: true }
  });
  if (!issuer) throw new ApiError(404, "not_found", "Emisor no encontrado");
  return issuer;
}

export const GET = withApi({ scope: "*", rate: "admin" }, async (_req, { api, params }) => {
  await requireAdmin(api);
  await getIssuer(api.workspaceId, params.id);
  const rows = await prisma.client.findMany({
    where: { workspaceId: api.workspaceId, deletedAt: null, issuers: { some: { id: params.id } } },
    select: { id: true }
  });
  return NextResponse.json({ clientIds: rows.map((r) => r.id) });
});

const putSchema = z.object({ clientIds: z.array(z.string()).max(10000) });

export const PUT = withApi({ scope: "*", rate: "admin" }, async (req, { api, params }) => {
  await requireAdmin(api);
  await getIssuer(api.workspaceId, params.id);
  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  // Solo clientes del workspace.
  const valid = await prisma.client.findMany({
    where: { workspaceId: api.workspaceId, deletedAt: null, id: { in: parsed.data.clientIds } },
    select: { id: true }
  });
  await prisma.invoiceIssuer.update({
    where: { id: params.id },
    data: { clients: { set: valid.map((c) => ({ id: c.id })) } }
  });
  return NextResponse.json({ clientIds: valid.map((c) => c.id) });
});
