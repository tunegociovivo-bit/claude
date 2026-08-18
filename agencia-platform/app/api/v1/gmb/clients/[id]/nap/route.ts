/**
 * NAP canónico VERSIONADO por ficha.
 *  GET  → versión activa (o derivada de la ficha si aún no hay ninguna).
 *  POST → crea una versión nueva y la activa (desactiva la anterior). Tenant-scoped.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureGmbClient, getCanonicalNap } from "@/lib/gmb/server";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().max(200).optional(),
  address: z.string().max(300).optional(),
  phone: z.string().max(40).optional(),
  website: z.string().max(300).optional()
});

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const nap = await getCanonicalNap(prisma, api.workspaceId, client);
  return NextResponse.json({ ok: true, nap });
});

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const prev = await prisma.gmbNapProfile.findFirst({ where: { workspaceId: api.workspaceId, clientId: client.id, active: true }, orderBy: { version: "desc" } });
  const nextVersion = (prev?.version ?? 0) + 1;
  // Desactiva versiones previas (tenant-scoped) y crea la nueva activa.
  await prisma.gmbNapProfile.updateMany({ where: { workspaceId: api.workspaceId, clientId: client.id, active: true }, data: { active: false } });
  const created = await prisma.gmbNapProfile.create({
    data: {
      workspaceId: api.workspaceId,
      clientId: client.id,
      version: nextVersion,
      active: true,
      name: parsed.data.name ?? prev?.name ?? client.name ?? "",
      address: parsed.data.address ?? prev?.address ?? client.address ?? "",
      phone: parsed.data.phone ?? prev?.phone ?? client.phone ?? "",
      website: parsed.data.website ?? prev?.website ?? client.website ?? "",
      createdById: api.userId ?? null
    }
  });
  return NextResponse.json({ ok: true, nap: { name: created.name, address: created.address, phone: created.phone, website: created.website, version: created.version } });
});
