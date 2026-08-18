/**
 * POST /api/v1/gmb/google/connect-locations — crea/actualiza fichas (GmbClient) a partir de las
 * ubicaciones GBP seleccionadas. Idempotente y deduplicado por (workspaceId, locationId): si la
 * ficha ya existe, actualiza sus metadatos; si no, la crea. Tenant-scoped. Nunca inventa datos.
 *
 * Body: { accountId: string, locations: Array<{ locationId, title, address?, phone?, website?, placeId?, primaryCategory? }> }
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type IncomingLocation = {
  locationId?: string;
  title?: string;
  address?: string | null;
  phone?: string | null;
  website?: string | null;
  placeId?: string | null;
  primaryCategory?: string | null;
};

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  const body = await req.json().catch(() => ({}));
  const accountId = String(body?.accountId ?? "").trim();
  const incoming: IncomingLocation[] = Array.isArray(body?.locations) ? body.locations : [];
  if (!accountId) throw new ApiError(400, "bad_request", "Falta accountId");

  // Sanea + deduplica por locationId dentro del propio payload.
  const byId = new Map<string, IncomingLocation>();
  for (const l of incoming) {
    const id = String(l?.locationId ?? "").trim();
    if (id) byId.set(id, l);
  }
  const locationIds = [...byId.keys()];
  if (locationIds.length === 0) throw new ApiError(400, "bad_request", "Selecciona al menos una ubicación");

  // Fichas ya existentes en este workspace para esas ubicaciones.
  const existing = await prisma.gmbClient.findMany({
    where: { workspaceId: api.workspaceId, locationId: { in: locationIds } },
    select: { id: true, locationId: true },
  });
  const existingByLoc = new Map(existing.map((e) => [e.locationId, e.id]));

  let created = 0;
  let updated = 0;
  for (const [locationId, l] of byId) {
    const data = {
      accountId,
      name: (l.title ?? "").trim() || "Ficha sin nombre",
      category: (l.primaryCategory ?? "").trim(),
      address: (l.address ?? "").trim(),
      phone: (l.phone ?? "").trim(),
      website: (l.website ?? "").trim(),
      placeId: (l.placeId ?? "").trim(),
    };
    const existingId = existingByLoc.get(locationId);
    if (existingId) {
      // Actualiza metadatos SIN sobrescribir status/config del piloto ya elegidos.
      await prisma.gmbClient.updateMany({ where: { id: existingId, workspaceId: api.workspaceId }, data });
      updated++;
    } else {
      await prisma.gmbClient.create({ data: { workspaceId: api.workspaceId, locationId, status: "active", ...data } });
      created++;
    }
  }

  await prisma.auditLog.create({
    data: {
      workspaceId: api.workspaceId,
      actorId: api.userId ?? null,
      action: "gmb.google.locations_linked",
      targetType: "GmbClient",
      meta: { accountId, created, updated, total: locationIds.length },
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true, created, updated, total: locationIds.length });
});
