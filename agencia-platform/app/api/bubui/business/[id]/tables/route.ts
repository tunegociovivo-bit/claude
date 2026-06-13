/**
 * GET /api/bubui/business/[id]/tables  → mesas abiertas para verificar/canjear.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";
import { loadTableState } from "@/lib/bubui/table";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const sessions = await prisma.bubuiTableSession.findMany({
    where: { businessId: params.id, status: { in: ["open", "verified"] } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, code: true, tableLabel: true, status: true, createdAt: true, expiresAt: true }
  });
  const items = await Promise.all(
    sessions.map(async (s) => {
      const loaded = await loadTableState(s.id);
      return {
        ...s,
        createdAt: s.createdAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        diners: loaded?.state.diners ?? 0,
        pctNow: loaded?.state.pctNow ?? 0,
        pctNextVisit: loaded?.state.pctNextVisit ?? 0,
        everyonePaidEntry: loaded?.state.everyonePaidEntry ?? false,
        pendingContributors: loaded?.state.pendingContributors ?? 0
      };
    })
  );
  return NextResponse.json({ ok: true, items });
}
