/**
 * GET /api/bubui/table/[code]?ticket=200   → estado en vivo de la mesa.
 * Lo consultan todos los comensales para ver el indicador de ahorro en € y el
 * checklist. Lectura por código (cualquiera en la mesa lo ve), sin datos
 * sensibles más allá del agregado.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { loadTableState, mesaReviewUrl, mesaReviewPlatformLabel, allowedContributions } from "@/lib/bubui/table";
import { customerAuthOk } from "@/lib/bubui/customer-auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { code: string } }) {
  const url = new URL(req.url);
  const ticket = Number(url.searchParams.get("ticket") ?? "") || null;
  const meId = url.searchParams.get("me"); // customerId del que consulta (su estado propio)
  const session = await prisma.bubuiTableSession.findFirst({
    where: { code: params.code.toUpperCase() },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  if (!session) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  const loaded = await loadTableState(session.id, ticket);
  if (!loaded) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  const { session: s, state } = loaded;

  // Estado PROPIO del comensal que consulta (cada uno ve solo SU aporte), para
  // no confundir el progreso individual con el del grupo.
  let me:
    | { isNewUser: boolean; contributed: boolean; contributionType: string | null; sharedDone: boolean; reviewDone: boolean; reviewVerified: boolean; socialVerified: boolean }
    | null = null;
  if (meId && (await customerAuthOk(req, meId))) {
    const p = s.participants.find((pp) => pp.customerId === meId);
    if (p) me = { isNewUser: p.isNewUser, contributed: p.contributed, contributionType: p.contributionType, sharedDone: p.sharedDone, reviewDone: p.reviewDone, reviewVerified: p.reviewVerified, socialVerified: p.socialVerified };
  }
  return NextResponse.json({
    ok: true,
    sessionId: s.id,
    status: s.status,
    tableLabel: s.tableLabel,
    business: {
      id: s.business.id,
      name: s.business.name,
      googlePlaceId: s.business.googlePlaceId,
      reviewPlatform: s.business.mesaReviewPlatform || "google",
      reviewPlatformLabel: mesaReviewPlatformLabel(s.business),
      reviewUrl: mesaReviewUrl(s.business),
      perkLabel: (s.business.mesaPerkLabel || "").trim() || null,
      // Acciones de aporte que acepta el negocio (para mostrar solo esos botones).
      actions: allowedContributions(s.business)
    },
    expiresAt: s.expiresAt.toISOString(),
    ticketAmount: s.ticketAmount ?? null,
    finalPct: s.finalPct ?? null,
    me,
    state
  });
}
