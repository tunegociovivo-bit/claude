/**
 * POST /api/bubui/referral-click  → { code }
 *
 * La página de invitación (/bubui/r/<code>) registra el clic con la IP
 * (hasheada) del visitante. Es la atribución de RESERVA: si el amigo acaba
 * instalando la app sin el Install Referrer de Play (la buscó a mano, el
 * navegador de WhatsApp se comió la redirección, etc.), verify-otp busca un
 * clic reciente desde la misma IP y vincula el código igualmente.
 *
 * Público (la página no tiene sesión). Deduplicado por code+ipHash en 1h.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { hashIpFromHeaders } from "@/lib/bubui/referral-click";

export const dynamic = "force-dynamic";

const schema = z.object({
  code: z.string().trim().min(4).max(12),
  offerId: z.string().min(8).max(64).optional()
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation" } }, { status: 400 });
  }
  const code = parsed.data.code.toUpperCase();
  const offerId = parsed.data.offerId ?? null;
  const ipHash = hashIpFromHeaders(req.headers);
  if (!ipHash) return NextResponse.json({ ok: true }); // sin IP no hay match posible
  const uaRaw = req.headers.get("user-agent") ?? "";
  const ua = /android/i.test(uaRaw) ? "android" : /iphone|ipad|ipod/i.test(uaRaw) ? "ios" : "other";

  const hourAgo = new Date(Date.now() - 3600_000);
  const dup = await prisma.bubuiReferralClick.findFirst({
    where: { code, offerId, ipHash, createdAt: { gt: hourAgo } },
    select: { id: true }
  });
  if (!dup) {
    await prisma.bubuiReferralClick.create({ data: { code, offerId, ipHash, ua } }).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
