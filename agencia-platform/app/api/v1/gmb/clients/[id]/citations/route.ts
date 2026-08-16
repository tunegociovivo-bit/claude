/**
 * Inventario de CITACIONES por ficha.
 *  GET  → citaciones + resumen por estado + recomendaciones de directorios (por sector).
 *  POST { action:"seed" } → crea filas para los directorios recomendados que falten (idempotente).
 *       { action:"export" } no aplica aquí (ver ?format=csv en GET).
 * Tenant-scoped. Nunca publica nada externamente.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { ensureGmbClient } from "@/lib/gmb/server";
import { recommendDirectories } from "@/lib/gmb/citations/directories";
import { isActionableStatus, type CitationStatus } from "@/lib/gmb/citations/engine";

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");

  const citations = await prisma.gmbCitation.findMany({
    where: { workspaceId: api.workspaceId, clientId: client.id },
    orderBy: [{ authority: "desc" }, { directoryName: "asc" }],
    select: { id: true, directorySlug: true, directoryName: true, city: true, sector: true, authority: true, url: true, status: true, napObserved: true, diffs: true, lastCheckedAt: true, attempts: true, lastError: true }
  });

  const byStatus: Record<string, number> = {};
  for (const c of citations) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  const actionable = citations.filter((c) => isActionableStatus(c.status as CitationStatus)).length;

  // Recomendaciones aún NO catalogadas para esta ficha.
  const have = new Set(citations.map((c) => c.directorySlug));
  const recommendations = recommendDirectories(client.category).filter((d) => !have.has(d.slug)).map((d) => ({ slug: d.slug, name: d.name, authority: d.authority, submitUrl: d.submitUrl }));

  return NextResponse.json({ ok: true, citations, summary: { total: citations.length, actionable, byStatus }, recommendations });
});

const postSchema = z.object({ action: z.enum(["seed"]).default("seed"), limit: z.number().int().min(1).max(50).default(20) });

export const POST = withApi({ scope: "*" }, async (req, { params, api }) => {
  const client = await ensureGmbClient(prisma, api.workspaceId, params.id);
  if (!client) throw new ApiError(404, "not_found", "Ficha no encontrada");
  const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const existing = await prisma.gmbCitation.findMany({ where: { workspaceId: api.workspaceId, clientId: client.id }, select: { directorySlug: true } });
  const have = new Set(existing.map((c) => c.directorySlug));
  const toSeed = recommendDirectories(client.category).filter((d) => !have.has(d.slug)).slice(0, parsed.data.limit);

  let created = 0;
  for (const d of toSeed) {
    // createMany con skipDuplicates evita choques con el unique [clientId, directorySlug].
    const res = await prisma.gmbCitation.createMany({
      data: [{ workspaceId: api.workspaceId, clientId: client.id, directorySlug: d.slug, directoryName: d.name, sector: client.category ?? "", city: "", authority: d.authority, status: "not_found", createdById: api.userId ?? null }],
      skipDuplicates: true
    });
    created += res.count ?? 0;
  }
  return NextResponse.json({ ok: true, created, catalogued: have.size + created });
});
