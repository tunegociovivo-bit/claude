/**
 * POST /api/bubui/business/[id]/custom-deal
 *
 * El comercio crea un "reto personalizado" para enviar a un cliente concreto
 * por WhatsApp: si el cliente trae N amigos, él se lleva clientDiscountPct y
 * cada amigo friendDiscountPct. Devuelve el enlace para el cliente + un enlace
 * de WhatsApp con mensaje prerrellenado.
 *
 * Auth: token de negocio (Bearer <businessId>:<secret>).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";
import { bubuiUrl } from "@/lib/bubui/url";

export const dynamic = "force-dynamic";

const schema = z.object({
  clientDiscountPct: z.number().int().min(1).max(90),
  friendsRequired: z.number().int().min(1).max(20),
  friendDiscountPct: z.number().int().min(0).max(90),
  title: z.string().trim().max(80).optional().nullable(),
  friendTitle: z.string().trim().max(80).optional().nullable(),
  // Texto del mensaje de WhatsApp escrito/editado por el dueño en el panel.
  // Si no llega, se genera la plantilla por defecto. El enlace del reto se
  // añade SIEMPRE al final aquí (así no se puede perder ni manipular).
  message: z.string().trim().max(600).optional().nullable(),
  requiresPurchase: z.boolean().optional(),
  expiresInDays: z.number().int().min(1).max(120).optional()
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized", message: "No autorizado" } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: parsed.error.issues[0]?.message ?? "Datos inválidos" } }, { status: 400 });
  }
  const d = parsed.data;
  const business = await prisma.bubuiBusiness.findUnique({ where: { id: params.id }, select: { name: true } });
  if (!business) return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });

  const token = randomBytes(8).toString("hex");
  const days = d.expiresInDays ?? 30;
  const deal = await prisma.bubuiCustomDeal.create({
    data: {
      token,
      businessId: params.id,
      title: d.title?.trim() || null,
      friendTitle: d.friendTitle?.trim() || null,
      // Solo persistimos el mensaje si el dueño lo personalizó: la página
      // /reto lo muestra tal cual; sin él usa su texto estructurado.
      message: d.message?.trim() || null,
      clientDiscountPct: d.clientDiscountPct,
      friendsRequired: d.friendsRequired,
      friendDiscountPct: d.friendDiscountPct,
      requiresPurchase: !!d.requiresPurchase,
      expiresAt: new Date(Date.now() + days * 86_400_000)
    }
  });

  const clientUrl = bubuiUrl(`/reto/${token}`);
  // OJO: el panel del negocio autogenera esta MISMA plantilla en su editor
  // de mensaje (bloque "Tus clientes te traen nuevos clientes"). Si cambias
  // la plantilla aquí, actualiza también la del panel para que coincidan.
  const friendTitle = d.friendTitle?.trim() || null;
  const body =
    d.message?.trim() ||
    `¡Te he preparado un reto en Bubui! 🎁\n\n` +
      `Si traes a ${d.friendsRequired} ${d.friendsRequired === 1 ? "amigo/a" : "amigos/as"}, tú te llevas ` +
      `${d.clientDiscountPct}% de descuento${d.title ? ` en ${d.title}` : ""} y cada ` +
      `amigo/a un ${d.friendDiscountPct}%${friendTitle ? ` en ${friendTitle}` : ""}.`;
  const waText = `${body}\n\nAcéptalo y compártelo aquí: ${clientUrl}`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(waText)}`;

  return NextResponse.json({ ok: true, token: deal.token, clientUrl, whatsappUrl }, { status: 201 });
}
