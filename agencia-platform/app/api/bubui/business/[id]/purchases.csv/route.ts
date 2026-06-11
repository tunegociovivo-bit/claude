/**
 * GET /api/bubui/business/[id]/purchases.csv?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Descarga CSV con todas las compras CONFIRMADAS del negocio en el
 * rango indicado (default últimos 90 días). Útil para contabilidad o
 * análisis externo.
 *
 * Auth simple: header Authorization Bearer <businessId>:<rand>.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";

export const dynamic = "force-dynamic";

function csvEscape(v: any): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  // Valida el secreto del token contra el apiToken del negocio (antes solo se
  // comprobaba el businessId del token, sin el secreto → bastaba conocer el id).
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const from = fromParam ? new Date(fromParam) : new Date(Date.now() - 90 * 86_400_000);
  const to = toParam ? new Date(toParam) : new Date();
  to.setHours(23, 59, 59, 999);

  const purchases = await prisma.bubuiPurchase.findMany({
    where: {
      businessId: params.id,
      status: "confirmed",
      scannedAt: { gte: from, lte: to }
    },
    orderBy: { scannedAt: "desc" },
    include: { customer: { select: { id: true, email: true, name: true } } }
  });

  const header = [
    "Fecha",
    "Hora",
    "ID compra",
    "Cliente nombre",
    "Cliente email",
    "Importe (€)",
    "% Descuento",
    "Descuento (€)",
    "Importe neto (€)",
    "Cupón cruzado"
  ].join(",");

  const rows = purchases.map((p) => {
    const fecha = p.scannedAt.toISOString().slice(0, 10);
    const hora = p.scannedAt.toISOString().slice(11, 19);
    const neto = (p.amount - p.discountAmount).toFixed(2);
    return [
      fecha,
      hora,
      p.id,
      csvEscape(p.customer.name ?? ""),
      csvEscape(p.customer.email),
      p.amount.toFixed(2),
      p.discountPct,
      p.discountAmount.toFixed(2),
      neto,
      p.redeemedOfferId ? "sí" : "no"
    ].join(",");
  });

  const csv = "﻿" + [header, ...rows].join("\n");
  const filename = `bubui-compras-${params.id.slice(0, 8)}-${from.toISOString().slice(0, 10)}-a-${to.toISOString().slice(0, 10)}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`
    }
  });
}
