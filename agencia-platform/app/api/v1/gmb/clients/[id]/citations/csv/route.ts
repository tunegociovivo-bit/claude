/**
 * CSV de citaciones.
 *  POST { csv } → importa (valida). Upsert por directorio; registra lo declarado, sin inventar
 *    presencia. GET → exporta el inventario actual como CSV. Tenant-scoped.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureGmbClient } from "@/lib/gmb/server";
import { parseCitationsCsv, buildCitationsCsv } from "@/lib/gmb/citations/csv";
import { directoryBySlug, DIRECTORIES } from "@/lib/gmb/citations/directories";

export const dynamic = "force-dynamic";

const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const parsed = z.object({ csv: z.string().min(1).max(500_000) }).safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const { rows, errors } = parseCitationsCsv(parsed.data.csv);
  let imported = 0;
  for (const row of rows) {
    // Resuelve el directorio: por slug conocido, por nombre del catálogo, o slug derivado.
    const known = directoryBySlug(row.directory) ?? DIRECTORIES.find((d) => d.name.toLowerCase() === row.directory.toLowerCase());
    const slug = known?.slug ?? slugify(row.directory);
    const directoryName = known?.name ?? row.directory;
    const authority = known?.authority ?? 0;
    const napObserved = (row.name || row.address || row.phone || row.website) ? { name: row.name ?? "", address: row.address ?? "", phone: row.phone ?? "", website: row.website ?? "" } : undefined;
    const existing = await prisma.gmbCitation.findFirst({ where: { workspaceId: api.workspaceId, clientId: client.id, directorySlug: slug } });
    if (existing) {
      await prisma.gmbCitation.updateMany({ where: { id: existing.id, workspaceId: api.workspaceId }, data: { url: row.url || existing.url, status: row.status, ...(napObserved ? { napObserved } : {}), lastCheckedAt: new Date() } });
    } else {
      await prisma.gmbCitation.create({ data: { workspaceId: api.workspaceId, clientId: client.id, directorySlug: slug, directoryName, authority, url: row.url, status: row.status, napObserved, createdById: api.userId ?? null } });
    }
    imported++;
  }
  return NextResponse.json({ ok: true, imported, errors });
});

export const GET = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const citations = await prisma.gmbCitation.findMany({ where: { workspaceId: api.workspaceId, clientId: client.id }, orderBy: { authority: "desc" }, select: { directorySlug: true, directoryName: true, url: true, status: true, napObserved: true } });
  const csv = buildCitationsCsv(citations as any);
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="citaciones-${client.id}.csv"` } });
});
