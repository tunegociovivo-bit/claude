/**
 * GET  /api/v1/gmb/clients/[id]/snapshot → últimos snapshots
 * POST /api/v1/gmb/clients/[id]/snapshot → captura estado actual y detecta cambios
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { createGmbNotification } from "@/lib/integrations/gmb-hub";

export const dynamic = "force-dynamic";

const FIELDS = ["name", "rating", "reviewCount", "category", "phone", "website", "address"] as const;

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const c = await prisma.gmbClient.findFirst({ where: { id: params.id, workspaceId: api.workspaceId }, select: { id: true } });
  if (!c) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const snapshots = await prisma.gmbSnapshot.findMany({
    where: { clientId: params.id },
    orderBy: { createdAt: "desc" },
    take: 20
  });
  return NextResponse.json({ snapshots });
});

export const POST = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const client = await prisma.gmbClient.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId },
    select: { id: true, name: true, rating: true, reviewCount: true, category: true, phone: true, website: true, address: true }
  });
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");

  const snapshot: Record<string, any> = {};
  for (const f of FIELDS) snapshot[f] = (client as any)[f];

  const prev = await prisma.gmbSnapshot.findFirst({
    where: { clientId: params.id },
    orderBy: { createdAt: "desc" }
  });

  const changes: Array<{ field: string; old: any; new: any }> = [];
  if (prev) {
    const prevData = (prev.data as any) ?? {};
    for (const f of FIELDS) {
      const oldV = String(prevData[f] ?? "");
      const newV = String(snapshot[f] ?? "");
      if (oldV !== newV) changes.push({ field: f, old: prevData[f] ?? null, new: snapshot[f] ?? null });
    }
  }

  const created = await prisma.gmbSnapshot.create({
    data: {
      workspaceId: api.workspaceId,
      clientId: params.id,
      data: snapshot,
      changes: changes.length ? changes : undefined
    }
  });

  if (changes.length > 0) {
    await createGmbNotification({
      workspaceId: api.workspaceId,
      clientId: params.id,
      type: "profile_change",
      title: `${changes.length} cambio(s) en ${client.name}`,
      body: changes.map((c) => `${c.field}: ${c.old} → ${c.new}`).join("; "),
      data: { changes }
    }).catch(() => {});
  }

  return NextResponse.json({ snapshot: created, changes, isFirst: !prev });
});
