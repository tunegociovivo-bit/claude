/**
 * GET /api/v1/leads/export?searchId=... → CSV con todos los leads.
 *
 * Columnas alineadas con el plugin NV Leads Pro.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";

function csvCell(v: any): string {
  if (v === null || v === undefined) return "";
  const s = String(v).replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

export const GET = withApi({ scope: "*" }, async (req, { api }) => {
  const url = new URL(req.url);
  const searchId = url.searchParams.get("searchId") ?? undefined;
  // Lista de IDs separados por coma — usado por el bulk action "Exportar
  // CSV" desde la pestaña Leads tras seleccionar varios manualmente.
  const idsParam = url.searchParams.get("ids") ?? "";
  const ids = idsParam ? idsParam.split(",").filter(Boolean) : [];
  const where: any = { workspaceId: api.workspaceId };
  if (searchId) where.searchId = searchId;
  if (ids.length > 0) where.id = { in: ids };

  const leads = await prisma.lead.findMany({
    where,
    include: { competitors: { orderBy: { position: "asc" }, take: 3 } },
    orderBy: { score: "desc" },
    take: 5000
  });

  const header = [
    "ID",
    "Nombre",
    "Provincia",
    "Direccion",
    "Telefono",
    "Web",
    "Rating",
    "Resenas",
    "Pct positivas",
    "Pct negativas",
    "Posicion",
    "Score",
    "Urgencia",
    "Estado",
    "GMB URL",
    "Place ID",
    "Categoria",
    "Competidor 1",
    "Competidor 2",
    "Competidor 3"
  ];

  const lines: string[] = [];
  lines.push(header.map(csvCell).join(","));
  for (const l of leads) {
    lines.push(
      [
        l.id,
        l.name,
        l.province,
        l.formattedAddress ?? l.address,
        l.phone,
        l.website,
        l.rating,
        l.reviewsCount,
        l.positivePct,
        l.negativePct,
        l.position,
        l.score,
        l.urgency,
        l.contactStatus,
        l.gmbUrl,
        l.placeId,
        l.category,
        l.competitors[0]?.name ?? "",
        l.competitors[1]?.name ?? "",
        l.competitors[2]?.name ?? ""
      ]
        .map(csvCell)
        .join(",")
    );
  }
  const csv = "﻿" + lines.join("\n"); // BOM UTF-8

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${searchId ?? "all"}-${new Date().toISOString().slice(0, 10)}.csv"`
    }
  });
});
