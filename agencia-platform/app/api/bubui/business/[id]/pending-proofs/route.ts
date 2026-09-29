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

export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const businessId = params.id;

  // Mesa: participantes con alguna acción verificada provisional.
  const parts = await prisma.bubuiTableParticipant.findMany({
    where: {
      session: { businessId, status: { in: ["open", "verified"] }, expiresAt: { gt: new Date() } },
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
    where: { businessId, source: { in: ["share_challenge", "post_purchase"] }, activatedProvisional: true, redeemed: false },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  const challenge = offers.map((o) => ({
    kind: "challenge",
    refId: o.id,
    type: "challenge",
    typeLabel: o.rewardLabel?.trim() || `${o.discountPct}% de descuento`,
    shotUrl: o.activationShotUrl,
    label: o.source === "post_purchase" ? "Acción postcompra" : "Cupón-reto",
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

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "validation" } }, { status: 400 });
  const { kind, refId, type, action } = parsed.data;

  if (kind === "mesa") {
    if (!type) return NextResponse.json({ error: { code: "validation" } }, { status: 400 });
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
    const changed = await prisma.bubuiTableParticipant.updateMany({ where: { id: refId, session: { businessId: params.id, status: { in: ["open", "verified"] }, expiresAt: { gt: new Date() } }, [`${col}Provisional`]: true }, data });
    if (changed.count !== 1) return NextResponse.json({ error: { code: "invalid_state" } }, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  // challenge
  const o = await prisma.bubuiOffer.findFirst({ where: { id: refId, businessId: params.id, source: { in: ["share_challenge", "post_purchase"] } }, select: { id: true } });
  if (!o) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  const changed = await prisma.bubuiOffer.updateMany({
    where: { id: refId, businessId: params.id, source: { in: ["share_challenge", "post_purchase"] }, redeemed: false, activatedProvisional: true, expiresAt: { gt: new Date() } },
    data: { active: action === "approve", activatedProvisional: false }
  });
  if (changed.count !== 1) return NextResponse.json({ error: { code: "invalid_state" } }, { status: 409 });
  return NextResponse.json({ ok: true });
}
