/**
 * GET /api/v1/leads/email-list?searchId=&source=leads|clients|all&format=csv|json
 *
 * Lista de emails para REMARKETING (subir como Custom Audience a Meta Ads, que
 * hashea los emails en su lado). Combina emails de leads (extraídos de sus webs)
 * y de clientes, deduplicados. Solo emails de empresa con base legítima B2B; el
 * uso debe respetar el derecho de oposición (RGPD).
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
  const source = url.searchParams.get("source") ?? "all";
  const format = url.searchParams.get("format") ?? "csv";

  const rows: { email: string; name: string; phone: string | null; origin: string }[] = [];
  const seen = new Set<string>();
  const add = (email: string | null, name: string, phone: string | null, origin: string) => {
    const e = (email ?? "").trim().toLowerCase();
    if (!/^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(e) || seen.has(e)) return;
    seen.add(e);
    rows.push({ email: e, name, phone, origin });
  };

  if (source === "leads" || source === "all") {
    const where: any = { workspaceId: api.workspaceId, email: { not: null } };
    if (searchId) where.searchId = searchId;
    const leads = await prisma.lead.findMany({ where, select: { email: true, name: true, phone: true }, take: 20000 });
    for (const l of leads) add(l.email, l.name, l.phone, "lead");
  }
  if (source === "clients" || source === "all") {
    const clients = await prisma.client.findMany({
      where: { workspaceId: api.workspaceId, email: { not: null }, deletedAt: null },
      select: { email: true, name: true, phone: true },
      take: 20000
    });
    for (const c of clients) add(c.email, c.name, c.phone, "client");
  }

  if (format === "json") {
    return NextResponse.json({ total: rows.length, items: rows });
  }

  const header = ["email", "nombre", "telefono", "origen"];
  const lines = [header.join(",")];
  for (const r of rows) lines.push([r.email, r.name, r.phone ?? "", r.origin].map(csvCell).join(","));
  const csv = "﻿" + lines.join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="emails-remarketing-${new Date().toISOString().slice(0, 10)}.csv"`
    }
  });
});
