/**
 * GET /api/v1/admin/subvenciones/match-all?limit=25
 * Cruza TODOS los clientes (con tope) y devuelve un resumen de oportunidades:
 * nº de subvenciones que encajan y la de mejor encaje, por cliente. Usa la
 * caché de 12 h del cruce, así que repetir es barato.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { matchForClient } from "@/lib/subvenciones/match";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get("limit")) || 25, 1), 60);
  const clients = await prisma.client.findMany({
    where: { workspaceId: api.workspaceId, status: "ACTIVE" },
    orderBy: { name: "asc" },
    take: limit,
    select: { id: true, name: true }
  });

  const rows: { clientId: string; clientName: string; count: number; topTitulo: string | null; topScore: number | null; topFechaFin: string | null }[] = [];
  for (const c of clients) {
    try {
      const matches = await matchForClient(api.workspaceId, c.id);
      const top = matches[0] ?? null;
      rows.push({
        clientId: c.id,
        clientName: c.name,
        count: matches.length,
        topTitulo: top?.titulo ?? null,
        topScore: top?.fitScore ?? null,
        topFechaFin: top?.fechaFin ? new Date(top.fechaFin).toISOString() : null
      });
    } catch {
      rows.push({ clientId: c.id, clientName: c.name, count: 0, topTitulo: null, topScore: null, topFechaFin: null });
    }
  }
  rows.sort((a, b) => b.count - a.count || (b.topScore ?? 0) - (a.topScore ?? 0));
  return NextResponse.json({ ok: true, procesados: clients.length, rows });
});
