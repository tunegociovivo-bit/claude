/**
 * POST /api/v1/notifications/push/test
 * Envía una notificación push de PRUEBA al usuario actual (a todos sus
 * dispositivos suscritos). Sirve para verificar que el pipeline de push
 * (VAPID + suscripción del dispositivo) funciona, sin esperar a un evento real.
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { isPushEnabled, sendPushToUser } from "@/lib/push/web-push";

export const POST = withApi({ scope: "*" }, async (_req, { api }) => {
  if (!isPushEnabled()) {
    throw new ApiError(503, "push_disabled", "Push no configurado en el servidor (faltan las claves VAPID).");
  }
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");

  const res = await sendPushToUser(api.userId, {
    title: "🔔 Notificación de prueba",
    body: "¡Funciona! Así te avisaremos de nuevos mensajes de WhatsApp y de borrados.",
    link: "/admin/notificaciones",
    tag: "test-push"
  });

  return NextResponse.json({ ok: true, sent: res.sent, removed: res.removed });
});
