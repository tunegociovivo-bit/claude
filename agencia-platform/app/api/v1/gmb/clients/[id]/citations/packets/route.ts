/**
 * GET /api/v1/gmb/clients/[id]/citations/packets — paquetes de alta/corrección para TODAS las
 * citaciones accionables (not_found/inconsistent/pending), usando el NAP canónico. Solo lectura,
 * accionable y trazable; NO publica nada externamente. Tenant-scoped.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureGmbClient, getCanonicalNap } from "@/lib/gmb/server";
import { buildSubmissionPacket } from "@/lib/gmb/citations/engine";
import { directoryBySlug } from "@/lib/gmb/citations/directories";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const canonical = await getCanonicalNap(prisma, api.workspaceId, client);
  const cites = await prisma.gmbCitation.findMany({ where: { workspaceId: api.workspaceId, clientId: client.id, status: { in: ["not_found", "inconsistent", "pending", "prepared"] } }, select: { id: true, directorySlug: true, directoryName: true, status: true } });
  const packets = cites.map((c: any) => {
    const dir = directoryBySlug(c.directorySlug);
    return dir ? { citationId: c.id, status: c.status, ...buildSubmissionPacket(dir, canonical) } : null;
  }).filter(Boolean);
  return NextResponse.json({ ok: true, count: packets.length, canonical, packets });
});
