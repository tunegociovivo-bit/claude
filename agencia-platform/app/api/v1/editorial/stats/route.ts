/**
 * Estadísticas del calendario editorial.
 * GET ?month=YYYY-MM (opcional) ?clientId=...
 *
 * Devuelve conteos por status, formato, cliente, red, y una matriz
 * red × formato (para gráficos tipo heatmap).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const url = new URL(req.url);
  const month = url.searchParams.get("month");
  const clientId = url.searchParams.get("clientId") ?? undefined;

  const where: any = { workspaceId: api.workspaceId };
  if (clientId) where.clientId = clientId;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split("-").map(Number);
    where.scheduledFor = {
      gte: new Date(Date.UTC(y, m - 1, 1)),
      lt: new Date(Date.UTC(y, m, 1))
    };
  }

  const rows = await prisma.editorialPost.findMany({
    where,
    select: { status: true, clientId: true, format: true, networks: true, scheduledFor: true }
  });

  const byStatus: Record<string, number> = {};
  const byFormat: Record<string, number> = {};
  const byClient: Record<string, number> = {};
  const byNetwork: Record<string, number> = {};
  const byDayOfWeek: number[] = [0, 0, 0, 0, 0, 0, 0]; // lun=0..dom=6
  // Matriz red × formato: { instagram: { imagen: 3, reel: 5, ... }, ... }
  const networkFormatMatrix: Record<string, Record<string, number>> = {};

  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (r.format) byFormat[r.format] = (byFormat[r.format] ?? 0) + 1;
    if (r.clientId) byClient[r.clientId] = (byClient[r.clientId] ?? 0) + 1;

    if (r.scheduledFor) {
      // lun=0 .. dom=6
      const dow = (r.scheduledFor.getUTCDay() + 6) % 7;
      byDayOfWeek[dow]++;
    }

    let networks: string[] = [];
    try {
      const parsed = JSON.parse(r.networks);
      if (Array.isArray(parsed)) networks = parsed;
    } catch {}
    for (const n of networks) {
      byNetwork[n] = (byNetwork[n] ?? 0) + 1;
      if (r.format) {
        networkFormatMatrix[n] ??= {};
        networkFormatMatrix[n][r.format] = (networkFormatMatrix[n][r.format] ?? 0) + 1;
      }
    }
  }

  const clients = Object.keys(byClient).length
    ? await prisma.client.findMany({
        where: { id: { in: Object.keys(byClient) } },
        select: { id: true, name: true }
      })
    : [];
  const clientMap = new Map(clients.map((c) => [c.id, c.name]));

  return NextResponse.json({
    total: rows.length,
    byStatus,
    byFormat,
    byNetwork,
    byDayOfWeek,
    networkFormatMatrix,
    byClient: Object.entries(byClient).map(([id, n]) => ({ id, name: clientMap.get(id) ?? "—", count: n }))
  });
});
