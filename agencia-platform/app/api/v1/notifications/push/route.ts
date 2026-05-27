import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { isPushEnabled, getPublicVapidKey } from "@/lib/push/web-push";

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1)
  }),
  userAgent: z.string().optional()
});

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!isPushEnabled()) {
    return NextResponse.json({ enabled: false, publicKey: null });
  }
  // ¿Tiene ya este usuario suscripciones activas?
  let hasAny = false;
  if (api.userId) {
    const count = await prisma.pushSubscription.count({ where: { userId: api.userId } });
    hasAny = count > 0;
  }
  return NextResponse.json({
    enabled: true,
    publicKey: getPublicVapidKey(),
    subscribed: hasAny
  });
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  if (!isPushEnabled()) throw new ApiError(503, "push_disabled", "Push no configurado en el servidor");
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");

  const body = await req.json().catch(() => null);
  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const existing = await prisma.pushSubscription.findUnique({
    where: { endpoint: parsed.data.endpoint }
  });
  if (existing) {
    // Re-suscripción: actualiza lastSeen + keys (a veces cambian) y dueño
    const updated = await prisma.pushSubscription.update({
      where: { id: existing.id },
      data: {
        userId: api.userId,
        p256dh: parsed.data.keys.p256dh,
        authKey: parsed.data.keys.auth,
        userAgent: parsed.data.userAgent ?? existing.userAgent,
        lastSeen: new Date()
      }
    });
    return NextResponse.json(updated);
  }

  const created = await prisma.pushSubscription.create({
    data: {
      userId: api.userId,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      authKey: parsed.data.keys.auth,
      userAgent: parsed.data.userAgent
    }
  });
  return NextResponse.json(created, { status: 201 });
});

export const DELETE = withApi({ scope: "*" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const url = new URL(req.url);
  const endpoint = url.searchParams.get("endpoint");
  if (endpoint) {
    await prisma.pushSubscription.deleteMany({
      where: { userId: api.userId, endpoint }
    });
  } else {
    await prisma.pushSubscription.deleteMany({ where: { userId: api.userId } });
  }
  return NextResponse.json({ ok: true });
});
