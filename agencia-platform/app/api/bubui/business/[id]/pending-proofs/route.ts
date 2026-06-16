/**
 * GET  /api/bubui/business/[id]/pending-proofs
 *   → capturas aceptadas de forma PROVISIONAL (la IA no pudo validar) que el
 *     negocio debe revisar a mano: de la Mesa Colectiva y de los cupones-reto.
 *
 * POST /api/bubui/business/[id]/pending-proofs   { kind, refId, type?, action }
 *   → action "approve" (quita la marca de provisional) o "reject" (deshace la
 *     acción/activación).
 *
 * Auth: token del panel (Bearer <businessId>:<secret>).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const businessId = params.id;

  // Mesa: participantes con alguna acción verificada provisional.
  const parts = await prisma.bubuiTableParticipant.findMany({
    where: {
      session: { businessId },
      OR: [
        { reviewVerified: true, reviewProvisional: true },
        { socialVerified: true, socialProvisional: true },
        { followVerified: true, followProvisional: true }
      ]
    },
    include: { session: { select: { tableLabel: true, createdAt: true, status: true } } },
    orderBy: { joinedAt: "desc" },
    take: 100
  });

  const TYPE_LABEL: Record<string, string> = { review: "Reseña", photo: "Foto en redes", follow: "Seguir en redes" };
  const mesa: any[] = [];
  for (const p of parts) {
    if (p.reviewVerified && p.reviewProvisional)
      mesa.push({ kind: "mesa", refId: p.id, type: "review", typeLabel: TYPE_LABEL.review, shotUrl: p.reviewShotUrl, label: p.session.tableLabel || "Mesa", date: p.contributedAt ?? p.joinedAt, sessionStatus: p.session.status });
    if (p.socialVerified && p.socialProvisional)
      mesa.push({ kind: "mesa", refId: p.id, type: "photo", typeLabel: TYPE_LABEL.photo, shotUrl: p.socialShotUrl, label: p.session.tableLabel || "Mesa", date: p.contributedAt ?? p.joinedAt, sessionStatus: p.session.status });
    if (p.followVerified && p.followProvisional)
      mesa.push({ kind: "mesa", refId: p.id, type: "follow", typeLabel: TYPE_LABEL.follow, shotUrl: p.followShotUrl, label: p.session.tableLabel || "Mesa", date: p.contributedAt ?? p.joinedAt, sessionStatus: p.session.status });
  }

  // Cupones-reto activados de forma provisional.
  const offers = await prisma.bubuiOffer.findMany({
    where: { businessId, source: "share_challenge", activatedProvisional: true, redeemed: false },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  const challenge = offers.map((o) => ({
    kind: "challenge",
    refId: o.id,
    type: "challenge",
    typeLabel: o.rewardLabel?.trim() || `${o.discountPct}% de descuento`,
    shotUrl: o.activationShotUrl,
    label: "Cupón-reto",
    date: o.createdAt,
    expiresAt: o.expiresAt
  }));

  const items = [...mesa, ...challenge].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return NextResponse.json({ items, count: items.length });
}

const postSchema = z.object({
  kind: z.enum(["mesa", "challenge"]),
  refId: z.string().min(1),
  type: z.enum(["review", "photo", "follow"]).optional(),
  action: z.enum(["approve", "reject"])
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "validation" } }, { status: 400 });
  const { kind, refId, type, action } = parsed.data;

  if (kind === "mesa") {
    // El participante debe pertenecer a una mesa de ESTE negocio.
    const p = await prisma.bubuiTableParticipant.findFirst({
      where: { id: refId, session: { businessId: params.id } },
      select: { id: true }
    });
    if (!p) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
    const col = type === "review" ? "review" : type === "follow" ? "follow" : "social"; // photo→social
    const data: any = {};
    if (action === "approve") {
      data[`${col}Provisional`] = false; // validada por el camarero
    } else {
      data[`${col}Verified`] = false; // se deshace: sale del bote
      data[`${col}Provisional`] = false;
    }
    await prisma.bubuiTableParticipant.update({ where: { id: refId }, data });
    return NextResponse.json({ ok: true });
  }

  // challenge
  const o = await prisma.bubuiOffer.findFirst({ where: { id: refId, businessId: params.id, source: "share_challenge" }, select: { id: true } });
  if (!o) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  if (action === "approve") {
    await prisma.bubuiOffer.update({ where: { id: refId }, data: { activatedProvisional: false } });
  } else {
    // Rechazada: el cupón vuelve a quedar BLOQUEADO.
    await prisma.bubuiOffer.update({ where: { id: refId }, data: { active: false, activatedProvisional: false } });
  }
  return NextResponse.json({ ok: true });
}
