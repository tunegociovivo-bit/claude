/**
 * POST   /api/bubui/business/[id]/push/subscribe   → registra (upsert) la
 *        suscripción Web Push del panel del negocio en este dispositivo.
 * DELETE /api/bubui/business/[id]/push/subscribe?endpoint=...  → la elimina.
 *
 * Auth: token del panel (Bearer <businessId>:<secret>).
 * Body POST: { subscription: { endpoint, keys: { p256dh, auth } }, userAgent? }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { businessTokenAllows } from "@/lib/bubui/auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({ p256dh: z.string().min(10), auth: z.string().min(5) })
  }),
  userAgent: z.string().optional()
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation", message: parsed.error.message } }, { status: 400 });
  }
  const { subscription: s, userAgent } = parsed.data;
  await prisma.bubuiBusinessPushSubscription.upsert({
    where: { endpoint: s.endpoint },
    create: { businessId: params.id, endpoint: s.endpoint, p256dh: s.keys.p256dh, authKey: s.keys.auth, userAgent },
    update: { businessId: params.id, p256dh: s.keys.p256dh, authKey: s.keys.auth, userAgent }
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  if (!(await businessTokenAllows(req.headers.get("authorization"), params.id))) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const endpoint = new URL(req.url).searchParams.get("endpoint");
  if (endpoint) {
    await prisma.bubuiBusinessPushSubscription.deleteMany({ where: { businessId: params.id, endpoint } }).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
