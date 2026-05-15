/**
 * Diagnóstico: qué hay aparcado en workspace.settings.pendingImport.
 * Solo admins.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

async function requireAdmin(workspaceId: string, userId: string | undefined) {
  if (!userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const me = await prisma.membership.findFirst({ where: { workspaceId, userId } });
  if (!me || me.role !== "ADMIN") throw new ApiError(403, "forbidden", "Solo admins");
}

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  await requireAdmin(api.workspaceId, api.userId);

  const ws = await prisma.workspace.findUnique({ where: { id: api.workspaceId } });
  const settings: any = (ws?.settings as any) ?? {};
  const pending: any = settings.pendingImport ?? {};

  // NV Dashboard
  const nvd = pending.nvDashboard ?? null;
  const pubs = Array.isArray(nvd?.publications) ? nvd.publications : [];
  const taxonomy = Array.isArray(nvd?.clientesTaxonomy) ? nvd.clientesTaxonomy : [];

  // Nombres de cliente derivados de las publicaciones
  const clientNamesFromPubs = new Set<string>();
  const sample: any[] = [];
  for (const p of pubs) {
    const arr = Array.isArray(p?.clientes) ? p.clientes : [];
    for (const t of arr) {
      const n = String(t?.name ?? "").trim();
      if (n) clientNamesFromPubs.add(n);
    }
    if (sample.length < 3) {
      sample.push({
        id: p.id,
        title: p.title,
        status: p.status,
        clientesTaxonomy: arr.map((t: any) => ({ name: t?.name, slug: t?.slug })),
        date: p.date,
        hasContent: typeof p.content === "string" && p.content.length > 0
      });
    }
  }

  // NV Leads
  const nvl = pending.nvLeads ?? null;
  const leadsTables = nvl?.tables ?? {};
  const tableCounts: Record<string, number> = {};
  for (const k of Object.keys(leadsTables)) {
    tableCounts[k] = Array.isArray(leadsTables[k]) ? leadsTables[k].length : 0;
  }

  // Clientes existentes en BD por nombre (para saber cuáles ya tenemos)
  const existingClients = await prisma.client.findMany({
    where: { workspaceId: api.workspaceId, deletedAt: null },
    select: { id: true, name: true }
  });
  const existingNamesLower = new Set(existingClients.map((c) => c.name.toLowerCase()));

  const fromTaxonomyNames = taxonomy.map((t: any) => String(t?.name ?? "")).filter(Boolean);
  const allFoundNames = Array.from(
    new Set([...fromTaxonomyNames, ...Array.from(clientNamesFromPubs)])
  );
  const alreadyInDb = allFoundNames.filter((n) => existingNamesLower.has(n.toLowerCase()));
  const willBeCreated = allFoundNames.filter((n) => !existingNamesLower.has(n.toLowerCase()));

  return NextResponse.json({
    processedAt: pending.processedAt ?? null,
    nvDashboard: nvd
      ? {
          publicationsCount: pubs.length,
          clientesTaxonomyCount: taxonomy.length,
          clientesTaxonomyNames: fromTaxonomyNames,
          clientNamesFoundInPublications: Array.from(clientNamesFromPubs),
          clienteConfigsKeys: Object.keys(nvd.clienteConfigs ?? {}),
          truncated: nvd.truncated ?? false,
          importedAt: nvd.importedAt ?? null,
          samplePublications: sample
        }
      : null,
    nvLeads: nvl
      ? {
          tableCounts,
          truncated: nvl.truncated ?? false,
          importedAt: nvl.importedAt ?? null
        }
      : null,
    existingClientsInDb: existingClients.length,
    clientsFoundInPending: {
      total: allFoundNames.length,
      alreadyInDb: alreadyInDb.length,
      willBeCreated: willBeCreated.length,
      willBeCreatedNames: willBeCreated.slice(0, 50)
    }
  });
});
