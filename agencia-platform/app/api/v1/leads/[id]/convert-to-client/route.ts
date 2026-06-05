/**
 * POST /api/v1/leads/[id]/convert-to-client
 *
 * Convierte un lead ganado en un Cliente del Hub con un clic: crea el Client
 * con los datos del negocio (nombre, teléfono, web, sector), marca el lead como
 * "client" y guarda el enlace en lead.convertedClientId. Idempotente: si ya se
 * convirtió, devuelve el cliente existente en vez de duplicarlo.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { indexEntity } from "@/lib/search/embeddings";
import { textForClient } from "@/lib/search/indexers";

export const POST = withApi({ scope: "*" }, async (_req, { params, api }) => {
  const lead = await prisma.lead.findFirst({
    where: { id: params.id, workspaceId: api.workspaceId }
  });
  if (!lead) throw new ApiError(404, "not_found", "Lead no encontrado");

  // Idempotencia: si ya se convirtió y el cliente sigue vivo, devolverlo.
  if (lead.convertedClientId) {
    const existing = await prisma.client.findFirst({
      where: { id: lead.convertedClientId, workspaceId: api.workspaceId, deletedAt: null },
      select: { id: true, name: true }
    });
    if (existing) {
      return NextResponse.json({ ok: true, clientId: existing.id, created: false });
    }
  }

  const notesParts = ["Captado con NV Leads Pro"];
  if (lead.province) notesParts.push(`Zona: ${lead.province}`);
  if (lead.gmbUrl) notesParts.push(`Ficha Google: ${lead.gmbUrl}`);

  const client = await prisma.client.create({
    data: {
      workspaceId: api.workspaceId,
      name: lead.name,
      phone: lead.phone ?? lead.internationalPhone ?? null,
      website: lead.website ?? null,
      industry: lead.category ?? null,
      notes: notesParts.join(". "),
      since: new Date()
    }
  });

  await prisma.lead.update({
    where: { id: lead.id },
    data: { convertedClientId: client.id, contactStatus: "client" }
  });

  void indexEntity({
    workspaceId: api.workspaceId,
    entityType: "CLIENT",
    entityId: client.id,
    text: textForClient(client as any)
  }).catch(() => {});

  return NextResponse.json({ ok: true, clientId: client.id, created: true });
});
